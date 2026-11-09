# Voxel Grove — Implementation Summary

Voxel Grove is a Minecraft-inspired voxel sandbox built from scratch with
JavaScript ES modules, Three.js r186 and Vite 8, following `SPEC.md`. The
world is a 32 × 32 floating island generated from seed 42, floating above a
sea of clouds. This file covers the architecture, features, key decisions,
the tests that were actually run, and known limitations.

> **Three development phases.** Sections 1–5 describe the base game as first
> delivered. Section 6 describes the **hand/tools extension**: a first-person
> hand, three tools, and animated (about 1 second) mining and building. It
> replaced the base game's instant break/place and its "held block" view
> model. Section 7 describes the **mobs, combat and health extension**
> (`EXTENSION_MOBS_HEALTH.md`). Where earlier sections describe behaviour
> that a later phase changed, the later section is the current behaviour.

## 1. Architecture

The code is split into small modules with one job each. Logic modules (world,
physics, raycast, rules, persistence) have no DOM or rendering dependencies,
so they are unit-tested in Node. Rendering and UI modules sit on top of them.

```
main.js ── Game.js (orchestrator: renderer, frame loop, state machine)
             │
             ├── world/        blocks.js · terrain.js · World.js · mesher.js
             ├── player/       Player.js           (AABB physics)
             ├── interaction/  raycast.js · BlockInteraction.js (edit rules)
             ├── persistence/  storage.js          (localStorage diff)
             ├── render/       textures.js · WorldRenderer.js · Environment.js · effects.js
             ├── input/        Input.js            (raw keyboard/mouse state)
             └── ui/           UI.js               (menus, hotbar, toasts)
```

- **`World`** stores blocks in a flat `Uint8Array` (`x + z·32 + y·32·32`,
  32 × 48 × 32). It also keeps a pristine copy of the generated terrain (`base`).
  That copy makes saving a diff and resetting cheap. The `World` emits
  `block`/`reload` events, which the renderer listens to.
- **`terrain.js`** is a deterministic generator: seeded Perlin-style fBm, two
  landmark hills, a rim falloff that gives an island silhouette, a flattened
  spawn meadow, stone on high and steep ground, a dirt layer over stone, and up
  to 11 trees placed with a seeded RNG and minimum spacing.
- **`mesher.js`** builds geometry for any voxel accessor. It does face
  culling, Minecraft-style per-vertex ambient occlusion with quad-diagonal
  flipping, random quarter-turns on top textures, a subtle per-block tint, and
  groups faces by material. The same mesher builds the world chunks, the
  decorative rock base and the distant islets.
- **`WorldRenderer`** splits the world into four 16 × 16 chunk meshes. An edit
  marks dirty only the chunks it touches plus neighbours whose faces or AO
  change, and only those are rebuilt on the next frame.
- **`Player`** has a 0.6 × 1.8 × 0.6 AABB. It runs at a fixed 120 Hz step
  with per-axis sweep-and-clamp collision. Rendering interpolates between
  physics steps for smooth motion.
- **`raycast.js`** uses an Amanatides–Woo voxel DDA, so the targeted block is
  exactly the first block the camera ray enters.
  **`BlockInteraction`** applies every edit rule: reach, bounds, overlap with
  the player, and valid ids. It returns `{ok}` or `{ok:false, reason}` and
  never changes the world when an edit is rejected.
- **`Game`** owns the state machine `title → playing ⇄ paused`. Gameplay
  input is ignored unless the state is `playing`, which is entered only when
  pointer lock is granted.

## 2. Implemented features (mapped to SPEC.md)

| Spec area | Implementation |
| --- | --- |
| 32 × 32 world, seed 42, deterministic | `WORLD.SIZE = 32`, `SEED = 42`; generation uses only seeded PRNG/noise, and reset copies the stored generated terrain back |
| Hills, grass, dirt, stone, trees | Noise + landmark hills (relief ≈ 13 blocks), grass over 2–4 dirt over stone, stone peaks and cliffs, wood trunks with leaf canopies |
| Safe spawn | `findSpawnPoint()` spirals out from the centre to a natural grass column with open sky, skips leaves and wood, works on the edited world, and runs a collision check (`unstick`) |
| Five blocks | Grass, Dirt, Stone, Wood, Leaves; hotbar slots 1–5 |
| Original visuals | Every texture is procedural 16 × 16 pixel art painted on canvases; hotbar icons are isometric renders of those textures; no external assets |
| Lighting, sky, atmosphere | Gradient sky shader with a sun disc and glow, warm sun with soft PCF shadows, hemisphere sky/ground light, distance fog, voxel clouds above and a cloud sea below (both fading with distance), six floating islets, drifting glowing motes, baked AO, vignette |
| Controls | WASD move · mouse look (pointer lock) · Space jump · left click break · right click place · 1–5 select (mouse wheel also cycles) · Esc releases the mouse and pauses · *(extension: Q cycles tools; break and place take about 1 s, see §6)* |
| Crosshair, hotbar | CSS crosshair with `mix-blend-mode: difference`; five-slot hotbar where the selected slot is raised, outlined in gold and glowing; block name pops up when the slot changes |
| 6-unit reach from the camera | The ray starts at the camera position and stops at distance 6; nothing is targeted or editable beyond that, and a forged far target is rejected too |
| No placing inside the player | `Player.intersectsBlock` uses exactly the collision code's cell range |
| No editing outside bounds | `inBounds` checks in `World.setBlock` and `BlockInteraction` |
| Context menu disabled | `contextmenu` is prevented on the whole document |
| Gravity, jumping, collision | Gravity 28 b/s², jump ≈ 1.3 blocks only when grounded, terminal velocity, ceiling hits, invisible walls at the world edge, a solid rock base under y = 0 |
| Persistence | Diff `[[index, id], …]` saved to `localStorage` after every edit; restored and validated on load; Reset (with confirmation) clears it and restores the generated island; corrupt or foreign data is ignored with a notice |
| Interface | Title screen with Play, a controls guide and Reset; pause menu (Resume/Reset); renderer, camera and pixel ratio follow window resizes |
| Feedback | Target outline, break particles, held block in view with swing/swap animations, toasts for rejected actions, "✓ Saved" indicator *(extension: the held block was replaced by the hand + tool rig, cracks, construction ghost and progress ring, see §6)* |

## 3. Important technical decisions

1. **The world is a floating island.** This answers "what is beyond the 32 ×
   32 edge?" visually. Invisible walls keep the player on the island. Space
   below y = 0 is solid for collision and drawn as a decorative, indestructible
   rock base (an inverted, jagged stone cone). The player can never fall out
   of the world, even after digging to the bottom. A ray that hits the rock
   base reports `editable: false`, so you can build on it but not mine it.
2. **Edits are saved as a diff against the generated terrain**, written to
   `localStorage` right after each edit, so a refresh immediately after
   clicking still keeps it. The payload is versioned and stamped with
   seed, size and height. Every entry is validated on load, and invalid
   entries are dropped individually.
3. **Fixed-step physics with interpolation.** Each 1/120 s step moves the
   player less than half a block, so collisions cannot tunnel even at terminal
   velocity. Rendering interpolates between steps so motion stays smooth at any
   refresh rate.
4. **One overlap rule.** Placement uses the same cell range as the collision
   code, so a block the rules allow can never overlap the player's collision
   box. A randomized property test checks this.
5. **Rendering optimisations.** Face culling and AO are baked into four
   chunk meshes, with one draw group per material and incremental rebuilds.
   The sun is static, so the shadow map is re-rendered only after geometry
   changes (`shadowMap.autoUpdate = false`). Clouds are merged geometry,
   particles use an `InstancedMesh`, and motes are a single `Points` object.
   The pixel ratio is capped at 2. Measured in the dev build: about 41 draw
   calls and 35k triangles per frame, 2.3 ms to rebuild one chunk, 5 ms to
   rebuild the whole world.
6. **Colour pipeline.** `NeutralToneMapping` (it kept the sky and grass more
   saturated than ACES in side-by-side screenshots) and sRGB output. The sky
   shader is not tone-mapped, so its horizon exactly matches the fog colour.
7. **Clouds that never pop.** Cloud layers use periodic value noise, so the
   pattern tiles seamlessly. They are thresholded at an exact coverage
   quantile and scroll across three tiles. A shader alpha falloff fades them
   out by horizontal distance well before any tile edge or wrap point.
8. **Pointer-lock robustness.** Rejections from the promise and the
   `pointerlockerror` event are caught and explained in the menu, with a
   specific message for embedded views that can never lock. Mouse presses in
   the first 350 ms after play starts are ignored, so a double-click on Play
   doesn't break a block.

## 4. Tests actually performed

### 4.1 Automated (Node built-in test runner, `npm test`)

38 tests in `tests/`, all passing on the final code (`ℹ tests 38 · pass 38 · fail 0`):

- **world.test.js**: bounds (0–31; non-integer and out-of-range coordinates
  rejected), determinism for seed 42 (byte-identical volumes), presence of all
  five block types, hill relief, tree count, safe spawn (grass below, open sky,
  no collision), spawn after building on the spawn column, rejected
  `setBlock`s, edit diff/apply validation, and reset restoring the original
  checksum.
- **physics.test.js**: gravity and landing, no fall-through at terminal
  velocity, long-idle stability, jump height and jumping only when grounded,
  holding jump never boosts mid-air, walls block movement (even while
  jumping), one-block steps can be climbed by jumping, ceilings stop jumps,
  the player can't leave the 32 × 32 area, standing on the rock base after
  digging to y = 0, an embedded player is freed, and a slightly embedded
  player is nudged rather than teleported.
- **interaction.test.js**: raycast hit and face normal, reach limit,
  degenerate rays, break, place, every hotbar block placeable, no placement
  inside the player (feet and head), touching-but-not-overlapping placement
  allowed, beyond-reach and forged far targets rejected, out-of-bounds
  rejected, rock base unbreakable but buildable, invalid operations leave the
  world unchanged, the 0.5 mm overlap regression, and a 4,000-iteration
  randomized property test (no accepted placement ever overlaps the player).
- **storage.test.js**: round trip, empty save, nine kinds of corrupt or
  foreign payloads, invalid entries dropped individually, storage that throws
  on access or write (quota), and clear.

### 4.2 In-browser checks (dev server, Claude desktop browser pane)

The preview pane does not run `requestAnimationFrame` in the background and
refuses pointer lock (`WrongDocumentError`). So these checks drove the real
game loop by calling `game.frame(t)` with synthetic timestamps, and entered
play mode through the dev-only `window.__voxelGrove.debugPlay()` hook. Input
went through real DOM `KeyboardEvent`/`MouseEvent` dispatches into the game's
own listeners. Results for the 12 SPEC validation checks:

| # | Check | Result |
| --- | --- | --- |
| 1 | Launches without a blank screen (title + live 3D scene, no console errors) | pass |
| 2 | Move (W) and look (mouse movement) | pass |
| 3 | Jump (peak ≈ 1.28 blocks) and land back on terrain | pass |
| 4 | Walking into the hill is blocked, with no overlap | pass |
| 5 | Remove a nearby block (left click) | pass |
| 6 | Place a nearby block (wood, right click) | pass |
| 7 | Keys 1–5 change the selected block and the highlighted slot | pass |
| 8 | Placing inside yourself is rejected; world unchanged; toast shown | pass |
| 9 | Block 6.21 units away: not targeted, clicks change nothing | pass |
| 10 | Two edits saved, page reloaded, both restored ("Restored 2 saved block edits") | pass |
| 11 | Reset via menu + confirm: world byte-identical to generated, save removed | pass |
| 12 | `npm run build` succeeds | pass |

Also checked in the browser:

- Corrupt JSON in `localStorage` loads the original island with a notice and
  no errors.
- While paused, clicks, WASD and number keys have no effect.
- The context menu is prevented.
- Resizing to 1280 × 720 updates the canvas, camera and held-block aspect.
- The pause menu hides the logo.
- A pointer-lock refusal shows a message instead of failing silently.
- The production build (`npm run preview`) renders the title screen with an
  empty console, and the debug hook is absent.
- Visual review from many viewpoints (title orbit, spawn, rim, underside,
  horizon). This led to tuning the terrain shape, sky palette, tone mapping,
  clouds, held-block size and spawn direction.

### 4.3 Multi-agent code review

Three review rounds ran as orchestrated workflows. In each round, independent
reviewers covered spec compliance, physics/interaction, state/input/
persistence and rendering, or verified earlier fixes. Every finding then went
to an adversarial verifier, often with its own Node or headless-browser
experiment.

- **Round 1:** 10 findings, 9 confirmed and fixed. Major: placement allowed a
  sub-millimetre overlap that `unstick()` turned into a teleport. Minor:
  double-click on Play, the storage write probe, the pause logo, rock-base
  shadows, a rim AO seam, cloud/mote draw order, pixel ratio on resize, and
  the cloud wrap. The spec-compliance reviewer reported no gaps.
- **Round 2:** the play-session walkthrough found nothing. 6 rendering
  findings were confirmed and fixed: cloud field edges and wrap still visible
  through fog (fixed with the distance alpha fade), cloud face ordering, the
  shadow map after a WebGL context restore, and shadow frustum height.
- **Round 3 (dryness check):** the regression check of the round-2 changes
  found nothing. The grader-style acceptance pass traced all 12 validation
  checks and every acceptance bullet, using Node and headless-Chrome
  experiments plus a 40-second input fuzz with no uncaught errors. All passed.
  It found one minor UI issue: the menu's save-status label went stale after
  edits. It is fixed: the label now updates after every save.

Fixes were made in the main session after each round. The automated tests
and the in-browser checks above were re-run on the final code.

## 5. Known limitations

- **Pointer lock is required.** In embedded webviews or iframes without the
  permission, the game shows an explanatory message and cannot be played. It
  works in a normal Chrome or Edge tab. I could not test real pointer lock or
  hardware mouse input in my environment, so mouse look was verified through
  synthetic `mousemove` events in the game's own handler.
- **Frame rate was not measured on real hardware.** The background preview
  doesn't run `requestAnimationFrame`. Only per-frame CPU time (≈ 0.1–0.3 ms)
  and draw-call and triangle counts were measured.
- No auto-step up one-block ledges (you jump, as in Minecraft) and no sprint
  or crouch. Neither is in the spec.
- Holding a mouse button repeats the action (base game: about 5 per second;
  since the extension, it chains 1-second actions), and the
  mouse wheel cycles the hotbar. These are small conveniences beyond the spec.
- The floor of a pit dug all the way to y = 0 is the rock base's top face,
  which has no baked AO.
- No day/night cycle, audio, or water: these are out of scope or not
  required.
- `.git` was initialised inside `ai-vibe/` to keep the development history.
  Remove it if the folder is going to be added to an outer repository.

## 6. Feature extension: first-person hand, tools and animated interactions

### 6.1 New features

- **First-person hand.** A voxel right forearm (blue sleeve, cuff, skin-tone
  fist with knuckles) sits in the lower-right corner and holds the active
  tool. It is drawn in its own scene and camera after the world, so it never
  clips into blocks. It has:
  - idle breathing and sway;
  - walk bob, sharing the camera bob's smoothed weight;
  - look lag (the hand trails quick turns slightly);
  - an eased landing dip, scaled by fall speed;
  - lighting that darkens when the sun is blocked (a voxel ray toward the
    sun every 0.15 s).

  It is only drawn and updated while playing. Pausing resets all its motion.
- **Three tools.** Diamond pickaxe, iron axe and gold shovel. Each is
  procedural 16 × 16 pixel art extruded into a 2-voxel-thick 3D model. The
  same sprite draws the HUD icon.
  - **Q** cycles Pickaxe → Axe → Shovel, only while playing. The hand dips,
    swaps the tool and comes back up. Pressing Q again mid-swap continues
    smoothly.
  - The **HUD tool panel** next to the hotbar shows the icon, the tool name
    and a Q hint; the name also flashes on change.
  - Tools are cosmetic. They never affect which blocks can be edited or how
    long it takes, and block selection (1–5, wheel) is fully independent.
- **Animated mining (left click).**
  - The hand makes three strikes over 1.0 s: wind-up, then a fast strike.
  - A 10-stage procedural crack overlay spreads over the block and swells on
    each strike.
  - Each strike knocks chips and sparks off the struck face.
  - The block stays in the world, and visible, until the third strike at
    1.0 s. It then shatters into about 37 fragments, is removed, and the edit
    is saved.
- **Animated building (right click).**
  - The hand rolls the tool outward and makes two lighter, forward taps.
  - A translucent, textured ghost of the selected block grows out of the
    clicked face inside a pulsing blueprint outline.
  - Glowing construction sparks, tinted with the block's colours, converge
    on it.
  - At 1.0 s the real block is placed, a dust-and-spark puff plays, and the
    edit is saved. The block type is the one selected when the action began.
- **Progress ring** around the crosshair, warm for mining and cyan for
  building.
- **Holding a button** chains actions, one block at a time.
- **Cancellation.** An action is cancelled without changing the world if the
  player walks out of reach (more than 6 units from the camera to the block),
  steps into the cell being built, the block changes or the cell is filled,
  the game is paused, or the world is reset. The crack, ghost, ring and
  construction sparks are removed immediately, and a short toast explains
  why (except for pause and reset).

### 6.2 Architecture and technical decisions

- **`BlockActions` (new, pure logic).** A small state machine with one
  active action at most (`startBreak`, `startPlace`, `update`, `cancel`) that
  emits `start`, `complete` and `cancel` events.
  - Actions are validated at start with the existing `BlockInteraction` rules.
    That class was refactored into side-effect-free `validateBreak` and
    `validatePlace` plus the committing `breakBlock` and `placeBlock`.
  - Each action is locked to its cell and re-checked every frame (reach via
    closest-point distance from the camera, block unchanged, cell still free,
    player not in the way).
  - The world is changed only on completion, through the same validated
    methods. A world `reload` event (reset or restore) cancels the action.
  - Durations come from `config.js` (`BREAK_DURATION` and `PLACE_DURATION`
    = 1.0 s), so tools cannot change them.
- **One timeline drives everything.** The rig, the strike chips, the crack
  stage, the ghost growth and the ring all derive from `action.elapsed`.
  Strike k lands at k·duration/3, so the third strike coincides exactly with
  block removal.
- **Frame-rate independence.** All motion uses elapsed time and exponential
  smoothing (`1 − e^(−k·dt)`). Action poses use a keyframed cycle (start →
  wind-up → impact) followed by a fast smoothing filter, so cycle boundaries
  and chained actions never snap. Physics still runs at a fixed 120 Hz.
- **Locked target.** Looking away mid-action doesn't cancel it, and releasing
  the button doesn't cancel it, so a single click always gives a full
  animation. Walking out of reach does cancel. While mining, the target
  outline stays on the mined block.
- **Particles.** `VoxelParticles` uses two fixed-capacity pools (480 lit
  debris, 320 additive sparks). Each pool is one `InstancedMesh` backed by
  typed arrays, with swap-remove and no per-frame allocation. When a pool is
  full, new particles are dropped, so memory can never grow. Particles carry
  a tag so a cancelled build's sparks can be removed as a group. Debris
  collides with the voxel world.
- **Tool models.** Shapes are defined in a handle-aligned (u, v) frame and
  rasterised to 16 × 16. They get auto-outlined and bevel-shaded, then
  extruded by a generic vertex-coloured voxel mesher (`voxelModel.js`, also
  used for the arm). Extruded side faces use the material's shade instead of
  the near-black outline, so the 3D silhouette stays readable. Each tool has
  a small per-tool grip angle (the axe is turned so its blade faces the
  camera).
- **Layout robustness.** Below 4:3 the hand camera widens its vertical FOV so
  the hand stays on screen in narrow or portrait windows. Both cameras ignore
  0 × 0 resizes, which would otherwise produce NaN projections. Across every
  mining and building animation for all three tools, no arm or tool vertex
  came within 121 px of the crosshair at 1024 × 768. That distance scales
  only with window height.

### 6.3 Files

New:
- `src/interaction/BlockActions.js`
- `src/render/FirstPersonRig.js`
- `src/render/tools.js`
- `src/render/voxelModel.js`
- `src/render/particles.js`
- `src/render/actionEffects.js`
- `tests/actions.test.js`
- `tests/tools.test.js`

Modified:
- `src/Game.js`: timed actions, held chaining, Q, effects, rig feed,
  resize guards.
- `src/interaction/BlockInteraction.js`: validate/commit split.
- `src/render/effects.js`: now only the highlight. The old `BreakParticles`
  and `HeldBlock` were removed.
- `src/config.js`: action durations and strike counts.
- `src/ui/UI.js`: tool panel and progress ring.
- `index.html`, `src/style.css`: HUD markup and styles, controls list.
- `README.md`.
- `.claude/launch.json`: review server on port 5190.

**Diff statistics** for the extension (`git diff --shortstat 6bd3cd5 7fef299`,
the code commits deaaa49 and 7fef299, before this summary was written):
**16 files changed, 1,873 insertions, 263 deletions.** The final totals,
including this document, are in the git history.

### 6.4 Tests performed for the extension

**Automated:** `npm test` passes 53/53. New in the extension:
- **`actions.test.js` (11 tests):**
  - the block is still present at 0.9 s and removed at about 1.0 s, exactly
    once;
  - construction doesn't touch the world before completion;
  - the block type is captured at start;
  - one action at a time;
  - invalid starts are rejected (no target, inside the player, invalid
    block, too far, air, rock base);
  - walking out of reach and stepping into the cell cancel the action;
  - changed blocks and filled cells cancel the action;
  - reset, pause and double cancel are safe;
  - irregular or NaN frame times complete exactly once.
- **`tools.test.js` (4 tests):** three tools; 16 × 16 deterministic sprites;
  silhouettes differ by at least 20 pixels; valid extruded geometry.

**In the browser** (dev server on port 5190, Claude desktop browser pane).
The pane doesn't run `requestAnimationFrame` in the background and refuses
pointer lock. So the game loop was driven manually with `game.frame(t)`,
play mode was entered through the dev-only `debugPlay()` hook, and input
went through real DOM `KeyboardEvent`/`MouseEvent` dispatches into the
game's handlers. Results for the extension's validation list:

| # | Check | Result |
| --- | --- | --- |
| 1 | Hand visible during gameplay (screenshots; projected bounds) | pass |
| 2 | Pickaxe, axe, shovel recognisable (screenshots of each; axe redesigned after the first look) | pass |
| 3 | Q switches tool (Axe → Shovel → Pickaxe → Axe; panel name + held model; ignored in menu) | pass |
| 4 | Block hotbar 1–5 still works, independent of the tool | pass |
| 5 | Mining starts a swing (screenshot mid-swing; hand pose changes) | pass |
| 6 | Cracks and particles visible (crack stage 1 → 9 over the timeline; screenshots at 0.45 s and 0.98 s) | pass |
| 7 | Block disappears after about 1 s (present at 0.98 s; removed at 1.00 s; saved) | pass |
| 8 | Placement shows construction effects (screenshot: ghost, outline, sparks, ring) | pass |
| 9 | New block appears after about 1 s (cell empty at 0.9 and 0.98 s; wood placed at 1.00 s even though the hotbar was switched mid-build) | pass |
| 10 | Invalid or interrupted actions don't change the world (overlapping clicks ignored; pause and reset mid-action leave the world unchanged and clear all effects; out-of-reach cancel) | pass |
| 11 | Persistence and reset (built block restored after reload; reset restores the original and clears storage) | pass |
| 12 | No regressions (jump peak 1.28 blocks and landing; wall stop at the same position as before; player moves about 2 blocks during an action; console clean) | pass |
| 13 | `npm run build` succeeds | pass |

**Smoothness, measured** as the grip point's largest per-frame move at
1280 × 720 and 60 fps:

| Situation | Largest move per frame |
| --- | --- |
| Idle | 0.1 px |
| Walking | 4.7 px |
| Jumping (in place / while walking) | 11.5 / 13.8 px |
| A single Q swap | 63 px |
| A double Q swap (was 381 px in review, before the fix) | 63 px |
| Mining strike (an intentionally fast swing) | 113 px |

After every action all particles expired (0 live within about 2 s), and the
construction sparks of a cancelled build were gone the same frame.

**Multi-agent review of the extension.** Two rounds ran as workflows, with
each finding adversarially verified.

- **Round 1:** reviewers covered requirements, interaction/state and
  rendering/animation. The requirements reviewer found no gaps, and 5 minor
  findings were confirmed and fixed:
  - construction sparks outlived a cancelled build (reported twice);
  - a second Q mid-swap snapped the hand;
  - the hand's walk bob was unsmoothed;
  - the hand went off-screen in narrow or portrait windows.
- **Round 2:** a fix-verification reviewer and a grader-style pass over the
  13 items each ran `npm test` and their own experiments, and both returned
  no findings.

### 6.5 Known limitations (extension)

- I still could not test real pointer lock or hardware mouse movement in my
  environment. Mouse look and hand look-lag were exercised through synthetic
  events and direct yaw/pitch changes.
- The block itself doesn't shake while being mined; the crack overlay swells
  on each strike instead. Chips that were already knocked off finish falling
  after a cancellation; only the construction sparks are removed.
- Because building takes 1 s, quick "jump and place a block under yourself"
  pillaring no longer works. A jump lasts about 0.6 s, so you land back in
  the cell before the block is due, and the build is cancelled at that moment
  ("you're standing in the way"). This is a direct consequence of the
  required delay.
- Tools are purely cosmetic, as specified. There are no tool-specific speeds
  or sounds (audio is out of scope).

## 7. Mobs, combat and health extension (`EXTENSION_MOBS_HEALTH.md`)

### 7.1 Features implemented

| Spec area | Implementation |
| --- | --- |
| Two monsters | **Mossling** (40 HP, 10 dmg, 1.3 u/s): a small, dark olive-teal moss blob with glowing lime eyes, a dark mouth, four stubby feet and a sprout with a pink flower. It hops when walking, crouches then lunges to attack, and blinks. **Stoneguard** (60 HP, 15 dmg, 0.8 u/s): a tall grey stone golem with cracks, mossy shoulders and head, glowing amber eye slits and a pulsing amber chest core. Its legs and arms swing as it walks, and it attacks with a two-armed overhead slam that kicks up dust. Both are original vertex-coloured voxel models built in code. |
| Spawning | 3 Mosslings + 1 Stoneguard. Each stands on natural ground (grass, dirt or stone; never leaves or wood) with clear headroom, with its whole body inside the world, more than 9 horizontal units from the player's spawn (spec: more than 8), and spaced apart. Spawn spots are deterministic, with a seeded shuffle over the current world state. |
| AI | Rule-based states: **wander** (slow, random walk/idle, avoids drops over 2 blocks); **chase** within 10 units, keeping up until 12.5; **attack** within 1.75 (centre-to-centre) with a clear voxel line of sight, started only when grounded; **dying** → **dead**. Attacks wind up for 0.35 s, and the hit lands only if the player is still within range and visible. Cooldown 1.5 s; hit stun 0.35 s (Stoneguard 0.15 s, and its slam can't be interrupted). Obstacles: hop up 1-block steps (whole-body clearance check), slide along walls perpendicular to the player, step off ledges above the player, and turn away from blocked directions while wandering. Mobs steer apart from each other. |
| Terrain | Creatures use a collision `Body` with the same voxel solidity as the player (world edges and the rock base are solid), so they cannot pass through blocks or trees or leave the world. Blocks can't be placed inside a creature, at the start of a build or while it runs (`inside-creature`). |
| Player health | 100 max and start, clamped to 0..max, no regeneration (`Health`). The HUD shows 10 pixel hearts (half hearts at 5 HP) plus the number. |
| Damage feedback | Red screen flash, hearts shake, the camera rolls, the hand jolts, and the player is knocked back away from the attacker. Below 30 HP the screen edges pulse red. |
| No unfair damage | Creatures only simulate in the `playing` state, so title, pause, death screen and a hidden tab (`visibilitychange` pauses the game) are all safe. Damage is applied only while playing. |
| Melee | Left click attacks the nearest creature hit by the crosshair ray within 3 units, only if no solid block is closer along the ray. 25 damage, 0.6 s cooldown. Otherwise left click mines as before. A creature in reach turns the crosshair red; an attack meter under the crosshair shows the cooldown. The hand reuses the rig with a faster, wider swing. |
| Hit feedback | The creature flashes red-white, is knocked back (Mossling far, Stoneguard barely) and sheds body-coloured chips and sparks. Its billboard health bar (green → red) appears. |
| Enemy death | At 0 HP the creature tips over, shrinks and blinks for 0.55 s, then bursts into 30–46 voxel fragments of its own colours and disappears. A toast and the "Monsters left" counter update. |
| Player death | Movement, combat and all block actions stop, and creatures freeze. The view rolls and sinks, the mouse is released, and a death screen names the killer and offers **Respawn**. |
| Respawn | 100 HP, a safe spawn point (`findSpawnPoint` on the current world), all creatures reset to full health at their spawn spots, cooldowns cleared, then pointer lock is requested to resume. World edits and `localStorage` are untouched. |

### 7.2 Architecture and decisions

- **New pure-logic modules** (Node-testable, no rendering):
  - `entities/mobTypes.js`: stats.
  - `entities/Body.js`: creature collision body.
  - `entities/Mob.js`: AI state machine and timers.
  - `entities/MobManager.js`: spawning, fixed-step update, ray targeting,
    line of sight, cell occupancy, and the collision-safe player/creature
    push-out; emits `attack-start`, `hit`, `miss` and `killed` events.
  - `entities/PlayerCombat.js`: melee targeting and cooldown.
  - `player/Health.js`.

  `Game` turns events into effects; the renderer only reads state.
- **Simulation.** Creatures step inside the player's fixed 120 Hz physics
  loop, after the player. Then `separatePlayer` keeps bodies apart:
  - it separates along the axis needing the smaller move, by the distance
    actually needed;
  - the player moves at most 0.2 units per step in total, across all
    passes, so there are no camera snaps; the smallest moves are tried
    first;
  - a creature dropping onto the player is moved instead of the player;
  - a push blocked by terrain, or one that would shove the player into
    another creature, is undone and the next option is tried;
  - several passes handle crowds.

  Every move goes through collision, so nobody ends up inside blocks. All timers use `dt`, so behaviour is
  frame-rate independent (tested at 30, 60 and 120 Hz). Line of sight reuses
  the voxel DDA raycast. There is no pathfinding, which the spec asks to
  avoid.
- **Attack distance** is the 3D distance between body centres. A chasing
  creature stops ("settles") only when it is on the ground, within real 3D
  reach and in sight. Otherwise it keeps closing in:
  - into a step, which triggers the hop;
  - off a ledge above the player, walking away from the blocks underfoot;
  - never stopping mid-hop.

  When it is touching a player who is level or above (for example jumping),
  it holds position instead of walking underneath. It also won't drop into
  a 1 × 1 pit that the player already fills: it waits only if there is no
  room anywhere beside the player. Blocked creatures hop 1-block
  steps, also along the blocked axis on diagonal staircases, after a
  whole-body clearance check. Otherwise they slide along the face they hit,
  towards the player's side, reversing only if the slide itself is blocked.
  This logic took five review/fuzz rounds to get right (see 7.4).
- **Left-click priority.** A creature in reach under the crosshair takes
  priority over mining:
  - an attack cancels a running block action cleanly;
  - a press that was used for combat never falls back to mining (for example
    the block behind a creature that just died);
  - on cooldown, a click on a creature does nothing;
  - holding the button keeps attacking every 0.6 s while a creature is in
    reach, and attacks one that walks in front of you while you mine.
- **Balance.** A struck Mossling's lunge is interrupted. The Stoneguard is
  heavy: hits barely move it and don't cancel its slam (shorter stun), so it
  can't be stun-locked.
- **State machine.** `title → playing ⇄ paused`, `playing → dead → (Respawn)
  → paused → playing` once the mouse is captured. The death screen ignores
  key repeats and all input for 0.7 s, so a held Space or a frantic combat
  click can't trigger Respawn by accident. **Reset world** also resets
  health and creatures.
- **Rendering.**
  - `MobRenderer` keeps one visual per creature and interpolates between
    physics steps.
  - Each creature has its own Lambert material, with a small base emissive
    so it stays readable in shade and a hit flash on top.
  - Glowing eyes and core use unlit materials.
  - Moving creatures use soft blob shadows (a raycast to the ground) rather
    than the static shadow map, which only re-renders after world edits.
  - Particles go through the existing fixed-capacity pools.

### 7.3 Files changed

New:
- `src/entities/{mobTypes,Body,Mob,MobManager,PlayerCombat}.js`
- `src/player/Health.js`
- `src/render/{mobModels,MobRenderer}.js`
- `tests/combat.test.js`

Modified:
- `src/Game.js`: combat, health, death and respawn, mobs in the physics loop,
  visibility pause, click priority, camera effects.
- `src/ui/UI.js`, `index.html`, `src/style.css`: hearts, flashes, hostile
  crosshair, attack meter, monster counter, death screen, controls text.
- `src/render/FirstPersonRig.js`: melee swing, hurt jolt.
- `src/render/particles.js`: creature hit, death and dust effects.
- `src/interaction/BlockInteraction.js`, `BlockActions.js`: the
  `inside-creature` rule.
- `src/config.js`: `COMBAT`.
- `README.md`.

`EXTENSION_MOBS_HEALTH.md` was added to git unmodified.

### 7.4 Tests performed

**Automated:** `npm test` passes 93/93. New in `combat.test.js` (39 tests):
- health clamping, bad input and reset;
- spawn count, types, validity, determinism and no tree tops;
- creatures settle onto the ground;
- 30 s of wandering stays valid and at wander speed or below;
- chase speeds measured at 1.3 / 0.8 (±0.1);
- no chase beyond 10 units;
- hopping a step;
- no passing through a 3-high wall (both types);
- attack cadence: exactly 4 hits in 6 s, at least 1.5 s apart, the first at
  0.35 s;
- no attack at 1.8 units;
- a dodge during the wind-up makes it miss;
- line of sight blocked by a block, and attacks require it;
- no events with no target (paused or dead);
- melee: 25 dmg, cooldown, Mossling 2 hits, Stoneguard 3, death → dead;
- out of range and behind a block are rejected;
- nearest target first;
- knockback and stun;
- respawn resets all four;
- creature cells block placement;
- frame-rate independence;
- regressions for every reach and behaviour bug found in review rounds 1–5:
  - one block higher, 1-wide terrace, 2-block ledge, ledge-edge approach;
  - partially taller step, tree trunk (in line and off to the side), 1-wide
    corridor, seed-42 diagonal staircase;
  - wander at the world edge, real-body range;
  - push-out against a cliff, jumping player, 1 × 1 pit, landing creature,
    two-creature squeeze;
  - concave ledge corner, per-step push budget.

  The push-out tests run a Game-like loop with real player physics. The
  round-3 and round-4 regression tests were checked to fail on the previous
  commit.

**In the browser** (dev server on port 5190, Claude desktop browser pane;
loop driven by `game.frame(t)`, play mode through the dev-only `debugPlay()`,
real DOM mouse and keyboard events). Results against the 16 acceptance
tests in `EXTENSION_MOBS_HEALTH.md`:

| # | Acceptance test | Result and evidence |
| --- | --- | --- |
| 1 | Both enemy types render correctly | pass. Close-up screenshots of both (the Stoneguard was too dark at first, and the Mossling blended into the grass; both fixed) |
| 2 | Four enemies spawn in valid positions | pass. 1 Stoneguard + 3 Mosslings, 12.5–17 units from the start spawn (10–14 after a respawn), on ground, not colliding |
| 3 | Enemies wander when the player is far | pass. With the player at spawn, all four were only in `wander` for 5 s and moved 1.1–1.8 units |
| 4 | Enemies chase when the player approaches | pass. At 6 units a Mossling switched to `chase` and closed 1.7 units in 1.5 s |
| 5 | Attacks only within range and cooldown | pass. Standing next to the Stoneguard: hits at 0.37 s and 1.87 s (1.5 s apart); range verified by unit tests |
| 6 | Enemies don't pass through terrain | pass. 90 s of play with 60 creature attacks: 0 frames with a creature overlapping blocks, 0 outside the world |
| 7 | Player health decreases correctly | pass. Stoneguard −15 per hit (100 → 85 → 70), Mossling −10 per hit; hearts and value update; red flash |
| 8 | Health never negative | pass. It stopped at exactly 0 at death, and stayed 0 for 3.8 s on the death screen (0 creature attacks) |
| 9 | Player can damage and defeat enemies | pass. Mossling 40 → 15 → dead (tip-over, burst, "Mossling defeated!", counter 3/4); a click during the cooldown did nothing and didn't mine |
| 10 | Attacks can't pass through blocks | pass. With a 2-high wall between the player and a Mossling 2.5 units away, no target was found and its HP stayed 40 |
| 11 | Death screen at zero health | pass. Screenshot: "You were defeated", the cause, Respawn |
| 12 | Respawn restores health and resets enemies | pass. 100 HP, spawn point, all four alive at full HP 10+ units away; a respawn click within 0.7 s of death is ignored, a later one works |
| 13 | World edits stay saved after respawn | pass. The test block was still present and still in `localStorage` |
| 14 | Block interaction still works | pass. Timed mining and building work; building into a creature's cell is refused; the killing click no longer mines behind the creature |
| 15 | Menus and controls still work | pass. Q → Axe, 3 → Stone, Esc → paused (no damage during 3 s paused), resume; the existing in-browser checks from §6 were unaffected |
| 16 | `npm run build` succeeds | pass |

**Performance:** with four active creatures, per-frame CPU time was 0.1 ms
median and 0.2 ms p95 (JavaScript only; the GPU frame rate could not be
measured in the background preview).

**Multi-agent review.** Round 1: reviewers covered spec compliance,
AI/physics/combat and state/UI/rendering, and each finding was
adversarially verified. 6 of 10 findings were confirmed and fixed:
- **major:** Mosslings parked out of 3D reach below a player one block
  higher, making the player immune to 3 of 4 monsters (found by two
  reviewers independently);
- **major:** the killing click also mined and saved the block behind the
  creature;
- held mining blocked attacks on a creature that came into reach;
- holding Space at death triggered Respawn;
- the block-name label overlapped the toast.

Refuted: step-probe hopping, pacing behind a pillar (allowed by the spec),
stun-lock immunity (a balance choice; the Stoneguard was made non-stunnable
anyway), and early slam dust.

**Round 2** (fix verification + grader pass) found 2 more confirmed major
reach bugs in the new chase rule, both fixed:
- a Mossling hopped in place below a 1-wide terrace, and its wind-ups
  started mid-hop and missed;
- a Stoneguard stalled on a 2-block ledge above the player.

**Round 3** was adversarial terrain fuzzing: about 44,000 synthetic and
21,000 seed-42 engagements in static, knockback and return modes, plus
about 10 million creature-steps of behaviour regression. For reachable
players the pass rate was 99.0–99.8%. It found 0 creatures inside blocks,
0 leaving the world, 0 hits beyond 1.75 or through walls, and the cooldown
was never under 1.5 s. 6 confirmed failure clusters were fixed:
- ledge pacing when approaching along the edge;
- hop-lock at partially taller steps;
- the player/creature overlap persisting against cliffs;
- a creature walking under a jumping player (a regression from round 2);
- wanderers freezing at walls;
- the padded hitbox allowing 3.06-unit hits.

The wall-slide flip-flop (refuted as spec-allowed) was improved too. Each
fix has a regression test that fails on the previous commit.

**Round 4** re-ran and extended the fuzzing: about 292,000 reach
engagements and about 34 million behaviour steps, A/B against the previous
commit.
- **Results:** synthetic families 100% static / 99.5% knockback; seed-42
  about 99.2–99.3%; 0 embeds or world exits; the cooldown was never under
  1.5 s; hits never beyond 1.75 or through walls.
- **Confirmed and fixed** (a reach verifier hit the usage limit, so I
  re-ran its repro scripts myself and confirmed those findings before
  fixing):
  - my round-3 wall slide trapped creatures in 1-wide corridors and around
    off-centre trunks;
  - creatures stalled on diagonal staircases;
  - a Stoneguard dropped into a 1 × 1 pit onto the player;
  - the push-out moved by the overlap width (a 0.85-unit snap) and left a
    sandwiched player inside a creature.
- **After the fixes,** the fuzzers' repro scripts show:
  - corridor: 75/75 reached, both types;
  - staircase: 8–9 hits, up from 0;
  - pit: 0 s of overlap;
  - snap: none;
  - sandwich: none;
  - trunk sweep: Mossling 0/105 and Stoneguard 4/105 failures, down from
    50 and 129.

**Round 5** re-ran the full round-4 harness on the fixed code.
- **Results:** 0 embeds, exits, through-wall hits or out-of-range hits; no
  persistent overlap over 1 s anywhere (the previous commit had hundreds of
  cases); 0 wall-slide flip-flop windows; corridor reach for the Stoneguard
  went from 71% to 100%.
- **Regression found:** my round-4 "wait on the pit rim" check misfired on
  ordinary concave, diagonal and ring ledges and in 1-wide trenches. It
  froze a creature above a reachable player in about 1% of ledge cases and
  about 0.75% of seed-42 engagements.
- **Minor:** the 0.2 push cap applied per call, not per step (up to 0.6).
- **Both fixed** with the verifier's tested patches: room is checked all
  around the player, and the push budget is shared across a step. After
  the fixes:
  - concave-ledge repro: 11 hits, up from 0;
  - seed-42 freeze repro: 8 hits, up from 0;
  - push sweep: 0 of 378 configurations above 0.21 per step (worst 0.006).

  Final re-run of the affected families: see 7.6.

### 7.5 Known limitations

- Real pointer lock and hardware mouse input still couldn't be tested in my
  environment. All combat was exercised with synthetic events and direct
  aiming.
- There is no pathfinding (by spec). A creature can fail to reach a player
  who is only reachable by a detour, and can't reach a player on a pillar
  two or more blocks high or in a sealed pit; it waits or paces nearby.
  Such a player can't be hit, but can still hit creatures within 3 units.
  In the round-4 fuzzing, detour-only placements still succeeded about 82%
  of the time.
- Defeated creatures stay defeated until you respawn or reset the world.
  Enemy state isn't saved across reloads (allowed by the spec): a reload
  brings back all four.
- With the 3-unit player reach against the 1.75 creature reach, a skilled
  player can often win one-on-one fights without taking damage. Groups and
  the Stoneguard's unstoppable slam remain dangerous.
- There is no fall damage, regeneration, armour or audio (out of scope or
  excluded).

### 7.6 Final validation of the combat extension

On the final code:

- **`npm test`:** 93/93 pass. `npm run build` succeeds.
- **Fuzz re-run of the families affected by the last fixes** (round-4
  harness, 49,800 engagements): ledge shapes, steps and terraces, trenches
  and pits pass 100% of reachable cases in static mode, and 1-wide
  corridors 100% in knockback mode. The only failures (96) are a
  Stoneguard against a player in an occupied 1 × 1, 2-deep pit, where
  waiting on the rim is the intended, spec-allowed behaviour. There were 0
  embeds, 0 world exits and 0 persistent overlaps.
- **Live game** (dev server, browser pane, frames driven by hand, real DOM
  input):
  - timed mining and building still work, Q switches tool, and edits save;
  - in 25 s of scripted combat (a bot that chases, aims and swings) all 4
    monsters were defeated and 3 hits taken (65 HP left), with no
    embedding;
  - after death, Respawn gave 100 HP, 4 monsters alive and the world edits
    kept;
  - the console was clean.

**Diff statistics** for the combat extension, from b4c0cab (end of the
hand/tools extension) to the last code commit 7f11dee, including the
unmodified spec file and the README and summary updates made along the way: 21 files changed, 3265 insertions, 27 deletions. The final totals including this
documentation commit are in the git history.

Commits in this phase:
- 8ed1224: the spec file;
- 7435b7f: the implementation;
- 3d61da1: round-1 fixes;
- cd180fd: round-2 fixes;
- 9f34fda: round-3 fixes;
- 4b0300d: round-4 fixes;
- 7f11dee: round-5 fixes.
