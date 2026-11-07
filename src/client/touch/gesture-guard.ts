/**
 * Gesture arbitration — does a touch that starts at this point belong to this
 * plugin at all?
 *
 * The right-edge open gesture is document-wide, so it competes with everything
 * the host and the mobile-layout plugin do with the same finger: the left
 * drawer, bottom sheets, the model picker, the settings page, modals, and the
 * native right column's fullscreen "workbench". Answering "is this pixel mine"
 * *before* measuring the swipe is what keeps one touch from being read twice.
 *
 * All host-DOM knowledge lives here — `gestures.ts` only consumes booleans, and
 * the host contract (`data-sidebar-*`, `data-shell-*`, `data-dshm-*`) has
 * exactly one place to change when the shell evolves.
 *
 * The criterion is the hit-test stack at the touch point, never "does a
 * matching node exist anywhere in the document". A closed dialog left mounted
 * with `opacity: 0` / `pointer-events: none` is still in the DOM; a document
 * scan would read it as "an overlay is up" and silently disable the gesture for
 * good. `elementsFromPoint` only reports what can actually be hit.
 *
 * Read-only by design: this module never writes another plugin's DOM.
 * @module dsh-solution-explorer/client/touch/gesture-guard
 */

/**
 * The panel only opens from the conversation view. Global panels (automations,
 * plugin management, …) keep the right edge free — they are pages, not chats,
 * and a fullscreen sheet over them reads as a glitch.
 */
export const CONVERSATION_ONLY = true

/**
 * Overlays that own the screen while they are up. Every entry is a stable,
 * public marker — host `data-sidebar-*` attributes, the mobile-layout plugin's
 * documented `data-dshm-*` hooks, or this plugin's own classes. Never a hashed
 * shell class.
 *
 * The drawer mask is deliberately absent: the shell renders `.drawerMask` in
 * *every* drawer-mode layout — collapsed included, where it is
 * `pointer-events:none` — so a static match would kill the open gesture on
 * every phone. The drawer is read from `data-sidebar-collapsed` instead, and a
 * physically covering mask is caught by the hit test.
 */
const BLOCKERS = [
  // Host shell
  '[data-rightbar-fullscreen]', // native right column in fullscreen (the "workbench")
  '[data-sidebar-right-open]', // native right column panel on screen
  '[data-shortcut-modal="settings"]', // host settings / shortcut editor
  '[data-shortcut-modal="sidebar"]', // host phone drawer (0.2.2-rc.1 renders it as an overlay dialog)
  '[role="dialog"][aria-modal="true"]', // any other modal dialog
  // dsh-mobile-layout
  '.dshm-sheet', // bottom sheet ("+", plugin sheet, …)
  '[data-dshm-picker]', // model / permission picker
  '[data-dshm-popover]', // popover menu
  '[data-dshm-header-menu]', // header "more" menu
  '[data-dshm-settings-panel]', // fullscreen settings page
  '[data-dshm-stats-dialog]', // token/stats dialog
  // This plugin
  '.sol-exp-modal-mask', // its own modal
  '.sol-exp-context-menu', // its own context menu
].join(',')

/** Text-entry surfaces never hand their horizontal pans to a global gesture. */
const EDITABLE = 'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"], [role="searchbox"]'

/** The conversation column, most authoritative anchor first. */
const CENTER_ANCHORS = ['[data-dshm-center]', '[class*="centerCol"]']

let debugFlag: boolean | null = null

/** Log the arbitration reason once per gesture when `sol-exp-debug=1`. */
function decline(reason: string): false {
  if (debugFlag === null) {
    try {
      debugFlag = window.localStorage.getItem('sol-exp-debug') === '1'
    } catch {
      debugFlag = false
    }
  }
  if (debugFlag) console.info('[dsh-solution-explorer] edge swipe declined:', reason)
  return false
}

/** Whether an element sits inside a known overlay. */
function withinBlocker(el: Element | null): boolean {
  if (el === null) return false
  return el.closest(BLOCKERS) !== null
}

/**
 * Everything hit-testable under the point, topmost first. Falls back to the
 * single-element API on WebViews without `elementsFromPoint` (Chromium < 43).
 */
function hitStack(x: number, y: number): Element[] {
  if (typeof document.elementsFromPoint === 'function') {
    return document.elementsFromPoint(x, y)
  }
  const one = document.elementFromPoint(x, y)
  return one === null ? [] : [one]
}

/**
 * The shell's own frame — the element carrying `data-sidebar-drawer` in drawer
 * (phone) mode. Null on layouts that never become a drawer.
 */
export function shellFrame(): HTMLElement | null {
  const marked = document.querySelector<HTMLElement>('[data-dshm-frame], [data-sidebar-drawer], [data-dsh-frame]')
  if (marked !== null) return marked
  const sidebar = document.querySelector<HTMLElement>('[data-dshm-sidebar], [class*="sidebarCol"]')
  const grid = sidebar?.parentElement ?? null
  return grid instanceof HTMLElement ? grid : null
}

/**
 * Whether the left drawer is expanded. Drawer layouts are the only ones where
 * the conversation is *behind* a fullscreen sidebar plus its mask, so every
 * swipe there belongs to the drawer — including the leftward one that closes
 * it, which is the exact gesture that used to fall through to this plugin and
 * open the sheet on top of the conversation.
 *
 * Two independent signals, so a shell change cannot silently re-open the bug:
 * the frame's own drawer state, and the host drawer overlay (0.2.2-rc.1 renders
 * it as `role="dialog"` + `data-shortcut-modal="sidebar"`).
 */
export function drawerOpen(): boolean {
  const frame = shellFrame()
  if (frame !== null && frame.hasAttribute('data-sidebar-drawer')) {
    if (!frame.hasAttribute('data-sidebar-collapsed')) return true
  }
  return drawerOverlayOpen()
}

/**
 * The host's own drawer overlay (0.2.2-rc.1). Only counts while it actually
 * occupies the viewport: a drawer that is mounted but translated off-screen, or
 * `aria-hidden`, must not shadow the gesture forever.
 */
function drawerOverlayOpen(): boolean {
  const el = document.querySelector('[data-shortcut-modal="sidebar"]')
  if (el === null) return false
  if (el.getAttribute('aria-hidden') === 'true') return false
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  return rect.right > 0 && rect.left < (document.documentElement.clientWidth || window.innerWidth)
}

/**
 * The conversation column. Three levels, because the shell's class names are
 * hashed per build and only the middle one is stable as a fragment:
 * 1. `[data-dshm-center]` — set by the mobile-layout plugin, authoritative;
 * 2. `[class*="centerCol"]` — the shell's own hashed class (`mP3x-q_centerCol`);
 * 3. the parent of the main panel (`[class*="mainPanel"]`).
 */
export function conversationColumn(): HTMLElement | null {
  for (const selector of CENTER_ANCHORS) {
    const found = document.querySelector<HTMLElement>(selector)
    if (found === null) continue
    if (found.closest('[data-solution-explorer]') !== null) continue
    return found
  }
  const mainPanel = document.querySelector<HTMLElement>('[class*="mainPanel"]')
  const column = mainPanel?.parentElement ?? null
  return column instanceof HTMLElement ? column : null
}

/**
 * Whether the main area currently renders the conversation (as opposed to a
 * global panel such as "automations"). The host marks the latter with
 * `data-global-panel` on the main panel; the mobile-layout plugin mirrors it
 * as `data-dshm-panel` on `<html>`, which is the fallback for older shells.
 */
export function isConversationPage(): boolean {
  const globalPanel = document.querySelector('[data-global-panel]')
  if (globalPanel !== null) return false
  const mainPanel = document.querySelector('[class*="mainPanel"]')
  if (mainPanel !== null) return true
  return !document.documentElement.hasAttribute('data-dshm-panel')
}

/** Whether a known overlay owns the pixel at this point. */
export function overlayOwnsPoint(x: number, y: number): boolean {
  for (const el of hitStack(x, y)) {
    if (withinBlocker(el)) return true
  }
  return false
}

/** Whether the touch started on a text-entry surface. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null
  if (el === null) return false
  return el.closest(EDITABLE) !== null
}

/**
 * The positive criterion: the topmost hit-testable element under the finger
 * must belong to the conversation column, and must not be an overlay.
 *
 * This is what makes "only on the conversation page" cheap and correct — with
 * the drawer open the column is `inert` and covered by the mask, so the hit
 * test cannot return anything inside it. One hit test replaces most of an
 * overlay blacklist.
 */
export function hitsConversationPage(x: number, y: number): boolean {
  const column = conversationColumn()
  if (column === null) return false
  const top = hitStack(x, y)[0] ?? null
  if (top === null) return false
  if (withinBlocker(top)) return false
  return column.contains(top)
}

/**
 * Total gate for the right-edge open gesture: may this touch open the panel?
 * @param x - touch start, CSS pixels.
 * @param y - touch start, CSS pixels.
 * @param target - the touch's original target (for the editable check).
 * @returns true only when nothing else owns the screen at this point.
 */
export function canOwnEdgeOpen(x: number, y: number, target: EventTarget | null): boolean {
  if (drawerOpen()) return decline('drawer-open')
  if (CONVERSATION_ONLY && !isConversationPage()) return decline('not-conversation')
  if (isEditableTarget(target)) return decline('editable')
  if (!hitsConversationPage(x, y)) return decline('miss-conversation')
  return true
}

/**
 * Gate for the fold gesture that lives on this plugin's own column: the column
 * is ours, but its inputs, its own modals and the workbench on top of it are
 * not.
 * @param target - the touch's original target.
 */
export function canOwnPanelSwipe(target: EventTarget | null): boolean {
  if (isEditableTarget(target)) return false
  const el = target instanceof Element ? target : null
  if (withinBlocker(el)) return false
  return true
}
