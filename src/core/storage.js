/**
 * 录音仓储：优先使用 IndexedDB 持久化（含音频 Blob），不可用时降级为内存存储。
 * 内存降级会明确标记 persistent=false，由 UI 告知用户"关闭页面即丢失"。
 */

const STORE_NAME = 'recordings';
const DEFAULT_DB = 'voice-recorder';

export class RecordingStore {
  #idb;
  #dbName;
  #db = null;
  #memory = null;
  #persistent = false;
  #initPromise = null;

  /** @param {{indexedDB?:IDBFactory, dbName?:string}} options 可注入 indexedDB 便于测试 */
  constructor({ indexedDB: idb = globalThis.indexedDB, dbName = DEFAULT_DB } = {}) {
    this.#idb = idb;
    this.#dbName = dbName;
  }

  get persistent() { return this.#persistent; }

  /** 幂等初始化。 */
  async init() {
    if (!this.#initPromise) this.#initPromise = this.#open();
    return this.#initPromise;
  }

  async #open() {
    if (!this.#idb) {
      this.#memory = new Map();
      this.#persistent = false;
      return { persistent: false, error: '当前环境不支持 IndexedDB' };
    }
    try {
      this.#db = await new Promise((resolve, reject) => {
        const req = this.#idb.open(this.#dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('createdAt', 'createdAt');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('打开数据库失败'));
        req.onblocked = () => reject(new Error('数据库被其他标签页阻塞，请关闭旧标签页后刷新'));
      });
      this.#db.onversionchange = () => {
        try { this.#db.close(); } catch { /* 忽略 */ }
        this.#db = null;
      };
      this.#persistent = true;
      return { persistent: true };
    } catch (e) {
      this.#memory = new Map();
      this.#persistent = false;
      return { persistent: false, error: (e && e.message) || '数据库不可用' };
    }
  }

  #run(mode, fn) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = this.#db.transaction(STORE_NAME, mode);
      } catch (e) {
        reject(e);
        return;
      }
      const req = fn(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error || new Error('数据库事务失败'));
      tx.onabort = () => reject(tx.error || new Error('数据库事务中止'));
    });
  }

  /** 全部录音，按录制时间倒序；自动剔除缺字段的脏数据。 */
  async list() {
    await this.init();
    const all = this.#persistent
      ? await this.#run('readonly', (s) => s.getAll())
      : [...this.#memory.values()];
    return (all || [])
      .filter((r) => r && r.id && r.blob && Number.isFinite(r.createdAt))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** 新增或更新录音。内存模式下返回 {persistent:false} 提示未持久化。 */
  async save(rec) {
    if (!rec || typeof rec.id !== 'string' || !rec.id) throw new TypeError('录音记录缺少有效 id');
    if (!rec.blob || typeof rec.blob.size !== 'number') throw new TypeError('录音记录缺少音频数据');
    await this.init();
    if (!this.#persistent) {
      this.#memory.set(rec.id, rec);
      return { persistent: false };
    }
    await this.#run('readwrite', (s) => s.put(rec));
    return { persistent: true };
  }

  async remove(id) {
    await this.init();
    if (!this.#persistent) {
      this.#memory.delete(id);
      return { persistent: false };
    }
    await this.#run('readwrite', (s) => s.delete(id));
    return { persistent: true };
  }
}

/** 存储用量估计；不支持时返回 null。 */
export async function estimateStorage() {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      return { usage: usage || 0, quota: quota || 0 };
    }
  } catch { /* 忽略 */ }
  return null;
}
