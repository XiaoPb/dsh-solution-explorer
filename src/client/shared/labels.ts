/**
 * Pure display-label helpers for the panel chrome.
 *
 * Kept free of React/DOM imports so `node --test` can exercise the real module
 * that ships (see test/labels.test.ts).
 * @module dsh-solution-explorer/client/shared/labels
 */

/** Workspace display name: the basename of a Windows or POSIX path. */
export function workspaceName(root: string): string {
  const trimmed = String(root ?? '').trim()
  if (trimmed === '') return ''
  return trimmed.split(/[\\/]/).filter(Boolean).pop() ?? trimmed
}

/** Whether a branch name can be shown (missing / git's "unknown" sentinel is not). */
export function isUsableBranch(branch: unknown): branch is string {
  if (typeof branch !== 'string') return false
  const value = branch.trim()
  return value !== '' && value !== 'unknown'
}

/** `↑ahead ↓behind`; empty when both counters are zero. */
export function syncLabel(ahead: number, behind: number): string {
  const up = Number.isFinite(ahead) && ahead > 0 ? `↑${Math.round(ahead)}` : ''
  const down = Number.isFinite(behind) && behind > 0 ? `↓${Math.round(behind)}` : ''
  return [up, down].filter(Boolean).join(' ')
}
