/**
 * E2E 基础设施：启动本地静态服务 + 无头 Chrome（模拟麦克风），通过 CDP 驱动页面。
 * 无第三方依赖：WebSocket 使用 Node 22+ 内置实现，HTTP 使用全局 fetch。
 *
 * 环境变量：
 *   CHROME_PATH       指定 Chrome / Edge / Chromium 可执行文件路径
 *   E2E_KEEP_PROFILE=1  测试结束后保留临时目录（便于排查，或避免受限环境删除失败）
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const BASE_URL = 'http://127.0.0.1:8170';
export const DEBUG_URL = 'http://127.0.0.1:9222';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const local = process.env.LOCALAPPDATA || '';
  const candidates = process.platform === 'win32'
    ? [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      path.join(local, 'Google/Chrome/Application/chrome.exe'),
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ]
    : process.platform === 'darwin'
      ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return candidates.find((p) => p && existsSync(p)) || null;
}

export async function waitFor(fn, { timeout = 25000, interval = 250, description = '条件' } = {}) {
  const end = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) {
      lastError = e;
    }
    await sleep(interval);
  }
  throw new Error(`等待超时：${description}${lastError ? `（${lastError.message}）` : ''}`);
}

/** CDP 连接：发送命令、执行页面 JS、收集页面错误。 */
export class CDP {
  #ws;
  #seq = 0;
  #pending = new Map();
  #errors = [];

  static async connect(wsUrl) {
    const cdp = new CDP();
    cdp.#ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      cdp.#ws.onopen = resolve;
      cdp.#ws.onerror = () => reject(new Error('CDP WebSocket 连接失败'));
    });
    cdp.#ws.onmessage = (e) => cdp.#onMessage(JSON.parse(e.data));
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    return cdp;
  }

  #onMessage(m) {
    if (m.id && this.#pending.has(m.id)) {
      const { resolve, reject } = this.#pending.get(m.id);
      this.#pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message));
      else resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      this.#errors.push((d.exception && d.exception.description) || d.text || '页面异常');
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      this.#errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  }

  get pageErrors() { return [...this.#errors]; }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.#seq;
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 在页面中执行表达式并返回其值（支持 Promise）。 */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面执行出错：' + ((d.exception && d.exception.description) || d.text));
    }
    return r.result ? r.result.value : undefined;
  }

  close() {
    try { this.#ws.close(); } catch { /* 忽略 */ }
  }
}

export async function createHarness() {
  if (typeof WebSocket === 'undefined') {
    console.log('SKIP: E2E 需要 Node.js 22+（内置 WebSocket），当前版本过低。');
    return null;
  }
  const chromePath = findChrome();
  if (!chromePath) {
    console.log('SKIP: 未找到 Chrome / Edge / Chromium。可设置 CHROME_PATH 环境变量后重试。');
    return null;
  }

  const server = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), '--port=8170', '--no-open'], { stdio: 'ignore' });
  const profile = mkdtempSync(path.join(os.tmpdir(), 'vr-e2e-profile-'));
  const downloadDir = mkdtempSync(path.join(os.tmpdir(), 'vr-e2e-download-'));
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=9222', `--user-data-dir=${profile}`,
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required', '--window-size=1200,1000',
    `${BASE_URL}/index.html`,
  ], { stdio: 'ignore' });

  const tempDirs = [profile, downloadDir];
  const dispose = async (cdp) => {
    if (cdp) cdp.close();
    try { chrome.kill(); } catch { /* 忽略 */ }
    try { server.kill(); } catch { /* 忽略 */ }
    if (process.env.E2E_KEEP_PROFILE === '1') {
      console.log('临时目录已保留：' + tempDirs.join(', '));
      return;
    }
    await sleep(400);
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        console.log('临时目录未能自动清理，可手动删除：' + dir);
      }
    }
  };

  try {
    await waitFor(async () => (await fetch(`${BASE_URL}/index.html`)).ok, { description: '本地静态服务就绪' });
    const target = await waitFor(async () => {
      const list = await (await fetch(`${DEBUG_URL}/json`)).json();
      return list.find((t) => t.type === 'page' && t.url.includes('index.html'));
    }, { description: 'Chrome 页面就绪' });
    const cdp = await CDP.connect(target.webSocketDebuggerUrl);
    return {
      cdp,
      downloadDir,
      async newPage(url) {
        const t = await (await fetch(`${DEBUG_URL}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
        return CDP.connect(t.webSocketDebuggerUrl);
      },
      close: () => dispose(cdp),
    };
  } catch (e) {
    await dispose(null);
    throw e;
  }
}
