/**
 * 录音引擎：封装 getUserMedia + MediaRecorder + Web Audio 音量分析。
 * 只负责"录出一段音频"，不碰 DOM、不写存储；通过事件向外通知。
 *
 * 状态机：idle → starting → recording ⇄ paused → stopping → idle
 * 事件：
 *   statechange(state)                 状态变化
 *   tick(elapsedMs)                    计时刷新（200ms）
 *   level(Uint8Array|null)             频谱数据，null 表示停止绘制
 *   warning(RecorderError)             非致命异常（设备断开、到达时长上限等）
 *   finished({recording, reason, error}) 一次录音结束；error 非空表示未产出有效音频
 */

import { Emitter } from '../lib/emitter.js';
import { ElapsedClock } from '../lib/clock.js';
import { DEFAULTS, pickMimeType, extForMime } from '../lib/config.js';
import { defaultName } from '../lib/format.js';
import { RecorderError, fromGetUserMediaError } from './errors.js';

const TICK_MS = 200;
let idCounter = 0;

function createId() {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class AudioRecorder extends Emitter {
  #config;
  #state = 'idle';
  #stream = null;
  #recorder = null;
  #chunks = [];
  #clock = new ElapsedClock();
  #startedAt = 0;
  #tickTimer = 0;
  #rafId = 0;
  #audioCtx = null;
  #analyser = null;
  #sourceNode = null;
  #freqData = null;
  #mime = '';
  #stopReason = 'user';
  #stopPromise = null;
  #resolveStop = null;
  #finalized = false;

  constructor(config = {}) {
    super();
    this.#config = { ...DEFAULTS, ...config };
  }

  get state() { return this.#state; }
  get elapsed() { return this.#clock.elapsed; }
  get mimeType() { return this.#mime; }

  /** 更新配置；进行中的录音不受影响，下次 start 生效。 */
  updateConfig(config) {
    this.#config = { ...this.#config, ...config };
  }

  #setState(next) {
    if (this.#state === next) return;
    this.#state = next;
    this.emit('statechange', next);
  }

  #assertEnvironment() {
    if (typeof window === 'undefined' || !window.MediaRecorder) throw new RecorderError('not-supported');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new RecorderError('not-supported');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
    if (!window.isSecureContext && !local) throw new RecorderError('insecure-context');
  }

  /** 开始录音；权限/设备问题会抛出 RecorderError。重复调用安全（返回 false）。 */
  async start() {
    if (this.#state !== 'idle') return false;
    this.#assertEnvironment();
    this.#setState('starting');
    let stream;
    try {
      const c = this.#config;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: c.echoCancellation,
          noiseSuppression: c.noiseSuppression,
          autoGainControl: c.autoGainControl,
        },
      });
    } catch (err) {
      this.#setState('idle');
      throw fromGetUserMediaError(err);
    }
    // 授权弹窗期间用户可能已取消：此时直接释放设备，不再进入录音
    if (this.#state !== 'starting') {
      this.#releaseStream(stream);
      return false;
    }
    try {
      this.#setup(stream);
    } catch (err) {
      this.#releaseStream(stream);
      this.#stream = null;
      this.#setState('idle');
      throw err instanceof RecorderError ? err : new RecorderError('start-failed', { cause: err });
    }
    this.#setState('recording');
    this.#startTick();
    this.#startLevels();
    return true;
  }

  #setup(stream) {
    const tracks = stream.getAudioTracks();
    if (!tracks.length) throw new RecorderError('no-device');
    this.#stream = stream;

    const c = this.#config;
    this.#mime = pickMimeType(c.mimePreference, (t) => window.MediaRecorder.isTypeSupported(t));
    const options = {};
    if (this.#mime) {
      options.mimeType = this.#mime;
      options.audioBitsPerSecond = c.audioBitsPerSecond;
    }
    this.#chunks = [];
    this.#finalized = false;
    this.#stopReason = 'user';
    this.#clock.reset();
    this.#startedAt = Date.now();

    const recorder = Object.keys(options).length
      ? new window.MediaRecorder(stream, options)
      : new window.MediaRecorder(stream);
    this.#recorder = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.#chunks.push(e.data);
    };
    recorder.onstop = () => this.#finalize();
    recorder.onerror = (e) => {
      this.emit('warning', new RecorderError('recorder-error', { cause: e.error }));
      this.stop('recorder-error').catch(() => {});
    };
    tracks[0].addEventListener('ended', () => {
      if (this.#state === 'recording' || this.#state === 'paused') {
        this.emit('warning', new RecorderError('device-lost'));
        this.stop('device-lost').catch(() => {});
      }
    });

    try {
      recorder.start(c.timesliceMs);
    } catch (err) {
      throw new RecorderError('start-failed', { cause: err });
    }
    this.#clock.start();
  }

  pause() {
    if (this.#state !== 'recording') return false;
    try {
      this.#recorder.pause();
    } catch (err) {
      throw new RecorderError('pause-unsupported', { cause: err });
    }
    this.#clock.pause();
    this.#stopLevels();
    this.#setState('paused');
    return true;
  }

  resume() {
    if (this.#state !== 'paused') return false;
    try {
      this.#recorder.resume();
    } catch (err) {
      throw new RecorderError('resume-failed', { cause: err });
    }
    this.#clock.resume();
    this.#setState('recording');
    this.#startLevels();
    return true;
  }

  /**
   * 停止录音。
   * @param {string} reason user | max-duration | device-lost | recorder-error
   * @returns {Promise<{recording:object|null, reason:string, error:Error|null}>|null}
   */
  stop(reason = 'user') {
    if (this.#state === 'idle') return null;
    if (this.#state === 'starting') {
      // 还在等待授权：取消本次启动，由 start() 负责释放设备
      this.#setState('idle');
      return null;
    }
    if (this.#state === 'stopping') return this.#stopPromise;
    this.#setState('stopping');
    this.#stopReason = reason;
    this.#clock.stop();
    clearInterval(this.#tickTimer);
    this.#tickTimer = 0;
    this.#stopLevels();
    this.#stopPromise = new Promise((resolve) => { this.#resolveStop = resolve; });
    if (this.#recorder && this.#recorder.state !== 'inactive') {
      try {
        this.#recorder.stop();
      } catch {
        this.#finalize();
      }
    } else {
      this.#finalize();
    }
    return this.#stopPromise;
  }

  /** onstop 回调：此时最后一个 dataavailable 已交付，音频数据完整。 */
  #finalize() {
    if (this.#finalized) return;
    this.#finalized = true;

    const blob = new Blob(this.#chunks, { type: this.#mime || 'audio/webm' });
    this.#chunks = [];
    const duration = Math.round(this.#clock.elapsed);
    const startedAt = this.#startedAt;
    const reason = this.#stopReason;

    this.#teardown();
    this.#setState('idle');

    const result = { recording: null, reason, error: null };
    if (blob.size === 0) {
      result.error = new RecorderError('empty-recording');
    } else {
      result.recording = {
        id: createId(),
        name: defaultName(this.#config.namePrefix, startedAt),
        createdAt: startedAt,
        duration,
        size: blob.size,
        mime: blob.type,
        ext: extForMime(blob.type),
        blob,
      };
    }
    this.emit('finished', result);
    if (this.#resolveStop) {
      this.#resolveStop(result);
      this.#resolveStop = null;
    }
  }

  #startTick() {
    clearInterval(this.#tickTimer);
    this.#tickTimer = setInterval(() => {
      this.emit('tick', this.#clock.elapsed);
      const max = this.#config.maxDurationSec;
      if (max > 0 && this.#state === 'recording' && this.#clock.elapsed >= max * 1000) {
        this.emit('warning', new RecorderError('max-duration'));
        this.stop('max-duration').catch(() => {});
      }
    }, TICK_MS);
  }

  #startLevels() {
    if (!this.#analyser) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC || !this.#stream) return;
        this.#audioCtx = new AC();
        this.#sourceNode = this.#audioCtx.createMediaStreamSource(this.#stream);
        this.#analyser = this.#audioCtx.createAnalyser();
        this.#analyser.fftSize = 256;
        this.#analyser.smoothingTimeConstant = 0.75;
        this.#freqData = new Uint8Array(this.#analyser.frequencyBinCount);
        this.#sourceNode.connect(this.#analyser); // 不接 destination，避免回放啸叫
      } catch {
        this.#analyser = null;
        return; // 音量条是增强功能，失败不影响录音
      }
    }
    const loop = () => {
      if (this.#state !== 'recording' || !this.#analyser) {
        this.#rafId = 0;
        return;
      }
      this.#analyser.getByteFrequencyData(this.#freqData);
      this.emit('level', this.#freqData);
      this.#rafId = requestAnimationFrame(loop);
    };
    if (!this.#rafId) loop();
  }

  #stopLevels() {
    if (this.#rafId) cancelAnimationFrame(this.#rafId);
    this.#rafId = 0;
    this.emit('level', null);
  }

  #releaseStream(stream) {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch { /* 已停止 */ }
    }
  }

  /** 等录音器完全停止后再释放麦克风与音频上下文，避免丢失最后一帧。 */
  #teardown() {
    clearInterval(this.#tickTimer);
    this.#tickTimer = 0;
    this.#stopLevels();
    try { if (this.#sourceNode) this.#sourceNode.disconnect(); } catch { /* 忽略 */ }
    if (this.#audioCtx) {
      try { this.#audioCtx.close(); } catch { /* 忽略 */ }
    }
    this.#sourceNode = null;
    this.#analyser = null;
    this.#audioCtx = null;
    this.#freqData = null;
    this.#releaseStream(this.#stream);
    this.#stream = null;
    if (this.#recorder) {
      this.#recorder.ondataavailable = null;
      this.#recorder.onstop = null;
      this.#recorder.onerror = null;
    }
    this.#recorder = null;
  }
}
