/**
 * React commits list — the "recent commits" list with its graph column.
 *
 * Rows are React elements, the graph is drawn with React SVG elements from the
 * pure {@link planGraph} plan, and the inline commit detail renders from the
 * detail cache (no imperative DOM insertion).
 * @module dsh-solution-explorer/client/scm/CommitsList
 */
import { createElement as h, Fragment } from 'react'
import type { ReactNode } from 'react'
import { FileTypeIcon } from '../icons.ts'
import { t } from '../locales.ts'
import { relTime } from '../shared/dom.ts'
import { gitStatusClass } from '../explorer/file-kind.ts'
import { planGraph, type GraphRowDraw } from './graph.ts'
import { laneShiftPath, mergeParentPath, SWIMLANE_HEIGHT, SWIMLANE_WIDTH } from './graph-path.ts'
import type { CommitState } from '../state/store.ts'

// Must equal the CSS height of one `.sol-exp-commit-item`: the SVG fills the
// whole row so lane lines are continuous across rows (no inter-row gaps).
const ROW_H = SWIMLANE_HEIGHT
const NODE_R = 4
const MERGE_R = 6

/** Actions the commits list needs. */
export interface CommitsActions {
  commitDetail(hash: string): void
  commitCheckout(hash: string): void
}

/** Props of the commits list. */
export interface CommitsListProps {
  commits: CommitState
  actions: CommitsActions
}

/** One row's graph column, drawn as React SVG elements. */
function GraphSvg({ draw, merge }: { draw: GraphRowDraw; merge: boolean }): ReactNode {
  const children: ReactNode[] = []
  const nodeLane = draw.lanes.find((lane) => lane.node)
  const nodeIndex = Math.max(0, Math.round(((nodeLane?.x ?? 5.5) - 5.5) / SWIMLANE_WIDTH))
  const nodeX = 5.5 + nodeIndex * SWIMLANE_WIDTH
  const nodeR = merge ? MERGE_R : NODE_R

  // Draw lane shifts and straight continuations first. VS Code computes these
  // from each lane's input/output column before drawing any commit circles.
  draw.lanes.forEach((lane, inputIndex) => {
    const laneIndex = Math.max(0, Math.round((lane.x - 5.5) / SWIMLANE_WIDTH))
    const shift = lane.forks.find((fork) => fork.kind === 'shift')
    const d = shift
      ? laneShiftPath(laneIndex, Math.max(0, Math.round((shift.x - 5.5) / SWIMLANE_WIDTH)))
      : `M ${lane.x} 0 V ${SWIMLANE_HEIGHT}`
    children.push(h('path', {
      key: 'lane-' + inputIndex, d,
      fill: 'none', stroke: lane.color, strokeWidth: 1, strokeLinecap: 'round',
    }))
  })

  // Add non-first-parent connectors using VS Code's 11px parent arc + join.
  draw.lanes.forEach((lane, inputIndex) => {
    lane.forks.forEach((fork, forkIndex) => {
      if (fork.kind !== 'merge') return
      const parentIndex = Math.max(0, Math.round((fork.x - 5.5) / SWIMLANE_WIDTH))
      children.push(h('path', {
        key: `merge-${inputIndex}-${forkIndex}`,
        d: mergeParentPath(nodeIndex, parentIndex),
        fill: 'none', stroke: fork.color, strokeWidth: 1, strokeLinecap: 'round',
      }))
    })
  })

  // The node is the top layer; paths terminate behind its ring, matching the
  // VS Code renderer's draw-paths-first, draw-circle-last ordering.
  if (nodeLane) {
    if (merge) {
      children.push(h('circle', {
        key: 'node-outer', cx: nodeX, cy: ROW_H / 2, r: nodeR,
        fill: 'var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-layer-2))',
        stroke: nodeLane.color, strokeWidth: 2,
      }))
      children.push(h('circle', { key: 'node-inner', cx: nodeX, cy: ROW_H / 2, r: 2, fill: nodeLane.color }))
    } else {
      children.push(h('circle', { key: 'node', cx: nodeX, cy: ROW_H / 2, r: nodeR, fill: nodeLane.color }))
    }
  }
  return h('svg', { className: 'sol-exp-graph-svg', width: draw.width, height: ROW_H }, children)
}

/** The expanded file list + checkout action under a selected commit row. */
function CommitDetailInline({ detail, hash, actions }: {
  detail: { files?: Array<{ path: string; status: string; oldPath?: string }> } | undefined
  hash: string
  actions: CommitsActions
}): ReactNode {
  if (detail === undefined) {
    return h('div', { className: 'sol-exp-commit-detail-inline', 'data-hash': hash },
      h('div', { style: { padding: '2px 0', color: 'var(--dsw-alias-label-tertiary)' } }, t('loading')))
  }
  const files = (detail.files ?? []).slice(0, 200)
  return h('div', { className: 'sol-exp-commit-detail-inline', 'data-hash': hash },
    files.length === 0
      ? h('div', { className: 'sol-exp-commit-file-row', style: { color: 'var(--dsw-alias-label-tertiary)' } }, t('scm.log.empty'))
      : files.map((f, i) => h('div', {
          key: i,
          className: 'sol-exp-commit-file-row',
          title: f.oldPath ? `${f.oldPath} → ${f.path}` : f.path,
        },
          h('span', { className: 'sol-exp-commit-file-icon' }, h(FileTypeIcon, { path: f.path, size: 14 })),
          h('span', { className: 'sol-exp-commit-file-path' }, f.oldPath ? `${f.oldPath} → ${f.path}` : f.path),
          h('span', { className: 'sol-exp-commit-file-status sol-exp-git-' + gitStatusClass(f.status) }, f.status),
        )),
    h('div', { className: 'sol-exp-commit-detail-footer' },
      h('button', { className: 'sol-exp-commit-detail-btn', onClick: () => actions.commitCheckout(hash) }, 'Checkout')),
  )
}

/** The commits list body (loading / empty / rows with graph). */
export function CommitsList({ commits, actions }: CommitsListProps): ReactNode {
  // The SCM view (not this list) is the scroll container: the graph expands
  // inside the single column and its pagination is driven by the view's
  // onScroll handler, exactly like VS Code's Source Control view.
  const listStyle = {
    marginTop: '2px', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)',
  } as const

  if (commits.rows === null) {
    return h('div', { id: 'sol-exp-commits-list', style: listStyle }, t('loading'))
  }
  if (commits.rows.length === 0) {
    return h('div', { id: 'sol-exp-commits-list', style: listStyle }, t('scm.log.empty'))
  }

  const plans = planGraph(commits.rows)
  return h('div', { id: 'sol-exp-commits-list', style: listStyle },
    commits.rows.map((c, i) => {
      const selected = commits.graphDetailOpen === c.hash
      const detail = selected ? commits.commitDetailCache.get(c.hash) : undefined
      return h(Fragment, { key: c.hash },
        h('div', {
          className: 'sol-exp-commit-item' + (selected ? ' selected' : ''),
          'data-hash': c.hash,
          onClick: () => actions.commitDetail(c.hash),
        },
          h('span', { className: 'sol-exp-graph', style: { display: 'flex', flexShrink: 0 } },
            h(GraphSvg, { draw: plans[i], merge: (c.parents?.length ?? 0) > 1 })),
          h('span', { className: 'sol-exp-commit-hash', style: { flexShrink: 0 } }, c.shortHash),
          h('span', { className: 'sol-exp-commit-msg', style: { minWidth: 0 } }, c.message.substring(0, 60) + (c.message.length > 60 ? '...' : '')),
          h('span', { className: 'sol-exp-commit-date', style: { flexShrink: 0 } }, relTime(c.timestamp)),
        ),
        selected ? h(CommitDetailInline, { detail, hash: c.hash, actions }) : null,
      )
    }))
}
