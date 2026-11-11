/**
 * 录音计时器：只累计"实际录音中"的时间，暂停时段不计入。
 * 基于时间戳差值而非 setInterval 计数，因此后台标签页降频不会产生计时漂移。
 * 时钟源可注入，便于单元测试。
 */

const defaultNow = () =>
  (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

export class ElapsedClock {
  #now;
  #accumulated = 0;
  #segmentStart = 0;
  #running = false;

  constructor(now = defaultNow) {
    if (typeof now !== 'function') throw new TypeError('now 必须是函数');
    this.#now = now;
  }

  /** 开始（或从暂停恢复）计时；重复调用幂等。 */
  start() {
    if (this.#running) return;
    this.#segmentStart = this.#now();
    this.#running = true;
  }

  resume() {
    this.start();
  }

  /** 暂停并返回累计毫秒；未在计时则返回当前累计值。 */
  pause() {
    if (this.#running) {
      this.#accumulated += this.#now() - this.#segmentStart;
      this.#running = false;
    }
    return this.#accumulated;
  }

  /** 停止计时并返回累计毫秒，保留结果供读取。 */
  stop() {
    return this.pause();
  }

  reset() {
    this.#accumulated = 0;
    this.#segmentStart = 0;
    this.#running = false;
  }

  /** 当前累计毫秒（含正在进行的计时段）。 */
  get elapsed() {
    return this.#accumulated + (this.#running ? this.#now() - this.#segmentStart : 0);
  }

  get running() {
    return this.#running;
  }
}
