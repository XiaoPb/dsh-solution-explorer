/**
 * React SCM panel — the source-control tab of the unified React client render.
 *
 * Layout follows VS Code's Source Control view: one vertical, scrollable stack
 * of three sections — Repository (branch, sync actions, worktree switcher),
 * Changes (commit box, conflicts, staged and working-tree changes) and Graph
 * (the commit graph). There is no top/bottom split or draggable divider; the
 * whole view scrolls and the commit graph expands inside it.
 *
 * Glyphs come from the official @deepseek-ai/dsh-client-ui-primitives set (the
 * four git sync operations keep plain text glyphs — the official set has no
 * distinct fetch/pull/push/sync icons).
 * @module dsh-solution-explorer/client/scm/ScmPanel
 */
import { createElement as h, Fragment, useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconRefreshOutline,
  IconBranchOutline,
  IconPlusOutline,
  IconTrashOutline,
  IconCloseOutline,
  IconFolderClose,
  FileTypeIcon,
  IconChevronRightOutline,
  IconChevronDownOutline,
} from '../icons.ts'
import { t } from '../locales.ts'
import { isPreviewOnlyFile } from '../explorer/file-kind.ts'
import { CommitsList } from './CommitsList.ts'
import type { ScmState, CommitState } from '../state/store.ts'
import { useDraft } from '../shared/draft.ts'

/** One change row as the git status payload reports it. */
export interface ScmChange {
  path: string
  status?: string
}

/** Every SCM interaction the SCM view can invoke. */
export interface ScmActions {
  toggleSection(id: string): void
  refresh(): void
  stage(paths: string[]): void
  unstage(paths: string[]): void
  discard(paths: string[]): void
  stageAll(): void
  unstageAll(): void
  discardAll(): void
  commitMsg(value: string): void
  commit(): void
  genCommitMsg(): void
  selectRepo(path: string): void
  remotePanel(): void
  branchPanel(): void
  fetch(): void
  pull(): void
  push(): void
  sync(): void
  remoteName(value: string): void
  remoteUrl(value: string): void
  remoteAdd(): void
  remoteRemove(name: string): void
  remoteSetUrl(name: string): void
  branchName(value: string): void
  branchFrom(value: string): void
  branchCreate(): void
  branchCheckout(name: string): void
  branchDelete(name: string): void
  branchRename(name: string): void
  branchMerge(name: string): void
  branchPublish(name: string): void
  gitInit(): void
  openDiff(path: string, staged: boolean): void
  openFile(path: string): void
  selectFile(path: string, isDir: boolean): void
  commitsScroll(e: unknown): void
  commitDetail(hash: string): void
  commitCheckout(hash: string): void
}

/** Props of the SCM panel. */
export interface ScmPanelProps {
  scm: ScmState
  commits: CommitState
  root: string
  actions: ScmActions
}

function Section(props: {
  id: string
  title: string
  count?: ReactNode
  collapsed: boolean
  onToggle: () => void
  headerActions?: ReactNode
  children?: ReactNode
}): ReactNode {
  return h('div', { className: 'sol-exp-scm-section' + (props.collapsed ? ' collapsed' : ''), 'data-section': props.id },
    h('div', { className: 'sol-exp-scm-section-header', onClick: props.onToggle },
      h(IconChevronRightOutline, { size: 16 }),
      props.title,
      h('span', { className: 'sol-exp-scm-header-actions' }, props.headerActions),
      h('span', { className: 'sol-exp-scm-section-count' }, props.count),
    ),
    props.children,
  )
}

/** A collapsible group nested inside a top-level section (VS Code groups). */
function SubSection(props: {
  id: string
  title: string
  count?: ReactNode
  collapsed: boolean
  onToggle: () => void
  headerActions?: ReactNode
  children?: ReactNode
}): ReactNode {
  return h('div', { className: 'sol-exp-scm-subsection' + (props.collapsed ? ' collapsed' : ''), 'data-subsection': props.id },
    h('div', { className: 'sol-exp-scm-subsection-header', onClick: props.onToggle },
      h(IconChevronRightOutline, { size: 14 }),
      props.title,
      h('span', { className: 'sol-exp-scm-header-actions' }, props.headerActions),
      h('span', { className: 'sol-exp-scm-section-count' }, props.count),
    ),
    props.children,
  )
}

function ScmItem({ item, section, actions }: { item: ScmChange; section: string; actions: ScmActions }): ReactNode {
  const staged = section === 'staged'
  const isDir = item.path.endsWith('/') || item.path.endsWith('\\')
  const open = () => {
    if (isDir) actions.selectFile(item.path, true)
    else if (isPreviewOnlyFile(item.path)) void actions.openFile(item.path)
    else void actions.openDiff(item.path, staged)
  }
  return h('div', { className: 'sol-exp-scm-item', title: t('file.open'), onClick: open },
    h('span', { className: 'sol-exp-file-icon' },
      isDir ? h(IconFolderClose, { size: 16 }) : h(FileTypeIcon, { path: item.path, size: 16 })),
    h('span', { className: 'sol-exp-scm-path' }, item.path),
    h('span', { className: 'sol-exp-scm-actions' },
      staged
        ? h('button', {
            className: 'sol-exp-scm-action-btn', title: t('scm.unstage'),
            onClick: (e) => { e.stopPropagation(); actions.unstage([item.path]) },
          }, h(IconCloseOutline, { size: 16 }))
        : h(Fragment, null,
            h('button', {
              className: 'sol-exp-scm-action-btn',
              title: section === 'conflicts' ? t('scm.merge.changes') : t('scm.stage'),
              onClick: (e) => { e.stopPropagation(); actions.stage([item.path]) },
            }, h(IconPlusOutline, { size: 16 })),
            h('button', {
              className: 'sol-exp-scm-action-btn', title: t('scm.discard'),
              onClick: (e) => { e.stopPropagation(); actions.discard([item.path]) },
            }, h(IconTrashOutline, { size: 16 })),
          ),
    ),
  )
}

/** The SCM panel: Repository → Changes → Graph, one scrollable column. */
export function ScmPanel({ scm, commits, root, actions }: ScmPanelProps): ReactNode {
  // Hooks must run before the not-a-repo early returns, and every editable
  // field needs a local draft: the mutable panel store does not re-render, so
  // binding controlled inputs straight to it would erase each keystroke.
  const [commitDraft, setCommitDraft] = useDraft(scm.commitMessage, actions.commitMsg)
  const [remoteNameDraft, setRemoteNameDraft] = useDraft(scm.remoteName, actions.remoteName)
  const [remoteUrlDraft, setRemoteUrlDraft] = useDraft(scm.remoteUrl, actions.remoteUrl)
  const [branchNameDraft, setBranchNameDraft] = useDraft(scm.branchName, actions.branchName)
  // VS Code's commit box shows the branch inside the placeholder; the split
  // caret opens the secondary commit actions.
  const [commitMenuOpen, setCommitMenuOpen] = useState(false)

  if (!root) {
    return h('div', { className: 'sol-exp-content' }, h('div', { className: 'sol-exp-empty' }, t('panel.empty')))
  }

  const status = scm.gitStatus
  const isRepo = !!status && status.branch !== 'unknown'
  if (!isRepo) {
    return h('div', { className: 'sol-exp-content' },
      h('div', { className: 'sol-exp-empty' }, t('scm.notRepo')),
      h('div', { style: { padding: '12px', textAlign: 'center' } },
        h('button', {
          className: 'sol-exp-commit-btn', style: { width: 'auto', padding: '6px 16px' },
          onClick: () => actions.gitInit(),
        }, t('scm.init.button'))))
  }

  const staged = (status?.staged ?? []) as ScmChange[]
  const unstaged = (status?.unstaged ?? []) as ScmChange[]
  const untracked = (status?.untracked ?? []) as ScmChange[]
  const conflicts = (status?.conflicts ?? []) as ScmChange[]
  const allChanges = [...unstaged, ...untracked]
  const collapsed = (id: string) => scm.collapsedSections.has(id)
  const syncCount = (status?.ahead || 0) > 0 || (status?.behind || 0) > 0
    ? `↑${status?.ahead || 0} ↓${status?.behind || 0}`
    : ''

  const syncBtn = (glyph: string, title: string, fn: () => void): ReactNode =>
    h('button', {
      className: 'sol-exp-hdr-btn', title,
      onClick: (e) => { e.stopPropagation(); fn() },
    }, glyph)

  const repoRow = (r: { path: string; name: string; branch: string; kind?: string }): ReactNode => {
    // Optional because older hosts omit `kind`; never invent one when absent.
    const kindLabel = r.kind === 'worktree'
      ? t('scm.repo.worktree')
      : r.kind === 'repository' ? t('scm.repo.repository') : ''
    return h('div', {
      key: r.path,
      className: 'sol-exp-repo-item' + (scm.activeRepo === r.path ? ' active' : ''),
      'data-repo-path': r.path,
      title: r.path,
      onClick: () => actions.selectRepo(r.path),
    },
      h('span', { className: 'sol-exp-repo-icon' }, h(IconBranchOutline, { size: 16 })),
      h('span', { className: 'sol-exp-repo-name', title: r.name }, r.name),
      kindLabel
        ? h('span', {
            className: 'sol-exp-repo-kind' + (r.kind === 'worktree' ? ' worktree' : ''),
            title: kindLabel,
          }, kindLabel)
        : null,
      h('span', { className: 'sol-exp-repo-branch', title: r.branch }, r.branch),
      h('span', { className: 'sol-exp-hdr-btn', title: t('scm.remote.title'), onClick: (e) => { e.stopPropagation(); actions.remotePanel() } }, '⇅'),
      h('span', { className: 'sol-exp-hdr-btn', title: t('scm.branch.title'), onClick: (e) => { e.stopPropagation(); actions.branchPanel() } },
        h(IconBranchOutline, { size: 14 })),
    )
  }

  const remotePanel = scm.remotePanelOpen
    ? h('div', { className: 'sol-exp-scm-inline-panel' },
        h('div', { className: 'sol-exp-scm-inline-head' },
          h('b', null, t('scm.remote.title')), h('span', { style: { flex: 1 } }),
          h('button', { className: 'sol-exp-commit-detail-close', onClick: () => actions.remotePanel() }, '✕')),
        scm.remotesList.length === 0
          ? h('div', { className: 'sol-exp-scm-inline-hint' }, t('scm.remote.none'))
          : scm.remotesList.map((r: { name: string; url: string }) => h('div', { key: r.name, className: 'sol-exp-scm-inline-row' },
              h('span', { className: 'sol-exp-scm-inline-name' }, r.name),
              h('span', { className: 'sol-exp-scm-inline-url' }, r.url),
              h('button', { className: 'sol-exp-commit-detail-btn', onClick: () => actions.remoteSetUrl(r.name) }, t('scm.remote.setUrl')),
              h('button', { className: 'sol-exp-commit-detail-btn', onClick: () => actions.remoteRemove(r.name) }, t('scm.remote.remove')),
            )),
        h('div', { className: 'sol-exp-scm-inline-add' },
          h('input', {
            className: 'sol-exp-commit-input sol-exp-scm-inline-input',
            placeholder: t('scm.remote.name'), value: remoteNameDraft,
            onChange: (e) => setRemoteNameDraft(e.target.value),
          }),
          h('input', {
            className: 'sol-exp-commit-input sol-exp-scm-inline-input',
            placeholder: t('scm.remote.url'), value: remoteUrlDraft,
            onChange: (e) => setRemoteUrlDraft(e.target.value),
          }),
          h('button', { className: 'sol-exp-commit-detail-btn', onClick: () => actions.remoteAdd() }, t('scm.remote.addBtn'))))
    : null

  const branchPanel = scm.branchPanelOpen
    ? h('div', { className: 'sol-exp-scm-inline-panel' },
        h('div', { className: 'sol-exp-scm-inline-head' },
          h('b', null, t('scm.branch.title')), h('span', { style: { flex: 1 } }),
          h('button', { className: 'sol-exp-commit-detail-close', onClick: () => actions.branchPanel() }, '✕')),
        h('div', { className: 'sol-exp-scm-inline-hint' }, t('scm.branch.local')),
        scm.branchesList.filter((b: { isRemote?: boolean }) => !b.isRemote).map((b: { name: string; current?: boolean; shortHash?: string; subject?: string; upstream?: string }) =>
          h('div', { key: b.name, className: 'sol-exp-scm-inline-row sol-exp-scm-branch-row', onClick: () => actions.branchCheckout(b.name) },
            h('span', { className: 'sol-exp-scm-branch-current' }, b.current ? '➤' : ''),
            h('span', { className: 'sol-exp-scm-inline-name' }, b.name),
            b.shortHash ? h('span', { className: 'sol-exp-scm-branch-hash' }, b.shortHash) : null,
            h('button', { className: 'sol-exp-commit-detail-btn sol-exp-scm-mini-btn', title: t('scm.branch.rename'), onClick: (e) => { e.stopPropagation(); actions.branchRename(b.name) } }, '✎'),
            !b.current
              ? h(Fragment, null,
                  h('button', { className: 'sol-exp-commit-detail-btn sol-exp-scm-mini-btn', title: t('scm.branch.merge'), onClick: (e) => { e.stopPropagation(); actions.branchMerge(b.name) } }, '⤵'),
                  h('button', { className: 'sol-exp-commit-detail-btn sol-exp-scm-mini-btn', title: t('scm.branch.publish'), onClick: (e) => { e.stopPropagation(); actions.branchPublish(b.name) } }, '↑'),
                  h('button', { className: 'sol-exp-commit-detail-btn sol-exp-scm-mini-btn', onClick: (e) => { e.stopPropagation(); actions.branchDelete(b.name) } }, '✕'))
              : null,
          )),
        h('div', { className: 'sol-exp-scm-inline-add' },
          h('input', {
            className: 'sol-exp-commit-input sol-exp-scm-inline-input',
            placeholder: t('scm.branch.name'), value: branchNameDraft,
            onChange: (e) => setBranchNameDraft(e.target.value),
          }),
          h('button', { className: 'sol-exp-commit-detail-btn', onClick: () => actions.branchCreate() }, t('scm.branch.create'))))
    : null

  const branchForPlaceholder = status?.branch && status.branch !== 'unknown' ? status.branch : 'HEAD'
  const commitPlaceholder = t('scm.commit.placeholder').replace('{branch}', branchForPlaceholder)

  const conflictsBlock = conflicts.length > 0
    ? h(SubSection, {
        id: 'conflicts', title: t('scm.merge.changes'), count: conflicts.length,
        collapsed: collapsed('conflicts'), onToggle: () => actions.toggleSection('conflicts'),
      },
        conflicts.map((item) => h(ScmItem, { key: item.path, item, section: 'conflicts', actions })))
    : null

  const stagedBlock = staged.length > 0
    ? h(SubSection, {
        id: 'staged', title: t('scm.staged'), count: staged.length,
        collapsed: collapsed('staged'), onToggle: () => actions.toggleSection('staged'),
        headerActions: h('button', { className: 'sol-exp-hdr-btn', title: t('scm.unstageAll'), onClick: (e) => { e.stopPropagation(); actions.unstageAll() } },
          h(IconCloseOutline, { size: 14 })),
      },
        staged.map((item) => h(ScmItem, { key: item.path, item, section: 'staged', actions })))
    : null

  return h('div', {
    className: 'sol-exp-content',
    // The view itself scrolls; reaching the bottom loads the next commit page.
    onScroll: (e) => actions.commitsScroll(e),
  },
    h('div', { className: 'sol-exp-scm-sections' },
      // 1. Repository — sync actions, worktree switcher and branch.
      h(Section, {
        id: 'repository', title: t('scm.repository'), count: syncCount,
        collapsed: collapsed('repository'), onToggle: () => actions.toggleSection('repository'),
        headerActions: h(Fragment, null,
          syncBtn('↓', t('scm.sync.fetch'), actions.fetch),
          syncBtn('⇣', t('scm.sync.pull'), actions.pull),
          syncBtn('↑', t('scm.sync.push'), actions.push),
          syncBtn('⟳', t('scm.sync.sync'), actions.sync)),
      },
        h('div', { className: 'sol-exp-scm-repository-body' },
          scm.repos.map(repoRow),
          h('div', { className: 'sol-exp-scm-branch-line' },
            h('span', null, t('scm.repository.branch')),
            h('span', { className: 'sol-exp-branch-pill' }, '⑂ ' + (status?.branch || ''))),
          remotePanel,
          branchPanel)),

      // 2. Changes — VS Code's Source Control block: message box, split commit
      // button, then conflicts / staged / working-tree groups.
      h(Section, {
        id: 'changes', title: t('scm.changes'),
        collapsed: collapsed('changes'), onToggle: () => actions.toggleSection('changes'),
        headerActions: h(Fragment, null,
          h('button', { className: 'sol-exp-hdr-btn', title: t('scm.refresh'), onClick: (e) => { e.stopPropagation(); actions.refresh() } },
            h(IconRefreshOutline, { size: 16 })),
          allChanges.length > 0
            ? h('button', { className: 'sol-exp-hdr-btn', title: t('scm.stageAll'), onClick: (e) => { e.stopPropagation(); actions.stageAll() } },
                h(IconPlusOutline, { size: 16 }))
            : null,
          allChanges.length > 0
            ? h('button', { className: 'sol-exp-hdr-btn danger', title: t('scm.discardAll'), onClick: (e) => { e.stopPropagation(); actions.discardAll() } },
                h(IconTrashOutline, { size: 16 }))
            : null),
      },
        h('div', { className: 'sol-exp-commit-box' },
          h('textarea', {
            className: 'sol-exp-commit-input',
            placeholder: commitPlaceholder,
            value: commitDraft,
            onChange: (e) => {
              const value = e.target.value
              setCommitDraft(value)
              actions.commitMsg(value)
            },
          }),
          h('div', { className: 'sol-exp-commit-row' },
            h('div', { className: 'sol-exp-commit-split' },
              h('button', {
                className: 'sol-exp-commit-btn',
                disabled: scm.committing || !commitDraft.trim(),
                onClick: () => actions.commit(),
              }, scm.committing ? t('scm.committing') : t('scm.commit.button')),
              h('button', {
                className: 'sol-exp-commit-caret',
                title: t('scm.commit.more'),
                'aria-label': t('scm.commit.more'),
                disabled: scm.committing,
                onClick: (e) => { e.stopPropagation(); setCommitMenuOpen((open) => !open) },
              }, h(IconChevronDownOutline, { size: 16 })))),
          commitMenuOpen
            ? h('div', { className: 'sol-exp-commit-menu' },
                h('button', {
                  className: 'sol-exp-commit-menu-item',
                  disabled: scm.aiGenerating || !(staged.length > 0),
                  onClick: () => { setCommitMenuOpen(false); actions.genCommitMsg() },
                }, '✦ ' + t('scm.ai.gen')))
            : null),
        conflictsBlock,
        stagedBlock,
        h(SubSection, {
          id: 'changes-list', title: t('scm.changes'), count: allChanges.length,
          collapsed: collapsed('changes-list'), onToggle: () => actions.toggleSection('changes-list'),
        },
          allChanges.length === 0 && staged.length === 0 && conflicts.length === 0
            ? h('div', { className: 'sol-exp-scm-empty' }, t('scm.changes.none'))
            : null,
          allChanges.map((item) => h(ScmItem, { key: item.path, item, section: 'changes', actions })))),

      // 3. Graph — the commit graph, VS Code's Source Control Graph.
      h(Section, {
        id: 'commits', title: t('scm.graph'),
        collapsed: collapsed('commits'), onToggle: () => actions.toggleSection('commits'),
      },
        collapsed('commits')
          ? null
          : h('div', { className: 'sol-exp-scm-commits-body' },
              h(CommitsList, {
                commits,
                actions: {
                  commitDetail: (hash) => actions.commitDetail(hash),
                  commitCheckout: (hash) => actions.commitCheckout(hash),
                },
              }))),
    ))
}
