# Voxel Grove

A Minecraft-inspired sandbox for desktop browsers. Explore a 32 × 32 island, mine and place
blocks, and fight moss and stone monsters. Built with JavaScript, Three.js, and Vite;
textures and models are generated in code.

Created for the University of Chicago Generative AI course, HW 4-1, collaborative track.
The project author reports implementing the initial static-scene foundation manually.
The subsequent full-game implementation was completed with Claude Code; its workflow and
validation limitations are recorded in [COLLABORATION_LOG.md](COLLABORATION_LOG.md).
[FOUNDATION_LOG.md](FOUNDATION_LOG.md) describes the original prototype's technical scope.
Those original prototype modules were subsequently replaced and are not in this bundle.

## Requirements

- Node.js 20.19 or later in the 20.x line, or Node.js 22.12 or newer; npm
- A desktop Chromium browser with WebGL 2

## Run locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite, usually [localhost:5173](http://localhost:5173/), and click **Play**.
Press **Esc** to release the mouse and pause. If mouse capture is unavailable, choose
**Play without mouse capture** and move the mouse over the game to look around.

To build and preview the production version:

```bash
npm run build
npm run preview
```

## Controls

| Input | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look around |
| Space | Jump while grounded |
| Left click | Attack a monster in reach, otherwise mine; hold to keep mining |
| Right click | Place the selected block |
| 1–5 / mouse wheel | Select grass, dirt, stone, wood, or leaves |
| Q | Cycle the cosmetic tool: pickaxe, axe, shovel |
| Esc | Pause and release the mouse |

The browser context menu is disabled over the game.

## Gameplay

- The island is generated from seed 42, with hills, trees, and a central spawn clearing.
- Mining and placement each take about one second and require a target within six units.
  Placement cannot overlap the player or a monster.
- Three Mosslings and one Stoneguard wander, chase, and attack. Melee reach is three units;
  blocks stop attacks. The player has 100 HP and no health regeneration.
- **Respawn** restores health and resets monsters while keeping world edits.
- Edits save automatically to `localStorage`. **Reset World**, on the title and pause menus,
  clears edits and regenerates the island after confirmation.

## Tests

```bash
npm test
```

Uses Node's built-in test runner. The suites cover world generation, physics, persistence,
interactions, combat, mob behaviour, rendering helpers, UI/input, and the gameplay simulation.
Browser wiring is tested with a fake DOM; these checks do not replace a browser playtest.

## Code layout

```text
src/
  main.js       startup and storage access
  config.js     gameplay constants
  core/         random numbers, events, geometry, math
  world/        storage, generation, spawn, raycasting, physics, saves
  player/       player state, movement, health
  interaction/  tools and timed block actions
  combat/       melee targeting and cooldown
  mobs/         entities, spawning, behaviour, movement
  game/         simulation, action resolution, game modes
  render/       Three.js views, textures, meshes, effects
  ui/           HUD, menus, icons
  app/          input, frame loop, simulation/view wiring
test/           unit and integration tests
```

Gameplay logic has no DOM or Three.js dependencies. Views read state and subscribe to events.
See [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) for module interfaces, requirement
coverage, and implementation-phase test evidence.

## Limitations

- The world is fixed at 32 × 32 × 32 blocks, with an unbreakable floor and invisible edge walls.
  The surrounding sea is decorative. There is no water physics, day/night cycle, or cave lighting.
- Tools are cosmetic; every block takes the same time to mine. Leaves are opaque and solid.
- Monster positions and health are not saved.
- The production build reports Vite's chunk-size advisory; Three.js accounts for most of the bundle.
- Previous browser checks used embedded Chromium, which refused pointer lock. Real mouse capture,
  mouse-look feel, and long human play sessions remain unverified; see the collaboration log.
- Development builds expose `window.__voxelGrove` for debugging. Production builds do not.
