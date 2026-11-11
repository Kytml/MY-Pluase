/** 录音波形：按频谱数据绘制对称柱状图，颜色跟随当前主题。 */
export class Waveform {
  #canvas;
  #ctx;

  constructor(canvas) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.#canvas.clientWidth || 600;
    this.#canvas.width = Math.round(w * dpr);
    this.#canvas.height = Math.round(64 * dpr);
    this.#ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.clear();
  }

  /** @param {Uint8Array|null} freqData null 表示清空（暂停/停止时） */
  draw(freqData) {
    const ctx = this.#ctx;
    const w = this.#canvas.clientWidth || 600;
    const h = 64;
    ctx.clearRect(0, 0, w, h);
    if (!freqData || !freqData.length) return;

    const styles = getComputedStyle(document.documentElement);
    const strong = styles.getPropertyValue('--wave-strong').trim() || '#2f6bff';
    const soft = styles.getPropertyValue('--wave-soft').trim() || '#9db8ff';
    const bars = 44;
    const gap = 3;
    const bw = (w - gap * (bars - 1)) / bars;
    for (let i = 0; i < bars; i++) {
      const v = freqData[Math.floor((i * freqData.length) / bars)] / 255;
      const bh = Math.max(3, Math.min(h, v * h * 1.5));
      const x = i * (bw + gap);
      const y = (h - bh) / 2;
      ctx.fillStyle = v > 0.55 ? strong : soft;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, 2);
      else ctx.rect(x, y, bw, bh);
      ctx.fill();
    }
  }

  clear() {
    this.#ctx.clearRect(0, 0, this.#canvas.clientWidth || 600, 64);
  }
}
