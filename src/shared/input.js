export class InputState {
  constructor() {
    this.sources = new Map();
    this.presses = new Set();
    this.pulses = new Set();
    this.pointer = { x: -1, y: -1, down: false, clicked: false, id: null };
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
  pulse(code) {
    this.pulses.add(code);
    this.presses.add(code);
  }
  held = (...codes) =>
    codes.some((code) => this.pulses.has(code) || [...this.sources.values()].includes(code));
  pressed = (...codes) => codes.some((code) => this.presses.has(code));
  flush() {
    this.presses.clear();
    this.pulses.clear();
    this.pointer.clicked = false;
  }
  clear() {
    this.sources.clear();
    this.flush();
    this.pointer.down = false;
    this.pointer.id = null;
    this.pointer.x = -1;
    this.pointer.y = -1;
  }
}
