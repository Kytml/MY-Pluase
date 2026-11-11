/**
 * 录音列表视图：负责渲染与行内交互（播放、重命名、删除确认、下载），
 * 业务动作全部通过 handlers 回调交给 main.js，自己不碰存储。
 */

import { el, ICONS } from './dom.js';
import { fmtDuration, fmtDateTime, fmtSize } from '../lib/format.js';
import { validateRecordingName } from '../lib/validate.js';

export class RecordListView {
  #root;
  #empty;
  #summary;
  #handlers;
  #playingId = null;

  constructor({ root, empty, summary, handlers }) {
    this.#root = root;
    this.#empty = empty;
    this.#summary = summary;
    this.#handlers = handlers;
  }

  render(records) {
    this.#root.textContent = '';
    this.#empty.style.display = records.length ? 'none' : 'block';
    const total = records.reduce((sum, r) => sum + (r.duration || 0), 0);
    this.#summary.textContent = `共 ${records.length} 条 · 总时长 ${fmtDuration(total)}`;
    for (const rec of records) this.#root.append(this.#row(rec));
  }

  /** 播放状态变化时只更新按钮，不重建 DOM（避免打断正在编辑的名称）。 */
  updatePlayback(playingId) {
    this.#playingId = playingId;
    for (const li of this.#root.children) this.#applyPlayState(li);
  }

  #applyPlayState(li) {
    const btn = li.querySelector('.play-btn');
    if (!btn) return;
    const on = li.dataset.id === this.#playingId;
    btn.classList.toggle('active', on);
    btn.innerHTML = on ? ICONS.pause : ICONS.play;
    btn.title = on ? '暂停' : '播放';
  }

  #row(rec) {
    const li = el('li', { class: 'rec-item', dataset: { id: rec.id } });
    const playBtn = el('button', {
      class: 'play-btn', title: '播放', html: ICONS.play,
      'aria-label': `播放 ${rec.name}`,
      onclick: () => this.#handlers.onPlay(rec),
    });
    const meta = el('div', { class: 'rec-meta' },
      el('div', { class: 'rec-name', text: rec.name, title: rec.name }),
      el('div', {
        class: 'rec-sub',
        text: `${fmtDateTime(rec.createdAt)} · 时长 ${rec.duration ? fmtDuration(rec.duration) : '未知'} · ${fmtSize(rec.size)}`,
      }));
    const actions = el('div', { class: 'rec-actions' },
      el('button', { class: 'icon-btn', text: '重命名', onclick: () => this.#startRename(li, rec) }),
      el('button', { class: 'icon-btn', text: '下载', onclick: () => this.#handlers.onDownload(rec) }),
      el('button', { class: 'icon-btn del', text: '删除', onclick: () => this.#confirmDelete(li, rec) }));
    li.append(playBtn, meta, actions);
    this.#applyPlayState(li);
    return li;
  }

  #startRename(li, rec) {
    if (li.querySelector('.name-input')) return;
    const meta = li.querySelector('.rec-meta');
    const actions = li.querySelector('.rec-actions');
    li.querySelector('.rec-name').style.display = 'none';
    actions.textContent = '';

    const input = el('input', {
      class: 'name-input', type: 'text', value: rec.name,
      maxlength: 200, 'aria-label': '录音名称',
    });
    const error = el('div', { class: 'field-error', role: 'alert' });
    meta.prepend(error);
    meta.prepend(input);
    input.focus();
    input.select();

    const restore = () => li.replaceWith(this.#row(rec));
    const saveBtn = el('button', { class: 'icon-btn primary', text: '保存' });
    const save = async () => {
      const result = validateRecordingName(input.value);
      if (!result.ok) {
        error.textContent = result.error;
        input.classList.add('invalid');
        input.focus();
        return; // 校验失败保留编辑状态，由用户修正
      }
      saveBtn.disabled = true;
      error.textContent = '';
      await this.#handlers.onRename(rec, result.value); // 成功后由 main 重新渲染
    };
    saveBtn.addEventListener('click', save);
    actions.append(saveBtn, el('button', { class: 'icon-btn', text: '取消', onclick: restore }));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { e.preventDefault(); restore(); }
    });
    input.addEventListener('input', () => {
      error.textContent = '';
      input.classList.remove('invalid');
    });
  }

  #confirmDelete(li, rec) {
    const actions = li.querySelector('.rec-actions');
    actions.textContent = '';
    const yes = el('button', { class: 'icon-btn del', text: '删除' });
    yes.addEventListener('click', async () => {
      yes.disabled = true;
      await this.#handlers.onDelete(rec);
    });
    actions.append(
      el('span', { class: 'confirm-txt', text: `确认删除「${rec.name}」？` }),
      yes,
      el('button', { class: 'icon-btn', text: '取消', onclick: () => li.replaceWith(this.#row(rec)) }),
    );
  }
}
