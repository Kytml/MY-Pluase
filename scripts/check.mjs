#!/usr/bin/env node
/**
 * 项目质量检查（无第三方依赖）：
 *   1. 全部 JS/MJS 文件通过 node --check 语法校验
 *   2. 源码中无不可见控制字符（防止正则被意外写成原始控制字符）
 *   3. index.html 引用的本地资源、package.json 中声明的关键文件都存在
 *   4. README 包含必需章节
 * 用法：npm run check
 */

import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]');
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const sourceFiles = [];
for (const dir of ['src', 'tests', 'scripts']) {
  sourceFiles.push(...await walk(path.join(ROOT, dir)));
}
sourceFiles.push(path.join(ROOT, 'server.mjs'));

// 1. 语法校验
const jsFiles = sourceFiles.filter((f) => /\.(js|mjs)$/.test(f));
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    problems.push(`语法错误 ${rel(file)}：${(result.stderr || '').split('\n')[0]}`);
  }
}
console.log(`[check] JS 语法校验：${jsFiles.length} 个文件`);

// 2. 控制字符扫描（源码 + 页面 + 样式 + 文档）
const textFiles = sourceFiles.concat([
  path.join(ROOT, 'index.html'),
  path.join(ROOT, 'styles', 'main.css'),
  path.join(ROOT, 'README.md'),
]);
for (const file of textFiles) {
  if (!(await exists(file))) continue;
  const text = await fs.readFile(file, 'utf8');
  if (CONTROL.test(text)) problems.push(`包含不可见控制字符：${rel(file)}`);
}
console.log(`[check] 控制字符扫描：${textFiles.length} 个文件`);

// 3. 关键文件与 HTML 引用
const required = ['index.html', 'styles/main.css', 'src/main.js', 'server.mjs',
  'tests/e2e/run.mjs', 'package.json', 'README.md', 'LICENSE'];
for (const file of required) {
  if (!(await exists(path.join(ROOT, file)))) problems.push(`缺少必需文件：${file}`);
}
const html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="(\.[^"]+)"/g)) {
  const target = match[1];
  if (!(await exists(path.join(ROOT, target)))) problems.push(`index.html 引用了不存在的资源：${target}`);
}

// 4. README 章节
const readmePath = path.join(ROOT, 'README.md');
if (await exists(readmePath)) {
  const readme = await fs.readFile(readmePath, 'utf8');
  for (const section of ['功能特性', '安装', '配置', '使用', '开发']) {
    if (!readme.includes(section)) problems.push(`README.md 缺少章节：${section}`);
  }
}

if (problems.length) {
  console.error(`\n[check] 发现 ${problems.length} 个问题：`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('[check] 全部检查通过。');
