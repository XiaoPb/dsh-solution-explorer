/**
 * Pure commit-graph planner.
 *
 * Follows VS Code's model (`toISCMHistoryItemViewModelArray` in
 * `src/vs/workbench/contrib/scm/browser/scmHistory.ts`): every row keeps the
 * swimlanes entering it (`input`) and the ones leaving it (`output`), plus the
 * column the node sits in. The renderer therefore never has to reverse-engineer
 * a connector from partial fork data.
 * @module dsh-solution-explorer/client/scm/graph
 */
import type { CommitRow, CommitState } from '../state/store.ts'
import { laneCountWidth, SWIMLANE_WIDTH } from './graph-path.ts'

/**
 * `scmGraph.historyItemRefColor` (chartsBlue): the lane of the checked-out
 * branch, i.e. the lane a brand new commit opens.
 */
const REF_COLOR = '#3794FF'
/** `scmGraph.foreground1..5`, VS Code's rotation for every other lane. */
const LANE_COLORS = ['#FFB000', '#DC267F', '#994F00', '#40B0A6', '#B66DFF']

/** One swimlane: the commit its line is waiting for, and its color. */
export interface GraphSwimlane {
  id: string
  color: string
}

/** Where a non-first parent lands in the row's output lanes. */
export interface GraphParentDraw {
  outputIndex: number
  color: string
}

/** Everything one commit row needs in order to be drawn. */
export interface GraphRowDraw {
  /** Commit hash this row draws. */
  hash: string
  /** Swimlanes entering the row, i.e. the previous row's output. */
  input: GraphSwimlane[]
  /** Swimlanes leaving the row, i.e. the next row's input. */
  output: GraphSwimlane[]
  /** Column of the commit node in `input`/`output`. */
  circleIndex: number
  /** Index of this commit in `input`, `-1` when the row opens a new lane. */
  inputIndex: number
  /** Color of the node and of its downward continuation. */
  color: string
  /** Number of parents; `0` means the row is a root and has no lower half. */
  parentCount: number
  /** Resolved columns for `parents[1..]`, in parent order. */
  extraParents: GraphParentDraw[]
  /** SVG width of the row in px. */
  width: number
}

/** Clears the selected commit detail row when the history is reloaded. */
export function resetCommitDetail(commits: CommitState): void {
  commits.graphDetailOpen = ''
}

function lastIndexOfLane(lanes: readonly GraphSwimlane[], id: string): number {
  for (let i = lanes.length - 1; i >= 0; i--) if (lanes[i].id === id) return i
  return -1
}

/**
 * Plans every row of `rows` (newest first).
 *
 * Lanes survive a row unless the row's commit is what they were waiting for; in
 * that case the commit's first parent inherits the lane and any remaining
 * parent opens a new one. When a first parent is *already* active in another
 * lane the lane is duplicated exactly like VS Code does; the duplicate is
 * folded back into the node by {@link import('./graph-draw.ts').drawGraphRow}.
 */
export function planGraph(rows: readonly CommitRow[]): GraphRowDraw[] {
  const plans: GraphRowDraw[] = []
  let previous: GraphSwimlane[] = []
  let laneColor = -1

  for (const commit of rows) {
    const parents = commit.parents ?? []
    const input = previous.map((lane) => ({ ...lane }))
    const inputIndex = input.findIndex((lane) => lane.id === commit.hash)
    const circleIndex = inputIndex !== -1 ? inputIndex : input.length

    // First parent inherits the node's lane; every other lane is carried over.
    // A root commit has no parent to inherit the lane, so its lane simply ends
    // there — while the lanes of other branches keep running, which is what
    // keeps a disconnected (multi-root) history continuous.
    const output: GraphSwimlane[] = []
    let firstParentAdded = false
    for (const lane of input) {
      if (lane.id === commit.hash) {
        if (parents.length > 0 && !firstParentAdded) {
          output.push({ id: parents[0], color: lane.color })
          firstParentAdded = true
        }
        continue
      }
      output.push({ ...lane })
    }

    // Parents that do not own a lane yet: the first one is the branch itself
    // (reference color), the rest rotate through the foreground palette.
    for (let i = firstParentAdded ? 1 : 0; i < parents.length; i++) {
      let color: string
      if (i === 0) {
        color = REF_COLOR
      } else {
        laneColor = (laneColor + 1) % LANE_COLORS.length
        color = LANE_COLORS[laneColor]
      }
      output.push({ id: parents[i], color })
    }

    // The node keeps its own lane's color; only a commit that opens a new lane
    // takes the color of the parent lane it just created.
    const color = inputIndex !== -1
      ? input[inputIndex].color
      : circleIndex < output.length ? output[circleIndex].color : REF_COLOR

    const extraParents: GraphParentDraw[] = []
    for (let p = 1; p < parents.length; p++) {
      const outputIndex = lastIndexOfLane(output, parents[p])
      if (outputIndex === -1) continue
      extraParents.push({ outputIndex, color: output[outputIndex].color })
    }

    plans.push({
      hash: commit.hash,
      input,
      output,
      circleIndex,
      inputIndex,
      color,
      parentCount: parents.length,
      extraParents,
      // `circleIndex + 1` only matters when a row opens its own lane without a
      // parent lane to sit on (a disconnected root); it keeps the node inside
      // the SVG instead of clipping it on the right edge.
      width: laneCountWidth(Math.max(input.length, output.length, circleIndex + 1)),
    })
    previous = output
  }

  return plans
}

/** Widest row, so the whole column keeps one width and the text never jitters. */
export function graphColumnWidth(plans: readonly GraphRowDraw[]): number {
  let width = SWIMLANE_WIDTH * 2
  for (const plan of plans) width = Math.max(width, plan.width)
  return width
}
