/**
 * Renderer tests for the commit graph: the path shapes, the draw order and —
 * the point of this suite — that no connector ends in mid-air.
 *
 * These run on the same pure painter the React list uses, so a broken line here
 * is a broken line on screen.
 * @module dsh-solution-explorer/test/graph-draw
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { graphColumnWidth, planGraph } from '../src/client/scm/graph.ts'
import type { GraphRowDraw } from '../src/client/scm/graph.ts'
import { drawGraph, drawGraphRow } from '../src/client/scm/graph-draw.ts'
import type { GraphRowPaint } from '../src/client/scm/graph-draw.ts'
import {
  laneCenter,
  laneClosePath,
  laneShiftPath,
  mergeParentPath,
  SWIMLANE_HEIGHT,
  SWIMLANE_MID,
  SWIMLANE_WIDTH,
  verticalPath,
} from '../src/client/scm/graph-path.ts'
import type { CommitRow } from '../src/client/state/store.ts'
import { avd, diamond, linear, multilevel, row } from './graph-fixture.ts'

const AMBER = '#FFB000'
const PINK = '#DC267F'

function uniqSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

/** x of every connector that leaves the bottom edge of the row. */
function bottomPoints(paint: GraphRowPaint): number[] {
  return uniqSorted(paint.segments.filter((s) => s.to.y === SWIMLANE_HEIGHT).map((s) => s.to.x))
}

/** x of every connector that starts at the top edge of the row. */
function topPoints(paint: GraphRowPaint): number[] {
  return uniqSorted(paint.segments.filter((s) => s.from.y === 0).map((s) => s.from.x))
}

function paintsOf(rows: readonly CommitRow[]): { plans: GraphRowDraw[]; paints: GraphRowPaint[] } {
  const plans = planGraph(rows)
  return { plans, paints: drawGraph(plans) }
}

test('a linear row draws the node in one column, above and below', () => {
  const { paints } = paintsOf(linear)

  // Newest row: no lane above it, only the first-parent continuation.
  assert.deepEqual(paints[0].segments.map((s) => [s.key, s.d]), [['node-bottom', verticalPath(0, SWIMLANE_MID, SWIMLANE_HEIGHT)]])
  // Middle rows: the lane comes in from above and continues below.
  assert.deepEqual(paints[1].segments.map((s) => [s.key, s.d]), [
    ['node-top', verticalPath(0, 0, SWIMLANE_MID)],
    ['node-bottom', verticalPath(0, SWIMLANE_MID, SWIMLANE_HEIGHT)],
  ])
  // Root: the lane stops at the node.
  assert.deepEqual(paints[2].segments.map((s) => s.key), ['node-top'])
  assert.equal(paints[2].segments[0].to.y, SWIMLANE_MID, 'the last row ends under its node')
})

test('the node is the last thing drawn and sits on its lane center', () => {
  const { plans, paints } = paintsOf(avd)
  paints.forEach((paint, i) => {
    assert.ok(paint.nodes.length >= 1)
    for (const node of paint.nodes) assert.equal(node.cx, laneCenter(plans[i].circleIndex))
    for (const node of paint.nodes) assert.equal(node.cy, SWIMLANE_MID)
  })
})

test('node geometry matches VS Code: dot, merge ring, current-commit ring', () => {
  const { paints } = paintsOf(avd)

  // Row 0 is the checked-out commit: radius 7 ring with a radius 2 hole.
  assert.deepEqual(paints[0].nodes.map((n) => [n.kind, n.r]), [['head-outer', 7], ['head-inner', 2]])
  // A plain commit: radius 5 dot.
  assert.deepEqual(paints[1].nodes.map((n) => [n.kind, n.r]), [['dot', 5]])
  assert.equal(paints[1].nodes[0].fill, AMBER)
  // A merge commit: radius 6 ring with a radius 3 inner circle.
  assert.deepEqual(paints[4].nodes.map((n) => [n.kind, n.r]), [['merge-outer', 6], ['merge-inner', 3]])
})

test('connector lines are continuous from one row to the next', () => {
  for (const [name, rows] of [['linear', linear], ['diamond', diamond], ['avd', avd], ['multilevel', multilevel]] as const) {
    const { paints } = paintsOf(rows)
    for (let i = 0; i < paints.length - 1; i++) {
      assert.deepEqual(bottomPoints(paints[i]), topPoints(paints[i + 1]),
        `${name}: row ${i} must hand every lane to row ${i + 1}`)
    }
  }
})

test('no connector ends in mid-air and every lane is inside the column', () => {
  for (const [name, rows] of [['linear', linear], ['diamond', diamond], ['avd', avd], ['multilevel', multilevel]] as const) {
    const { plans, paints } = paintsOf(rows)
    const width = graphColumnWidth(plans)
    paints.forEach((paint, i) => {
      const plan = plans[i]
      const lanes = Math.max(plan.input.length, plan.output.length)
      for (const segment of paint.segments) {
        assert.ok(segment.d.startsWith('M '), `${name}: ${segment.key} is a path`)
        for (const point of [segment.from, segment.to]) {
          assert.ok([0, SWIMLANE_MID, SWIMLANE_HEIGHT].includes(point.y),
            `${name}: ${segment.key} ends at y=${point.y}, which is not a row or node boundary`)
          assert.ok(point.x >= 0 && point.x <= width, `${name}: ${segment.key} stays inside the column`)
          assert.equal(point.x % SWIMLANE_WIDTH, 0, `${name}: ${segment.key} lands on a lane centre`)
        }
        // A connector that touches a node must touch *the* node.
        for (const point of [segment.from, segment.to]) {
          if (point.y === SWIMLANE_MID) assert.equal(point.x, laneCenter(plan.circleIndex))
        }
      }
      assert.ok(lanes + 1 <= width / SWIMLANE_WIDTH + 1)
      assert.ok(width >= plan.width, `${name}: the shared column fits every row`)
    })
  }
})

test('a merge row joins each extra parent with VS Code elbow geometry', () => {
  const { plans, paints } = paintsOf(avd)
  assert.equal(plans[4].circleIndex, 0)
  const parent = paints[4].segments.find((s) => s.key === 'parent-0')!
  assert.ok(parent, 'merge-a draws the feat-a connector')
  assert.equal(parent.color, PINK)
  assert.equal(parent.d, mergeParentPath(2, 0))
  assert.deepEqual(parent.from, { x: laneCenter(0), y: SWIMLANE_MID })
  assert.deepEqual(parent.to, { x: laneCenter(2), y: SWIMLANE_HEIGHT })
})

test('a folded branch line curves into the node instead of stopping', () => {
  const { paints } = paintsOf(diamond)

  // B's line reaches the base commit row: it must close into R's node.
  const close = paints[3].segments.find((s) => s.key === 'close-1')!
  assert.ok(close, 'the branch lane is closed on the base-commit row')
  assert.equal(close.color, AMBER)
  assert.equal(close.d, laneClosePath(1, 0))
  assert.deepEqual(close.from, { x: laneCenter(1), y: 0 })
  assert.deepEqual(close.to, { x: laneCenter(0), y: SWIMLANE_MID })

  // The same history keeps both lanes alive on the row above.
  assert.equal(paints[2].segments.filter((s) => s.key.startsWith('lane-')).length, 1)
})

test('two merged branches close on the shared base commit row', () => {
  const { paints } = paintsOf(avd)
  const closes = paints[7].segments.filter((s) => s.key.startsWith('close-'))
  assert.deepEqual(closes.map((s) => s.d), [laneClosePath(1, 0), laneClosePath(2, 0)])
  assert.equal(closes.length, 2, 'both duplicate base lanes are folded in')
})

test('a folded lane makes the next lane shift left instead of overlapping it', () => {
  // A is the first parent of C and also of M, so its lane is duplicated and the
  // duplicate is folded into A's own row; Z then has to move into the free spot.
  const rows = [
    row('M', ['B', 'A', 'Z']),
    row('B', ['C']),
    row('C', ['A']),
    row('A', ['P']),
    row('Z', ['P']),
    row('P'),
  ]
  const { plans, paints } = paintsOf(rows)
  assert.deepEqual(plans[3].input.map((lane) => lane.id), ['A', 'A', 'Z'])
  assert.equal(plans[3].circleIndex, 0)

  const fold = paints[3].segments.find((s) => s.key === 'close-1')!
  assert.ok(fold, 'the duplicate A lane folds into the node')
  assert.equal(fold.d, laneClosePath(1, 0))

  const shift = paints[3].segments.find((s) => s.key === 'lane-2')!
  assert.ok(shift, 'Z moves one lane left')
  assert.equal(shift.d, laneShiftPath(2, 1))
  assert.deepEqual(shift.to, { x: laneCenter(1), y: SWIMLANE_HEIGHT })

  assert.deepEqual(bottomPoints(paints[3]), [laneCenter(0), laneCenter(1)])
  assert.deepEqual(topPoints(paints[4]), [laneCenter(0), laneCenter(1)])
  for (let i = 0; i < paints.length - 1; i++) {
    assert.deepEqual(bottomPoints(paints[i]), topPoints(paints[i + 1]), `seam ${i}`)
  }
})

test('a disconnected history does not leave a lane hanging', () => {
  const rows = [row('M', ['A', 'B']), row('A'), row('B')]
  const { paints } = paintsOf(rows)

  // A is a root: its lane ends at the node, B's lane slides one column left.
  const shifted = paints[1].segments.find((s) => s.key === 'lane-1')!
  assert.equal(shifted.d, laneShiftPath(1, 0))
  assert.deepEqual(bottomPoints(paints[1]), [laneCenter(0)])
  assert.deepEqual(topPoints(paints[2]), [laneCenter(0)])
  for (let i = 0; i < paints.length - 1; i++) {
    assert.deepEqual(bottomPoints(paints[i]), topPoints(paints[i + 1]), `seam ${i}`)
  }
})

test('every row renders its own connectors only', () => {
  const { plans, paints } = paintsOf(avd)
  paints.forEach((paint, i) => {
    const plan = plans[i]
    const laneSegments = paint.segments.filter((s) => s.key.startsWith('lane-'))
    assert.ok(laneSegments.length <= plan.input.length)
    const parentSegments = paint.segments.filter((s) => s.key.startsWith('parent-'))
    assert.equal(parentSegments.length, plan.extraParents.length)
    if (plan.parentCount === 0) {
      assert.equal(paint.segments.filter((s) => s.key === 'node-bottom').length, 0)
    }
  })
})

test('several branches waiting on one commit are all folded into it', () => {
  const { plans, paints } = paintsOf(multilevel)
  const notesRow = plans.findIndex((plan) => plan.hash === 'notes')
  assert.equal(notesRow, 39)

  // z, y and x each forked from `notes`, so its lane is reserved once per
  // branch long before the commit itself is reached.
  for (const [index, waiting] of [[3, 1], [6, 2], [9, 3]] as const) {
    assert.equal(plans[index].input.filter((lane) => lane.id === 'notes').length, waiting,
      `row ${index} keeps ${waiting} lane(s) waiting for notes`)
  }

  assert.equal(plans[notesRow].input.length, 4)
  assert.ok(plans[notesRow].input.every((lane) => lane.id === 'notes'))
  const closes = paints[notesRow].segments.filter((s) => s.key.startsWith('close-'))
  assert.deepEqual(closes.map((s) => s.d),
    [laneClosePath(1, 0), laneClosePath(2, 0), laneClosePath(3, 0)],
    'all three duplicates land on the node')
  assert.deepEqual(bottomPoints(paints[notesRow]), [laneCenter(0)], 'one lane is left going down')
})

test('an octopus merge joins every extra parent on the same row', () => {
  const { plans, paints } = paintsOf(multilevel)
  const octo = plans.findIndex((plan) => plan.hash === 'octo')
  assert.equal(plans[octo].parentCount, 3)
  assert.deepEqual(plans[octo].extraParents.map((p) => p.outputIndex), [5, 6])

  const parents = paints[octo].segments.filter((s) => s.key.startsWith('parent-'))
  assert.equal(parents.length, 2, 'two side parents, one connector each')
  assert.deepEqual(parents.map((s) => s.d), [
    mergeParentPath(5, plans[octo].circleIndex),
    mergeParentPath(6, plans[octo].circleIndex),
  ])
  assert.deepEqual(parents.map((s) => s.to.x), [laneCenter(5), laneCenter(6)])
  assert.notEqual(parents[0].color, parents[1].color, 'each side parent keeps its lane colour')
  // Both connectors plus the node's own column cover every lane that leaves
  // the row, so nothing is left hanging.
  assert.deepEqual(bottomPoints(paints[octo]), [11, 22, 33, 44, 55, 66, 77])
})

test('nested merges close into their own branch lane, not into master', () => {
  const { plans, paints } = paintsOf(multilevel)

  // merge: d-mid into feature-d  (a merge nested two levels deep)
  const nested = plans.findIndex((plan) => plan.hash === 'dmidmerge')
  assert.equal(plans[nested].circleIndex, 5, 'the nested merge node sits on feature-d lane')
  const nestedParents = paints[nested].segments.filter((s) => s.key.startsWith('parent-'))
  assert.equal(nestedParents.length, 1)
  assert.equal(nestedParents[0].to.x, laneCenter(6))

  // merge: d-deep into d-mid  (three levels deep, still one connector)
  const deeper = plans.findIndex((plan) => plan.hash === 'ddeepmerge')
  assert.equal(plans[deeper].circleIndex, 6)
  const deeperParents = paints[deeper].segments.filter((s) => s.key.startsWith('parent-'))
  assert.deepEqual(deeperParents.map((s) => s.to.x), [laneCenter(7)])

  // Master's own merge ring stays on lane 0 the whole time.
  const masterMerge = plans.findIndex((plan) => plan.hash === 'dmerge')
  assert.equal(plans[masterMerge].circleIndex, 0)
})
