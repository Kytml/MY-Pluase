/**
 * 多标签页同步：一个标签页保存/删除/重命名后，其他打开的同款页面自动刷新列表，
 * 避免"两个标签页列表不一致、互相覆盖"的问题。基于 BroadcastChannel，不支持时静默降级。
 */
export class TabSync {
  #channel = null;

  constructor(onMessage, name = 'voice-recorder:sync') {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      this.#channel = new BroadcastChannel(name);
      this.#channel.onmessage = (e) => {
        if (e.data && e.data.type && typeof onMessage === 'function') onMessage(e.data);
      };
    } catch {
      this.#channel = null;
    }
  }

  get supported() { return !!this.#channel; }

  notify(type = 'changed') {
    try {
      if (this.#channel) this.#channel.postMessage({ type, at: Date.now() });
    } catch { /* 忽略 */ }
  }

  close() {
    try { if (this.#channel) this.#channel.close(); } catch { /* 忽略 */ }
    this.#channel = null;
  }
}
