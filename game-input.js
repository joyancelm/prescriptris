// Latest-held direction wins; releasing it resumes the remaining held control.
// Keyboard and pointer controls share the same repeat cadence.
export class HorizontalInput {
  constructor() { this.clear(); }
  clear() {
    this.held = new Map();
    this.active = null;
    this.nextRepeat = 0;
  }
  press(id, direction, now) {
    this.held.delete(id);
    this.held.set(id, direction);
    this.active = id;
    this.nextRepeat = now + 170;
  }
  release(id, now) {
    this.held.delete(id);
    if (this.active !== id) return;
    this.active = [...this.held.keys()].at(-1) ?? null;
    this.nextRepeat = now + 65;
  }
  next(now) {
    if (this.active === null || now < this.nextRepeat) return 0;
    this.nextRepeat = now + 65;
    return this.held.get(this.active);
  }
}
