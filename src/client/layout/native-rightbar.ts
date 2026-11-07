/**
 * Native right-sidebar bridge — keeps this plugin's fullscreen phone sheet and
 * the shell's own right column (工作台) mutually exclusive, and makes the
 * official "open right sidebar" header button usable again on a portrait
 * phone.
 *
 * The official button is the only entry to the native column on the main
 * window (dsh-mobile-layout's classic preset has no workbench key). It is
 * hidden out from under the user twice over:
 *
 * 1. The sidebarRight store persists `expanded` across restarts while the
 *    mobile grid collapses the column track to 0 — the store claims open,
 *    nothing renders. The official header then hides the "expand" button
 *    (it believes the column is already shown), so neither of the two
 *    official toggles is reachable.
 * 2. Its one-click semantics are store-driven: with the stale persisted
 *    state a click would "collapse" an invisible column instead of opening.
 *
 * Both are fixed here rather than in dsh-mobile-layout: the exclusion duty is
 * this plugin's (our sheet covers the screen, so coexistence is ours to
 * refuse), and the button takeover rides the same click.
 * @module dsh-solution-explorer/client/layout/native-rightbar
 */

import { commands } from "../commands.ts"
import { isPortraitPhone } from "../touch/form-factor.ts"

/** The shell's sidebar-right face, structurally typed. */
interface SidebarRightFace {
  toggleExpanded?(): void
  isExpanded?(): boolean
}

type ServiceGetter = (name: string) => unknown

function serviceOf(get: ServiceGetter | undefined): SidebarRightFace | undefined {
  if (get === undefined) return undefined
  try {
    const face = get("sidebarRight") as SidebarRightFace | undefined
    return face !== null && typeof face === "object" ? face : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether the official panel actually occupies the screen.
 *
 * `data-sidebar-right-open` alone is not enough: on a narrow viewport the
 * panel node stays mounted while the column folds to zero width (the shell
 * writes `display:none` on it), so the attribute flips to "open" for a panel
 * nobody can see. Measured geometry is the only witness of a visible column.
 */
function panelVisible(): boolean {
  const panel = document.querySelector("[data-sidebar-right-panel]")
  if (!(panel instanceof HTMLElement)) return false
  if (getComputedStyle(panel).display === "none") return false
  return panel.getBoundingClientRect().width >= 1
}

/**
 * The native column's DOM truth: `data-sidebar-right-open` on a panel that is
 * really laid out. `null` when the panel is not mounted (store is the only
 * witness — and a stale one, per the module comment).
 */
function domOpen(): boolean | null {
  const panel = document.querySelector("[data-sidebar-right-panel]")
  if (!(panel instanceof HTMLElement)) return null
  if (!panel.hasAttribute("data-sidebar-right-open")) return false
  return panelVisible()
}

/** The store's idea of the open state, or `null` when it cannot be asked. */
function readStore(face: SidebarRightFace | undefined): boolean | null {
  if (face?.isExpanded === undefined) return null
  try {
    return Boolean(face.isExpanded())
  } catch {
    return null
  }
}

/**
 * Whether the native column currently covers the screen. On a portrait phone
 * an expanded right column always takes the fullscreen form; the frame flag
 * is the authoritative signal (the panel node may still be mounting).
 */
export function nativeRightbarFullscreen(): boolean {
  const frame = document.querySelector("[data-dshm-frame]")
  return frame instanceof HTMLElement && frame.hasAttribute("data-rightbar-fullscreen")
}

/**
 * Reconcile the persisted store with the DOM before any toggle, mirroring the
 * dance dsh-mobile-layout performs: a store that disagrees with a mounted
 * panel is first reset to the DOM truth, otherwise the next toggle is read as
 * "close the panel that is already open" and nothing happens on screen.
 * @returns the open state the store was left in, or `null` when the panel is
 * unmounted and only the store could be asked.
 */
function alignStore(face: SidebarRightFace | undefined): boolean | null {
  if (face?.toggleExpanded === undefined || face.isExpanded === undefined) return null
  const dom = domOpen()
  let store: boolean
  try {
    store = Boolean(face.isExpanded())
  } catch {
    return dom
  }
  if (dom !== null && store !== dom) {
    try {
      face.toggleExpanded()
    } catch {
      return dom
    }
    store = dom
  }
  return store
}

function clickOfficialToggle(selector: string): boolean {
  const button = document.querySelector(selector)
  if (!(button instanceof HTMLButtonElement)) return false
  button.click()
  return true
}

/**
 * Fold the column and reopen it on the next frame.
 *
 * Used whenever the store claims "expanded" while nothing is on screen: two
 * `toggleExpanded()` calls inside one event would be batched by React into
 * "still expanded" and produce no render at all, so the second one has to
 * land in a later task. The frame also lets the shell re-run its fullscreen
 * presentation, which is what actually paints the column on a phone.
 */
function reopenNextFrame(face: SidebarRightFace | undefined): void {
  const toggle = face?.toggleExpanded
  if (toggle === undefined) {
    clickOfficialToggle("[data-sidebar-right-expand]")
    return
  }
  try {
    toggle()
  } catch {
    return
  }
  requestAnimationFrame(() => {
    try {
      toggle()
    } catch {
      /* left folded: the next tap runs this again */
    }
  })
}

/**
 * Open the native right column, closing this plugin's sheet first: on a
 * portrait phone the two are both fullscreen, so only one may stand.
 * Falls back to the official header button when the service face is absent.
 * @returns true when an open was triggered.
 */
export function openNativeRightbar(get: ServiceGetter | undefined): boolean {
  if (isPortraitPhone() && panelIsOpen()) commands.togglePanel?.()
  const face = serviceOf(get)
  const dom = domOpen()
  if (dom === null) return clickOfficialToggle("[data-sidebar-right-expand]")
  if (dom) {
    // Painted and fullscreen: nothing to do.
    if (nativeRightbarFullscreen()) return true
    // Laid out but not presented fullscreen yet — same batched-toggle trap.
    reopenNextFrame(face)
    return true
  }
  if (readStore(face) === true) {
    // Stale `expanded`: the persisted store survived a cold start (or a switch
    // away from the conversation view) while the column was folded. Reset it
    // now and reopen on the next frame; a single toggle here would be a no-op.
    reopenNextFrame(face)
    return true
  }
  try {
    face?.toggleExpanded?.()
    return true
  } catch {
    return clickOfficialToggle("[data-sidebar-right-expand]")
  }
}

/**
 * Close the native right column when it stands. Runs before this plugin's
 * sheet expands (portrait exclusivity) and is a no-op everywhere else — a
 * desktop right column may coexist with the explorer panel as before.
 */
export function closeNativeRightbar(get: ServiceGetter | undefined): void {
  if (!nativeRightbarFullscreen() && domOpen() !== true) return
  const face = serviceOf(get)
  if (face?.toggleExpanded === undefined) {
    clickOfficialToggle("[data-sidebar-right-toggle]")
    return
  }
  // After this the store matches the mounted panel (or the panel is absent).
  const dom = alignStore(face)
  if (dom === null) {
    // Panel unmounted while the fullscreen flag stood: reset the stale store
    // so the header button reads "open" again, there is nothing else to do.
    let store = false
    try {
      store = Boolean(face.isExpanded?.())
    } catch {
      store = false
    }
    if (store) {
      try {
        face.toggleExpanded()
      } catch {
        /* the store stays stale; the next open realigns again */
      }
    }
    return
  }
  if (dom) {
    try {
      face.toggleExpanded()
    } catch {
      clickOfficialToggle("[data-sidebar-right-toggle]")
    }
  }
}

/**
 * Whether this plugin's sheet is standing — read through the command
 * registry so the module never imports panel state directly. `undefined`
 * (registry not bound yet) reads as "not open": guessing "open" here would
 * fold a sheet the user never opened.
 */
function panelIsOpen(): boolean {
  return commands.panelClosed?.() === false
}

/**
 * Keep the official "open right sidebar" entry reachable while the column is
 * not on screen.
 *
 * The shell renders that button `disabled` and `visibility:hidden` for as
 * long as the store says `expanded` — including the stale folded state where
 * the panel is `display:none`. A disabled button dispatches no click at all,
 * so without this the stale flag can never be dropped and the entry is gone
 * for good. Only the folded case is touched: once the column is really
 * painted, the shell's own hidden/disabled treatment is restored.
 */
function ensureEntry(): void {
  if (!isPortraitPhone()) return
  const panel = document.querySelector("[data-sidebar-right-panel]")
  if (panel instanceof HTMLElement && panel.hasAttribute("data-sidebar-right-open") && getComputedStyle(panel).display === "none") {
    // A folded panel keeps an inline `display:none` after the column was torn
    // down to zero width; the shell expresses folding with visibility and
    // transform, never with display, so this one is a leftover that would keep
    // a logically-open column invisible forever. Dropping it is safe: the open
    // attribute is the shell's own statement that the panel should be shown.
    panel.style.removeProperty("display")
  }
  const button = document.querySelector("[data-sidebar-right-expand]")
  if (!(button instanceof HTMLButtonElement)) return
  if (panelVisible() && nativeRightbarFullscreen()) {
    if (button.style.visibility === "visible") button.style.visibility = ""
    return
  }
  if (button.disabled) button.disabled = false
  if (button.style.visibility !== "visible") button.style.visibility = "visible"
}

/**
 * Bind the bridge. Registers the shared commands and intercepts the official
 * expand button on a portrait phone (capture phase, before the shell's own
 * handler): the interception re-aligns the store first so the very first tap
 * opens the column, and routes the open through the exclusivity rules above.
 * On non-phone form factors the button keeps its stock behavior untouched.
 * @param get - the context's soft service reader (`ctx.get`), optional.
 * @returns a disposer.
 */
export function bindNativeRightbar(get: ServiceGetter | undefined): () => void {
  commands.closeNativeRightbar = () => closeNativeRightbar(get)

  const onClick = (e: MouseEvent): void => {
    if (!isPortraitPhone()) return
    const target = e.target
    if (!(target instanceof Element)) return
    if (target.closest("[data-sidebar-right-expand]") === null) return
    e.preventDefault()
    e.stopPropagation()
    openNativeRightbar(get)
  }
  document.addEventListener("click", onClick, { capture: true })

  // The shell re-renders the header on every session/layout change and writes
  // `disabled` back on the entry each time. Re-check after the fact instead of
  // guessing when that render lands; the throttle keeps a streaming transcript
  // (which mutates the DOM constantly) from paying for a layout read per frame.
  let scheduled = false
  let lastRun = 0
  const scheduleEnsure = (): void => {
    if (scheduled) return
    scheduled = true
    const wait = Math.max(0, 200 - (performance.now() - lastRun))
    setTimeout(() => {
      scheduled = false
      lastRun = performance.now()
      ensureEntry()
    }, wait)
  }
  const observer = new MutationObserver(scheduleEnsure)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "data-sidebar-right-open", "data-rightbar-fullscreen"],
  })
  ensureEntry()

  return () => {
    observer.disconnect()
    document.removeEventListener("click", onClick, { capture: true } as EventListenerOptions)
    delete commands.closeNativeRightbar
  }
}

/**
 * Watch the shell for the native column taking the fullscreen form and step
 * this plugin's sheet aside when it does — only one right column may stand.
 * The attribute filter keeps the callback rare: only mutations of that one
 * attribute anywhere in the document reach it.
 * @returns a disposer.
 */
export function watchNativeRightbarExclusive(): () => void {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type !== "attributes") continue
      const frame = record.target
      if (!(frame instanceof HTMLElement)) continue
      if (!frame.hasAttribute("data-rightbar-fullscreen")) continue
      commands.nativeRightbarOpened?.()
    }
  })
  observer.observe(document, { attributes: true, attributeFilter: ["data-rightbar-fullscreen"], subtree: true })
  return () => observer.disconnect()
}
