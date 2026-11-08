/**
 * Unit tests for the pure commit-graph planner (no DOM).
 *
 * Run with `node --test test/graph.test.ts`. Node strips the TypeScript types,
 * so the module under test is the real one the bundle ships, not a copy.
 * @module dsh-solution-explorer/test/graph
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planGraph } from '../src/client/scm/graph.ts'
import type { GraphLaneDraw, GraphRowDraw } from '../src/client/scm/graph.ts'
import type { CommitRow } from '../src/client/state/store.ts'

/** Lane width used by graph.ts; every coordinate must be a multiple of it. */
const LANE_W = 14
const HEX = /^#[0-9a-f]{6}$/i

function row(hash: string, parents: string[] = [], extra: Partial<CommitRow> = {}): CommitRow {
  return { hash, shortHash: hash.slice(0, 7), message: `subject ${hash}`, timestamp: 0, parents, ...extra }
}

function graphNumbers(plans: readonly GraphRowDraw[]): number[] {
  const nums: number[] = []
  for (const plan of plans) {
    nums.push(plan.width)
    for (const tr of plan.transitions) nums.push(tr.x1, tr.x2)
    for (const lane of plan.lanes) {
      nums.push(lane.x)
      for (const fork of lane.forks) nums.push(fork.x)
    }
  }
  return nums
}

function nodeLane(plan: GraphRowDraw): GraphLaneDraw {
  const nodes = plan.lanes.filter((lane) => lane.node)
  assert.equal(nodes.length, 1, 'every row has exactly one node lane')
  return nodes[0]
}

/** Shape invariants every plan must satisfy, whatever the history. */
function assertSane(plans: readonly GraphRowDraw[]): void {
  for (const n of graphNumbers(plans)) assert.ok(Number.isFinite(n), `non-finite graph coordinate: ${n}`)
  for (const plan of plans) {
    assert.ok(plan.width >= LANE_W, 'graph is at least one lane wide')
    assert.equal(plan.width % LANE_W, 0, 'width is a whole number of lanes')
    assert.ok(plan.lanes.length * LANE_W <= plan.width, 'all lanes fit inside the SVG width')
    assert.equal(new Set(plan.lanes.map((lane) => lane.x)).size, plan.lanes.length,
      'no two lanes share the same x on one row')
    for (const lane of plan.lanes) {
      assert.match(lane.color, HEX)
      assert.ok(lane.x + LANE_W / 2 <= plan.width, 'lane center fits inside the SVG width')
      for (const fork of lane.forks) {
        assert.match(fork.color, HEX)
        assert.ok(fork.x + LANE_W / 2 <= plan.width, 'connector target fits inside the SVG width')
      }
    }
    for (const tr of plan.transitions) {
      assert.match(tr.color, HEX)
      assert.ok(tr.x1 + LANE_W / 2 <= plan.width, 'transition start fits inside the SVG width')
      assert.ok(tr.x2 + LANE_W / 2 <= plan.width, 'transition end fits inside the SVG width')
    }
  }
}

test('empty input plans nothing', () => {
  assert.deepEqual(planGraph([]), [])
})

test('linear history keeps a single lane at x = 7 with no transitions', () => {
  const plans = planGraph([row('C', ['B']), row('B', ['A']), row('A')])
  assert.equal(plans.length, 3)
  plans.forEach((plan, i) => {
    assert.equal(plan.lanes.length, 1)
    assert.equal(plan.lanes[0].x, LANE_W / 2)
    assert.equal(plan.lanes[0].node, true)
    assert.deepEqual(plan.lanes[0].forks, [])
    assert.deepEqual(plan.transitions, [])
    assert.equal(plan.width, LANE_W)
    assert.equal(plan.lanes[0].hasParent, i < plans.length - 1)
  })
  assertSane(plans)
})

test('a root commit draws a node but no parent continuation', () => {
  const plans = planGraph([row('root')])
  assertSane(plans)
  assert.equal(plans.length, 1)
  assert.equal(plans[0].lanes.length, 1)
  assert.equal(plans[0].lanes[0].node, true)
  assert.equal(plans[0].lanes[0].hasParent, false)
  assert.deepEqual(plans[0].lanes[0].forks, [])
  assert.equal(plans[0].width, LANE_W)
})

test('diamond history reuses the existing parent lane instead of duplicating it', () => {
  const rows = [row('M', ['A', 'B']), row('A', ['R']), row('B', ['R']), row('R')]
  const plans = planGraph(rows)
  assertSane(plans)
  assert.equal(plans.length, 4)

  // Merge row: first parent continues the lane, second parent forks into a new lane.
  assert.equal(plans[0].lanes.length, 1)
  assert.equal(plans[0].lanes[0].node, true)
  assert.equal(plans[0].lanes[0].forks.length, 1)

  // A continues its lane down to R while B stays in the second lane.
  assert.equal(plans[1].lanes.length, 2)

  // B reaches R, which already owns a lane: one connector to R's x, no extra lane.
  const rX = nodeLane(plans[3]).x
  const bLane = nodeLane(plans[2])
  assert.equal(bLane.forks.length, 1, 'B exposes a connector for its parent')
  assert.equal(bLane.forks[0].x, rX, 'the connector targets R\'s existing lane')
  assert.equal(bLane.hasParent, false, 'the connector replaces the straight parent stub')
  assert.equal(plans[2].lanes.length, 2, 'the B row keeps R + B only')

  // R row: exactly one lane (no ghost/duplicate lane from re-adding R).
  assert.equal(plans[3].lanes.length, 1)
  assert.equal(plans[3].lanes[0].x, rX)
  assert.equal(plans[3].lanes[0].node, true)
  assert.equal(plans[3].lanes[0].hasParent, false)
})

test('a merge with more parents than palette colors stays deterministic and valid', () => {
  const parents = Array.from({ length: 9 }, (_, i) => `p${i}`)
  const rows = [row('M', parents), ...parents.map((hash) => row(hash))]
  const plans = planGraph(rows)
  assertSane(plans)
  assert.equal(plans.length, 10)

  const merge = plans[0]
  assert.equal(merge.lanes.length, 1)
  assert.equal(merge.lanes[0].forks.length, 8)
  assert.equal(merge.width, 9 * LANE_W, 'nine simultaneous lanes widen the column')
  assert.deepEqual(planGraph(rows), plans, 'identical input produces identical output')
})

test('lanes shifting left keep their transition curves inside the SVG width', () => {
  const rows = [row('M', ['A', 'B', 'C']), row('A'), row('B', ['X']), row('C', ['X']), row('X')]
  const plans = planGraph(rows)
  assertSane(plans)
  const shifted = plans[2]
  assert.ok(shifted.transitions.length > 0, 'the closing lane produces a transition')
  for (const tr of shifted.transitions) {
    assert.ok(tr.x1 + LANE_W / 2 <= shifted.width)
    assert.ok(tr.x2 + LANE_W / 2 <= shifted.width)
  }
})

test('paginating (prefixing) never changes earlier rows', () => {
  const rows = [
    row('H', ['M', 'F']),
    row('M', ['A', 'B']),
    row('F', ['A']),
    row('A', ['R']),
    row('B', ['R']),
    row('R'),
  ]
  const full = planGraph(rows)
  assertSane(full)
  assert.deepEqual(planGraph(rows), full, 'planGraph is deterministic')
  for (let k = 0; k <= rows.length; k++) {
    assert.deepEqual(planGraph(rows.slice(0, k)), full.slice(0, k), `prefix of length ${k} is stable`)
  }
})
