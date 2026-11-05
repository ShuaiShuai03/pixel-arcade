export class ArcadeAudio {
  constructor(enabled = false) {
    this.enabled = enabled;
    this.context = null;
    this.last = 0;
  }
  unlock() {
    if (!this.enabled) return;
    try {
      this.context ??= new (window.AudioContext || window.webkitAudioContext)();
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch {
      /* Audio is optional on restricted browsers. */
    }
  }
  setEnabled(value) {
    this.enabled = value;
    if (value) this.unlock();
    else if (this.context) void this.context.suspend().catch(() => {});
  }
  play(name) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const ctx = this.context,
      now = ctx.currentTime;
    if (now - this.last < 0.025) return;
    this.last = now;
    const tones = {
        coin: [880, 1320, 0.12],
        hit: [120, 45, 0.15],
        shoot: [550, 110, 0.07],
        win: [660, 1320, 0.3],
        lose: [220, 65, 0.4],
        move: [330, 440, 0.06],
      },
      [a, b, length] = tones[name] || tones.move;
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(a, now);
    oscillator.frequency.exponentialRampToValueAtTime(b, now + length);
    gain.gain.setValueAtTime(0.035, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + length);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
}
