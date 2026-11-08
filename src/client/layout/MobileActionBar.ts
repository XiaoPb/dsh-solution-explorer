/**
 * Phone-only bottom action bar.
 *
 * Explorer actions sit in the thumb zone instead of the top view header. CSS
 * shows this bar only while the column carries `data-sol-exp-sheet`; desktop
 * keeps the original header. The search tab needs no actions, and SCM only
 * needs a refresh at this level.
 * @module dsh-solution-explorer/client/layout/MobileActionBar
 */
import { createElement as h } from 'react'
import type { ReactNode } from 'react'
import {
  IconChevronDownOutline,
  IconChevronUpOutline,
  IconPlusOutline,
  IconProjectAddOutline,
  IconRefreshOutline,
} from '../icons.ts'
import { t } from '../locales.ts'
import type { AppState } from '../state/store.ts'
import type { PanelActions } from '../PanelRoot.ts'

const ACTION_ICON_SIZE = 16

/** Props of the phone-only bottom action bar. */
export interface MobileActionBarProps {
  state: AppState
  actions: PanelActions
}

/** Explorer / SCM actions for the phone sheet. */
export function MobileActionBar({ state, actions }: MobileActionBarProps): ReactNode {
  const item = (label: string, icon: ReactNode, onClick: () => void): ReactNode =>
    h('button', {
      type: 'button',
      className: 'sol-exp-actionbar-btn',
      title: label,
      'aria-label': label,
      onClick,
    }, icon)

  if (state.currentTab === 'explorer') {
    return h('div', { className: 'sol-exp-actionbar', 'data-sol-exp-actionbar': 'explorer' },
      item(t('tree.expand'), h(IconChevronDownOutline, { size: ACTION_ICON_SIZE }), actions.tree.expandAll),
      item(t('tree.collapse'), h(IconChevronUpOutline, { size: ACTION_ICON_SIZE }), actions.tree.collapseAll),
      item(t('tree.newFile'), h(IconPlusOutline, { size: ACTION_ICON_SIZE }), actions.tree.newFile),
      item(t('tree.newDir'), h(IconProjectAddOutline, { size: ACTION_ICON_SIZE }), actions.tree.newDir),
      item(t('tree.refresh'), h(IconRefreshOutline, { size: ACTION_ICON_SIZE }), actions.tree.refresh),
    )
  }

  if (state.currentTab === 'scm') {
    return h('div', { className: 'sol-exp-actionbar', 'data-sol-exp-actionbar': 'scm' },
      item(t('scm.refresh'), h(IconRefreshOutline, { size: ACTION_ICON_SIZE }), actions.scm.refresh),
    )
  }

  return null
}
