import * as fsp from 'node:fs/promises'
import * as pathModule from 'node:path'

import { git } from '../git-runner.ts'
import { discoverRepositories } from '../git-repos.ts'
import { getGitStatus } from '../status.ts'
import { unquoteGitPath } from '../paths.ts'
import { json } from '../http-util.ts'
import type { Handler } from './context.ts'

export const gitReadGet: Record<string, Handler> = {
  '/solution-explorer/git-repos': async ({ res, query }) => {
    const root = query.root || ''
    if (!root) { json(res, { ok: false, error: { message: 'root required' } }); return }
    // Root wins; otherwise only direct children are probed (see git-repos.ts).
    const value = await discoverRepositories(root)
    json(res, { ok: true, value })
  },
  '/solution-explorer/git-status': async ({ res, query }) => {
    const root = query.root || ''
    if (!root) { json(res, { ok: false, error: { message: 'root required' } }); return }
    json(res, getGitStatus(root))
  },
  '/solution-explorer/git-diff': async ({ res, query }) => {
    const root = query.root || ''
    const file = query.file || ''
    if (!root || !file) { json(res, { ok: false, error: { message: 'root and file required' } }); return }
    const staged = query.staged === 'true'
    const args = ['diff']
    if (staged) args.push('--cached')
    args.push('--', file)
    const result = git(args, root)
    if (!result.ok) { json(res, { ok: false, error: { message: result.error } }); return }
    // Binary diffs ("Binary files a/x and b/x differ") cannot be shown in
    // the text diff view — report unsupported so the UI can say so
    // instead of rendering garbled bytes (consistent with the editor).
    if (/^Binary files .* differ$/m.test(result.stdout)) {
      json(res, { ok: true, value: { unsupported: true } })
      return
    }
    // Full-file contents for the side-by-side view: old = HEAD, new = index (staged) or working tree.
    const headShow = git(['show', 'HEAD:' + file], root)
    const oldContent = headShow.ok ? headShow.stdout : ''
    let newContent = ''
    if (staged) {
      const idx = git(['show', ':0:' + file], root)
      newContent = idx.ok ? idx.stdout : ''
    } else {
      try {
        newContent = await fsp.readFile(pathModule.resolve(root, file), 'utf8')
      } catch { newContent = '' }
    }
    json(res, { ok: true, value: { diff: result.stdout, oldContent, newContent } })
  },
  '/solution-explorer/git-log': async ({ res, query }) => {
    const root = query.root || ''
    if (!root) { json(res, { ok: false, error: { message: 'root required' } }); return }
    const count = Math.min(parseInt(query.count || '20', 10), 100)
    const skip = Math.max(parseInt(query.skip || '0', 10), 0)
    // --parents feeds the client-side graph lane algorithm (merge edges).
    // --topo-order keeps a side branch's commits together (like VS Code's
    // graph) instead of interleaving equal-timestamp commits from branches.
    const logArgs = ['log', '--topo-order', `--max-count=${count}`]
    if (skip > 0) logArgs.push(`--skip=${skip}`)
    logArgs.push('--format=%H|%P|%h|%an|%ae|%at|%s')
    const result = git(logArgs, root)
    if (!result.ok) { json(res, { ok: false, error: { message: result.error } }); return }
    const commits = result.stdout.split('\n').filter(Boolean).map((line: string) => {
      const parts = line.split('|')
      return {
        hash: parts[0] || '', parents: (parts[1] || '').split(' ').filter(Boolean),
        shortHash: parts[2] || '', author: parts[3] || '',
        email: parts[4] || '', timestamp: parseInt(parts[5] || '0', 10) * 1000,
        message: parts.slice(6).join('|') || '',
      }
    })
    // Unpushed (outgoing) commits: HEAD commits not yet on the upstream.
    // Without an upstream, everything is local-only → all unpushed.
    const upstreamLog = git(['log', '--format=%H', '@{upstream}..HEAD'], root)
    let unpushedSet: Set<string>
    if (upstreamLog.ok) {
      unpushedSet = new Set(upstreamLog.stdout.split('\n').filter(Boolean))
    } else {
      unpushedSet = new Set(commits.map((c) => c.hash))
    }
    for (const c of commits) (c as { unpushed?: boolean }).unpushed = unpushedSet.has(c.hash)
    json(res, { ok: true, value: commits })
  },
  '/solution-explorer/git-remotes': async ({ res, query }) => {
    const root = query.root || ''
    if (!root) { json(res, { ok: false, error: { message: 'root required' } }); return }
    const result = git(['remote', '-v'], root)
    if (!result.ok) { json(res, { ok: false, error: { message: result.error } }); return }
    const remotes = result.stdout.split('\n').filter(Boolean).map((line: string) => {
      const m = line.match(/^(\S+)\s+(\S+)\s+\((\w+)\)$/)
      return m ? { name: m[1], url: m[2], type: m[3] } : null
    }).filter((r): r is { name: string; url: string; type: string } => r !== null)
    json(res, { ok: true, value: remotes })
  },
  '/solution-explorer/git-branches': async ({ res, query }) => {
    const root = query.root || ''
    if (!root) { json(res, { ok: false, error: { message: 'root required' } }); return }
    // Full refname (refs/heads/* vs refs/remotes/*) so local and remote
    // branches are distinguishable — %(refname:short) collapses both to
    // "name"/"origin/name" and the remote rows were mis-sorted.
    const result = git(['branch', '-a', '--format=%(HEAD)|%(refname)|%(upstream:short)|%(objectname:short)|%(subject)'], root)
    if (!result.ok) { json(res, { ok: false, error: { message: result.error } }); return }
    const branches = result.stdout.split('\n').filter(Boolean).map((line: string) => {
      const parts = line.split('|')
      const ref = parts[1] || ''
      let name = ''
      let isRemote = false
      if (ref.startsWith('refs/remotes/')) { name = ref.slice('refs/remotes/'.length); isRemote = true }
      else if (ref.startsWith('refs/heads/')) name = ref.slice('refs/heads/'.length)
      else return null // detached-HEAD row (no refname) — never a clickable branch
      if (name.endsWith('/HEAD')) return null // origin/HEAD is a symref pointer, not a branch
      return {
        current: parts[0] === '*', name, isRemote,
        upstream: parts[2] || '', shortHash: parts[3] || '',
        subject: parts.slice(4).join('|') || '',
      }
    }).filter((b): b is NonNullable<typeof b> => b !== null)
    json(res, { ok: true, value: branches })
  },
  '/solution-explorer/git-tags': async ({ res, query }) => {
    const root = query.root || ''
    if (!root) { json(res, { ok: false, error: { message: 'root required' } }); return }
    // Tag name, tag object hash, dereferenced commit hash and commit subject.
    const result = git(['for-each-ref', 'refs/tags', '--sort=-creatordate', '--format=%(refname:short)|%(objectname:short)|%(*objectname:short)|%(*subject)'], root)
    if (!result.ok) { json(res, { ok: false, error: { message: result.error } }); return }
    const tags = result.stdout.split('\n').filter(Boolean).map((line: string) => {
      const parts = line.split('|')
      return {
        name: parts[0] || '', hash: parts[1] || '',
        commitHash: parts[2] || '', subject: parts.slice(3).join('|') || '',
      }
    })
    json(res, { ok: true, value: tags })
  },
  '/solution-explorer/git-commit-detail': async ({ res, query }) => {
    const root = query.root || ''
    const hash = query.hash || ''
    if (!root || !hash) { json(res, { ok: false, error: { message: 'root and hash required' } }); return }
    // One call carries both the per-file status letters (M/A/D, and
    // rename/copy rows carry "old<TAB>new") and the shortstat summary
    // line for the tooltip ("N files changed, X insertions(+), Y deletions(-)").
    const result = git(['show', '--name-status', '--shortstat', '--format=%H|%P|%h|%an|%ae|%at|%s', hash], root)
    if (!result.ok) { json(res, { ok: false, error: { message: result.error } }); return }
    const lines = result.stdout.split('\n')
    const head = lines[0] || ''
    const parts = head.split('|')
    // Paths with spaces are quoted by git ("AGENTS copy.md") — decode
    // them so the list matches the tree/SCM path display.
    const files: Array<{ status: string; path: string; oldPath?: string }> = []
    const stats = { files: 0, insertions: 0, deletions: 0 }
    for (const line of lines.slice(1)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const statMatch = trimmed.match(/^(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?$/)
      if (statMatch) {
        stats.files = parseInt(statMatch[1], 10)
        stats.insertions = parseInt(statMatch[2] || '0', 10)
        stats.deletions = parseInt(statMatch[3] || '0', 10)
        continue
      }
      const segs = trimmed.split('\t')
      if (segs.length < 2) continue
      const status = (segs[0] || 'M').slice(0, 1)
      if (segs.length >= 3 && /^(R|C)/.test(segs[0])) {
        // Rename/copy: "R100<TAB>old<TAB>new" — keep both paths.
        files.push({ status, path: unquoteGitPath(segs[2]), oldPath: unquoteGitPath(segs[1]) })
      } else {
        files.push({ status, path: unquoteGitPath(segs[1]) })
      }
    }
    // Full message (subject + body) for the hover tooltip.
    const bodyResult = git(['show', '-s', '--format=%B', hash], root)
    json(res, {
      ok: true,
      value: {
        hash: parts[0] || '', parents: (parts[1] || '').split(' ').filter(Boolean),
        shortHash: parts[2] || '', author: parts[3] || '',
        email: parts[4] || '', timestamp: parseInt(parts[5] || '0', 10) * 1000,
        message: parts.slice(6).join('|') || '',
        body: bodyResult.ok ? bodyResult.stdout.replace(/\n+$/, '') : '',
        files, stats,
      },
    })
  },
}
