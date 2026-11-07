/**
 * Unit tests for the pure swipe decision (no DOM).
 *
 * Run with `pnpm test` — Node strips the TypeScript types, so the module under
 * test is the real one the bundle ships, not a copy.
 * @module dsh-solution-explorer/test/gestures
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidePanelSwipe, SWIPE_TRIGGER } from '../src/client/touch/gestures.ts'

type Row = {
  name: string
  input: Parameters<typeof decidePanelSwipe>[0]
  expect: ReturnType<typeof decidePanelSwipe>
}

const rows: Row[] = [
  {
    name: 'leftward past the trigger on a closed panel expands',
    input: { dx: -60, dy: 5, scrollerConsumes: false, collapsed: true },
    expect: 'expand',
  },
  {
    name: 'drawer owns the gesture → no decision',
    input: { dx: -60, dy: 5, scrollerConsumes: false, collapsed: true, allowed: false },
    expect: null,
  },
  {
    name: 'vertical travel of the same length is a scroll, not a swipe',
    input: { dx: -60, dy: 60, scrollerConsumes: false, collapsed: true },
    expect: null,
  },
  {
    name: 'vertical travel slightly under the horizontal one still expands',
    input: { dx: -60, dy: 59, scrollerConsumes: false, collapsed: true },
    expect: 'expand',
  },
  {
    name: 'a scroller that can still pan keeps its gesture',
    input: { dx: -60, dy: 5, scrollerConsumes: true, collapsed: true },
    expect: null,
  },
  {
    name: 'rightward on the expanded panel collapses',
    input: { dx: 60, dy: 5, scrollerConsumes: false, collapsed: false },
    expect: 'collapse',
  },
  {
    name: 'rightward on an already closed panel does nothing',
    input: { dx: 60, dy: 5, scrollerConsumes: false, collapsed: true },
    expect: null,
  },
  {
    name: 'leftward on an expanded panel does nothing',
    input: { dx: -60, dy: 5, scrollerConsumes: false, collapsed: false },
    expect: null,
  },
  {
    name: 'direction must be confirmed (24px)',
    input: { dx: -30, dy: 5, scrollerConsumes: false, collapsed: true },
    expect: null,
  },
  {
    name: 'the trigger distance is required',
    input: { dx: -(SWIPE_TRIGGER - 1), dy: 5, scrollerConsumes: false, collapsed: true },
    expect: null,
  },
  {
    name: 'the trigger itself is enough',
    input: { dx: -SWIPE_TRIGGER, dy: 0, scrollerConsumes: false, collapsed: true },
    expect: 'expand',
  },
  {
    name: 'no movement at all',
    input: { dx: 0, dy: 0, scrollerConsumes: false, collapsed: true },
    expect: null,
  },
]

for (const row of rows) {
  test(row.name, () => {
    assert.equal(decidePanelSwipe(row.input), row.expect)
  })
}
