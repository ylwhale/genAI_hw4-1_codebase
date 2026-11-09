# Voxel Grove — Implementation Summary

**Scope:** this document covers the later full-game implementation, including its new
shared core modules, tests, and verification. It does not describe development of
the original ten-block static-scene prototype; see `FOUNDATION_LOG.md` for the
recorded scope of that earlier foundation.

Implementation notes for `SPEC.md` and `EXTENSION_MOBS_HEALTH.md`. The tables below preserve the
full-game implementation's test evidence and verification limits. Browser and performance results
are from that phase, not from the later readability cleanup. See `COLLABORATION_LOG.md` for the
development history and subsequent checks; see `README.md` for setup and controls.

## 1. Architecture

`app/` connects the simulation in `game/` to input, DOM UI, and Three.js views. Gameplay modules
have no DOM or Three.js dependencies, so the simulation also runs in Node tests.

### Modules

| Area | Module | Responsibility |
| --- | --- | --- |
| core | `rng.js` | Mulberry32 RNG, coordinate hash, sub-seed derivation (all randomness flows from seed 42) |
| | `events.js` | Synchronous event bus; `GAME_EVENTS` registry; a validating bus throws on unknown names |
| | `geometry.js`, `math.js` | Boxes, ray–box test, look direction, point/cell validation; shared numeric helpers |
| world | `blocks.js` | Block registry (ids, names, solidity, particle colours) and the five hotbar blocks |
| | `world.js` | 32×32×32 `Uint8Array` storage, bounds, collision view (outside = wall), change events |
| | `noise.js`, `generator.js` | Seeded gradient noise + fBm terrain, island falloff, layers, central clearing, trees |
| | `spawn.js` | Safe player spawn search (ring search, headroom, tree clearance, bounded-escape pit test) |
| | `raycast.js` | Amanatides–Woo voxel DDA (exact first block under the crosshair) and line of sight |
| | `physics.js` | Axis-separated AABB collision shared by the player and mobs; anti-tunnelling; unstick |
| | `persistence.js` | Diff-against-generated save/restore, corruption recovery, save-failure signal, cross-tab resync |
| player | `player.js`, `playerController.js`, `health.js` | Player state and look; frame-rate-independent movement and jump; clamped health with death latch |
| interaction | `blockRules.js` | Break and place validation: reach, bounds, floor protection, entity overlap |
| | `actionController.js` | One timed action at a time (~1 s break / place); start, progress, cancel, complete |
| | `tools.js` | Pickaxe / axe / shovel toolbelt (cosmetic) |
| combat | `playerCombat.js` | Nearest mob on the crosshair ray within 3 units and in front of any block; 25 damage, 0.6 s cooldown |
| mobs | `mobTypes.js`, `mob.js` | Mossling / Stoneguard stats (spec values) and entity helpers (damage, death, boxes) |
| | `mobSpawns.js` | Deterministic valid spawns ≥ 9 units from the player spawn (≥ 12 preferred) |
| | `mobAI.js` | State machine: wander → chase (≤ 10) → attack (≤ 1.75 + line of sight); wind-up and 1.5 s cooldown |
| | `mobMovement.js` | Steering, 1-block step hops, knockback, collision through shared physics |
| | `mobManager.js` | Spawning/reset, sub-stepped updates, mob and player separation, damage events, removal |
| game | `simulation.js` | Headless gameplay loop: world + persistence, player, mobs, combat, actions, respawn, reset, resync |
| | `playerActions.js` | Left/right-click decision table and the timed break/place lifecycle |
| | `gameState.js` | Mode machine `title → playing ⇄ paused`, `playing → dead → paused → playing` |
| render | `renderer.js`, `environment.js` | WebGL renderer + hand overlay pass; sky dome, sun, fog, lights + shadows, sea, clouds |
| | `textures.js`, `chunkMesher.js`, `worldView.js` | Procedural pixel atlas; face-culled AO chunk meshes; dirty-chunk rebuilds |
| | `handView.js`, `toolModels.js`, `miningRhythm.js` | First-person arm and tools, pure pose functions, shared mining swing timing |
| | `effects.js` → `particles.js`, `crackOverlay.js`, `placementPreview.js`, `blockHighlight.js`, `blockFaces.js`, `renderOrder.js` | Particle pool, crack stages + dust, construction ghost, outline, shared face helpers, transparent draw order |
| | `mobModels.js`, `mobView.js` | Original voxel monster models and their animation from mob state and events |
| ui | `hud.js`, `screens.js`, `icons.js` | Crosshair, hotbar, hearts, tool, toasts, hints; title/pause/death/fatal screens; isometric icons |
| app | `game.js`, `gameView.js`, `input.js` | Glue (injectable factories for tests); per-frame view sync; keyboard, mouse, pointer lock, free look |

### Runtime flow (one frame)

1. `app/game.js` computes `dt`, clamped to 0.1 s. Selection keys are handled. **Only if the mode is still
   `playing`** it calls `sim.update(dt, controls)`.
2. `sim.update` applies mouse look, then runs physics and mob AI in sub-steps of ≤ 1/120 s. Mob strikes
   damage the player, and death emits `player:died`. It then resolves clicks and timed actions through
   `playerActions` and returns the crosshair targets.
3. `app/gameView.js` reads simulation state and draws the frame: camera at the player's eye (or the
   title orbit), dirty chunks remeshed, mobs, hand pose, and crack, preview and outline from the pure
   `interactionVisuals()`. Event listeners add one-shot effects (debris, puffs, swings, hurt tilt).
4. The HUD updates from events (health, slot, tool, toasts) and from per-frame values it caches (attack
   cooldown, mob-target crosshair).

Views read gameplay state and subscribe to the events defined in `core/events.js`.

## 2. Requirement coverage

### SPEC.md functional checks

| # | Check | Implementation | Evidence |
| --- | --- | --- | --- |
| 1 | Launches without a blank screen | Title screen over an orbiting island view; a WebGL failure shows a fatal message instead of a blank page | Browser: title rendered, no console errors; `ui.test.js` fatal-screen tests |
| 2 | Move and look around | WASD acceleration controller; mouse look via pointer lock or the free-look fallback | `integration`, `playerController`, `app` tests; browser: W walked ~3 u in 0.7 s; free look entered |
| 3 | Jump and land | Jump only when grounded; gravity 25 u/s² | `integration`, `physics`, `playerController` tests; browser: +0.94 u, landed |
| 4 | Cannot walk through blocks | Axis-separated AABB collision, sub-stepped, never tunnels | `physics`, `integration` (wall) tests |
| 5 | Remove a nearby block | Left press → 1 s break with crack overlay → removed + saved | `integration`, `playerActions` tests; browser: block removed, save written |
| 6 | Place a nearby block | Right press → 1 s construction preview → placed + saved | `integration` tests; browser: stone and wood placed |
| 7 | Hotbar changes block | Keys 1–5 and wheel; highlighted slot and name label | `integration`, `ui` tests; browser: label changed to STONE/WOOD |
| 8 | No placing inside self | Entity overlap check against the player and mob boxes | `blockRules`, `integration` tests |
| 9 | No editing beyond reach | Ray distance ≤ 6 and eye-to-box distance ≤ 6 | `blockRules` boundary tests (5.99 / 6.01), `integration` |
| 10 | Edits persist after refresh | Diff saved on every edit; restored on load; cross-tab resync | `persistence`, `integration`, `app` tests; browser: reload restored edits (`status: loaded`) |
| 11 | Reset restores original world | Two-step Reset World clears the save and regenerates seed 42 | `integration` test (byte-identical); browser: diff 0 after reset, key removed |
| 12 | Production build | Vite build | `npm run build` succeeded (667 kB JS / 182 kB gzip) |

Also implemented: 32×32 bounds (0–31) with invisible edge walls and an unbreakable floor at y = 0,
deterministic generation, a safe spawn, a context menu blocked during play (mouse and keyboard), no
gameplay while a menu is open, and renderer resize.

### EXTENSION_MOBS_HEALTH.md acceptance tests

| # | Acceptance test | Evidence | Result |
| --- | --- | --- | --- |
| 1 | Both enemy types render correctly | Browser screenshots of both models (front and back); `mobView` tests (extents within the hit box, poses, flash, death) | Pass (visual check by the AI, not by a human) |
| 2 | Four enemies spawn in valid positions | `integration`, `mobSpawns` tests: 3 Mosslings + 1 Stoneguard, not colliding, ≥ 9 u from spawn; browser: 13–19 u away | Pass |
| 3 | Enemies wander when the player is far | `mobAI`, `mobManager` tests; browser: all four in `wander` at start | Pass |
| 4 | Enemies chase when the player approaches | `mobAI` tests (≤ 10 u); browser: mobs closed in and attacked | Pass |
| 5 | Attack only within range and cooldown | `mobAI` tests (1.74 vs 1.76 u, 1.49 vs 1.5 s); `integration` cadence test | Pass |
| 6 | Enemies do not pass through terrain | `mobMovement` soak tests (no frame inside a block), ledge-climb regression | Pass |
| 7 | Health decreases correctly | `integration` (10 per Mossling strike), `health` tests | Pass |
| 8 | Health never negative | `health` clamp tests; `integration` death loop | Pass |
| 9 | Player can damage and defeat enemies | `integration`, `playerCombat` tests; browser: 25 → kill, burst + toast | Pass |
| 10 | Attacks cannot pass through blocks | `playerCombat`, `integration` (wall between) tests; mob line of sight in `mobAI` | Pass |
| 11 | Death screen at zero health | `app` tests (death → lock released → death screen); browser: overlay shown | Pass |
| 12 | Respawn restores health and resets enemies | `integration`, `app` tests; browser: 100 HP, four fresh mobs | Pass |
| 13 | World edits survive respawn | `integration` test; browser: edits kept after respawn and reload | Pass |
| 14 | Block interaction still works | Full sandbox suite + browser checks above | Pass |
| 15 | Menus and controls still work | `app`, `input`, `ui` tests (pause, resume, Q, 1–5, Esc) | Pass with fake DOM and scripted browser. **Real pointer lock was not verified**: the embedded browser refuses it. |
| 16 | `npm run build` succeeds | Build output above | Pass |

Gameplay values are centralized in `config.js` and `mobs/mobTypes.js`. The simulation runs only in
`playing` mode; menus, death, and hidden tabs pause it.

### Assignment Stage 3A (first person)

The hand and tool use a separate overlay pass. Q cycles tools independently of the hotbar.
Mining combines four swings, eight crack stages, chips, and dust; placement uses a rising block
preview and completion particles. Both actions take about one second. Invalid targets, attacks,
pause, death, respawn, and reset cancel active actions and clear their overlays.

## 3. Testing evidence

`npm test` (Node built-in runner): **743 tests, 743 pass, 0 fail**, in 38 files. Largest suites: ui 63,
input 48, playerController 38, playerCombat 38, mobView 38, mobAI 33, handView 32, mobManager 31,
persistence 29, blockRules 28, integration 22, app 21. The integration and app suites drive the real
simulation, and for app, the real glue with a fake DOM: mining, placing, reach, persistence across
reloads, reset, corruption, mob cadence, combat, death, respawn, two-tab resync, pointer-lock flows,
the Escape regression, the free-look fallback, and storage events. The review agents mutation-checked
each regression test added during fixing: with the fix reverted, the test failed.

Browser verification happened in the Claude desktop app's embedded Chromium against `npm run dev`;
details are in `COLLABORATION_LOG.md`. The embedded browser rejects pointer lock (`WrongDocumentError`),
so gameplay ran through the in-game "Play without mouse capture" fallback, the dev-only `forcePlay`
hook, and synthetic input. When the pane was in the background, requestAnimationFrame was suspended,
so some checks drove the simulation directly and captured frames with screenshots.

## 4. Significant engineering decisions

- **Corner-based block coordinates.** This replaces the foundation's centre-based convention; with it,
  `Math.floor` maps any point to its block.
- **Diff-based persistence** against the regenerated seed-42 terrain. Saves stay tiny, and reset is
  simply "clear the diff". Any change to the generator invalidates old saves, which the save header
  version guards against.
- **Timed interactions.** A left press starts a break; release does not cancel it, so a click works.
  Holding the button continues mining only if the press began as mining. A placement is fixed to its
  cell and re-validated every frame and on completion.
- **Click arbitration.** A mob within 3 units wins (the click is swallowed during the cooldown). A mob
  further along the ray hides the block behind it, so the click becomes a miss swing. Otherwise the
  click mines.
- **Mob attack wind-up** (0.35 s, inside the 1.5 s cooldown). Strikes land only if the target is still
  in range and line of sight, which makes attacks readable and fair while keeping the spec's cadence.
- **Pointer lock drives the mode machine.** Play and resume happen only once the mouse is captured, and
  losing the lock pauses. Death releases the lock; respawn waits in `paused` for a new lock. If the lock
  is refused, the player can play with free look instead.
- **Semi-fixed timestep** (frames clamped to 0.1 s, sub-steps ≤ 1/120 s) in the simulation. The inner
  modules also sub-step defensively.
- **No new dependencies.** Testing uses Node's built-in runner, and every asset is procedural.
- **Layer-0 floor is unbreakable** and the world edges are walls, so the player cannot leave the island.

## 5. Maintenance

- Keep gameplay independent of rendering. Views treat simulation objects as read-only by convention;
  that boundary is not enforced by the language.
- Shared numeric and geometry helpers belong in `core/`; spawn checks use the same column rules for
  players and mobs.
- Event names are registered in `core/events.js`; unknown names are rejected.
- UI and model files are the largest areas to navigate (`style.css`, `hud.js`, `mobModels.js`).
- Changes to rendering helpers may require test updates. Retain checks for winding, occlusion,
  animation timing, and disposal when changing their implementation.

The implementation-phase complexity measurements and refactoring history remain in the collaboration log.

## 6. Performance

Implementation-phase measurements in embedded Chromium at 1280×720, DPR 2, with the pane visible:

- Median frame time is 8.3 ms and p95 is 9.9 ms, vsync-bound at about 120 fps, with all four mobs active.
- About 3.4 k triangles are drawn in the hand pass. The world uses 16 chunk meshes, one shared
  material, and a 2048 shadow map.
- One simulation sub-step takes about 0.02 ms.
- A full rebuild of all chunks takes a few ms; an edit rebuilds only the 1–4 affected chunks.

Limitations:
- There is no per-frame chunk rebuild budget.
- Shadows are recomputed every frame.
- Saves are written synchronously on every edit. This is fine for a 32×32 world.
- The bundle is 667 kB, mostly Three.js, and triggers Vite's 500 kB advisory.

## 7. Incomplete or unverified items

- **Real pointer-lock gameplay and mouse-look feel** were not checked by a human, and pointer lock could
  not be granted in the automated browser. The lock flows are covered by fake-DOM tests.
- **Visual quality** was judged only by the AI's own screenshot review. No human playtest happened in
  this phase.
- **Cross-browser behaviour** (Firefox, Safari) and low-end GPU performance were not tested; the target
  is desktop Chromium.
- **First-use shader compile stutter** was not measured (it needs a GPU). As a mitigation, shaders are
  precompiled at start-up.
- Monster state is not persisted across reloads, which the extension allows.
