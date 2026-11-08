/**
 * Phone-only information header.
 *
 * Rendered above the activity bar for every expanded panel; CSS shows it only
 * while the column carries `data-sol-exp-sheet`. It answers "where am I" before
 * the user starts navigating: workspace, branch, sync counters, pending changes
 * and a close button that sits in the thumb-reachable corner.
 *
 * Plain React (no JSX) and no window access, per the client conventions.
 * @module dsh-solution-explorer/client/layout/MobileHeader
 */
import { createElement as h } from 'react'
import type { ReactNode } from 'react'
import { IconBranchOutline, IconCloseOutline, IconFolderClose } from '../icons.ts'
import { t } from '../locales.ts'
import { isUsableBranch, syncLabel, workspaceName } from '../shared/labels.ts'
import type { AppState } from '../state/store.ts'
import type { PanelActions } from '../PanelRoot.ts'

/* React icon `size` is a prop, not a CSS value; keep the JS-side values in one
 * place and in sync with --sol-exp-icon-size / --sol-exp-icon-size-sm. */
const HEADER_ICON_SIZE = 16
const HEADER_META_ICON_SIZE = 14

/** Props of the phone-only information header. */
export interface MobileHeaderProps {
  state: AppState
  actions: PanelActions
}

/** Workspace, git state and the sheet close affordance, in one compact row. */
export function MobileHeader({ state, actions }: MobileHeaderProps): ReactNode {
  const root = state.root
  const name = workspaceName(root)
  const status = state.scm.gitStatus
  const branch = isUsableBranch(status?.branch) ? status.branch : ''
  const sync = syncLabel(Number(status?.ahead ?? 0), Number(status?.behind ?? 0))
  const changes = state.scm.gitChangesCount
  const busy = state.tree.loading || state.search.searching || state.scm.committing

  return h('div', { className: 'sol-exp-mobilehead' },
    h('div', { className: 'sol-exp-mobilehead-row' },
      h('div', {
        className: 'sol-exp-mobilehead-workspace',
        title: root !== '' ? root : undefined,
      },
        h(IconFolderClose, { size: HEADER_ICON_SIZE }),
        h('span', { className: 'sol-exp-mobilehead-name' },
          name !== '' ? name : t('panel.empty')),
      ),
      branch !== ''
        ? h('div', { className: 'sol-exp-mobilehead-branch', title: branch },
            h(IconBranchOutline, { size: HEADER_META_ICON_SIZE }),
            h('span', { className: 'sol-exp-mobilehead-branch-name' }, branch),
            sync !== ''
              ? h('span', { className: 'sol-exp-mobilehead-sync' }, sync)
              : null,
          )
        : (root !== '' ? h('span', { className: 'sol-exp-mobilehead-nogit' }, t('header.noGit')) : null),
      changes > 0
        ? h('span', { className: 'sol-exp-mobilehead-changes' },
            String(changes),
            h('span', { className: 'sol-exp-mobilehead-changes-unit' }, t('header.changes')))
        : null,
      busy
        ? h('span', { className: 'sol-exp-mobilehead-busy', 'aria-hidden': 'true' }, '…')
        : null,
      h('div', { style: { flex: 1 } }),
      h('button', {
        type: 'button',
        className: 'sol-exp-mobilehead-close',
        title: t('header.close'),
        'aria-label': t('header.close'),
        'data-sol-exp-close': '',
        onClick: (e) => {
          e.stopPropagation()
          actions.togglePanel()
        },
      }, h(IconCloseOutline, { size: HEADER_ICON_SIZE })),
    ),
  )
}
