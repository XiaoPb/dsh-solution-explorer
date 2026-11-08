/**
 * Unit tests for the pure active-repository selection helper (no DOM).
 * Run with `node --test test/repo-selection.test.ts`.
 * @module dsh-solution-explorer/test/repo-selection
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickActiveRepo } from '../src/client/scm/repo-selection.ts'

const repo = (path: string, name: string, branch = 'main', kind?: 'repository' | 'worktree') => ({
  path,
  name,
  branch,
  ...(kind ? { kind } : {}),
})

test('keeps the current repository when it is still in the list', () => {
  const repos = [repo('/workspace/a', 'a'), repo('/workspace/b', 'b')]
  assert.equal(pickActiveRepo(repos, '/workspace/b', '/workspace'), '/workspace/b')
})

test('falls back to the first repository when the current one disappeared', () => {
  const repos = [repo('/workspace/a', 'a'), repo('/workspace/b', 'b')]
  assert.equal(pickActiveRepo(repos, '/workspace/gone', '/workspace'), '/workspace/a')
})

test('treats an empty current selection as missing', () => {
  const repos = [repo('/workspace/a', 'a')]
  assert.equal(pickActiveRepo(repos, '', '/workspace'), '/workspace/a')
})

test('falls back to the workspace root when no repository was discovered', () => {
  assert.equal(pickActiveRepo([], '/workspace/old', '/workspace'), '/workspace')
  assert.equal(pickActiveRepo([], '', '/workspace'), '/workspace')
})

test('returns an empty root when neither a repository nor a root exists', () => {
  assert.equal(pickActiveRepo([], '', ''), '')
  assert.equal(pickActiveRepo([], '/workspace/old', ''), '')
})

test('repository kind never changes the selection', () => {
  const repos = [
    repo('/workspace/repo', 'repo', 'main', 'repository'),
    repo('/workspace/worktree', 'worktree', 'feature/x', 'worktree'),
  ]
  assert.equal(pickActiveRepo(repos, '/workspace/worktree', '/workspace'), '/workspace/worktree')
  assert.equal(pickActiveRepo(repos, '', '/workspace'), '/workspace/repo')
  assert.equal(pickActiveRepo(repos, '/workspace/missing', '/workspace'), '/workspace/repo')
})
