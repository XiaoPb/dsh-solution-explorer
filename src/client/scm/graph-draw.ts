/**
 * Turns one planned commit row into the exact SVG shapes VS Code's
 * `renderSCMHistoryItemGraph` emits, in the same order: every connector first,
 * the commit node last so it covers the line ends beneath it.
 *
 * Node geometry follows VS Code's numbers (`CIRCLE_RADIUS = 4`, stroke 2px):
 * a normal commit is a dot of radius 5, a merge is a ring (radius 6 + 3) and
 * the checked-out commit is the larger ring (radius 7 + 2). VS Code strokes
 * every circle with the row background, which is what makes the dots look
 * crisp where lines run underneath; that stroke (and the ring's hole fill)
 * comes from CSS so it can follow hover/selection backgrounds.
 * @module dsh-solution-explorer/client/scm/graph-draw
 */
import type { GraphParentDraw, GraphRowDraw } from './graph.ts'
import {
  laneCenter,
  laneClosePath,
  laneShiftPath,
  mergeParentPath,
  SWIMLANE_HEIGHT,
  SWIMLANE_MID,
  verticalPath,
} from './graph-path.ts'

/** Radius of a plain commit dot (VS Code: `CIRCLE_RADIUS + 1`). */
const NODE_RADIUS = 5
/** Outer/inner radius of a merge node. */
const MERGE_OUTER_RADIUS = 6
const MERGE_INNER_RADIUS = 3
/** Outer/inner radius of the checked-out commit node. */
const HEAD_OUTER_RADIUS = 7
const HEAD_INNER_RADIUS = 2

/** A point on the SVG canvas. */
export interface GraphPoint {
  x: number
  y: number
}

/** One `path` element and the two points it visually connects. */
export interface GraphSegmentDraw {
  key: string
  d: string
  color: string
  from: GraphPoint
  to: GraphPoint
}

/** One `circle` element. `kind` picks its CSS class (stroke/hole fill). */
export interface GraphNodeDraw {
  key: string
  kind: 'dot' | 'merge-outer' | 'merge-inner' | 'head-outer' | 'head-inner'
  cx: number
  cy: number
  r: number
  fill: string
}

/** Everything one row draws. */
export interface GraphRowPaint {
  segments: GraphSegmentDraw[]
  nodes: GraphNodeDraw[]
}

/**
 * Draws one row.
 *
 * `head` marks the checked-out commit so it gets VS Code's hollow "current"
 * node instead of the plain dot / merge ring.
 */
export function drawGraphRow(row: GraphRowDraw, options: { head?: boolean } = {}): GraphRowPaint {
  const segments: GraphSegmentDraw[] = []
  const nodes: GraphNodeDraw[] = []
  const nodeX = laneCenter(row.circleIndex)
  const node: GraphPoint = { x: nodeX, y: SWIMLANE_MID }

  // 1. Swimlanes carried over from the row above. The node's own lane is not
  //    drawn here; a duplicate of it (VS Code keeps one for a fold-back) folds
  //    into the node so the branch line never stops in mid-air.
  // A lane moves left when a lane above it disappears: one column per folded
  // duplicate, plus one more when the node is a root and gives up its column.
  const nodeDropped = row.inputIndex !== -1 && row.parentCount === 0
  let foldedAbove = 0
  row.input.forEach((lane, index) => {
    const from: GraphPoint = { x: laneCenter(index), y: 0 }
    if (lane.id === row.hash) {
      if (index !== row.circleIndex) {
        segments.push({
          key: `close-${index}`,
          d: laneClosePath(index, row.circleIndex),
          color: lane.color,
          from,
          to: node,
        })
        foldedAbove++
      }
      return
    }
    const target = index - foldedAbove - (nodeDropped && index > row.circleIndex ? 1 : 0)
    // When the lane has no counterpart left (a disconnected root row) it ends
    // here rather than being drawn into a column it no longer owns.
    if (target >= 0 && target < row.output.length && row.output[target].id === lane.id) {
      segments.push({
        key: `lane-${index}`,
        d: target === index ? verticalPath(index) : laneShiftPath(index, target),
        color: lane.color,
        from,
        to: { x: laneCenter(target), y: SWIMLANE_HEIGHT },
      })
    }
  })

  // 2. Parents after the first: arc into their lane plus the join to the node.
  row.extraParents.forEach((parent: GraphParentDraw, index: number) => {
    segments.push({
      key: `parent-${index}`,
      d: mergeParentPath(parent.outputIndex, row.circleIndex),
      color: parent.color,
      from: node,
      to: { x: laneCenter(parent.outputIndex), y: SWIMLANE_HEIGHT },
    })
  })

  // 3. The node's own vertical: lane color above, node color below.
  if (row.inputIndex !== -1) {
    segments.push({
      key: 'node-top',
      d: verticalPath(row.circleIndex, 0, SWIMLANE_MID),
      color: row.input[row.inputIndex].color,
      from: { x: nodeX, y: 0 },
      to: node,
    })
  }
  if (row.parentCount > 0) {
    segments.push({
      key: 'node-bottom',
      d: verticalPath(row.circleIndex, SWIMLANE_MID, SWIMLANE_HEIGHT),
      color: row.color,
      from: node,
      to: { x: nodeX, y: SWIMLANE_HEIGHT },
    })
  }

  // 4. The node itself, last, so it covers every line that ends under it.
  if (options.head) {
    nodes.push({ key: 'head-outer', kind: 'head-outer', cx: nodeX, cy: SWIMLANE_MID, r: HEAD_OUTER_RADIUS, fill: row.color })
    nodes.push({ key: 'head-inner', kind: 'head-inner', cx: nodeX, cy: SWIMLANE_MID, r: HEAD_INNER_RADIUS, fill: row.color })
  } else if (row.parentCount > 1) {
    nodes.push({ key: 'merge-outer', kind: 'merge-outer', cx: nodeX, cy: SWIMLANE_MID, r: MERGE_OUTER_RADIUS, fill: row.color })
    nodes.push({ key: 'merge-inner', kind: 'merge-inner', cx: nodeX, cy: SWIMLANE_MID, r: MERGE_INNER_RADIUS, fill: row.color })
  } else {
    nodes.push({ key: 'node', kind: 'dot', cx: nodeX, cy: SWIMLANE_MID, r: NODE_RADIUS, fill: row.color })
  }

  return { segments, nodes }
}

/** Plans the paints of a whole list, marking the first row as the checked-out one. */
export function drawGraph(rows: readonly GraphRowDraw[]): GraphRowPaint[] {
  return rows.map((row, index) => drawGraphRow(row, { head: index === 0 }))
}
