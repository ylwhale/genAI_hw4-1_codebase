export const MAX_HEALTH = 100;

export function createHealth() {
  return { max: MAX_HEALTH, current: MAX_HEALTH, get dead() { return this.current === 0; } };
}

export function damagePlayer(health, amount, active = true) {
  if (!active || health.dead || !Number.isFinite(amount) || amount <= 0) return { amount: 0, killed: false };
  const previous = health.current;
  health.current = Math.max(0, Math.min(health.max, health.current - amount));
  return { amount: previous - health.current, killed: health.dead };
}

export function restoreHealth(health) { health.current = health.max; }
