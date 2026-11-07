/**
 * Panel touch gestures — swipe to collapse/expand the right column.
 *
 * Pure decision function + a thin binder, so the thresholds are unit-testable.
 * The gesture is horizontal-dominant only: vertical scrolls and scrollers
 * that still have horizontal room (diff view, terminal, code editor) are left
 * alone. It binds passively and never preventDefault — it only observes.
 *
 * The binder is a small state machine (idle → tracking → armed → fired) with
 * three jobs the old end-point measurement could not do:
 * - ask the arbitration gate *before* tracking, so a gesture the host or the
 *   left drawer owns never even enters the round;
 * - lock the direction at 24px, so a vertical scroll that drifts sideways —
 *   or a long press that turns into a text selection — is dropped early and
 *   for good;
 * - fire at most once per touch, with a cooldown, so a WebView that re-sends
 *   `touchend` cannot toggle the panel twice.
 * @module dsh-solution-explorer/client/touch/gestures
 */

/** Distance the finger must travel before a direction is confirmed. */
export const SWIPE_DIRECTION_CONFIRM = 24
/** Horizontal distance that triggers collapse/expand. */
export const SWIPE_TRIGGER = 48
/**
 * Right-edge zone (px) where an inward swipe opens the closed panel. Wide on
 * purpose: the outermost ~56 CSS px of a phone edge belong to the system's
 * full-screen (back) gesture — a swipe starting there never reaches the page.
 * A narrow zone forces the finger onto that strip, so opens are eaten by the
 * launcher more often than they land.
 */
export const EDGE_OPEN_ZONE = 120
/** Ignore any new gesture this soon after one fired (covers duplicate touchend). */
export const SWIPE_COOLDOWN = 300

export interface SwipeDecideInput {
  /** Total horizontal delta, positive = rightward. */
  dx: number
  /** Total vertical delta (absolute value). */
  dy: number
  /** True when the touch started inside a scroller that can still pan this way. */
  scrollerConsumes: boolean
  /** True when the panel column is currently folded to the rail. */
  collapsed: boolean
  /** Arbitration gate result (defaults to allowed, for old call sites). */
  allowed?: boolean
}

export type SwipeDecision = 'collapse' | 'expand' | null

/**
 * Decide what a completed touch swipe means for the panel column.
 * Horizontal must dominate, direction must be confirmed, and the trigger
 * distance reached. A swipe inside a horizontal scroller never collapses.
 *
 * This is the final verdict only; the early "vertical wins" abort lives in the
 * state machine (`touchmove`), where it can drop the round before the finger
 * has travelled far enough to make the net-displacement comparison meaningful.
 */
export function decidePanelSwipe({ dx, dy, scrollerConsumes, collapsed, allowed = true }: SwipeDecideInput): SwipeDecision {
  if (!allowed) return null
  if (scrollerConsumes) return null
  if (Math.abs(dx) < SWIPE_DIRECTION_CONFIRM) return null
  // A tie is not horizontal enough: 60px of vertical travel is a scroll.
  if (Math.abs(dx) <= Math.abs(dy)) return null
  if (Math.abs(dx) < SWIPE_TRIGGER) return null
  // Rightward on the expanded panel → fold; leftward on the rail → unfold.
  if (dx > 0 && !collapsed) return 'collapse'
  if (dx < 0 && collapsed) return 'expand'
  return null
}

/**
 * Selectors of elements that legitimately own horizontal panning inside the
 * panel: the terminal, syntax-highlighted/diff code blocks and any explicit
 * horizontal scroller.
 */
const SCROLLER_EXCLUDE = '.sol-exp-terminal, .sol-exp-hl'
const SCROLLER_FLAG = '[data-sol-exp-hscroll]'
/** Slack for "is there still room to pan" — sub-pixel scroll positions. */
const SCROLL_SLACK = 4

/**
 * Whether a scroller can still pan in the swipe's direction. A finger moving
 * left scrolls the content further right (`scrollLeft` grows); one moving
 * right scrolls back. Once the container sits at the edge it no longer
 * consumes the gesture — the swipe is free to mean "close the panel", which is
 * what users expect at the end of a diff or a wide table.
 */
function canPanFurther(el: HTMLElement, dx: number): boolean {
  const max = el.scrollWidth - el.clientWidth
  if (max <= SCROLL_SLACK) return false
  if (dx < 0) return el.scrollLeft < max - SCROLL_SLACK
  return el.scrollLeft > SCROLL_SLACK
}

/**
 * Whether the element under the finger (or an ancestor) owns this horizontal
 * pan. Explicitly flagged containers always win — they are an opt-out contract,
 * not something to second-guess by measuring scroll positions.
 */
function scrollerConsumes(target: EventTarget | null, dx: number): boolean {
  const el = target instanceof Element ? target : null
  if (el === null) return false
  if (el.closest(SCROLLER_FLAG) !== null) return true
  const owned = el.closest(SCROLLER_EXCLUDE)
  if (owned instanceof HTMLElement && canPanFurther(owned, dx)) return true
  let node: HTMLElement | null = el instanceof HTMLElement ? el : el.parentElement
  while (node !== null) {
    if (node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0) {
      const ov = getComputedStyle(node).overflowX
      // Only auto/scroll really pan horizontally. `hidden` merely clips —
      // decorative wrappers on the main page (shadow strips, absolutely
      // positioned chrome) overflow by a few px under hidden and must not
      // swallow the right-edge open gesture there.
      if ((ov === 'auto' || ov === 'scroll') && canPanFurther(node, dx)) return true
    }
    node = node.parentElement
  }
  return false
}

export interface PanelSwipeHandlers {
  onCollapse(): void
  onExpand(): void
  /** When false the binder is inert (e.g. dsh-mobile-layout owns the screen). */
  enabled(): boolean
  /** Current fold state of the panel column. */
  collapsed(): boolean
  /**
   * Arbitration gate, asked once per touch at `touchstart`. Returning false
   * drops the whole round: this binder never sees the end of that gesture.
   */
  allowed?(x: number, y: number, target: EventTarget | null): boolean
}

type Phase = 'idle' | 'tracking' | 'armed' | 'aborted'

/** Wall-clock ms; `performance.now` for monotonicity across clock changes. */
function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/**
 * Timestamp of the last fired gesture, shared by every binder. A phone swipe
 * raises one gesture, but a duplicate `touchend` (some WebViews send one) or a
 * sheet that re-mounts the column mid-gesture must not toggle twice.
 */
let lastFireAt = 0

interface Tracker {
  start(e: TouchEvent): void
  move(e: TouchEvent): void
  end(e: TouchEvent): void
  cancel(): void
}

/**
 * One gesture round. Owns the phase, the start point and the start target;
 * the binders only forward events.
 */
function createTracker(config: PanelSwipeHandlers & { zone?(x: number, y: number): boolean }): Tracker {
  let phase: Phase = 'idle'
  let startX = 0
  let startY = 0
  let startTarget: EventTarget | null = null

  const reset = () => {
    phase = 'idle'
    startTarget = null
  }

  const start = (e: TouchEvent) => {
    reset()
    if (!config.enabled()) return
    // Two fingers mean a pinch or a two-finger pan: never a panel gesture.
    if (e.touches.length !== 1) return
    if (nowMs() - lastFireAt < SWIPE_COOLDOWN) return
    const touch = e.touches[0]
    if (touch === undefined) return
    const x = touch.clientX
    const y = touch.clientY
    if (config.zone !== undefined && !config.zone(x, y)) return
    if (config.allowed !== undefined && !config.allowed(x, y, e.target)) return
    startX = x
    startY = y
    startTarget = e.target
    phase = 'tracking'
  }

  const move = (e: TouchEvent) => {
    if (phase !== 'tracking' && phase !== 'armed') return
    if (e.touches.length !== 1) {
      phase = 'aborted'
      return
    }
    const touch = e.touches[0]
    if (touch === undefined) return
    const dx = touch.clientX - startX
    const dy = touch.clientY - startY
    // Vertical wins as soon as it clearly dominates: the page is scrolling, or
    // a long press turned into a text selection. Drop the round for good —
    // coming back when the finger straightens out is what made the old
    // endpoint-only version fire on vertical scrolls.
    if (Math.abs(dy) > SWIPE_DIRECTION_CONFIRM / 2 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      phase = 'aborted'
      return
    }
    if (Math.abs(dx) >= SWIPE_DIRECTION_CONFIRM && Math.abs(dx) > Math.abs(dy)) phase = 'armed'
  }

  const end = (e: TouchEvent) => {
    if (phase !== 'tracking' && phase !== 'armed') {
      reset()
      return
    }
    const target = startTarget
    const x0 = startX
    const y0 = startY
    reset()
    const touch = e.changedTouches[0]
    if (touch === undefined) return
    const dx = touch.clientX - x0
    const dy = touch.clientY - y0
    const decision = decidePanelSwipe({
      dx,
      dy,
      scrollerConsumes: scrollerConsumes(target, dx),
      collapsed: config.collapsed(),
    })
    if (decision === null) return
    lastFireAt = nowMs()
    if (decision === 'collapse') config.onCollapse()
    else config.onExpand()
  }

  const cancel = () => {
    reset()
  }

  return { start, move, end, cancel }
}

/**
 * Bind observe-only swipe listeners to the panel column element.
 * Returns a disposer. All listeners are passive: the gesture never blocks
 * scrolling, it just measures start/move/end points.
 */
export function bindPanelSwipe(el: HTMLElement, handlers: PanelSwipeHandlers): () => void {
  const tracker = createTracker(handlers)
  const onStart = (e: TouchEvent) => tracker.start(e)
  const onMove = (e: TouchEvent) => tracker.move(e)
  const onEnd = (e: TouchEvent) => tracker.end(e)
  const onCancel = () => tracker.cancel()

  el.addEventListener('touchstart', onStart, { passive: true })
  el.addEventListener('touchmove', onMove, { passive: true })
  el.addEventListener('touchend', onEnd, { passive: true })
  el.addEventListener('touchcancel', onCancel, { passive: true })
  return () => {
    el.removeEventListener('touchstart', onStart)
    el.removeEventListener('touchmove', onMove)
    el.removeEventListener('touchend', onEnd)
    el.removeEventListener('touchcancel', onCancel)
  }
}

/**
 * Bind a right-edge inward swipe that expands the collapsed panel. On a phone
 * the closed column has zero width — nothing to swipe on — so the open
 * gesture lives on the document instead: start within the edge zone, end
 * leftward-dominant past the trigger.
 *
 * The zone is measured against the document's client width rather than
 * `window.innerWidth`: with a soft keyboard or a visual viewport offset the
 * two disagree, and the finger lives in layout pixels.
 * @returns a disposer.
 */
export function bindEdgeSwipeOpen(handlers: PanelSwipeHandlers): () => void {
  const tracker = createTracker({
    ...handlers,
    // Opening only makes sense while the panel is closed.
    enabled: () => handlers.enabled() && handlers.collapsed(),
    zone: (x: number) => {
      const width = document.documentElement.clientWidth || window.innerWidth
      return x >= width - EDGE_OPEN_ZONE
    },
  })
  const onStart = (e: TouchEvent) => tracker.start(e)
  const onMove = (e: TouchEvent) => tracker.move(e)
  const onEnd = (e: TouchEvent) => tracker.end(e)
  const onCancel = () => tracker.cancel()

  // Capture phase: the mobile layout plugin observes gestures at window
  // level, and any stopPropagation there would keep a bubble-phase listener
  // on `document` from ever firing.
  document.addEventListener('touchstart', onStart, { passive: true, capture: true })
  document.addEventListener('touchmove', onMove, { passive: true, capture: true })
  document.addEventListener('touchend', onEnd, { passive: true, capture: true })
  document.addEventListener('touchcancel', onCancel, { passive: true, capture: true })
  return () => {
    document.removeEventListener('touchstart', onStart, { capture: true } as EventListenerOptions)
    document.removeEventListener('touchmove', onMove, { capture: true } as EventListenerOptions)
    document.removeEventListener('touchend', onEnd, { capture: true } as EventListenerOptions)
    document.removeEventListener('touchcancel', onCancel, { capture: true } as EventListenerOptions)
  }
}
