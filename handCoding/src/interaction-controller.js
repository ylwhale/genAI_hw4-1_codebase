import { validateEdit, editBlock } from './interactions.js';

export const INTERACTION_DURATION = 1;
const sameCell = (a, b) => a && b && a.x === b.x && a.y === b.y && a.z === b.z;

export function createInteractionController({ world, player, canPlace = () => true, onStart = () => {}, onProgress = () => {}, onCancel = () => {}, onComplete = () => {} }) {
  let active = null;
  function cancel(reason = 'Interrupted') {
    if (!active) return false;
    const operation = active;
    active = null;
    onCancel(operation, reason);
    return true;
  }
  return {
    get active() { return active; },
    start(target, action, selected = 1) {
      if (active) return { ok: false, reason: 'Already working' };
      const result = validateEdit(world, player, target, action, selected);
      if (!result.ok) return result;
      if (action === 'place' && !canPlace(result)) return { ok: false, reason: 'A creature is in the way' };
      const source = { ...target, normal: target.normal ? { ...target.normal } : null };
      if (target.point) source.point = { ...target.point };
      active = { action, selected, source, destination: result, sourceType: world.get(source.x, source.y, source.z), elapsed: 0, progress: 0 };
      onStart(active);
      return { ok: true };
    },
    cancel,
    update(dt, target, playing = true) {
      if (!active) return;
      if (!playing) { cancel('Interrupted'); return; }
      if (!sameCell(target, active.source)) { cancel('Target changed'); return; }
      if (world.get(active.source.x, active.source.y, active.source.z) !== active.sourceType) { cancel('Block changed'); return; }
      const valid = validateEdit(world, player, target, active.action, active.selected);
      if (!valid.ok) { cancel(valid.reason); return; }
      if (active.action === 'place' && !canPlace(valid)) { cancel('A creature is in the way'); return; }
      if (!sameCell(valid, active.destination)) { cancel('Placement face changed'); return; }
      if (!Number.isFinite(dt) || dt < 0) return;
      active.elapsed = Math.min(INTERACTION_DURATION, active.elapsed + dt);
      active.progress = active.elapsed / INTERACTION_DURATION;
      onProgress(active);
      if (active.progress < 1 - 1e-9) return;
      const operation = active;
      const result = editBlock(world, player, target, operation.action, operation.selected);
      if (!result.ok) { cancel(result.reason); return; }
      active = null;
      onComplete(result, operation);
    },
  };
}
