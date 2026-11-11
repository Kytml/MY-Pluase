/**
 * 设置面板：录音参数、音频处理、自动备份、主题。
 * 表单先经 validateConfig 校验，有非法输入就拒绝保存并就地提示，
 * 绝不把脏配置写入 localStorage。
 */

import { el } from './dom.js';
import { BITRATE_OPTIONS, LIMITS, validateConfig, saveConfig } from '../lib/config.js';
import { fmtSize } from '../lib/format.js';

export class SettingsDialog {
  #dialog;
  #fields = {};
  #errorBox;
  #storageLine;
  #onSave;
  #baseConfig = {};

  constructor(dialog, { onSave }) {
    this.#dialog = dialog;
    this.#onSave = onSave;
    this.#build();
  }

  #build() {
    const f = this.#fields;
    f.namePrefix = el('input', { type: 'text', maxlength: 40, class: 'text-input', id: 'set-prefix' });
    f.audioBitsPerSecond = el('select', { class: 'text-input', id: 'set-bitrate' },
      BITRATE_OPTIONS.map((v) => el('option', { value: v, text: `${v / 1000} kbps` })));
    f.maxDurationSec = el('input', {
      type: 'number', class: 'text-input', id: 'set-maxdur',
      min: LIMITS.maxDurationSec.min, max: LIMITS.maxDurationSec.max, step: 1,
    });
    f.echoCancellation = el('input', { type: 'checkbox', id: 'set-echo' });
    f.noiseSuppression = el('input', { type: 'checkbox', id: 'set-noise' });
    f.autoGainControl = el('input', { type: 'checkbox', id: 'set-gain' });
    f.autoDownload = el('input', { type: 'checkbox', id: 'set-autodl' });
    f.theme = el('select', { class: 'text-input', id: 'set-theme' },
      el('option', { value: 'system', text: '跟随系统' }),
      el('option', { value: 'light', text: '浅色' }),
      el('option', { value: 'dark', text: '深色' }));

    this.#errorBox = el('div', { class: 'field-error', role: 'alert' });
    this.#storageLine = el('p', { class: 'storage-line' });

    const form = el('form', { class: 'settings-form', novalidate: '' },
      el('div', { class: 'dialog-head' },
        el('h2', { text: '设置' }),
        el('button', { type: 'button', class: 'nclose', text: '×', title: '关闭', onclick: () => this.close() })),

      field('录音命名前缀', f.namePrefix, '新录音将命名为「前缀 + 录制时间」，留空则使用"录音"。'),
      field('音频码率', f.audioBitsPerSecond, '码率越高音质越好、文件越大。语音记录 96–128 kbps 足够。'),
      field('最长录音时长（秒）', f.maxDurationSec,
        `0 表示不限制；范围 ${LIMITS.maxDurationSec.min}–${LIMITS.maxDurationSec.max} 秒，到达上限自动停止并保存。`),

      el('div', { class: 'form-field' },
        el('span', { class: 'form-label', text: '音频处理' }),
        el('div', { class: 'check-group' },
          check(f.echoCancellation, '回声消除', 'set-echo'),
          check(f.noiseSuppression, '降噪', 'set-noise'),
          check(f.autoGainControl, '自动增益', 'set-gain')),
        el('p', { class: 'form-help', text: '修改后在下一次录音时生效。' })),

      el('div', { class: 'form-field' },
        el('label', { class: 'check-line', for: 'set-autodl' }, f.autoDownload, ' 停止后自动下载备份到电脑')),
      field('界面主题', f.theme),

      this.#storageLine,
      this.#errorBox,
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'button', class: 'icon-btn', text: '取消', onclick: () => this.close() }),
        el('button', { type: 'submit', class: 'primary', text: '保存设置' })),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.#submit();
    });
    this.#dialog.textContent = '';
    this.#dialog.append(form);
    this.#dialog.addEventListener('click', (e) => {
      if (e.target === this.#dialog) this.close(); // 点击遮罩关闭
    });
  }

  open(config, { getStorageInfo, persistent } = {}) {
    this.#baseConfig = { ...config };
    const f = this.#fields;
    f.namePrefix.value = config.namePrefix;
    f.audioBitsPerSecond.value = String(config.audioBitsPerSecond);
    if (!f.audioBitsPerSecond.value) f.audioBitsPerSecond.value = '128000'; // 自定义码率不在选项中时的兜底
    f.maxDurationSec.value = String(config.maxDurationSec);
    f.echoCancellation.checked = config.echoCancellation;
    f.noiseSuppression.checked = config.noiseSuppression;
    f.autoGainControl.checked = config.autoGainControl;
    f.autoDownload.checked = config.autoDownload;
    f.theme.value = config.theme;
    this.#errorBox.textContent = '';
    this.#refreshStorage(getStorageInfo, persistent);
    if (!this.#dialog.open) {
      if (typeof this.#dialog.showModal === 'function') this.#dialog.showModal();
      else this.#dialog.setAttribute('open', '');
    }
  }

  close() {
    if (typeof this.#dialog.close === 'function') this.#dialog.close();
    else this.#dialog.removeAttribute('open');
  }

  async #refreshStorage(getStorageInfo, persistent) {
    this.#storageLine.textContent = persistent
      ? '存储方式：浏览器本地数据库（IndexedDB），刷新或重开浏览器不丢失。'
      : '存储方式：内存（浏览器数据库不可用），关闭页面即丢失，请及时下载备份。';
    if (typeof getStorageInfo !== 'function') return;
    const info = await getStorageInfo();
    if (info && info.quota) {
      this.#storageLine.textContent += ` 已用 ${fmtSize(info.usage)} / 配额约 ${fmtSize(info.quota)}。`;
    }
  }

  #collect() {
    const f = this.#fields;
    const rawMax = f.maxDurationSec.value.trim();
    return {
      ...this.#baseConfig, // 保留 mimePreference、timesliceMs 等未暴露字段
      namePrefix: f.namePrefix.value,
      audioBitsPerSecond: Number(f.audioBitsPerSecond.value),
      maxDurationSec: rawMax === '' ? 0 : Number(rawMax),
      echoCancellation: f.echoCancellation.checked,
      noiseSuppression: f.noiseSuppression.checked,
      autoGainControl: f.autoGainControl.checked,
      autoDownload: f.autoDownload.checked,
      theme: f.theme.value,
    };
  }

  #submit() {
    const { config, errors } = validateConfig(this.#collect());
    if (errors.length) {
      this.#errorBox.textContent = `设置未保存：${errors.join('；')}`;
      return;
    }
    const result = saveConfig(config);
    if (!result.ok) {
      this.#errorBox.textContent = result.error;
      return;
    }
    this.#onSave(config);
    this.close();
  }
}

function field(label, control, help) {
  const id = control.id;
  return el('div', { class: 'form-field' },
    el('label', { class: 'form-label', for: id, text: label }),
    control,
    help ? el('p', { class: 'form-help', text: help }) : null);
}

function check(control, label, id) {
  return el('label', { class: 'check-line', for: id }, control, ` ${label}`);
}
