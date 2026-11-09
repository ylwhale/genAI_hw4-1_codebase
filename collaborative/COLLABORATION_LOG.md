# Voxel Grove — Collaboration Log

## Context and authorship

- **Original foundation, before the work logged here:** a static ten-block Three.js
  prototype that the project author reports implementing manually. See
  `FOUNDATION_LOG.md` for its technical scope. Those original source files were later
  replaced, so this bundle cannot independently verify their authorship.
- **Later full-game phase documented in this log:** autonomous AI implementation by
  Claude Code (model Claude Opus 5.5), following the original static-scene prototype.
  This log records the full-game work, not the original foundation's implementation.
  The human supplied the assignment brief, `SPEC.md`, and `EXTENSION_MOBS_HEALTH.md`,
  and explicitly authorized end-to-end autonomous execution without intermediate approvals.
- **Human contributions in this phase:** writing the task brief and specifications and authorizing the
  autonomous workflow. No human code review, approval checkpoint, playtest, or code edit happened during
  this phase. Any later human review is not recorded here.
- **AI working method:** a single orchestrating Claude Code session planned the architecture, wrote the
  shared core modules and the integration layer itself, and used Claude Code *workflows* (deterministic
  multi-agent scripts) to (1) critique the architecture contract, (2) implement independent subsystems
  in parallel against that contract, and (3) review the finished code adversarially. Each step below
  records what actually ran.
- Sibling projects (`ai-vibe/`, `ai-human-style/`, `real-manual/`, `starter/`) were not opened or copied.
  `SPEC.md`, `EXTENSION_MOBS_HEALTH.md`, and `FOUNDATION_LOG.md` were not modified; their SHA-256 hashes
  were recorded at the start and rechecked at the end (see the final validation entry).

## Stage 1 — Inspection and baseline (autonomous)

Inspected: `SPEC.md`, `EXTENSION_MOBS_HEALTH.md`, `FOUNDATION_LOG.md`, `package.json`, `.gitignore`,
`index.html`, and all of `src/` (`main.js`, `world.js`, `player.js`, `renderer.js`, `style.css`).
No `CLAUDE.md`, `README.md`, or tests existed. The directory is not a Git repository (`git status`:
"fatal: not a git repository"), so no commits are made in this phase and none were created.

Findings:

- The foundation is a fixed-camera static scene: 10 hard-coded blocks, three solid-colour materials, one
  `Mesh` per block, and no input, physics, terrain generation, persistence, or UI.
- Useful aspects kept: world data independent of Three.js, focused modules, `createX()` factory style,
  no-semicolon code style, the existing dependencies (Three.js 0.186.1, Vite 8.3.5) and Vite defaults.
- Limitations to fix: one mesh per block will not scale to a 32×32 terrain (thousands of draw calls);
  integer coordinates were cube *centres*, which complicates voxel math; no test runner.

Baseline checks actually run: `npm ls --depth=0` (three 0.186.1, vite 8.3.5), `npm run build` (succeeded,
10 modules, 528.85 kB JS with Vite's >500 kB advisory), a Node import of `three` (revision 186; core
classes usable without a DOM, so render-side helpers are unit-testable), and SHA-256 hashes of
`SPEC.md`, `EXTENSION_MOBS_HEALTH.md`, `FOUNDATION_LOG.md`, and `package-lock.json`.

## Architectural decisions (made autonomously)

1. **Block coordinates are cube corners**: block (x, y, z) fills [x, x+1)³ and entity positions are the
   centre of the feet, so `Math.floor` maps a point to its block. This changes the foundation's
   "integer = cube centre" convention to the standard voxel convention.
2. **World storage** is a flat `Uint8Array` (32 × 32 × 32) with change events. Generation, persistence,
   physics, AI, and rendering read it through one small interface. Persistence stores only a diff against
   the regenerated seed-42 terrain.
3. **Strict layering**: `core/` and `world/`, `player/`, `interaction/`, `combat/`, `mobs/` are pure
   (no Three.js, no DOM) and unit-tested in Node. `render/` holds the Three.js views and `ui/` the DOM.
   `game/` wires them together. Logic talks to views only through an event bus and through state the
   views read.
4. **Testing** uses Node's built-in `node:test` (`npm test`), so no new dependency is added.
5. **Rendering**: merged, face-culled chunk meshes (8 × 8 columns) with baked ambient occlusion, a
   procedural pixel-art texture atlas (`DataTexture`, no image assets), shadows, fog, a sky dome, and a
   first-person hand drawn as a depth-cleared overlay pass.
6. **Simulation** uses a semi-fixed timestep: frames are clamped to 0.1 s and split into ≤ 1/120 s
   physics/AI sub-steps, making gameplay frame-rate independent.
7. **World floor**: layer y = 0 is unbreakable so the player can never dig out of the world. The
   collision view also treats everything outside the 32 × 32 footprint as walls.

Implementation entries follow in chronological order.

## Stage 2a — Shared core (written directly by the orchestrating session)

- Created `src/config.js`, `src/core/{rng,events,geometry}.js`, `src/world/{blocks,world,raycast}.js`,
  `src/player/physics.js`, `src/game/gameState.js`.
- Tests: `test/helpers.js`, `test/{core,world,raycast,physics,gameState}.test.js`. `npm test` reported
  26 passing tests before the game-state tests were added. With the game-state tests and the
  `liftOutOfBlocks` regression test, 30 tests passed and none failed.
- `package.json`: renamed the package from `starter` to `voxel-grove` and added `"test": "node --test
  \"test/**/*.test.js\""`. No dependencies changed.

## Stage 2b — Architecture contract and independent design critique (workflow)

- Wrote an interface contract (module owners, exact signatures, event names, layering rules) and a
  requirements digest of the brief, kept as working files outside the repository.
- Ran workflow `contract-critique`: three independent critic agents (requirements traceability,
  interface consistency, gameplay/browser robustness) read the contract, the specs, and the core code.
  They returned about 35 findings. Several were confirmed by running the real physics code. The
  decisions below were adopted as "contract v2":
  - **Mob step climbing was frame-rate dependent** (jump apex 0.98 blocks at 60 fps): mob jump speed
    raised to 8.4 and mob physics sub-stepped at ≤ 1/120 s.
  - **Infinite raycast hang**: `raycastBlocks` with `maxDistance = Infinity` never terminated for a ray
    leaving the world. Fixed: the traversal now stops once the ray is outside the world box and moving
    away. Regression test added.
  - **Layering**: physics moved from `src/player/physics.js` to `src/world/physics.js`, so spawn checks and
    mobs can share it without upward imports or duplicate collision code.
  - **Pointer lock lifecycle**: `play`/`resume` are dispatched only after pointer lock is acquired. A
    respawn moves `dead → paused` and waits for the lock (`gameState.js` and its tests updated).
  - **Left-click arbitration**: a mob in melee reach wins (the click is swallowed while the attack cools
    down). A mob further along the ray hides the block behind it (miss swing, no mining through mobs).
    Otherwise the click mines. Holding the button continues mining.
  - **Persistence**: `restore()` seeds the in-memory edit map, so a second reload cannot drop earlier
    edits.
  - **Placement**: entity overlap is checked with epsilon 0. Any positive epsilon could trap the player
    inside a placed block.
  - **Mob attacks**: a 0.35 s visible wind-up sits inside the 1.5 s cooldown. Strikes land only if the
    target is still in range and in line of sight.
  - **Spawning**: mobs must be ≥ 9 horizontal units from the player spawn (a margin over the required 8),
    with ≥ 12 preferred. Pit columns are rejected.
  - **Rendering pitfalls pinned**: `autoClear=false` for the hand overlay pass, `PCFShadowMap`, particle
    `frustumCulled=false`, atlas gutters and row orientation, diagonal dirty chunks, geometry disposal,
    unique mob ids per session.
- Other changes: `TERRAIN.maxSurface` 16 → 14 (room to build above trees), `MOB_RULES.attackWindup`,
  `spawnMinDistance`, `spawnPreferredDistance` added to `config.js`.

## Stage 2c/3A/3B — Parallel subsystem implementation (workflow `implement-subsystems`)

Seven implementation agents worked in parallel, each owning a disjoint set of files and its own tests.
Each ran only its own test files; none ran builds, servers or git. Each agent's reported result:

| Owner | Files | Own tests |
| --- | --- | --- |
| World | `world/{noise,generator,spawn,persistence}.js` | 62 pass |
| Rendering | `render/{textures,chunkMesher,worldView,environment,renderer}.js` | 71 pass |
| First person | `interaction/{tools,blockRules,actionController}.js`, `render/{toolModels,handView,effects}.js` | 116 pass |
| Mob logic | `mobs/{mobTypes,mob,mobSpawns,mobAI,mobMovement,mobManager}.js` | 91 pass |
| Mob visuals | `render/{mobModels,mobView}.js` | 37 pass |
| Player/combat | `player/{health,player,playerController}.js`, `combat/playerCombat.js` | 109 pass |
| UI/input | `index.html`, `style.css`, `ui/{hud,screens,icons}.js`, `game/input.js` | 96 pass |

Meanwhile the orchestrating session wrote the integration layer: `game/simulation.js` (headless
gameplay loop), `game/playerActions.js` (click arbitration and timed actions), `game/gameView.js`
(drives every Three.js view from simulation state and events), `game/game.js` (pointer lock, screens,
HUD, input, crash-safe frame loop), `main.js`, and `test/integration.test.js`. The old foundation modules
`src/world.js`, `src/player.js`, and `src/renderer.js` were deleted; their roles moved to
`world/world.js`, `player/player.js`, and `render/renderer.js`.

### Integration results (orchestrator, actually run)

- `npm test`: **627 tests, 627 pass, 0 fail**, including 14 end-to-end integration tests on the real
  seed-42 world (walking, jumping, wall collision, 1-second mining and placement, reach limit, hotbar/tool
  independence, reset, corrupt save, mob attack cadence, combat cooldown, melee blocked by walls, death,
  respawn preserving edits).
- `npm run build`: succeeded (659 kB JS / 179 kB gzip). Vite's >500 kB chunk advisory remains: Three.js
  makes up most of the bundle.
- Applied agents' integration notes: textured debris via `effects.burstBlock`, atlas disposal, wording of
  the incompatible-save notice, the crosshair turns red over a mob target, wheel steps, a respawn
  lock-grace fallback, and a rescue that returns a deeply embedded player to spawn.

### Browser verification (Claude Browser preview of `npm run dev`, Chromium, 1280×720 and 1024×600)

Pointer lock **cannot be granted** to scripted clicks in the embedded preview browser. Clicking Play
correctly stayed on the title screen with the "Couldn't capture the mouse" notice. Gameplay checks then
used the development-only `window.__voxelGrove.forcePlay()` hook plus synthetic keyboard and mouse
events; mouse look was simulated by setting yaw and pitch. Verified: the title screen renders with no
console warnings; W walks about 3 units in 0.7 s; Space jumps about 0.94 units and lands; a mined block
shows a crack overlay and is removed after about 1 s and saved to localStorage; placement shows a rising
translucent preview and places after about 1 s; keys 1–5 change the hotbar label; Q switches
pickaxe → axe; both mob types render as distinct models; mobs chase and attack, and the player died at
0 HP with the death overlay; Respawn restored 100 HP, spawned four fresh mobs 13–19 units away, and kept
the world edits; melee dealt 25 per hit, swallowed a click during the 0.6 s cooldown, and a kill produced
a voxel burst and a "Mossling defeated" toast; Escape paused the game with mobs frozen and no damage;
reloading restored the edits (`status: loaded`); two-step Reset World restored the generated terrain
byte-for-byte and removed the save; the canvas tracks viewport resizes; frames take about 8.3 ms
(median) and 9.9 ms (p95) with four mobs; no console errors.

### Defects found during integration and fixed

1. **Placement next to the feet wrongly rejected.** With very small browser frames a resting body can
   settle up to the 1e-4 physics skin into the block below. Epsilon-0 overlap then refused a block in
   the cell beside the player's feet, which breaks bridging and pillaring. Fix: placement uses the physics
   contact tolerance (`SKIN`), which the collision code already ignores, so no body can be trapped.
   Regression test added in `test/blockRules.test.js`.
2. **A killing click started mining the block behind the mob.** The button stays held for a frame or two
   after the kill, and hold-to-continue mining then fired. Fix: `playerActions` records each press's
   intent (`melee` / `miss` / `mine`), and only a mining press continues while held. Regression
   integration test added. Afterwards `npm test` reported 629 passing tests and none failing.

## Stage 4 — Adversarial review (workflow `review-voxel-grove`)

Five independent reviewer agents examined the finished game, each through one lens: SPEC compliance,
extension + Stage 3A compliance, logic bugs, browser/render bugs, and maintainability/performance. Each
lens's findings then went to a separate verifier agent told to try to *refute* them, by reading the
full code path and writing reproduction scripts outside the repository. The first run hit an account
usage limit after one reviewer finished. The workflow was resumed afterwards and completed (10 agents
in total). Before resuming, file modification times were checked to confirm no project file had been
changed while the review ran.

Outcome: 39 findings in total. 34 were confirmed with reproductions or exact code traces, 1 was left
uncertain (first-use shader compile hitches; this needs a GPU to measure), and 4 were refuted. All
confirmed findings were rated minor or major; there were no criticals. The main confirmed defects:

- **Escape without pointer lock** (debug or no-lock path) still ran one simulation step after pausing. A
  lethal hit in that step left the player dead with no death screen.
- **Mining through a mob**: a break already in progress continued while a mob stepped in front of the
  block. A melee click cancelled a break but not an in-progress placement.
- **Mob ledge loop**: below a 1-block ledge a mob could alternate chase → attack mid-jump → chase,
  hopping in place and striking from the air.
- **Eye inside a mob's box**: every click hit that mob regardless of aim, and mining and placing stopped
  working.
- **Spawn pits**: the pit rule caught only 1×1 shafts, so a respawn could land at the bottom of a wider
  dug hole.
- **Persistence**: a save failure during load latched silently, so the "not saving" toast never
  appeared. Two open tabs overwrote each other's edits.
- **Rendering**: near the shore the sea was sorted after the block outline and placement preview and
  painted over them. The placement puff spawned inside the new block and was invisible.
- **Browser**: no WebGL 2 meant a blank page; the keyboard context-menu key was not blocked; the mouse
  back/forward buttons were not blocked; the `:active` button offset made a dead click strip; hotbar
  icons were blurry; dialogs lacked accessible names; Reset World on the title screen gave no visible
  confirmation; there was no way to play when the browser refuses pointer lock.
- **Maintainability**: `effects.js` was a 753-line multi-purpose module tied to the hand view; helpers
  were duplicated across modules with drifting semantics; spawn-column rules were duplicated; anim
  state was dead; the browser glue (`game.js`, `gameView.js`) was untestable; four sub-stepping layers
  existed and the outer one lacked a non-finite dt guard; there were unused exports and event names
  were unchecked strings.

Refuted: save fingerprinting, chasers parking under canopies (real behaviour, but allowed by the
spec), duplicate box-geometry builders (different algorithms), and splitting `raycastBlocks`
(standard DDA).

### Fix round 1

For the later full-game refactor, the orchestrator first added shared utilities:
`src/core/math.js` (shared numeric helpers; `clamp` moved there), `isFinitePoint` / `isCell` / `horizontalDirection` in `core/geometry.js`, a
validated event-name registry (`GAME_EVENTS`; the simulation's bus now throws on unknown names), and
a move of the browser glue from `src/game/` to `src/app/`, so `game/` is pure logic only. Then workflow
`fix-review-findings` ran three engineer agents in parallel on disjoint file clusters (logic, render,
app/UI), with a written brief that fixed the cross-cluster APIs in advance.

Results reported by the three fix agents (each listed every brief item as done, none skipped; each
regression test was mutation-checked by reverting its fix in a scratch copy and seeing it fail):

- **Logic** (`game/`, `combat/`, `mobs/`, `world/`, `player/`, `interaction/`, `config.js`):
  - An active break is cancelled when a mob occludes the block, and melee cancels any timed action.
  - `classifyPress()` decision table plus a new `test/playerActions.test.js` (16 tests).
  - Mobs enter attack only when grounded (fixes the ledge hop loop).
  - Eye-inside-mob targeting requires facing the mob, and a soft player–mob separation stops bodies
    overlapping.
  - Bounded-escape pit detection, shared by player and mob spawns.
  - Fixed the persistence load-latch, and `onSaveError` now notifies late listeners.
  - `persistence.resync` + `sim.reloadSavedEdits()` for cross-tab saves.
  - `sim.update` dt guard, `PLAYER_KNOCKBACK` in `config.js`, dead `attackTimer` state removed, helpers
    de-duplicated, unused exports dropped.
- **Render** (`render/`):
  - `effects.js` split into `particles.js`, `crackOverlay.js`, `placementPreview.js`,
    `blockHighlight.js`, and `blockFaces.js`, plus `miningRhythm.js`, so effects no longer import the hand
    view.
  - `renderOrder.js` draws overlays after the sea, with a test that uses three.js's real transparent
    sort.
  - Effects own the mining dust, spawned outside the hit face, and `burstPlaced()` emits from the
    placed block's open faces.
  - Monster models narrowed to their hit boxes: Stoneguard ±0.456, was ±0.62; Mossling ±0.39, was ±0.43.
  - Dead `mobView` fallback removed and helpers de-duplicated.
- **App/UI** (`app/`, `ui/`, `main.js`, CSS):
  - Escape-frame guard, and a dead-on-resume player goes to the death flow.
  - WebGL failure shows a fatal screen.
  - Document-level context-menu block, and mouse back/forward blocked.
  - Pressed buttons keep a still hit box, and hotbar icons are pixel-crisp at display size.
  - Dialogs have accessible names, and reset notices are visible on screens.
  - **"Play without mouse capture"** free-look fallback after a lock failure (automatic when the
    Pointer Lock API is missing).
  - Shaders precompiled at start-up.
  - Injectable factories with new `test/app.test.js` (21 tests) and `test/gameView.test.js` (10 tests,
    including the pure `interactionVisuals()`).
  - Storage-event resync, and save-failure warnings with a `warn` tone.

### Post-fix verification (orchestrator, actually run)

- `npm test`: **743 tests, 743 pass, 0 fail** (38 test files).
- `npm run build`: succeeded (666.71 kB JS / 181.67 kB gzip, 17.65 kB CSS). The production bundle
  contains no `__voxelGrove` debug hook.
- Complexity scan (the AST script the review agent wrote): 950 functions, mean cyclomatic complexity
  2.27, 7 functions at ≥ 10 (9 before the fixes).
- Browser (embedded Chromium, `npm run dev`, clean localStorage):
  - Clicking Play was rejected by the browser (`WrongDocumentError: The root document of this element
    is not valid for pointer lock`). The title screen then showed the notice and the new **Play without
    mouse capture** button. Clicking it entered `playing` with free look on and the Esc hint visible.
  - The Browser pane was in the background for this pass, so requestAnimationFrame was suspended and
    live timing could not be observed. The checks therefore drove `sim.update` from the page and
    captured frames with screenshots.
  - A placed wood block showed debris outside its faces.
  - The reworked Mossling and Stoneguard models rendered front and back.
  - The shore view rendered the sea correctly; the outline-over-sea case itself is covered by the
    render-order test.
  - A reload restored the saved edits (`status: loaded`, 2 applied).
  - No console warnings or errors.
  - Free-look mouse movement could not be shown live because no frames ran; it is covered by
    `input` and `app` tests.

## Final validation

- `SPEC.md`, `EXTENSION_MOBS_HEALTH.md`, and `FOUNDATION_LOG.md`: SHA-256 rechecked at the end and
  identical to the values recorded at the start
  (`fe8d48dd…ad585`, `d08ad68e…cb06`, `536f1b3d…96cd1`). No dependency was added or changed.
  `package.json` changed only its name (`starter` → `voxel-grove`) and gained a `test` script. The
  lockfile's two matching `name` fields were updated by hand, so `npm install` does not rewrite it.
- All 12 SPEC functional checks and all 16 extension acceptance tests are mapped to code and evidence
  in `IMPLEMENTATION_SUMMARY.md` §2. Every item has automated test coverage. One part of #15 (real
  pointer lock and mouse-look feel) **could not be verified** because the available browser refuses
  pointer lock. It is reported as unverified, not passed.
- No human playtest, review, or approval took place during this autonomous phase.

## Remaining limitations

- The game was not playtested by a human, and pointer lock was only exercised through fake-DOM tests.
- The target is desktop Chromium; other browsers and low-end GPUs were not tested.
- Vite reports its 500 kB chunk advisory because Three.js dominates the bundle.
- Monster state resets on reload, which is allowed. Tools are cosmetic.

## 2026-11-04 — Readability cleanup (OpenAI Codex)

The user requested a style cleanup of the current source and documentation, with authorship and
verification records kept accurate. This pass covered the full game now present in this directory.

Changes:

- Shortened repeated module descriptions and removed decorative comment dividers. Retained comments
  explaining coordinate conventions, data formats, algorithms, browser quirks, and lifecycle rules.
- Simplified the README around installation, controls, gameplay, tests, layout, and limitations.
  Corrected its Node.js requirement to match the installed Vite package's engine range:
  `^20.19.0 || >=22.12.0`.
- Removed repeated architecture and feature prose from `IMPLEMENTATION_SUMMARY.md`. Its module and
  requirement tables are unchanged. Browser and performance figures are explicitly identified as
  implementation-phase evidence, not measurements taken during this cleanup.
- At the time of this cleanup, the earlier foundation log and collaboration entries were
  preserved without modification, including their test results and verification limits.
- Made no changes to executable JavaScript, CSS rules, gameplay, interfaces, test files, specifications,
  HTML, or dependencies.

Checks actually performed:

- `pwd`, a filtered `rg --files` search for local `AGENTS.md`, comment searches, and targeted source
  and documentation reads. No local `AGENTS.md` was found; supplied instructions applied.
- `git status --short --branch`: still reports that this directory is not a Git repository. No Git
  operations changed history.
- `npm test` before edits: 743 passed, 0 failed.
- Saved a temporary comparison baseline in the ignored `node_modules/.cache/readability-review/`
  directory. Used the already installed `rolldown/parseAst` parser to compare all 53 source modules
  before and after, excluding source-position metadata: every syntax tree is identical.
- Compared the stylesheet with comments removed: all CSS rules are identical. Byte comparisons
  confirmed that 49 protected files (including specifications, dependency files, tests, HTML, and
  `FOUNDATION_LOG.md`) were unchanged. Every table in the implementation summary was also unchanged.
- `npm test` after edits: 743 passed, 0 failed; no cancelled, skipped, or todo tests. Output was captured
  temporarily for inspection. No test cases or dependencies were added.
- `npm run build`: succeeded in 1.14 s, transforming 59 modules. Output: 666.71 kB JavaScript
  (181.67 kB gzip), 17.65 kB CSS (4.27 kB gzip). Vite still reports the existing >500 kB chunk advisory.
- No new browser playtest or performance measurement was performed for this comment/documentation pass.
- Final comparisons confirmed that earlier collaboration entries remained an exact prefix of this log.
  Removed the temporary comparison baseline and captured test output after verification.

The prior gameplay and browser limitations still apply.


## 2026-11-07 — Documentation scope clarification

Clarified the distinction between the original ten-block static-scene prototype and
the later full-game implementation in `FOUNDATION_LOG.md`, this log, and
`IMPLEMENTATION_SUMMARY.md`. Earlier SHA-256 comparisons in this log describe their
respective historical checks, not the contents of these revised documents. This
clarification changed no game source, tests, specifications, or runtime assets.
