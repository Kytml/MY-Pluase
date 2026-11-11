#!/usr/bin/env node
/**
 * 零依赖本地静态服务器。
 * 录音需要安全上下文（localhost 被视为安全来源），且 ES 模块不能用 file:// 加载，
 * 因此开发/使用一律通过本服务访问。
 *
 * 用法：node server.mjs [--port=8168] [--no-open]
 * 仅监听 127.0.0.1，不对局域网开放；拒绝目录遍历与隐藏文件/node_modules 访问。
 */

import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 8168;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function parseArgs(argv) {
  const options = { port: Number(process.env.PORT) || DEFAULT_PORT, open: true };
  for (const arg of argv) {
    if (arg === '--no-open') options.open = false;
    else if (arg.startsWith('--port=')) options.port = Number(arg.slice('--port='.length));
    else if (arg === '--help' || arg === '-h') {
      console.log('用法: node server.mjs [--port=8168] [--no-open]');
      process.exit(0);
    } else {
      console.error(`未知参数: ${arg}`);
      process.exit(1);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    console.error('端口必须是 1-65535 之间的整数');
    process.exit(1);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end('Method Not Allowed');
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }
    if (pathname.endsWith('/')) pathname += 'index.html';

    const filePath = path.normalize(path.join(ROOT, pathname));
    const relative = path.relative(ROOT, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    // 不暴露 .git / .env / node_modules 等敏感内容
    if (relative.split(path.sep).some((seg) => seg.startsWith('.') || seg === 'node_modules')) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(await fs.readFile(filePath));
  } catch (err) {
    const notFound = err && (err.code === 'ENOENT' || err.code === 'ENOTDIR');
    res.writeHead(notFound ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(notFound ? '404 Not Found' : '500 Internal Server Error');
  }
});

function listen(port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve(port);
    });
  });
}

let boundPort = null;
for (let port = options.port; port < options.port + 20; port++) {
  try {
    boundPort = await listen(port);
    break;
  } catch (err) {
    if (err.code !== 'EADDRINUSE') {
      console.error(`启动失败：${err.message}`);
      process.exit(1);
    }
  }
}
if (boundPort === null) {
  console.error(`端口 ${options.port}-${options.port + 19} 均被占用，请用 --port 指定其他端口。`);
  process.exit(1);
}

const url = `http://127.0.0.1:${boundPort}/`;
console.log(`录音机已启动：${url}`);
console.log('仅监听本机回环地址。按 Ctrl+C 停止服务。');
if (options.open) openBrowser(url);

function openBrowser(target) {
  const platform = process.platform;
  const command = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', target] : [target];
  try {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', () => console.log('未能自动打开浏览器，请手动访问上述地址。'));
  } catch {
    console.log('未能自动打开浏览器，请手动访问上述地址。');
  }
}

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
