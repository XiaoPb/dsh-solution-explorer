/**
 * React commits list — the "recent commits" list with its graph column.
 *
 * Rows are React elements, the graph is drawn with React SVG elements from the
 * pure planner ({@link planGraph}) and painter ({@link drawGraph}), and the
 * inline commit detail renders from the detail cache (no imperative DOM
 * insertion).
 * @module dsh-solution-explorer/client/scm/CommitsList
 */
import { createElement as h, Fragment } from 'react'
import type { ReactNode } from 'react'
import { FileTypeIcon } from '../icons.ts'
import { t } from '../locales.ts'
import { relTime } from '../shared/dom.ts'
import { gitStatusClass } from '../explorer/file-kind.ts'
import { graphColumnWidth, planGraph } from './graph.ts'
import { drawGraph } from './graph-draw.ts'
import type { GraphRowPaint } from './graph-draw.ts'
import { SWIMLANE_HEIGHT } from './graph-path.ts'
import type { CommitState } from '../state/store.ts'

// Must equal the CSS height of one `.sol-exp-commit-item`: the SVG fills the
// whole row so lane lines are continuous across rows (no inter-row gaps).
const ROW_H = SWIMLANE_HEIGHT

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

/**
 * One row's graph column, drawn as React SVG elements in VS Code's order:
 * connectors first, the node last so it covers the line ends beneath it.
 * `width` is shared by every row so the hash/message columns stay aligned.
 */
function GraphSvg({ paint, width }: { paint: GraphRowPaint; width: number }): ReactNode {
  const children: ReactNode[] = paint.segments.map((segment) => h('path', {
    key: segment.key,
    d: segment.d,
    fill: 'none',
    stroke: segment.color,
    strokeWidth: 1,
    strokeLinecap: 'round',
  }))

  // VS Code strokes every circle with the row background, which keeps the dots
  // crisp where connectors run underneath; the "current" node's hole is filled
  // the same way. Both colors live in CSS so hover/selection follow.
  for (const node of paint.nodes) {
    children.push(h('circle', {
      key: node.key,
      className: 'sol-exp-graph-node sol-exp-graph-' + node.kind,
      cx: node.cx,
      cy: node.cy,
      r: node.r,
      fill: node.kind === 'head-inner' ? undefined : node.fill,
      strokeWidth: node.kind === 'head-inner' ? 4 : 2,
    }))
  }

  return h('svg', { className: 'sol-exp-graph-svg', width, height: ROW_H }, children)
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
  const paints = drawGraph(plans)
  const width = graphColumnWidth(plans)
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
            h(GraphSvg, { paint: paints[i], width })),
          h('span', { className: 'sol-exp-commit-hash', style: { flexShrink: 0 } }, c.shortHash),
          h('span', { className: 'sol-exp-commit-msg', style: { minWidth: 0 } }, c.message.substring(0, 60) + (c.message.length > 60 ? '...' : '')),
          h('span', { className: 'sol-exp-commit-date', style: { flexShrink: 0 } }, relTime(c.timestamp)),
        ),
        selected ? h(CommitDetailInline, { detail, hash: c.hash, actions }) : null,
      )
    }))
}
