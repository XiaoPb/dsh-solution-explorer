/**
 * Unit tests for the pure panel-label helpers (no DOM).
 * Run with `pnpm test`.
 * @module dsh-solution-explorer/test/labels
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isUsableBranch, syncLabel, workspaceName } from '../src/client/shared/labels.ts'

test('workspaceName handles empty, POSIX and Windows paths', () => {
  assert.equal(workspaceName(''), '')
  assert.equal(workspaceName('   '), '')
  assert.equal(workspaceName('/home/me/project/'), 'project')
  assert.equal(workspaceName('E:\\Code\\DSH\\plugins\\dsh-solution-explorer'), 'dsh-solution-explorer')
  assert.equal(workspaceName('E:\\Code\\DSH\\plugins\\dsh-solution-explorer\\'), 'dsh-solution-explorer')
})

test('isUsableBranch rejects the git sentinel and blank strings', () => {
  assert.equal(isUsableBranch(undefined), false)
  assert.equal(isUsableBranch(null), false)
  assert.equal(isUsableBranch(''), false)
  assert.equal(isUsableBranch('   '), false)
  assert.equal(isUsableBranch('unknown'), false)
  assert.equal(isUsableBranch('main'), true)
  assert.equal(isUsableBranch('feature/mobile-sidebar'), true)
})

test('syncLabel renders ahead/behind counters only when non-zero', () => {
  assert.equal(syncLabel(0, 0), '')
  assert.equal(syncLabel(2, 0), '↑2')
  assert.equal(syncLabel(0, 3), '↓3')
  assert.equal(syncLabel(2, 3), '↑2 ↓3')
  assert.equal(syncLabel(Number.NaN, 1), '↓1')
})
