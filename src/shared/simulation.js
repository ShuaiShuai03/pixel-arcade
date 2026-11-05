// Keep physics and input sampling independent of the display's refresh rate.
export class SimulationClock {
  constructor() {
    this.remaining = 0;
  }

  reset() {
    this.remaining = 0;
  }

  advance(elapsed, update) {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return;
    const step = 1 / 120;
    this.remaining += Math.min(elapsed, 0.1);
    while (this.remaining + 1e-10 >= step) {
      this.remaining = Math.max(0, this.remaining - step);
      if (update(step) === false) {
        this.reset();
        break;
      }
    }
  }
}
