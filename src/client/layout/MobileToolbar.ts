/**
 * Phone-only context toolbar.
 *
 * Sits directly under the activity tabs, so the actions stay in the same
 * visual group as the view they belong to. CSS shows it only while the column
 * carries `data-sol-exp-sheet`; desktop keeps the original view header. Search
 * needs no actions; SCM only needs refresh at this level.
 * @module dsh-solution-explorer/client/layout/MobileToolbar
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

const TOOLBAR_ICON_SIZE = 16

/** Props of the phone-only context toolbar. */
export interface MobileToolbarProps {
  state: AppState
  actions: PanelActions
}

/** Explorer / SCM actions for the phone sheet, grouped under the tabs. */
export function MobileToolbar({ state, actions }: MobileToolbarProps): ReactNode {
  const item = (label: string, icon: ReactNode, onClick: () => void): ReactNode =>
    h('button', {
      type: 'button',
      className: 'sol-exp-mobile-toolbar-btn',
      title: label,
      'aria-label': label,
      onClick,
    }, icon)

  if (state.currentTab === 'explorer') {
    return h('div', {
      className: 'sol-exp-mobile-toolbar',
      'data-sol-exp-toolbar': 'explorer',
      role: 'toolbar',
      'aria-label': t('header.actions'),
    },
      item(t('tree.expand'), h(IconChevronDownOutline, { size: TOOLBAR_ICON_SIZE }), actions.tree.expandAll),
      item(t('tree.collapse'), h(IconChevronUpOutline, { size: TOOLBAR_ICON_SIZE }), actions.tree.collapseAll),
      item(t('tree.newFile'), h(IconPlusOutline, { size: TOOLBAR_ICON_SIZE }), actions.tree.newFile),
      item(t('tree.newDir'), h(IconProjectAddOutline, { size: TOOLBAR_ICON_SIZE }), actions.tree.newDir),
      item(t('tree.refresh'), h(IconRefreshOutline, { size: TOOLBAR_ICON_SIZE }), actions.tree.refresh),
    )
  }

  if (state.currentTab === 'scm') {
    return h('div', {
      className: 'sol-exp-mobile-toolbar',
      'data-sol-exp-toolbar': 'scm',
      role: 'toolbar',
      'aria-label': t('header.actions'),
    },
      item(t('scm.refresh'), h(IconRefreshOutline, { size: TOOLBAR_ICON_SIZE }), actions.scm.refresh),
    )
  }

  return null
}
