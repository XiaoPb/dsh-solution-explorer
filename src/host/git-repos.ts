/**
 * Git repository discovery for the SCM repository switcher.
 *
 * Boundary rules (tasks/plan.md §4.1–§4.2):
 * - The workspace root wins: when it is a valid worktree its children are
 *   never scanned.
 * - Otherwise only the root's direct children are candidates; repositories
 *   nested one level deeper are intentionally invisible.
 * - A `.git` directory is a normal repository, a `.git` file is a linked
 *   worktree (the file points at the real gitdir, which is never exposed —
 *   `path` is always the working-tree directory the user selected).
 * @module dsh-solution-explorer/host/git-repos
 */
import * as fsp from 'node:fs/promises'
import * as pathModule from 'node:path'

import { git } from './git-runner.ts'

export interface GitRepositoryItem {
  path: string
  name: string
  branch: string
  kind?: 'repository' | 'worktree'
}

/** Classify `<dir>/.git` without following symlinks; null when absent/inert. */
async function readDotGitKind(dir: string): Promise<'repository' | 'worktree' | null> {
  try {
    const stat = await fsp.lstat(pathModule.join(dir, '.git'))
    if (stat.isDirectory()) return 'repository'
    // Linked worktrees replace the directory with a "gitdir: <path>" file.
    if (stat.isFile()) return 'worktree'
    return null
  } catch {
    return null
  }
}

/**
 * Probe one candidate directory. Returns null unless it has its own `.git`
 * handle *and* Git confirms it is inside a work tree. Never throws.
 */
async function probeRepository(dir: string): Promise<GitRepositoryItem | null> {
  try {
    const kind = await readDotGitKind(dir)
    if (!kind) return null
    if (!git(['rev-parse', '--is-inside-work-tree'], dir).ok) return null

    // Unborn (no commits yet) and detached HEAD both fail to abbreviate;
    // they must not fail the whole listing.
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)
    const resolved = pathModule.resolve(dir)
    return {
      path: resolved,
      name: pathModule.basename(resolved),
      branch: branch.ok && branch.stdout ? branch.stdout : 'HEAD',
      kind,
    }
  } catch {
    return null
  }
}

/**
 * Discover Git repositories at the workspace boundary.
 *
 * Returns at most one item (the root itself) when the root is a worktree;
 * otherwise at most one item per direct, non-hidden, non-symlink child.
 * The result order is stable: root first, else name (case-insensitive)
 * then path.
 */
export async function discoverRepositories(root: string): Promise<GitRepositoryItem[]> {
  if (!root || !root.trim()) return []
  try {
    const resolvedRoot = pathModule.resolve(root)
    // The workspace root is the user's chosen directory: follow a symlinked /
    // junction root (opening a linked workspace must keep working), while the
    // child scan below still refuses to follow directory links.
    const rootStat = await fsp.stat(resolvedRoot)
    if (!rootStat.isDirectory()) return []

    const rootItem = await probeRepository(resolvedRoot)
    if (rootItem) return [rootItem]

    const entries = await fsp.readdir(resolvedRoot, { withFileTypes: true }).catch(() => [])
    const items: GitRepositoryItem[] = []
    for (const entry of entries) {
      // Dirent.isDirectory() is lstat-based, so symlinked directories are
      // already excluded; the explicit check keeps the intent obvious.
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (entry.name.startsWith('.')) continue
      const item = await probeRepository(pathModule.join(resolvedRoot, entry.name))
      if (item) items.push(item)
    }
    items.sort((a, b) => {
      const aName = a.name.toLowerCase()
      const bName = b.name.toLowerCase()
      if (aName !== bName) return aName < bName ? -1 : 1
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
    })
    return items
  } catch {
    return []
  }
}
