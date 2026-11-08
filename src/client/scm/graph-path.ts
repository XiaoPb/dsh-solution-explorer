export const SWIMLANE_WIDTH = 11
export const SWIMLANE_HEIGHT = 28
export const SWIMLANE_CURVE_RADIUS = 5

const mid = SWIMLANE_HEIGHT / 2
const laneCenter = (index: number) => SWIMLANE_WIDTH / 2 + SWIMLANE_WIDTH * index

/** VS Code's rounded lane-change path, mapped to this renderer's lane centers. */
export function laneShiftPath(fromIndex: number, toIndex: number): string {
  const fromX = laneCenter(fromIndex)
  const toX = laneCenter(toIndex)
  if (fromIndex === toIndex) return `M ${fromX} 0 V ${SWIMLANE_HEIGHT}`

  const direction = Math.sign(toX - fromX)
  const r = SWIMLANE_CURVE_RADIUS
  const firstSweep = direction > 0 ? 0 : 1
  const secondSweep = direction > 0 ? 1 : 0
  const startTurnX = fromX + direction * r
  const endTurnX = toX - direction * r

  return [
    `M ${fromX} 0`,
    `V ${mid - r}`,
    `A ${r} ${r} 0 0 ${firstSweep} ${startTurnX} ${mid}`,
    `H ${endTurnX}`,
    `A ${r} ${r} 0 0 ${secondSweep} ${toX} ${mid + r}`,
    `V ${SWIMLANE_HEIGHT}`,
  ].join(' ')
}

/** VS Code's non-first-parent connector: merge-back arc plus node join. */
export function mergeParentPath(parentIndex: number, circleIndex: number): string {
  const parentEdgeX = SWIMLANE_WIDTH * parentIndex
  const parentOuterX = SWIMLANE_WIDTH * (parentIndex + 1)
  const circleX = laneCenter(circleIndex)

  return [
    `M ${parentEdgeX} ${mid}`,
    `A ${SWIMLANE_WIDTH} ${SWIMLANE_WIDTH} 0 0 1 ${parentOuterX} ${SWIMLANE_HEIGHT}`,
    `M ${parentEdgeX} ${mid}`,
    `H ${circleX}`,
  ].join(' ')
}
