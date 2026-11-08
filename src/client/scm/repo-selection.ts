/**
 * Active-repository selection — SCM domain, pure and dependency-free.
 *
 * The SCM view keeps one active working tree; every Git request resolves its
 * root through `gitRoot(state)`. This module owns the rule for keeping or
 * replacing that selection when the repository list is (re)loaded.
 * @module dsh-solution-explorer/client/scm/repo-selection
 */

/** Minimum shape of a discovered repository/worktree as the panel needs it. */
export interface RepoLike {
  path: string
  name: string
  branch: string
  kind?: string
}

/**
 * Choose the active repository path after a repository-list refresh.
 *
 * Rules (tasks/plan.md §4.3):
 * 1. Keep `current` when it is still present in `repos`.
 * 2. Otherwise fall back to the first discovered repository.
 * 3. With no discovered repository, fall back to the workspace `root`.
 *
 * The result never depends on mutable state, so callers can pass it through a
 * request generation guard without extra bookkeeping.
 *
 * @param repos - the freshly discovered repositories (may be empty).
 * @param current - the currently active repository path (may be empty).
 * @param root - the workspace root used when nothing was discovered.
 */
export function pickActiveRepo(repos: readonly RepoLike[], current: string, root: string): string {
  if (current && repos.some((repo) => repo.path === current)) return current
  const first = repos[0]
  return first ? first.path : root
}
