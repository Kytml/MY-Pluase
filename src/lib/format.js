/**
 * 展示与文件名相关的纯函数工具。无 DOM / 浏览器依赖，可在 Node 中直接单测。
 */

export function pad2(n) {
  return String(Math.floor(Math.abs(n))).padStart(2, '0');
}

/** 毫秒 → "MM:SS"，超过 1 小时或 forceHours 时为 "HH:MM:SS"。非法输入按 0 处理。 */
export function fmtDuration(ms, { forceHours = false } = {}) {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const total = Math.round(safe / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (h > 0 || forceHours ? pad2(h) + ':' : '') + pad2(m) + ':' + pad2(s);
}

/** 时间戳 → "YYYY-MM-DD HH:mm:ss"（本地时区）。 */
export function fmtDateTime(ts) {
  const d = new Date(Number.isFinite(ts) ? ts : 0);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** 字节数 → 可读大小。 */
export function fmtSize(bytes) {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 默认录音名："录音 2026-11-08 21-03-45"。 */
export function defaultName(prefix, ts) {
  const base = typeof prefix === 'string' && prefix.trim() ? prefix.trim() : '录音';
  return `${base} ${fmtDateTime(ts).replace(/:/g, '-')}`;
}

// Windows / macOS / Linux 均不允许的字符 + 控制字符
const ILLEGAL_FILENAME = /[\\/:*?"<>|\u0000-\u001F\u007F]/g;

/**
 * 生成跨平台安全的下载文件名：替换非法字符、去掉结尾点/空格、限制长度。
 * @param {string} name 录音名
 * @param {string} ext 扩展名（不含点）
 */
export function safeFileName(name, ext = 'webm', { maxBase = 80 } = {}) {
  let base = String(name ?? '').replace(ILLEGAL_FILENAME, '_').trim();
  base = base.replace(/[. ]+$/g, '').slice(0, maxBase).replace(/[. ]+$/g, '');
  if (!base) base = 'recording';
  // Windows 保留设备名
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = `_${base}`;
  const cleanExt = String(ext ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webm';
  return `${base}.${cleanExt}`;
}
