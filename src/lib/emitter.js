/** 极简事件发射器：core 模块通过它向 UI 广播，避免直接操作 DOM。 */
export class Emitter {
  #handlers = new Map();

  /** 订阅事件，返回取消订阅函数。 */
  on(type, handler) {
    if (typeof handler !== 'function') throw new TypeError('handler 必须是函数');
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(handler);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    this.#handlers.get(type)?.delete(handler);
  }

  emit(type, payload) {
    for (const handler of [...(this.#handlers.get(type) || [])]) {
      try {
        handler(payload);
      } catch (e) {
        // 单个监听器出错不能影响录音主流程
        console.error(`[emitter] ${type} 监听器出错`, e);
      }
    }
  }

  removeAllListeners() {
    this.#handlers.clear();
  }
}
