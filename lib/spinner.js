'use strict';

const SPINNER_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];

class Spinner {
  constructor() {
    this._isTTY = !!process.stdout.isTTY;
    this._frame = 0;
    this._timer = null;
    this._text = '';
  }

  update(text) {
    this._text = text;
    if (!this._isTTY) return;
    if (!this._timer) {
      this._timer = setInterval(() => {
        this._frame = (this._frame + 1) % SPINNER_FRAMES.length;
        this._render();
      }, 80);
    }
    this._render();
  }

  _render() {
    process.stdout.write(`\x1b[2K\r  ${SPINNER_FRAMES[this._frame]} ${this._text}`);
  }

  log(text) {
    if (this._isTTY) {
      process.stdout.write(`\x1b[2K\r${text}\n`);
      if (this._text) this._render();
    } else {
      process.stdout.write(`${text}\n`);
    }
  }

  done(text) {
    this._stop();
    if (this._isTTY) {
      process.stdout.write(`\x1b[2K\r  \x1b[32m\u2713\x1b[0m ${text}\n`);
    } else {
      process.stdout.write(`  ${text}\n`);
    }
    this._text = '';
  }

  _stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

module.exports = { Spinner };
