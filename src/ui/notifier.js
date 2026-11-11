/**
 * 通知条：错误/警告常驻（需手动关闭），成功/提示 4.5 秒后自动消失。
 * 新通知会替换旧通知，保证用户看到的永远是最新一条状态。
 */
export class Notifier {
  #box;
  #body;
  #timer = 0;

  constructor(box, body, closeButton) {
    this.#box = box;
    this.#body = body;
    if (closeButton) closeButton.addEventListener('click', () => this.hide());
  }

  show(type, message, { sticky } = {}) {
    clearTimeout(this.#timer);
    this.#box.className = `notice show ${type}`;
    this.#body.textContent = message;
    const stay = sticky === undefined ? type === 'error' || type === 'warn' : sticky;
    if (!stay) this.#timer = setTimeout(() => this.hide(), 4500);
  }

  success(message, options) { this.show('ok', message, options); }
  info(message, options) { this.show('info', message, options); }
  warn(message) { this.show('warn', message, { sticky: true }); }
  error(message) { this.show('error', message, { sticky: true }); }

  hide() {
    clearTimeout(this.#timer);
    this.#box.className = 'notice';
  }

  get visible() { return this.#box.classList.contains('show'); }
}
