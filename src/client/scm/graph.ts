/**
 * Commit-graph planning — SCM domain. Pure function over the loaded commit rows.
 * @module dsh-solution-explorer/client/scm/graph
 */

import type { CommitState, CommitRow } from "../state/store.ts"

/** Lane color palette (8 colors; wraps for >8 simultaneous branches). */
const GRAPH_COLORS = ["#e2b714", "#4ec9b0", "#58a6ff", "#d2a8ff", "#ff7b72", "#79c0ff", "#7ee787", "#ffa657"];

/** Width of one lane in SVG pixels. */
const LANE_W = 14;

/** Drop the selected inline commit detail (called when the list reloads). */
export function resetCommitDetail(commits: CommitState) {
  commits.graphDetailOpen = "";
}

/** One lane's drawing plan for a row. */
export interface GraphLaneDraw {
  x: number
  color: string
  node: boolean
  unpushed: boolean
  hasParent: boolean
  forks: { x: number; color: string }[]
}

/** One row's graph drawing plan (pure: no shared state mutation). */
export interface GraphRowDraw {
  width: number
  transitions: { x1: number; x2: number; color: string }[]
  lanes: GraphLaneDraw[]
}

/**
 * Plan the commit graph for the whole loaded list in one deterministic pass.
 * Every lane lives in local state, so React can render the graph without
 * mutating the store per row.
 *
 * Parent relationships are the only source of lanes: a parent hash that already
 * owns a lane is reused (never duplicated), and reaching it from a different
 * column adds a connector to the node's `forks` instead of a phantom lane.
 * @param rows - loaded commit rows, newest first.
 * @returns one drawing plan per row.
 */
export function planGraph(rows: readonly CommitRow[]): GraphRowDraw[] {
  const colorOf = (color: number): string => GRAPH_COLORS[color % GRAPH_COLORS.length];
  const xOf = (laneIndex: number): number => laneIndex * LANE_W + LANE_W / 2;
  const colorsOf = (list: readonly { color: number }[]): Set<number> => new Set(list.map((lane) => lane.color));
  const allocColor = (used: Set<number>): number => {
    for (let c = 0; c < GRAPH_COLORS.length; c++) if (!used.has(c)) return c;
    // Palette exhausted (>8 live lanes): wrap deterministically.
    return used.size % GRAPH_COLORS.length;
  };

  let lanes: { hash: string; color: number }[] = [];
  let prevLanes: { hash: string; color: number }[] = [];
  const out: GraphRowDraw[] = [];

  for (const commit of rows) {
    const parents = commit.parents ?? [];
    let idx = lanes.findIndex((lane) => lane.hash === commit.hash);
    if (idx === -1) {
      // The commit owns no lane yet (page boundary / extra head): give it one.
      idx = lanes.length;
      lanes = lanes.concat([{ hash: commit.hash, color: allocColor(colorsOf(lanes)) }]);
    }
    const node = lanes[idx];
    const nodeX = xOf(idx);

    // The commit's own lane disappears; its parents take/reuse lanes below it.
    const next = lanes.slice(0, idx).concat(lanes.slice(idx + 1));
    const used = colorsOf(next);
    const forks: { x: number; color: string }[] = [];
    let continuesStraight = false;

    for (let p = 0; p < parents.length; p++) {
      const parent = parents[p];
      const existing = next.findIndex((lane) => lane.hash === parent);
      if (existing !== -1) {
        // Parent already owns a lane: connect to it, never add a duplicate lane.
        const x = xOf(existing);
        if (p === 0 && x === nodeX) continuesStraight = true;
        else forks.push({ x, color: colorOf(next[existing].color) });
        continue;
      }
      if (p === 0) {
        // First parent keeps the node's column and color (continuous main line).
        next.splice(Math.min(idx, next.length), 0, { hash: parent, color: node.color });
        used.add(node.color);
        continuesStraight = true;
      } else {
        // Additional parents fork into fresh lanes at the right edge.
        const color = allocColor(used);
        used.add(color);
        forks.push({ x: xOf(next.length), color: colorOf(color) });
        next.push({ hash: parent, color });
      }
    }
    if (!continuesStraight) used.delete(node.color);

    // Safety net: a parent hash must own at most one lane.
    const seen = new Set<string>();
    const deduped = next.filter((lane) => {
      if (seen.has(lane.hash)) return false;
      seen.add(lane.hash);
      return true;
    });

    const transitions: { x1: number; x2: number; color: string }[] = [];
    prevLanes.forEach((pl, pi) => {
      const ci = lanes.findIndex((lane) => lane.hash === pl.hash);
      if (ci !== -1 && ci !== pi) {
        transitions.push({ x1: xOf(pi), x2: xOf(ci), color: colorOf(pl.color) });
      }
    });

    const laneDraws: GraphLaneDraw[] = lanes.map((lane, i) => ({
      x: xOf(i),
      color: colorOf(lane.color),
      node: i === idx,
      unpushed: i === idx && !!commit.unpushed,
      hasParent: i === idx && continuesStraight,
      forks: i === idx ? forks : [],
    }));

    // A row must fit its own lanes, the lanes it hands to the next row, any
    // connectors reaching further right, and transition curves that start at a
    // wider previous row (a lane shifting left must not be clipped).
    const laneCount = Math.max(lanes.length, deduped.length, forks.length);
    let width = Math.max(LANE_W, laneCount * LANE_W);
    for (const tr of transitions) width = Math.max(width, tr.x1 + LANE_W / 2, tr.x2 + LANE_W / 2);
    out.push({ width, transitions, lanes: laneDraws });

    prevLanes = lanes.slice();
    lanes = deduped;
  }
  return out;
}
