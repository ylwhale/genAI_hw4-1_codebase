# Voxel Grove — Foundation Technical Summary

## Scope and attribution

In this document, **original foundation** means only the initial ten-block static
Three.js prototype. It does not refer to shared utilities or other modules added
later for the complete game. The project author reports implementing this original
prototype manually. Its source files were subsequently replaced and are not included
in the current archive, so their authorship cannot be independently verified here.

The details below concern only that original prototype: its intended structure,
design, and recorded checks. They do not describe the later full-game implementation
or attribute its current source modules to the original prototype.

## Prototype scope

The foundation contained ten fixed voxel blocks, a fixed elevated camera, basic
lighting, and a resizing render loop. It did not include player movement, physics,
terrain generation, block interaction, persistence, combat, or a gameplay interface.
The full-game requirements appear in `SPEC.md`.

## Original module structure

| Original file | Responsibility |
| --- | --- |
| `src/world.js` | Define a ten-block scene with grass, dirt, and stone cubes |
| `src/player.js` | Define camera position, eye height, and viewing target |
| `src/renderer.js` | Set up the Three.js scene, camera, lighting, cube meshes, rendering, and resize handling |
| `src/main.js` | Initialize the world, player configuration, and renderer |
| `src/style.css` | Provide full-window page and canvas layout |
| `index.html` | Provide the page title and application entry point |

The original `world.js`, `player.js`, and `renderer.js` were superseded as the game was
reorganized. The names of some later modules overlap, but their implementations and
interfaces should not be assumed to match the initial prototype.

## Design decisions

- World blocks were plain data objects independent of the rendering module.
- Blocks had integer coordinates at the centers of unit cubes, with Y pointing up.
- The scene contained a 3 × 3 base and one elevated block, with grass, dirt, and
  stone as the supported block types.
- The camera setup used position `(5, 3, 7)`, eye height `1.6`, and viewing target
  `(0, 0.5, 0)`; the resulting camera eye was `(5, 4.6, 7)`.
- The renderer used shared cube geometry, one material per block type, ambient and
  directional lights, and an animation loop.
- The original prototype relied on the existing Three.js and Vite dependencies.

## Recorded validation of the original prototype

The earlier technical notes reported the following checks. These are historical
results; they have not been rerun against the original prototype because its modules
are not included in the current bundle.

- A Node import check returned ten blocks with unique integer coordinates,
  supported block types, and independent data objects on subsequent calls.
- A Node configuration check returned finite camera coordinates and independent
  player configurations.
- JavaScript syntax and module-import checks passed for the original renderer,
  world, player, and startup modules.
- The original `npm run build` succeeded, with a bundle-size advisory for
  the JavaScript output.
- Recorded browser checks showed a visible scene with distinct block colors,
  lighting, and correct resize behavior at 653 × 844, 1200 × 700, and 400 × 600.
  These checks did not constitute cross-browser, gameplay, or performance tests.

## Relationship to the full game

The later implementation replaced the static scene with a deterministic 32 × 32
world, interactive player controls, physics, block editing, saves, enemies, combat,
and UI. It also changed the block-coordinate convention from cube centers to
cube corners and reorganized source modules under focused directories.

The later implementation's authorship, workflow, testing, and limitations are
recorded separately in `COLLABORATION_LOG.md` and `IMPLEMENTATION_SUMMARY.md`.
