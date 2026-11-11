/**
 * 应用入口：把 core（录音/存储/播放/同步）与 ui（列表/通知/设置/波形）组装起来。
 * 所有跨模块协作都在这里，子模块之间不互相引用。
 */

import { $, ICONS } from './ui/dom.js';
import { Notifier } from './ui/notifier.js';
import { Waveform } from './ui/waveform.js';
import { RecordListView } from './ui/record-list.js';
import { SettingsDialog } from './ui/settings-dialog.js';
import { AudioRecorder } from './core/recorder.js';
import { RecordingStore, estimateStorage } from './core/storage.js';
import { Player } from './core/player.js';
import { TabSync } from './core/sync.js';
import { loadConfig } from './lib/config.js';
import { fmtDuration, fmtSize, safeFileName } from './lib/format.js';
import { describeStorageError, ERROR_MESSAGES } from './core/errors.js';

const notifier = new Notifier($('#notice'), $('#noticeBody'), $('#noticeClose'));
const loaded = loadConfig();
let config = loaded.config;
let records = [];
let syncTimer = 0;

const store = new RecordingStore();
const recorder = new AudioRecorder(config);
const player = new Player($('#audioEl'));
const waveform = new Waveform($('#wave'));

applyTheme(config.theme);

const sync = new TabSync(() => {
  // 其他标签页修改了数据：防抖后重新读取，保证各标签页列表一致
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      records = await store.list();
      if (player.currentId && !records.some((r) => r.id === player.currentId)) player.close();
      refresh();
    } catch { /* 数据库临时不可用时忽略，下次变更再试 */ }
  }, 150);
});

const listView = new RecordListView({
  root: $('#recordList'),
  empty: $('#empty'),
  summary: $('#listSum'),
  handlers: {
    onPlay: (rec) => player.toggle(rec).catch(() => {}),
    onRename: async (rec, name) => {
      rec.name = name;
      refresh();
      try {
        const { persistent } = await store.save(rec);
        if (!persistent) notifier.warn('数据库不可用，重命名仅在当前页面有效，刷新后可能恢复旧名称。');
        else notifier.success(`已重命名为「${name}」。`);
      } catch (e) {
        notifier.warn(`重命名未能写入数据库，刷新后可能恢复旧名称。${describeStorageError(e)}`);
      }
      sync.notify('changed');
    },
    onDelete: async (rec) => {
      if (player.currentId === rec.id) player.close();
      records = records.filter((r) => r.id !== rec.id);
      refresh();
      try {
        await store.remove(rec.id);
        notifier.success(`已删除「${rec.name}」。`);
      } catch (e) {
        notifier.warn(`本地数据库删除失败，刷新后该录音可能重新出现：${(e && e.message) || ''}`);
      }
      sync.notify('changed');
    },
    onDownload: (rec) => downloadRec(rec),
  },
});

const settings = new SettingsDialog($('#settingsDialog'), {
  onSave(next) {
    config = next;
    recorder.updateConfig(next);
    applyTheme(next.theme);
    notifier.success('设置已保存，录音相关选项将在下一次录音时生效。');
  },
});

/* ---------- 录音控制 ---------- */

$('#btnStart').addEventListener('click', async () => {
  if (recorder.state !== 'idle') return; // 防重复点击 / 权限弹窗期间重入
  try {
    await recorder.start();
  } catch (err) {
    notifier.error((err && err.message) || String(err));
    refreshDeviceStatus();
  }
});
$('#btnPause').addEventListener('click', () => {
  try {
    recorder.pause();
    notifier.info('已暂停，计时与音频均已停止累积。');
  } catch (e) { notifier.error(e.message); }
});
$('#btnResume').addEventListener('click', () => {
  try {
    recorder.resume();
    notifier.hide();
  } catch (e) { notifier.error(e.message); }
});
$('#btnStop').addEventListener('click', () => {
  const pending = recorder.stop();
  if (pending) pending.catch((e) => notifier.error(e.message));
});
$('#btnSettings').addEventListener('click', () => {
  settings.open(config, { getStorageInfo: estimateStorage, persistent: store.persistent });
});

recorder.on('statechange', (state) => {
  updateControls(state);
  if (state === 'idle') {
    $('#timer').textContent = '00:00:00';
    waveform.clear();
  }
  if (state === 'recording') {
    $('#fmtHint').textContent = `音频格式：${(recorder.mimeType.split(';')[0]) || '浏览器默认'} · 码率 ${config.audioBitsPerSecond / 1000} kbps`;
  }
});
recorder.on('tick', (ms) => {
  $('#timer').textContent = fmtDuration(ms, { forceHours: true });
});
recorder.on('level', (data) => waveform.draw(data));
recorder.on('warning', (err) => notifier.warn(err.message));
recorder.on('finished', async ({ recording, error }) => {
  if (error || !recording) {
    notifier.error((error && error.message) || '录音未保存。');
    return;
  }
  records = [recording, ...records].sort((a, b) => b.createdAt - a.createdAt);
  refresh();
  try {
    const { persistent } = await store.save(recording);
    if (persistent) {
      notifier.success(`已保存「${recording.name}」，时长 ${fmtDuration(recording.duration)}，大小 ${fmtSize(recording.size)}。`);
    } else {
      notifier.warn(`${ERROR_MESSAGES['storage-unavailable']} 当前录音「${recording.name}」已保留在列表中。`);
    }
  } catch (e) {
    notifier.warn(describeStorageError(e));
  }
  if (config.autoDownload) downloadRec(recording, { silent: true });
  sync.notify('changed');
  refreshDeviceStatus();
});

/* ---------- 播放 ---------- */

player.on('change', () => {
  const has = !!player.current;
  $('#player').classList.toggle('hidden', !has);
  if (has) $('#pName').textContent = player.current.name;
  $('#pToggle').innerHTML = player.playing ? ICONS.pause : ICONS.play;
  listView.updatePlayback(player.playing ? player.currentId : null);
  updatePlayerTime();
});
player.on('time', updatePlayerTime);
player.on('error', (e) => notifier.error(e.message));
player.on('durationknown', async ({ record, duration }) => {
  record.duration = duration;
  refresh();
  try { await store.save(record); } catch { /* 回填时长失败不影响播放 */ }
});

function updatePlayerTime() {
  const d = player.duration;
  const cur = player.currentTime;
  $('#pSeek').value = d ? Math.round((cur / d) * 1000) : 0;
  $('#pTime').textContent = `${fmtDuration(cur * 1000)} / ${d ? fmtDuration(d * 1000) : '--:--'}`;
}

$('#pToggle').addEventListener('click', () => {
  if (!player.current) return;
  if (player.playing) player.pause();
  else player.toggle(player.current).catch(() => {});
});
$('#pClose').addEventListener('click', () => player.close());
$('#pSeek').addEventListener('input', (e) => player.seekToRatio(Number(e.target.value) / 1000));

/* ---------- 工具 ---------- */

function refresh() {
  listView.render(records);
  listView.updatePlayback(player.playing ? player.currentId : null);
}

function updateControls(state) {
  const labels = {
    idle: '待命',
    starting: '正在请求麦克风权限…',
    recording: '正在录音',
    paused: '已暂停',
    stopping: '正在保存…',
  };
  const st = $('#stateText');
  st.className = 'state' + (state === 'recording' ? ' recording' : state === 'paused' ? ' paused' : '');
  st.querySelector('span').textContent = labels[state] || state;
  $('#btnStart').disabled = state !== 'idle';
  $('#btnPause').disabled = state !== 'recording';
  $('#btnResume').disabled = state !== 'paused';
  $('#btnStop').disabled = state !== 'recording' && state !== 'paused';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

function downloadRec(rec, { silent = false } = {}) {
  if (!rec || !rec.blob) {
    notifier.error('该录音缺少音频数据，无法下载。');
    return;
  }
  const url = URL.createObjectURL(rec.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFileName(rec.name, rec.ext || 'webm');
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  if (!silent) notifier.success(`已开始下载「${a.download}」。`);
}

function setBadge(cls, text) {
  const badge = $('#devStatus');
  badge.className = 'badge' + (cls ? ` ${cls}` : '');
  badge.querySelector('span').textContent = text;
}

async function refreshDeviceStatus() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    setBadge('bad', '浏览器不支持录音');
    return;
  }
  let perm = null;
  if (navigator.permissions && navigator.permissions.query) {
    try {
      perm = await navigator.permissions.query({ name: 'microphone' });
      if (perm && !perm.onchange) perm.onchange = refreshDeviceStatus;
    } catch { /* 部分浏览器不支持查询麦克风权限 */ }
  }
  if (perm && perm.state === 'denied') {
    setBadge('bad', '麦克风权限被拒绝');
    return;
  }
  let mics = [];
  try {
    mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  } catch { /* 忽略 */ }
  if (perm && perm.state === 'granted') {
    setBadge('good', mics.length ? `麦克风已就绪 · ${mics.length} 个输入设备` : '麦克风已就绪');
  } else if (mics.length === 0 && perm === null) {
    setBadge('bad', '未检测到麦克风设备');
  } else {
    setBadge('', '麦克风待授权 · 开始录音时弹出授权');
  }
}

if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', refreshDeviceStatus);
}
window.addEventListener('resize', () => {
  waveform.resize();
  if (recorder.state !== 'recording') waveform.clear();
});
window.addEventListener('beforeunload', (e) => {
  if (recorder.state !== 'idle') {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* 快捷键：空格 暂停/继续；Esc 关闭播放条。输入控件聚焦时不拦截。 */
document.addEventListener('keydown', (e) => {
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (e.key === 'Escape') {
    if (player.current) player.close();
    return;
  }
  if (typing) return;
  if (e.code === 'Space' && (recorder.state === 'recording' || recorder.state === 'paused')) {
    e.preventDefault();
    if (recorder.state === 'recording') $('#btnPause').click();
    else $('#btnResume').click();
  }
});

/* ---------- 初始化 ---------- */

(async function init() {
  updateControls('idle');
  if (loaded.errors.length) notifier.warn(loaded.errors.join('；'));
  const { persistent, error } = await store.init();
  try {
    records = await store.list();
  } catch (e) {
    notifier.warn(`读取历史录音失败：${(e && e.message) || '数据库异常'}。新录音仍可正常保存。`);
  }
  refresh();
  if (!persistent) {
    notifier.warn(`${ERROR_MESSAGES['storage-unavailable']}${error ? `（${error}）` : ''}`);
  }
  refreshDeviceStatus();
})();
