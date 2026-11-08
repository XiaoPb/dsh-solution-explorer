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
import type { CommitState } from '../state/store.ts'

// Must equal the CSS height of one `.sol-exp-commit-item`: the SVG fills the
// whole row so lane lines are continuous across rows (no inter-row gaps).
const ROW_H = 28
const NODE_R = 4
const MERGE_R = 5.5

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
  const nodeR = merge ? MERGE_R : NODE_R
  draw.transitions.forEach((tr, i) => {
    children.push(h('path', {
      key: 't' + i,
      d: `M ${tr.x1} 0 C ${tr.x1} ${ROW_H / 2}, ${tr.x2} ${ROW_H / 2}, ${tr.x2} ${ROW_H}`,
      fill: 'none', stroke: tr.color, strokeWidth: 2, strokeLinecap: 'round', opacity: 0.9,
    }))
  })
  draw.lanes.forEach((lane, i) => {
    if (!lane.node) {
      children.push(h('line', { key: 'l' + i, x1: lane.x, y1: 0, x2: lane.x, y2: ROW_H, stroke: lane.color, strokeWidth: 2, strokeLinecap: 'round' }))
      return
    }
    children.push(h('line', { key: 'u' + i, x1: lane.x, y1: 0, x2: lane.x, y2: ROW_H / 2 - nodeR, stroke: lane.color, strokeWidth: 2, strokeLinecap: 'round' }))
    if (merge) {
      // VS Code draws a merge commit as a hollow ring; the lane line stops at
      // its edge and restarts below, so the merge point reads distinctly.
      children.push(h('circle', {
        key: 'c' + i, cx: lane.x, cy: ROW_H / 2, r: nodeR,
        fill: 'var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-layer-2))',
        stroke: lane.color, strokeWidth: 2,
      }))
      children.push(h('circle', { key: 'ci' + i, cx: lane.x, cy: ROW_H / 2, r: 1.8, fill: lane.color }))
    } else {
      // Normal commits are filled with their lane color; "unpushed" adds an
      // outer ring instead of replacing the fill (it must never turn every
      // node into a hollow ring).
      children.push(h('circle', { key: 'c' + i, cx: lane.x, cy: ROW_H / 2, r: nodeR, fill: lane.color }))
    }

    if (lane.hasParent) {
      children.push(h('line', { key: 'd' + i, x1: lane.x, y1: ROW_H / 2 + nodeR, x2: lane.x, y2: ROW_H, stroke: lane.color, strokeWidth: 2, strokeLinecap: 'round' }))
    }
    lane.forks.forEach((f, fi) => {
      if (f.x === lane.x) return
      // Smooth S-curve from the node to the parent lane at the row bottom, so
      // the merged branch flows into the next row instead of a hard diagonal.
      const y1 = ROW_H / 2 + nodeR
      children.push(h('path', {
        key: 'f' + i + '-' + fi,
        d: `M ${lane.x} ${y1} C ${lane.x} ${y1 + 8}, ${f.x} ${ROW_H - 8}, ${f.x} ${ROW_H}`,
        fill: 'none', stroke: f.color, strokeWidth: 2, strokeLinecap: 'round',
      }))
    })
  })
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
