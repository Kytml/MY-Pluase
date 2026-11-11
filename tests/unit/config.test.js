import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, CONFIG_STORAGE_KEY, validateConfig, loadConfig, saveConfig,
  pickMimeType, extForMime,
} from '../../src/lib/config.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    dump: () => Object.fromEntries(map),
  };
}

test('空配置 → 全部默认值且无错误', () => {
  const { config, errors } = validateConfig({});
  assert.deepEqual(errors, []);
  assert.equal(config.audioBitsPerSecond, DEFAULTS.audioBitsPerSecond);
  assert.equal(config.maxDurationSec, 0);
  assert.equal(config.theme, 'system');
  assert.equal(config.namePrefix, '录音');
});

test('合法覆盖被接受，字符串数字会被转换', () => {
  const { config, errors } = validateConfig({
    audioBitsPerSecond: '192000', maxDurationSec: 300, theme: 'dark',
    autoDownload: true, namePrefix: '会议',
  });
  assert.deepEqual(errors, []);
  assert.equal(config.audioBitsPerSecond, 192000);
  assert.equal(config.maxDurationSec, 300);
  assert.equal(config.theme, 'dark');
  assert.equal(config.autoDownload, true);
  assert.equal(config.namePrefix, '会议');
});

test('非法值回退默认值并给出原因', () => {
  const { config, errors } = validateConfig({
    audioBitsPerSecond: -5,
    timesliceMs: 'abc',
    maxDurationSec: 99999999,
    autoDownload: 'yes',
    theme: 'blue',
    namePrefix: 'a'.repeat(50),
  });
  assert.equal(config.audioBitsPerSecond, DEFAULTS.audioBitsPerSecond);
  assert.equal(config.timesliceMs, DEFAULTS.timesliceMs);
  assert.equal(config.maxDurationSec, 0);
  assert.equal(config.autoDownload, false);
  assert.equal(config.theme, 'system');
  assert.equal(config.namePrefix, '录音');
  assert.equal(errors.length, 6);
});

test('非对象输入与未知键被安全处理', () => {
  for (const bad of [null, [], 'x', 42]) {
    const { config, errors } = validateConfig(bad);
    assert.equal(config.audioBitsPerSecond, DEFAULTS.audioBitsPerSecond);
    assert.ok(errors.length > 0);
  }
  const { config } = validateConfig({ hacker: 'x', audioBitsPerSecond: 64000 });
  assert.equal('hacker' in config, false);
  assert.equal(config.audioBitsPerSecond, 64000);
});

test('loadConfig：无记录 / 损坏 JSON / 非法字段', () => {
  assert.deepEqual(loadConfig(fakeStorage()).errors, []);
  const broken = loadConfig(fakeStorage({ [CONFIG_STORAGE_KEY]: '{not json' }));
  assert.equal(broken.config.audioBitsPerSecond, DEFAULTS.audioBitsPerSecond);
  assert.ok(broken.errors.length > 0);
  const invalid = loadConfig(fakeStorage({
    [CONFIG_STORAGE_KEY]: JSON.stringify({ audioBitsPerSecond: -1, theme: 'dark' }),
  }));
  assert.equal(invalid.config.audioBitsPerSecond, DEFAULTS.audioBitsPerSecond);
  assert.equal(invalid.config.theme, 'dark');
});

test('loadConfig：存储被禁用时明确标记 persisted=false', () => {
  const throwing = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  assert.equal(loadConfig(throwing).persisted, false);
  assert.equal(loadConfig(null).persisted, false);
});

test('saveConfig：写入规范化配置，失败时返回错误', () => {
  const storage = fakeStorage();
  const result = saveConfig({ audioBitsPerSecond: 96000, junk: true }, storage);
  assert.equal(result.ok, true);
  const saved = JSON.parse(storage.dump()[CONFIG_STORAGE_KEY]);
  assert.equal(saved.audioBitsPerSecond, 96000);
  assert.equal('junk' in saved, false);
  assert.equal(saveConfig({}, null).ok, false);
});

test('pickMimeType：按偏好挑选第一个受支持的格式', () => {
  const supported = (t) => t === 'audio/webm';
  assert.equal(pickMimeType(['audio/mp4', 'audio/webm'], supported), 'audio/webm');
  assert.equal(pickMimeType(['audio/mp4'], supported), '');
  assert.equal(pickMimeType(undefined, supported), 'audio/webm');
  assert.equal(pickMimeType(['audio/webm'], null), '');
});

test('extForMime：MIME 到扩展名', () => {
  assert.equal(extForMime('audio/webm;codecs=opus'), 'webm');
  assert.equal(extForMime('audio/mp4'), 'm4a');
  assert.equal(extForMime('audio/ogg;codecs=opus'), 'ogg');
  assert.equal(extForMime('audio/mpeg'), 'mp3');
  assert.equal(extForMime(''), 'webm');
  assert.equal(extForMime(undefined), 'webm');
});
