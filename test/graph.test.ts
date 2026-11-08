/**
 * Unit tests for the pure commit-graph planner (no DOM).
 *
 * Run with `node --test test/graph.test.ts`. Node strips the TypeScript types,
 * so the module under test is the real one the bundle ships, not a copy.
 * @module dsh-solution-explorer/test/graph
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { graphColumnWidth, planGraph } from '../src/client/scm/graph.ts'
import type { GraphRowDraw } from '../src/client/scm/graph.ts'
import { laneCountWidth, SWIMLANE_WIDTH } from '../src/client/scm/graph-path.ts'
import type { CommitRow } from '../src/client/state/store.ts'
import { avd, diamond, linear, row } from './graph-fixture.ts'

const HEX = /^#[0-9a-f]{6}$/i
/** VS Code's `historyItemRefColor` (chartsBlue): the checked-out branch lane. */
const REF = '#3794FF'
const AMBER = '#FFB000'
const PINK = '#DC267F'
const BROWN = '#994F00'
const TEAL = '#40B0A6'
const PURPLE = '#B66DFF'

function parentIds(rows: readonly CommitRow[]): string[][] {
  return rows.map((r) => r.parents ?? [])
}

/** Invariants every plan must satisfy, whatever the history. */
function assertSane(rows: readonly CommitRow[], plans: readonly GraphRowDraw[]): void {
  assert.equal(plans.length, rows.length, 'one plan per commit row')
  const parents = parentIds(rows)

  plans.forEach((plan, index) => {
    assert.equal(plan.hash, rows[index].hash)
    assert.equal(plan.width, laneCountWidth(Math.max(plan.input.length, plan.output.length)),
      'the row is as wide as its widest lane set, plus one lane')
    assert.equal(plan.width % SWIMLANE_WIDTH, 0, 'width is a whole number of lanes')
    assert.match(plan.color, HEX, 'the node color is a hex color')

    for (const lane of [...plan.input, ...plan.output]) {
      assert.match(lane.color, HEX)
      assert.ok(lane.id.length > 0)
    }

    // Every row starts from the lanes the row above left behind.
    if (index > 0) {
      assert.deepEqual(plan.input, plans[index - 1].output,
        `row ${index} inherits the previous row's lanes`)
    }

    // The node sits in an existing lane or opens the next free one.
    assert.equal(plan.inputIndex, plan.input.findIndex((lane) => lane.id === plan.hash))
    assert.equal(plan.circleIndex, plan.inputIndex !== -1 ? plan.inputIndex : plan.input.length)
    assert.ok(plan.circleIndex <= Math.max(plan.input.length, plan.output.length))

    // Lanes only leave a row when the row's commit is what they waited for;
    // a root commit consumes its own lane and leaves the others running.
    const waitingOnHash = plan.input.filter((lane) => lane.id === plan.hash).length
    assert.equal(plan.output.length, plan.input.length - waitingOnHash + parents[index].length,
      'one lane per surviving lane, plus one per new parent')

    // Parents after the first are resolved to output lanes and keep the color
    // that lane was assigned.
    assert.equal(plan.extraParents.length, Math.max(parents[index].length - 1, 0))
    plan.extraParents.forEach((parent, i) => {
      assert.equal(plan.output[parent.outputIndex].id, parents[index][i + 1])
      assert.equal(parent.color, plan.output[parent.outputIndex].color)
    })

    assert.equal(plan.parentCount, parents[index].length)
    assert.equal(plan.color, plan.inputIndex !== -1
      ? plan.input[plan.inputIndex].color
      : plan.output[plan.circleIndex]?.color ?? REF,
      'the node takes the color of its own lane')
  })
}

test('empty input plans nothing', () => {
  assert.deepEqual(planGraph([]), [])
  assert.equal(graphColumnWidth([]), SWIMLANE_WIDTH * 2)
})

test('linear history keeps one lane at x = 11 in the reference color', () => {
  const plans = planGraph(linear)
  assertSane(linear, plans)
  plans.forEach((plan, i) => {
    assert.equal(plan.input.length, i === 0 ? 0 : 1, 'one lane enters every row but the first')
    assert.equal(plan.circleIndex, 0)
    assert.equal(plan.color, REF)
    if (i > 0) assert.equal(plan.input[0].color, REF)
    assert.deepEqual(plan.extraParents, [])
    assert.equal(plan.width, 2 * SWIMLANE_WIDTH)
    assert.equal(plan.parentCount, i < plans.length - 1 ? 1 : 0)
  })
  assert.equal(plans[0].inputIndex, -1, 'the newest commit opens the first lane')
  assert.deepEqual(plans[0].input, [])
})

test('a root commit keeps its lane but leaves none behind', () => {
  const rows = [row('root')]
  const plans = planGraph(rows)
  assertSane(rows, plans)
  assert.equal(plans[0].inputIndex, -1)
  assert.equal(plans[0].circleIndex, 0)
  assert.equal(plans[0].parentCount, 0)
  assert.deepEqual(plans[0].output, [])
  assert.equal(plans[0].color, REF)
  assert.equal(plans[0].width, 2 * SWIMLANE_WIDTH)
})

test('a disconnected root ends its lane but lets the other branches run on', () => {
  // `git merge --allow-unrelated-histories` shape: two roots reachable from one
  // merge. The first root must not drop the lane still waiting for the second.
  const rows = [row('M', ['A', 'B']), row('A'), row('B')]
  const plans = planGraph(rows)
  assertSane(rows, plans)

  assert.deepEqual(plans[0].output, [{ id: 'A', color: REF }, { id: 'B', color: AMBER }])
  assert.deepEqual(plans[1].output, [{ id: 'B', color: AMBER }],
    'A is a root, B is still pending')
  assert.equal(plans[1].circleIndex, 0)
  assert.equal(plans[1].color, REF)
  assert.deepEqual(plans[2].input, [{ id: 'B', color: AMBER }])
  assert.equal(plans[2].circleIndex, 0)
  assert.equal(plans[2].parentCount, 0)
  assert.equal(plans[2].color, AMBER, 'B keeps the colour it was given')
  assert.deepEqual(plans[2].output, [])
})

test('a merge opens one lane per parent: first parent keeps the lane, the rest rotate', () => {
  const rows = [row('M', ['A', 'B', 'C']), row('A'), row('B'), row('C')]
  const plans = planGraph(rows)
  assertSane(rows, plans)

  assert.deepEqual(plans[0].output, [
    { id: 'A', color: REF },
    { id: 'B', color: AMBER },
    { id: 'C', color: PINK },
  ])
  assert.deepEqual(plans[0].extraParents, [
    { outputIndex: 1, color: AMBER },
    { outputIndex: 2, color: PINK },
  ])
  assert.equal(plans[0].width, 4 * SWIMLANE_WIDTH)
})

test('the palette wraps after five lanes and stays deterministic', () => {
  const parents = Array.from({ length: 9 }, (_, i) => `p${i}`)
  // Every parent forks from the same base commit, so the history stays connected.
  const rows = [row('M', parents), ...parents.map((hash) => row(hash, ['q'])), row('q')]
  const plans = planGraph(rows)
  assert.deepEqual(plans, planGraph(rows), 'identical input produces identical output')

  assert.deepEqual(plans[0].output.map((lane) => lane.color), [
    REF, AMBER, PINK, BROWN, TEAL, PURPLE, AMBER, PINK, BROWN,
  ])
  assert.equal(plans[0].extraParents.length, 8)
  plans[0].extraParents.forEach((parent, i) => assert.equal(parent.outputIndex, i + 1))
  assert.equal(plans[0].width, 10 * SWIMLANE_WIDTH, 'nine lanes need ten columns of room')
  assert.equal(graphColumnWidth(plans), 10 * SWIMLANE_WIDTH)
})

test('a diamond reuses the fork lane and folds the branch back into the node', () => {
  const plans = planGraph(diamond)
  assertSane(diamond, plans)

  // M: main lane plus one feature lane, joined by a parent connector.
  assert.deepEqual(plans[0].output, [{ id: 'A', color: REF }, { id: 'B', color: AMBER }])
  assert.deepEqual(plans[0].extraParents, [{ outputIndex: 1, color: AMBER }])

  // A keeps lane 0 and hands it to R; B stays in lane 1.
  assert.deepEqual(plans[1].output, [{ id: 'R', color: REF }, { id: 'B', color: AMBER }])

  // B's first parent R already owns lane 0, so VS Code keeps a second lane
  // for it: the node keeps its own column and the duplicate is closed later.
  assert.equal(plans[2].inputIndex, 1)
  assert.equal(plans[2].circleIndex, 1)
  assert.equal(plans[2].color, AMBER, 'the B node stays in the branch color')
  assert.deepEqual(plans[2].output, [{ id: 'R', color: REF }, { id: 'R', color: AMBER }])

  // R consumes both lanes and closes the branch line in the row itself.
  assert.deepEqual(plans[3].input, [{ id: 'R', color: REF }, { id: 'R', color: AMBER }])
  assert.equal(plans[3].inputIndex, 0)
  assert.equal(plans[3].circleIndex, 0)
  assert.equal(plans[3].color, REF)
  assert.deepEqual(plans[3].output, [])
})

test('the emulator history keeps its two merged branches on separate lanes', () => {
  const plans = planGraph(avd)
  assertSane(avd, plans)

  // merge-b: main lane plus the feat-b lane.
  assert.deepEqual(plans[0].output, [{ id: 'merge-a', color: REF }, { id: 'feat-b2', color: AMBER }])

  // The feat-b branch walks down its own lane in the amber color.
  for (let i = 1; i <= 3; i++) {
    assert.equal(plans[i].circleIndex, 1, `row ${i} keeps feat-b on lane 1`)
    assert.equal(plans[i].color, AMBER)
  }

  // merge-a joins the base commit (first parent) and the feat-a branch.
  assert.equal(plans[4].circleIndex, 0)
  assert.equal(plans[4].color, REF)
  assert.deepEqual(plans[4].output.map((lane) => lane.id), ['base-4', 'base-4', 'feat-a2'],
    'the base commit lane is kept next to the one merge-a inherits')
  assert.deepEqual(plans[4].extraParents, [{ outputIndex: 2, color: PINK }])

  // feat-a runs in the pink lane until the shared base commit collects it.
  for (let i = 5; i <= 6; i++) {
    assert.equal(plans[i].circleIndex, 2, `row ${i} keeps feat-a on lane 2`)
    assert.equal(plans[i].color, PINK)
  }
  assert.deepEqual(plans[7].input.map((lane) => lane.id), ['base-4', 'base-4', 'base-4'])
  assert.equal(plans[7].output.length, 1, 'the duplicates are folded into the base commit')
})

test('paginating (prefixing) never changes earlier rows', () => {
  const full = planGraph(avd)
  assert.deepEqual(planGraph(avd), full, 'planGraph is deterministic')
  for (let k = 0; k <= avd.length; k++) {
    assert.deepEqual(planGraph(avd.slice(0, k)), full.slice(0, k), `prefix of length ${k} is stable`)
  }
})

test('a branch that starts on the current tip reuses the reference lane', () => {
  const rows = [row('M', ['A', 'B']), row('B', ['A']), row('A')]
  const plans = planGraph(rows)
  assertSane(rows, plans)
  assert.deepEqual(plans[0].output, [{ id: 'A', color: REF }, { id: 'B', color: AMBER }])
  assert.equal(plans[1].inputIndex, 1)
  assert.equal(plans[1].color, AMBER)
  assert.deepEqual(plans[1].output, [{ id: 'A', color: REF }, { id: 'A', color: AMBER }])
  assert.equal(plans[2].inputIndex, 0)
  assert.equal(plans[2].color, REF)
})
