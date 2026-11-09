// Three.js sorts transparent objects by renderOrder before depth.
// Draw interaction overlays after the sea; they do not write depth.
export const RENDER_ORDER = Object.freeze({
  backdrop: -1, // sky dome and sun disc
  crack: 1, // sits on an opaque block face, so the sea can never cover it
  seaWater: 1,
  seaFoam: 2,
  overlay: 3, // block highlight and every placement-preview part
})
