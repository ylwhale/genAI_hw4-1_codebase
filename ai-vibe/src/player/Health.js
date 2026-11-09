/** Player health: clamped to [0, max], no regeneration. */
export class Health {
  constructor(max = 100) {
    this.max = max;
    this.current = max;
  }

  /**
   * Removes `amount` health (never below 0). Returns the health actually
   * lost, which is 0 for invalid amounts or when already dead.
   */
  damage(amount) {
    if (!(amount > 0) || !Number.isFinite(amount) || this.current <= 0) return 0;
    const applied = Math.min(this.current, amount);
    this.current -= applied;
    return applied;
  }

  reset() {
    this.current = this.max;
  }

  get dead() {
    return this.current <= 0;
  }

  get fraction() {
    return this.current / this.max;
  }
}
