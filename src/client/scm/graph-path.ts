/**
 * SVG geometry for the commit graph, ported from VS Code's
 * `renderSCMHistoryItemGraph` in `src/vs/workbench/contrib/scm/browser/scmHistory.ts`.
 *
 * VS Code's constants are `SWIMLANE_WIDTH = 11`, `SWIMLANE_HEIGHT = 22`,
 * `SWIMLANE_CURVE_RADIUS = 5`, `CIRCLE_RADIUS = 4`. Lane `i` is centered at
 * `SWIMLANE_WIDTH * (i + 1)`; a lane's vertical line runs through that center
 * and the commit node sits on it at half the row height.
 *
 * This module keeps the width/curve-radius numbers and stretches the height to
 * 28px so the SVG fills one list row. The stretched parts stay exact arcs: the
 * lane-shift elbows are quarter circles (radius 5) and only the merge connector
 * — a quarter circle in VS Code because there `height / 2 === width` — becomes
 * a quarter ellipse with `ry = height / 2`.
 * @module dsh-solution-explorer/client/scm/graph-path
 */

/** Horizontal distance between two swimlanes. */
export const SWIMLANE_WIDTH = 11
/** Row height, matching the CSS height of one commit row. */
export const SWIMLANE_HEIGHT = 28
/** Radius of the rounded elbows used by lane shifts. */
export const SWIMLANE_CURVE_RADIUS = 5

/** Half a row: the commit node's `cy`. */
export const SWIMLANE_MID = SWIMLANE_HEIGHT / 2

/** x coordinate of lane `index`'s vertical line and node. */
export const laneCenter = (index: number): number => SWIMLANE_WIDTH * (index + 1)

/** Left edge of lane `index`, where VS Code starts the merge connector arc. */
export const laneEdge = (index: number): number => SWIMLANE_WIDTH * index

/** SVG width for a row that holds `lanes` swimlanes (VS Code's max + 1). */
export const laneCountWidth = (lanes: number): number => SWIMLANE_WIDTH * (Math.max(lanes, 1) + 1)

/** Straight segment: the shape VS Code uses for a lane that keeps its column. */
export function verticalPath(index: number, fromY = 0, toY = SWIMLANE_HEIGHT): string {
  return `M ${laneCenter(index)} ${fromY} V ${toY}`
}

/**
 * VS Code's rounded lane change: vertical, quarter circle, horizontal,
 * quarter circle, vertical. Kept in both directions (VS Code only shifts left).
 */
export function laneShiftPath(fromIndex: number, toIndex: number): string {
  if (fromIndex === toIndex) return verticalPath(fromIndex)

  const fromX = laneCenter(fromIndex)
  const toX = laneCenter(toIndex)
  const direction = Math.sign(toX - fromX)
  const r = SWIMLANE_CURVE_RADIUS
  const firstSweep = direction > 0 ? 0 : 1
  const secondSweep = direction > 0 ? 1 : 0
  const startTurnX = fromX + direction * r
  const endTurnX = toX - direction * r

  return [
    `M ${fromX} 0`,
    `V ${SWIMLANE_MID - r}`,
    `A ${r} ${r} 0 0 ${firstSweep} ${startTurnX} ${SWIMLANE_MID}`,
    `H ${endTurnX}`,
    `A ${r} ${r} 0 0 ${secondSweep} ${toX} ${SWIMLANE_MID + r}`,
    `V ${SWIMLANE_HEIGHT}`,
  ].join(' ')
}

/**
 * Top-half lane change into the commit node: this is VS Code's "base commit"
 * connector (`M x 0` → arc → `H circle`). It closes a lane that folds into the
 * node on this row, so the row above's lane never ends in mid-air.
 */
export function laneClosePath(fromIndex: number, toIndex: number): string {
  const fromX = laneCenter(fromIndex)
  const toX = laneCenter(toIndex)
  const direction = Math.sign(toX - fromX) || 1
  const sweep = direction > 0 ? 0 : 1

  return [
    `M ${fromX} 0`,
    `A ${SWIMLANE_WIDTH} ${SWIMLANE_MID} 0 0 ${sweep} ${fromX + direction * SWIMLANE_WIDTH} ${SWIMLANE_MID}`,
    `H ${toX}`,
  ].join(' ')
}

/**
 * VS Code's non-first-parent connector: an arc from the parent lane's left edge
 * down into the parent lane, plus the horizontal join into the merge node.
 * `parentIndex` is the parent's **output** lane, `circleIndex` the node's lane.
 */
export function mergeParentPath(parentIndex: number, circleIndex: number): string {
  const parentX = laneEdge(parentIndex)

  return [
    `M ${parentX} ${SWIMLANE_MID}`,
    `A ${SWIMLANE_WIDTH} ${SWIMLANE_MID} 0 0 1 ${laneCenter(parentIndex)} ${SWIMLANE_HEIGHT}`,
    `M ${parentX} ${SWIMLANE_MID}`,
    `H ${laneCenter(circleIndex)}`,
  ].join(' ')
}
