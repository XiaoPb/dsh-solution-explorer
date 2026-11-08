import type { CommitRow, CommitState } from '../state/store.ts'

const COLORS = ['#3794FF', '#FFB000', '#DC267F', '#994F00', '#40B0A6', '#B66DFF']
const LANE_W = 11
const xAt = (index: number): number => 5.5 + index * LANE_W

export interface GraphForkDraw {
  x: number
  color: string
  kind: 'shift' | 'merge'
}

export interface GraphLaneDraw {
  x: number
  color: string
  node: boolean
  unpushed: boolean
  hasParent: boolean
  forks: GraphForkDraw[]
}

export interface GraphRowDraw {
  width: number
  transitions: { x1: number; x2: number; color: string }[]
  lanes: GraphLaneDraw[]
}

export function resetCommitDetail(commits: CommitState): void {
  commits.graphDetailOpen = ''
}

/** Plan commit rows by mapping input lanes to their output lanes. */
export function planGraph(rows: readonly CommitRow[]): GraphRowDraw[] {
  let lanes: { hash: string; color: string }[] = []
  let nextColor = 1
  const plans: GraphRowDraw[] = []

  for (const commit of rows) {
    const parents = commit.parents ?? []
    let nodeIndex = lanes.findIndex((lane) => lane.hash === commit.hash)
    if (nodeIndex < 0) {
      nodeIndex = lanes.length
      lanes.push({ hash: commit.hash, color: COLORS[nodeIndex === 0 ? 0 : nextColor++ % COLORS.length] })
    }

    const input = lanes
    const nodeLane = input[nodeIndex]
    const output: typeof lanes = []
    if (parents[0]) output.push({ hash: parents[0], color: nodeLane.color })
    for (let i = 0; i < input.length; i++) {
      if (i === nodeIndex) continue
      const lane = input[i]
      if (!output.some((entry) => entry.hash === lane.hash)) output.push(lane)
    }
    for (let p = 1; p < parents.length; p++) {
      if (!output.some((lane) => lane.hash === parents[p])) {
        output.push({ hash: parents[p], color: COLORS[nextColor++ % COLORS.length] })
      }
    }

    const uniqueOutput = output.filter((lane, i) => output.findIndex((other) => other.hash === lane.hash) === i)
    const forks = new Map<number, GraphForkDraw[]>()
    const addFork = (laneIndex: number, fork: GraphForkDraw): void => {
      const current = forks.get(laneIndex) ?? []
      current.push(fork)
      forks.set(laneIndex, current)
    }

    // If the first parent was already active on another input lane, the
    // current node's lane shifts into that existing parent lane (diamond close).
    if (parents[0]) {
      const parentOutputIndex = uniqueOutput.findIndex((lane) => lane.hash === parents[0])
      if (parentOutputIndex >= 0 && parentOutputIndex !== nodeIndex) {
        addFork(nodeIndex, { x: xAt(parentOutputIndex), color: nodeLane.color, kind: 'shift' })
      }
    }

    // Every surviving input lane either stays vertical or performs VS Code's
    // rounded lane shift to its output column.
    input.forEach((lane, inputIndex) => {
      const outputIndex = uniqueOutput.findIndex((entry) => entry.hash === lane.hash)
      if (outputIndex >= 0 && outputIndex !== inputIndex) {
        addFork(inputIndex, { x: xAt(outputIndex), color: lane.color, kind: 'shift' })
      }
    })

    // VS Code records each non-first parent on the current node lane. The
    // renderer then draws the parent's arc plus a horizontal join to this node.
    for (let p = parents.length > 0 ? 1 : 0; p < parents.length; p++) {
      const parent = parents[p]
      const outputIndex = uniqueOutput.findIndex((lane) => lane.hash === parent)
      if (outputIndex < 0) continue
      addFork(nodeIndex, { x: xAt(outputIndex), color: uniqueOutput[outputIndex].color, kind: 'merge' })
    }

    const laneDraws = input.map((lane, i) => ({
      x: xAt(i),
      color: lane.color,
      node: i === nodeIndex,
      unpushed: i === nodeIndex && !!commit.unpushed,
      hasParent: i === nodeIndex && parents.length > 0,
      forks: forks.get(i) ?? [],
    }))
    plans.push({
      width: Math.max(LANE_W, input.length * LANE_W, uniqueOutput.length * LANE_W),
      transitions: [],
      lanes: laneDraws,
    })
    lanes = uniqueOutput
  }

  return plans
}
