#!/usr/bin/env node
'use strict'

/**
 * 包清单 / 产物契约自检（离线，CI 与 npm pack 共用）。
 *
 *   node scripts/verify-package.mjs
 *
 * 校验项：
 *   1. package.json 关键字段（scoped 包名、SemVer、入口与 exports 指向真实文件）
 *   2. files 白名单只发布 lib 产物 + cordis.patch.yml（不夹带开发目录）
 *   3. dsh 元数据：bundle.patch / client.platform / client.inject
 *   4. cordis.patch.yml：insert 行 id 与插件包名指向本包
 *   5. 客户端 bundle 契约：__ModuleLoader__ 包装 + 插件自有锚点标记 + 无 ESM import
 *   6. 宿主入口可 require 且导出 { apply, inject }
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(root, rel))

let failures = 0
const ok = (msg) => console.log(`  ok   ${msg}`)
const fail = (msg) => { failures += 1; console.error(`  FAIL ${msg}`) }
const check = (cond, msg) => (cond ? ok(msg) : fail(msg))

const pkg = JSON.parse(read('package.json'))

console.log(`verify-package: ${pkg.name}@${pkg.version}`)

// ---- 1. 清单字段 ----
check(pkg.name === '@xiaopb/dsh-solution-explorer', `name = @xiaopb/dsh-solution-explorer（实际 ${pkg.name}）`)
check(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version || ''), 'version 是 SemVer')
check(pkg.main === 'lib/index.js', 'main 指向 lib/index.js')
check(exists(pkg.main), 'main 文件存在')
for (const [key, target] of Object.entries(pkg.exports || {})) {
  const flat = typeof target === 'string' ? target : target?.default
  if (typeof flat === 'string' && flat.startsWith('./') && flat !== './package.json' && !flat.includes('*')) {
    check(exists(flat), `exports["${key}"] 指向真实文件（${flat}）`)
  }
}

// ---- 2. 发布白名单 ----
const files = pkg.files || []
check(Array.isArray(files) && files.length > 0, 'package.json 声明了 files 白名单')
for (const must of ['lib/index.js', 'lib/client.js', 'lib/types/**/*.d.ts', 'cordis.patch.yml']) {
  check(files.includes(must), `files 含 ${must}`)
}
const leaked = files.filter((f) => /^(test|tools|docs|scripts|\.github|\.scratch)/.test(f))
check(leaked.length === 0, `files 未夹带开发目录（${leaked.join(', ') || '无'}）`)
// glob 条目验证其基目录，字面条目验证文件本体
for (const entry of files) {
  if (entry.includes('*')) {
    const base = entry.slice(0, entry.indexOf('*')).replace(/[^/]*$/, '')
    check(exists(base || '.'), `files 条目基目录存在（${entry} → ${base}）`)
  } else {
    check(exists(entry), `files 条目存在（${entry}）`)
  }
}

// ---- 3. dsh 元数据 ----
const dsh = pkg.dsh || {}
check(dsh.bundle && dsh.bundle.patch === './cordis.patch.yml', 'dsh.bundle.patch = ./cordis.patch.yml')
check(dsh.client && dsh.client.platform === 'web', 'dsh.client.platform = web')
const inject = (dsh.client && dsh.client.inject) || []
for (const need of ['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-slots']) {
  check(inject.includes(need), `client.inject 含 ${need}`)
}

// ---- 4. cordis.patch.yml ----
const patchText = read('cordis.patch.yml')
check(/^-\s*insert:/m.test(patchText), 'patch 含 insert 层')
check(/id:\s*ui-dsh-solution-explorer/.test(patchText), 'roster 行 id = ui-dsh-solution-explorer')
check(patchText.includes(pkg.name), `roster 行 name 指向本包（${pkg.name}）`)

// ---- 5. 客户端 bundle 契约 ----
const client = read('lib/client.js')
check(/__ModuleLoader__\s*\.\s*load\(/.test(client), '客户端产物走 __ModuleLoader__.load 包装')
for (const marker of ['solutionExplorer', 'sol-exp-', 'sidebarRightTabs']) {
  check(client.includes(marker), `bundle 含标记 ${marker}`)
}
check(!/^\s*import\s+/m.test(client), 'bundle 不用 ESM import（走 loader 注入的 require）')

// ---- 6. 宿主入口 ----
const host = require(path.join(root, 'lib', 'index.js'))
check(typeof host.apply === 'function', '宿主入口导出 apply')
check(Array.isArray(host.inject), '宿主入口导出 inject 数组')
check(typeof host.EXPLORER_GUIDANCE === 'string' && host.EXPLORER_GUIDANCE.length > 40, '宿主入口导出非空 EXPLORER_GUIDANCE')

if (failures > 0) {
  console.error(`verify-package: ${failures} 项未通过`)
  process.exit(1)
}
console.log('verify-package: ALL PASS')
