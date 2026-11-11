/**
 * 播放器：单 audio 元素复用，管理 objectURL 生命周期与播放状态。
 * Chrome 录制的 WebM 常缺少时长元数据（audio.duration === Infinity），
 * 因此进度条优先使用录音时自行计算的 duration，而不是媒体元数据。
 *
 * 事件：change（播放/暂停/切换/关闭）、time（进度）、error、durationknown（回填缺失时长）
 */

import { Emitter } from '../lib/emitter.js';

export class Player extends Emitter {
  #audio;
  #url = null;
  #current = null;

  constructor(audio) {
    super();
    if (!audio) throw new TypeError('需要 audio 元素');
    this.#audio = audio;
    audio.addEventListener('timeupdate', () => this.emit('time'));
    audio.addEventListener('play', () => this.emit('change'));
    audio.addEventListener('pause', () => this.emit('change'));
    audio.addEventListener('ended', () => this.emit('change'));
    audio.addEventListener('loadedmetadata', () => {
      const rec = this.#current;
      if (rec && !rec.duration && Number.isFinite(audio.duration) && audio.duration > 0) {
        this.emit('durationknown', { record: rec, duration: Math.round(audio.duration * 1000) });
      }
      this.emit('time');
    });
    audio.addEventListener('error', () => {
      if (audio.getAttribute('src')) {
        this.emit('error', new Error('音频解码失败，文件可能已损坏。可尝试下载后用系统播放器打开。'));
      }
    });
  }

  get current() { return this.#current; }
  get currentId() { return this.#current ? this.#current.id : null; }
  get playing() { return !!this.#current && !this.#audio.paused; }
  get currentTime() { return this.#audio.currentTime || 0; }
  get duration() {
    if (this.#current && this.#current.duration) return this.#current.duration / 1000;
    const d = this.#audio.duration;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  /** 同一条 → 播放/暂停切换；不同条 → 切换并播放。 */
  async toggle(rec) {
    if (this.#current && rec && this.#current.id === rec.id) {
      if (this.#audio.paused) await this.#play();
      else this.#audio.pause();
      return;
    }
    await this.play(rec);
  }

  async play(rec) {
    if (!rec || !rec.blob) throw new TypeError('无效的录音记录');
    this.#setSource(rec);
    await this.#play();
  }

  pause() { this.#audio.pause(); }

  seekToRatio(ratio) {
    const d = this.duration;
    if (!d) return;
    const r = Math.min(1, Math.max(0, Number(ratio) || 0));
    try { this.#audio.currentTime = r * d; } catch { /* 某些容器不支持 seek */ }
    this.emit('time');
  }

  close() {
    this.#audio.pause();
    this.#audio.removeAttribute('src');
    this.#audio.load();
    if (this.#url) URL.revokeObjectURL(this.#url);
    this.#url = null;
    this.#current = null;
    this.emit('change');
  }

  async #play() {
    try {
      await this.#audio.play();
    } catch (e) {
      const err = new Error(`播放失败：${(e && e.message) || '浏览器阻止了播放'}。可尝试下载后用系统播放器打开。`);
      this.emit('error', err);
      throw err;
    } finally {
      this.emit('change');
    }
  }

  #setSource(rec) {
    this.#audio.pause();
    if (this.#url) URL.revokeObjectURL(this.#url);
    this.#url = URL.createObjectURL(rec.blob);
    this.#current = rec;
    this.#audio.src = this.#url;
    this.#audio.load();
    this.emit('change');
  }
}
