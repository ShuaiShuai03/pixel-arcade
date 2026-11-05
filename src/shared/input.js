export class InputState {
  constructor() {
    this.sources = new Map();
    this.presses = new Set();
    this.pointer = { x: -1, y: -1, down: false, clicked: false };
  }
  down(code, source = code) {
    if (!this.sources.has(source)) {
      if (!this.held(code)) this.presses.add(code);
      this.sources.set(source, code);
    }
  }
  up(source) {
    this.sources.delete(source);
  }
  held = (...codes) => codes.some((code) => [...this.sources.values()].includes(code));
  pressed = (...codes) => codes.some((code) => this.presses.has(code));
  flush() {
    this.presses.clear();
    this.pointer.clicked = false;
  }
  clear() {
    this.sources.clear();
    this.flush();
    this.pointer.down = false;
  }
}
