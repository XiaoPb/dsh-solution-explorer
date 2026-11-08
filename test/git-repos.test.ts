/**
 * Integration tests for host-side Git repository discovery.
 *
 * Each case builds real repositories with the `git` CLI inside an isolated
 * temp directory — no network, no mocks. Run with:
 *   node --test test/git-repos.test.ts
 * @module dsh-solution-explorer/test/git-repos
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { discoverRepositories } from '../src/host/git-repos.ts'

function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString()
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-git-repos-'))
  try {
    await run(dir)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

/** Create a repository; `commit: false` leaves it unborn (no HEAD commit). */
async function makeRepo(dir: string, options: { commit?: boolean } = {}): Promise<void> {
  await fsp.mkdir(dir, { recursive: true })
  runGit(['-c', 'init.defaultBranch=main', 'init', '-q'], dir)
  if (options.commit === false) return
  runGit([
    '-c', 'user.email=t@t',
    '-c', 'user.name=t',
    '-c', 'commit.gpgsign=false',
    'commit', '-q', '--allow-empty', '-m', 'init',
  ], dir)
}

/** Add a linked worktree from `baseRepo` at `target` on a new branch. */
function makeWorktree(baseRepo: string, target: string, branch: string): void {
  runGit(['worktree', 'add', '-q', target, '-b', branch], baseRepo)
}

test('root repository short-circuits child repositories', async () => {
  await withTempDir(async (root) => {
    await makeRepo(root)
    await makeRepo(path.join(root, 'child'))

    const items = await discoverRepositories(root)
    assert.equal(items.length, 1)
    assert.equal(items[0].path, path.resolve(root))
    assert.equal(items[0].name, path.basename(root))
    assert.equal(items[0].kind, 'repository')
    assert.equal(items[0].branch, 'main')
  })
})

test('non-repo root scans exactly one level, skipping hidden, nested and non-directory entries', async () => {
  await withTempDir(async (root) => {
    await makeRepo(path.join(root, 'alpha'))
    await fsp.mkdir(path.join(root, 'outer'))
    await makeRepo(path.join(root, 'outer', 'deep'))
    await makeRepo(path.join(root, '.hidden'))
    await fsp.mkdir(path.join(root, 'not-a-repo'))
    await fsp.writeFile(path.join(root, 'plain.txt'), 'not a repository\n')

    const items = await discoverRepositories(root)
    assert.deepEqual(items.map((item) => item.name), ['alpha'])
    assert.equal(items[0].path, path.resolve(root, 'alpha'))
    assert.equal(items[0].kind, 'repository')
    assert.equal(items[0].branch, 'main')
  })
})

test('linked worktree child reports kind worktree, its branch and the worktree path', async () => {
  await withTempDir(async (root) => {
    const base = path.join(root, 'base')
    const worktree = path.join(root, 'feature-wt')
    await makeRepo(base)
    makeWorktree(base, worktree, 'feature-x')

    const items = await discoverRepositories(root)
    const found = items.find((item) => item.path === path.resolve(worktree))
    assert.ok(found)
    assert.equal(found.name, 'feature-wt')
    assert.equal(found.kind, 'worktree')
    assert.equal(found.branch, 'feature-x')

    // `path` is the working-tree directory, never the gitdir pointer target.
    const pointer = await fsp.readFile(path.join(worktree, '.git'), 'utf8')
    const gitdir = pointer.replace(/^gitdir:\s*/, '').trim()
    assert.notEqual(found.path, path.resolve(worktree, gitdir))

    const baseItem = items.find((item) => item.path === path.resolve(base))
    assert.ok(baseItem)
    assert.equal(baseItem.kind, 'repository')
    assert.equal(baseItem.branch, 'main')
  })
})

test('nonexistent, empty and blank roots yield no repositories', async () => {
  await withTempDir(async (root) => {
    assert.deepEqual(await discoverRepositories(path.join(root, 'missing')), [])
    assert.deepEqual(await discoverRepositories(root), [])
    assert.deepEqual(await discoverRepositories('   '), [])
  })
})

test('a plain-text `.git` file that is not a gitdir pointer is ignored', async () => {
  await withTempDir(async (root) => {
    const bogus = path.join(root, 'bogus')
    await fsp.mkdir(bogus)
    await fsp.writeFile(path.join(bogus, '.git'), 'this is not a git directory\n')

    assert.deepEqual(await discoverRepositories(root), [])
  })
})

test('child repositories sort by name case-insensitively, then by path, stably', async () => {
  await withTempDir(async (root) => {
    for (const name of ['zeta', 'Alpha', 'beta', 'alpha2']) {
      await makeRepo(path.join(root, name))
    }

    const first = await discoverRepositories(root)
    assert.deepEqual(first.map((item) => item.name), ['Alpha', 'alpha2', 'beta', 'zeta'])
    const second = await discoverRepositories(root)
    assert.deepEqual(second, first)
  })
})

test('a repository without commits falls back to branch HEAD', async () => {
  await withTempDir(async (root) => {
    await makeRepo(path.join(root, 'unborn'), { commit: false })

    const items = await discoverRepositories(root)
    assert.equal(items.length, 1)
    assert.equal(items[0].name, 'unborn')
    assert.equal(items[0].kind, 'repository')
    assert.equal(items[0].branch, 'HEAD')
  })
})

test('detached HEAD still lists the repository with branch HEAD', async () => {
  await withTempDir(async (root) => {
    const repo = path.join(root, 'detached')
    await makeRepo(repo)
    runGit(['checkout', '-q', '--detach'], repo)

    const items = await discoverRepositories(root)
    assert.equal(items.length, 1)
    assert.equal(items[0].name, 'detached')
    assert.equal(items[0].branch, 'HEAD')
  })
})

test('paths with spaces and non-ASCII names are reported unchanged', async () => {
  await withTempDir(async (root) => {
    const name = '仓库 with space'
    await makeRepo(path.join(root, name))

    const items = await discoverRepositories(root)
    assert.equal(items.length, 1)
    assert.equal(items[0].name, name)
    assert.equal(items[0].path, path.resolve(root, name))
  })
})

test('a symlinked workspace root is still discovered', async () => {
  const target = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-git-repos-root-target-'))
  try {
    await makeRepo(target)
    await withTempDir(async (root) => {
      const link = path.join(root, 'workspace-link')
      try {
        // `junction` works on Windows without elevation; POSIX ignores the type.
        await fsp.symlink(target, link, 'junction')
      } catch {
        return
      }

      const items = await discoverRepositories(link)
      assert.equal(items.length, 1)
      assert.equal(items[0].path, path.resolve(link))
      assert.equal(items[0].kind, 'repository')
      assert.equal(items[0].branch, 'main')
    })
  } finally {
    await fsp.rm(target, { recursive: true, force: true })
  }
})

test('a symlinked child directory is not followed', async () => {
  const target = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-git-repos-target-'))
  try {
    await makeRepo(target)
    await withTempDir(async (root) => {
      const link = path.join(root, 'linked')
      try {
        // `junction` is required on Windows and ignored on POSIX; skip only
        // where the platform forbids creating directory links entirely.
        await fsp.symlink(target, link, 'junction')
      } catch {
        return
      }

      const items = await discoverRepositories(root)
      assert.deepEqual(items, [])
    })
  } finally {
    await fsp.rm(target, { recursive: true, force: true })
  }
})
