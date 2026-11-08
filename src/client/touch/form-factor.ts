/**
 * Device form-factor probes shared by layout and touch modules.
 * @module dsh-solution-explorer/client/touch/form-factor
 */

/**
 * The shell's own layout mode flag (`data-dshm-mode` on `<html>`, set by the
 * dsh-mobile-layout plugin on phone portrait; empty on hosts that never set it).
 * @returns the mode string.
 */
export function dshmMode(): string {
  return document.documentElement.dataset.dshmMode ?? document.body?.dataset.dshmMode ?? ""
}

/**
 * Device orientation, independent of a soft keyboard shrinking the layout
 * viewport (which can otherwise make a portrait phone look "landscape").
 * @returns true when the device is held upright.
 */
function devicePortrait(): boolean {
  try {
    const orientation = window.screen?.orientation
    if (orientation !== undefined && typeof orientation.type === "string") {
      return orientation.type.startsWith("portrait")
    }
  } catch { /* fall through */ }
  try {
    return window.matchMedia("(orientation: portrait)").matches
  } catch {
    return window.innerHeight >= window.innerWidth
  }
}

/**
 * Whether this session runs on a phone held upright. The shell flag marks the
 * mobile form factor; the actual orientation still decides whether the panel
 * is a fullscreen sheet. A coarse pointer plus a portrait viewport is the
 * fallback for hosts that never set the attribute.
 * @returns true when the panel should behave as a fullscreen phone sheet.
 */
export function isPortraitPhone(): boolean {
  if (dshmMode() === "mobile") return devicePortrait()
  try {
    return window.matchMedia("(pointer: coarse)").matches && devicePortrait()
  } catch { return false }
}
