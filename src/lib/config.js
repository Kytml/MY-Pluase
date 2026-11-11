/**
 * 应用配置：默认值、范围限制、校验、localStorage 读写。
 * 非法配置一律回退为默认值并给出原因，绝不让脏配置进入录音流程。
 */

import { validatePrefix } from './validate.js';

export const CONFIG_STORAGE_KEY = 'voice-recorder:config:v1';

export const DEFAULTS = Object.freeze({
  audioBitsPerSecond: 128000,
  timesliceMs: 1000,
  maxDurationSec: 0, // 0 = 不限制
  namePrefix: '录音',
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  autoDownload: false,
  theme: 'system', // system | light | dark
  mimePreference: Object.freeze([
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/mpeg',
  ]),
});

export const LIMITS = Object.freeze({
  audioBitsPerSecond: Object.freeze({ min: 16000, max: 512000 }),
  timesliceMs: Object.freeze({ min: 100, max: 10000 }),
  maxDurationSec: Object.freeze({ min: 0, max: 86400 }),
});

export const BITRATE_OPTIONS = Object.freeze([64000, 96000, 128000, 192000, 256000]);
export const THEMES = Object.freeze(['system', 'light', 'dark']);

const LABELS = {
  audioBitsPerSecond: '音频码率',
  timesliceMs: '分片间隔',
  maxDurationSec: '最长录音时长',
};
const BOOLEAN_KEYS = ['echoCancellation', 'noiseSuppression', 'autoGainControl', 'autoDownload'];
const INT_KEYS = ['audioBitsPerSecond', 'timesliceMs', 'maxDurationSec'];

function validateInt(key, value, errors) {
  const { min, max } = LIMITS[key];
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    errors.push(`${LABELS[key]}必须是 ${min}–${max} 之间的整数，已回退为 ${DEFAULTS[key]}`);
    return DEFAULTS[key];
  }
  return n;
}

/**
 * 校验并补全配置。
 * @returns {{config:object, errors:string[]}} config 只含已知键，可安全使用
 */
export function validateConfig(input) {
  const errors = [];
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (src !== input) errors.push('配置必须是对象，已回退为默认值');

  const config = {};
  for (const key of INT_KEYS) {
    config[key] = validateInt(key, src[key] === undefined ? DEFAULTS[key] : src[key], errors);
  }
  for (const key of BOOLEAN_KEYS) {
    const v = src[key] === undefined ? DEFAULTS[key] : src[key];
    if (typeof v !== 'boolean') {
      errors.push(`${key} 必须是布尔值，已回退为 ${DEFAULTS[key]}`);
      config[key] = DEFAULTS[key];
    } else {
      config[key] = v;
    }
  }
  const prefix = validatePrefix(src.namePrefix === undefined ? DEFAULTS.namePrefix : src.namePrefix);
  if (prefix.ok) config.namePrefix = prefix.value;
  else {
    errors.push(`${prefix.error}，已回退为默认前缀`);
    config.namePrefix = DEFAULTS.namePrefix;
  }
  const theme = src.theme === undefined ? DEFAULTS.theme : src.theme;
  if (THEMES.includes(theme)) config.theme = theme;
  else {
    errors.push(`主题只能是 ${THEMES.join('/')}，已回退为跟随系统`);
    config.theme = DEFAULTS.theme;
  }
  config.mimePreference = Array.isArray(src.mimePreference)
    ? src.mimePreference.filter((t) => typeof t === 'string' && t.startsWith('audio/'))
    : [...DEFAULTS.mimePreference];
  if (config.mimePreference.length === 0) config.mimePreference = [...DEFAULTS.mimePreference];
  return { config, errors };
}

function safeLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** 读取配置；storage 可注入 fake 实现用于测试。 */
export function loadConfig(storage = safeLocalStorage()) {
  const fallback = { ...DEFAULTS, mimePreference: [...DEFAULTS.mimePreference] };
  if (!storage) {
    return { config: fallback, errors: ['浏览器禁用了本地存储，设置仅在本次会话有效'], persisted: false };
  }
  let raw;
  try {
    raw = storage.getItem(CONFIG_STORAGE_KEY);
  } catch {
    return { config: fallback, errors: ['读取设置失败，已使用默认值'], persisted: false };
  }
  if (!raw) return { config: fallback, errors: [], persisted: true };
  try {
    const { config, errors } = validateConfig(JSON.parse(raw));
    return { config, errors, persisted: true };
  } catch {
    return { config: fallback, errors: ['设置内容损坏，已恢复默认值'], persisted: true };
  }
}

/** 保存配置（先校验规范化）。 */
export function saveConfig(config, storage = safeLocalStorage()) {
  if (!storage) return { ok: false, error: '浏览器禁用了本地存储，设置无法保存' };
  try {
    const { config: clean } = validateConfig(config);
    storage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(clean));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: '保存设置失败：' + ((e && e.message) || '未知错误') };
  }
}

/** 按偏好顺序挑出浏览器支持的录制格式；都不支持返回空串（由浏览器自行决定）。 */
export function pickMimeType(preference, isTypeSupported) {
  const list = Array.isArray(preference) ? preference : DEFAULTS.mimePreference;
  if (typeof isTypeSupported !== 'function') return '';
  return list.find((t) => {
    try {
      return isTypeSupported(t);
    } catch {
      return false;
    }
  }) || '';
}

/** MIME → 下载文件扩展名。 */
export function extForMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('aac')) return 'aac';
  return 'webm';
}
