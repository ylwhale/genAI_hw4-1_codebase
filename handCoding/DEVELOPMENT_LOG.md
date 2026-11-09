# Voxel Grove development log

This log records the implementation milestones, technical decisions, validation results, fixes, and remaining limitations of Voxel Grove. `SPEC.md` defines the base requirements; `EXTENSION_MOBS_HEALTH.md` defines the combat extension.

## Preparation
- Read all of `SPEC.md` and inspected the supplied Vite starter, dependencies, and local files.
- Found JavaScript ES modules, Vite 8, and Three.js already installed. Node v25.2.1 and npm 11.6.2 are available.
- Initialized a local Git repository for tracking changes to the starting project files.
- Assumptions: use a bounded vertical world in addition to the specified horizontal bounds; keep the player within the island's horizontal extent to avoid falling into an unbounded void. These details are not prescribed by the specification.

## Milestone 1 — Basic 3D scene
- Intent: verify the rendering pipeline before implementing world generation.
- Approach: one scene, perspective camera, WebGL renderer, shared cube geometry, hemisphere light, and directional sunlight. A small 5 × 5 group of blocks checks depth, lighting, and resize behavior.
- Changed: `src/main.js`, `src/style.css`, `index.html`, and this log. Replaced the starter interface with a canvas and set the game title.
- Validation: pending build and actual browser inspection below.
- Adjustment: replaced the starter interface files with the initial scene implementation. No application failure was observed.
- Limitations: no terrain, controls, or interactions are implemented in this milestone.
- Validation completed: `npm run build` passed. Ran `npm run dev -- --host 127.0.0.1` and inspected the scene in a browser. Lit cubes and depth displayed correctly, with no console warnings or errors.
- Build observation: Vite reports the Three.js bundle exceeds its default 500 kB advisory threshold; build succeeds. No premature bundle restructuring.

## Milestone 2 — Voxel world
- Intent: deterministic 32 × 32 terrain with hills, all five materials, trees, and safe spawn.
- Approach: a 32 × 48 × 32 byte array; integer coordinate validation; seeded integer hash and smooth value noise for heights; stone/dirt/grass layers; spaced tree candidates with trunk and crown blocks. A clear plateau surrounds the spawn. One indexed mesh contains only exposed faces, avoiding thousands of separate scene objects.
- Reason: bounded storage is simple to query for future collision and edits. Exposed-face meshing is a small, justified rendering optimization for this world size.
- Changed: `src/world.js`, `src/world-mesh.js`, `src/main.js`, `tests/world.test.js`, `package.json`, and lockfile (project name).
- Validation: `npm test` passed 3 tests; `npm run build` passed; `npm install --package-lock-only --ignore-scripts` synchronized metadata. Browser inspection showed hills, layered sides, and trees; warning/error logs remained empty.
- Seed-42 SHA-256: `ec25728208132ecfafbb22168af24ca20ecb222711995f874cb333b60b378945`.
- Problems: none discovered in the world checks. The existing bundle-size advisory remains.
- Limitations: colors are flat pending the visual polish milestone; the vertical editing boundary is 48 blocks, a documented implementation choice.

## Milestone 3 — Player controls and physics
- Intent: first-person mouse look, WASD movement, grounded jumping, gravity, and solid collision.
- Approach: player feet position plus a 0.6 × 1.75 collision box; fixed 1/120-second simulation; separate axis resolution for wall sliding; capped frame delta and fall speed. Mouse yaw/pitch use pointer lock. Jump input is an edge request, consumed once, rather than held auto-jumping. Focus loss clears keys and releases capture.
- Reason: small fixed steps prevent tunneling at the chosen movement speeds, and axis resolution is straightforward to inspect and test. Safe-spawn search also anticipates saved edits occupying the clearing.
- Changed: `src/physics.js`, `src/controls.js`, `src/main.js`, `tests/physics.test.js`.
- Validation: `npm test` passed 7 tests (4 physics, 3 world); `npm run build` passed. Browser preview confirmed a first-person view. Pointer-lock requests were rejected with `UnknownError` in the test browser, so captured-input gameplay was not verified.
- Resolution: handled the rejected pointer-lock request and displayed a useful message without an uncaught rejection. Physics behavior was validated by simulation tests; live captured mouse movement and held-key input still require a compatible desktop browser check.
- Limitations: no menu yet (scheduled for milestone 5). World boundaries are solid horizontal walls and a floor at y=0, even if the lowest block layer is removed.

## Milestone 4 — Block interactions
- Intent: visible-face targeting, removal, placement, number-key selection, six-unit reach, and invalid-operation protection.
- Approach: Three.js raycasting against the exposed-face mesh; a tiny inward face offset identifies the hit cell. A separate edit function validates reach, bounds, occupied cells, material, and player overlap. Successful edits replace and dispose the previous world geometry. An outline marks the target.
- Reason: raycasting the rendered surface selects the block the player actually sees, and a pure edit function makes safety rules independently testable.
- Changed: `src/interactions.js`, `src/main.js`, `src/style.css`, `tests/interactions.test.js`.
- Validation sequence: first ran `node --test tests/interactions.test.js` with removal/reach checks (2 passed); then added placement/invalid-placement checks and reran (4 passed); then connected input/render updates. `npm test` passed all 11 tests and `npm run build` passed.
- Problems: none in the observed interaction logic. End-to-end mouse-click gameplay remains unverified until pointer capture can be tested in a desktop browser.
- Limitations: rebuilding the whole small world's exposed-face geometry is intentionally simple; only optimize if measured editing costs warrant it. Final hotbar/menu arrives in milestone 5.

## Milestone 5 — Game interface
- Intent: a complete title/pause screen, control guide, Play/Resume button, crosshair, five-slot hotbar, selected state, and input gating.
- Approach: a small DOM UI module with explicit methods for playing state, selected material, target label, and brief feedback. Before first play, the actual world is shown from a slowly changing overview camera. Captured pointer state is the single condition for all gameplay input and physics; Escape naturally restores the menu.
- Changed: `src/ui.js`, `src/main.js`, `src/style.css`.
- Validation: `npm test` passed 11 tests; `npm run build` passed. Checked the title screen at a 653 × 788 browser viewport. The screenshot and accessibility inspection showed the title, Play button, control instructions, and expected layout. A Play attempt displayed the capture-error message without a new uncaught application error. DOM checks found exactly five slots, Grass selected, menu visible, HUD hidden, and no pointer lock. Pressing 5 while in the menu left Grass selected.
- Problems: the test browser did not permit pointer capture. The menu now handles the error without an unhandled rejection. Full desktop-input testing remains outstanding.
- Limitations: actual Escape/captured gameplay transitions need desktop Chromium verification. Reset is deliberately hidden until persistence is implemented next.

## Milestone 6 — Persistence and visual polish
- Intent: save/restore edits, deterministic reset, corrupt-save tolerance, and improved presentation without altering collision or editing rules.
- Approach: versioned localStorage payload containing only differences from generated terrain. Validate the entire payload before applying it. Catch storage getter/access/quota failures and keep in-memory play available. Reset restores the original byte array and removes the save; a two-click menu action prevents accidental resets.
- Visuals: original 16-pixel procedural grass, soil, stone, bark, wood-ring, and leaf textures in one atlas; per-vertex contact shading; warm shadow-casting sunlight; a gradient sky, distance haze, drifting block clouds, subtle dust motes, and slow decorative water. The world remains one mesh. Shadows update only when world geometry changes.
- Changed: `src/storage.js`, `src/textures.js`, `src/atmosphere.js`, `src/world-mesh.js`, `src/main.js`, `src/ui.js`, `tests/storage.test.js`, `tests/browser-checks.html`, `tests/browser-checks.js`.
- Validation: first ran the 4 storage tests independently; then `npm test` passed all 15 tests and `npm run build` passed. Inspected textured/shadowed and atmospheric browser screenshots. Three.js warned that `PCFSoftShadowMap` was removed; changed to the supported `PCFShadowMap`. No new rendering errors were observed after reloading.
- Real-browser persistence: opened `/tests/browser-checks.html`; removed a real grass block and placed wood through the actual edit function; wrote two edits under an isolated test key. Clicked its reload button. All 5 post-reload checks passed: restored payload, removal, placement, cleared key on reset, and byte-for-byte original terrain. Test browser warning/error logs were empty. The playable world's save was not used by this test.
- Real game reset: clicked Reset world and its second-click confirmation; observed the fresh-seed-42 message and Saved locally status.
- Measurement: a local Node geometry-rebuild probe produced 24,648 vertices / 12,324 triangles; four runs took 22.66, 11.64, 11.66, and 8.96 ms. Kept the simple full-world rebuild. These are local measurements, not a cross-device FPS benchmark.
- Limitations: this check used the available 653 × 788 browser viewport. Pointer capture remained unverified. Water, clouds, and motes are decorative and are excluded from voxel targeting and collision.

## Milestone 7 — Validation and completion
- Intent: audit the specification, exercise edge cases, verify the production artifact, and document actual limits.
- Approach: extend Node's built-in tests for boundary cases; extend the isolated browser harness for real UI components; serve the actual production build independently of the development server. No new runtime or test dependencies.
- Changed: added `README.md`, `vite.config.js`, `tests/controls.test.js`, `tests/mesh.test.js`, and `screenshots/voxel-grove.png`; extended physics/interaction/world/browser checks. Replaced the starter favicon with an original cube mark and removed unused starter assets/counter/icons. The Vite config explicitly binds local servers to loopback.
- Actual failure and fix: the first expanded test run passed 20/21 tests. The all-six-faces check found a strict data comparison difference between `-0` and `0` from Three.js face normals. Canonicalized zero components in `src/interactions.js`; reran mesh/interaction tests (7 passed), then the full suite (21 passed). This was a data normalization issue, not an observed walk-through or editing failure.
- Input validation: tested real control-handler code with synthetic EventTargets for pointer-state gating, key state, single-consumption jump requests, held-key repeat rejection, mouse pitch limits, and focus cleanup. This does not substitute for browser pointer-lock testing.
- Browser validation: extended the test page to instantiate the production UI module and renderer components. Checked title visibility, playing state, every material's unique selected slot, target material/distance text, and pause/Resume state. Reloaded via its actual button: all 10 post-reload storage/UI checks passed, zero failures, empty warning/error logs. Visually inspected the five-slot selected Leaves hotbar and textured first-person scene. This was explicitly labelled a component preview with no mouse capture.
- Viewport checks: the original game tab was 653 × 788. Other browser tabs measured 1280 × 720, confirmed by DOM dimensions and screenshots. The UI component preview and production title screen were checked at that size. No viewport override was kept.
- Production validation: `npm run build` passed (556.52 kB JS / 141.33 kB gzip, 6.69 kB CSS). Ran `npm run preview -- --host 127.0.0.1` and opened `http://127.0.0.1:4173/`; verified the production assets loaded, the title/Play/world rendered, five hotbar slots appeared, and no console warnings or errors were reported. Saved a production screenshot.
- Final checks: `npm test` passed 21/21 tests; `git diff --check` passed; `git diff 0445cfb --exit-code -- SPEC.md` passed, confirming the base specification was unchanged.

### Acceptance audit
| Specification check | Executed evidence |
| --- | --- |
| 1. Launch without blank screen | Actual development and production browser screenshots; production logs empty |
| 2. Move and look | Physics/control-event tests pass; live captured input unverified |
| 3. Jump and land | Gravity/grounded jump/airborne rejection/ledge simulation tests pass; live Space input unverified |
| 4. Solid collision | Wall sliding, ceilings, ledges, floor, all horizontal edges pass simulation tests |
| 5–6. Remove and place nearby blocks | Raycast/edit tests and actual browser edit functions pass; live captured clicks unverified |
| 7. Hotbar selection | All five UI selection states pass browser component checks; menu ignores number keys; live captured number-key selection unverified |
| 8. No placement inside player | Intersection rejection test passes with unchanged world data |
| 9. Six-unit limit | Exactly six units allowed; beyond six rejected by raycasting and edit validation |
| 10. Refresh persistence | Real localStorage, actual browser reload, removal and placement restored |
| 11. Reset | Browser reset clears isolated key and restores every original block; real menu's two-click reset message verified |
| 12. Production build | `npm run build` succeeds; built artifact launched in browser |

### Remaining limitations
- The test browser rejected pointer capture (`UnknownError`). Captured mouse movement, jumping, editing, hotbar input, and Escape release require a desktop Chromium smoke test; they were not recorded as completed manual checks.
- The default Vite bundle-size advisory remains non-fatal; no cross-device frame-rate benchmark was performed.
- Storage can be unavailable or full; the UI reports session-only changes. The finite world has solid outer/floor boundaries; decorative atmosphere is outside the editable voxel system. No player-position persistence, mobile support, audio, or out-of-scope game systems.
- No critical application logic failure remains known from the executed checks. Implementation is complete; full desktop input verification remains outstanding.

## Feature Extension — First-Person Tools and Interaction Effects

### Stage 1 — Existing architecture and implementation plan
- Read `SPEC.md`, `README.md`, and the earlier log, then inspected the camera/render loop, controls, hotbar, edit validation, world storage, save functions, mesh/atlas, and existing tests.
- Baseline: clean Git worktree at `162128d6cebde20112d67caf1566e5f3ae936340`; `npm test` passed 21/21. The earlier development server did not respond to a local HTTP request, so a new server was needed for visual testing.
- Plan: (1) add `src/first-person.js` for a camera-child hand and three procedural tools, rendered in a separate depth-cleared foreground pass; add Q handling and a small HUD label while retaining number-key block selection. (2) add reusable delta-time swing motion. (3) extract non-mutating validation from `editBlock`, then add `src/interaction-controller.js` for one one-second operation with validation before and during execution. (4) add `src/interaction-effects.js` for progressive crack textures and a bounded particle pool. (5) extend the same controller/effects for translucent construction previews and captured block selection. (6) exercise cancellation, focus/menu/reset, persistence, and cleanup; update documentation and run the production build.
- Reason: preserve the current world/physics/save architecture and keep visual effects outside the raycastable world mesh. A foreground pass avoids clipping the nearby hand into terrain. Shared validation avoids divergent immediate/delayed safety rules.
- Assumptions: cancel when the crosshair leaves the source block, reach is lost, source material changes, or placement becomes occupied/intersects the player. Placement remains tied to its initial face and material. Q will cancel any pending operation before changing the held tool. A click starts a single operation; holding the button is not required and does not auto-repeat.
- Known limitation carried forward: browser preview previously rejected pointer capture. Component previews and synthetic input tests are recorded separately from live captured-input verification.

### Stage 2 — Hand and tools
- Added a procedural right hand, sleeve, cuff, wooden handles, and distinct steel pickaxe/axe/shovel models in `src/first-person.js`. The hand is a child of the actual camera in a foreground scene; a second depth-cleared pass prevents terrain clipping and does not participate in world targeting. A shared box geometry/material set is disposed explicitly by the view's teardown method.
- Added capture-gated, non-repeating Q callbacks in `src/controls.js`, independent tool state/HUD in `src/main.js` and `src/ui.js`, and restrained HUD styling in `src/style.css`. Number-key block selection is unchanged. Added subtle idle motion and grounded movement bob; menu state hides the rig.
- Validation: `npm test` passed 22/22; `npm run build` passed. Focused `node --test tests/first-person.test.js tests/controls.test.js` passed 2/2 after the visual adjustment. Tests verify camera parenting/projected lower-right placement, hidden state, three distinct model dimensions, wraparound selection, Q gating, repeat rejection, and existing movement input handling.
- Browser: ran `npm run dev -- --host 127.0.0.1`. Port 5173 was occupied, so Vite selected 5174. Extended the component preview with the foreground renderer and tool buttons. Inspected Pickaxe, Axe, and Shovel; HUD labels updated, and console logs contained no warnings or errors. Save/UI checks still passed. Reduced the initial hand/tool scale to 0.7 and adjusted the horizontal anchor for a clearer view.
- Files: `src/first-person.js`, `src/main.js`, `src/controls.js`, `src/ui.js`, `src/style.css`, `tests/first-person.test.js`, `tests/controls.test.js`, `tests/browser-checks.js`.
- Limit: preview buttons exercise model/UI selection; actual pointer-captured Q/gameplay has not yet been verified. No delayed edit behavior is connected at this stage.

### Stage 3 — Reusable hand animation
- Added a non-blocking swing timeline to `src/first-person.js`: three soft chopping strokes for removal and a forward construction motion for placement. Delta-time progress returns exactly to the resting rotation; overlapping starts are rejected. Hiding the rig, cancelling, or switching tools clears the swing.
- Reason: keep all view-model motion in the existing foreground component and accept duration explicitly, so the later interaction controller can use the same one-second interval.
- Files: `src/first-person.js`, `tests/first-person.test.js`, `tests/browser-checks.js` (standalone Preview swing button).
- Validation: `node --test tests/first-person.test.js` passed 2/2; `npm run build` passed. Tested matching half-time/completion at 20, 60, and 120 updates per second, overlap rejection, cancellation, return to rest, and menu hiding. Clicked Preview swing in the browser and inspected a mid-swing screenshot: the tool moves inward/down toward the working area with a visible forearm, leaving the crosshair clear.
- Problems: none observed in these checks. No world edits are delayed or connected to this swing yet. Actual captured gameplay input remains unverified.

### Stage 4 — Animated destruction
- Extracted `validateEdit` in `src/interactions.js`, keeping `editBlock` as the validated mutation primitive. Added `src/interaction-controller.js` to run one one-second destruction operation, validate continuously, reject overlap, and commit once. Source changes, lost aim/reach, menu/focus/tab interruption, Q, and reset cancel it.
- Added `src/interaction-effects.js`: four cumulative procedural crack textures, a temporary overlay, and 48 reusable voxel-particle slots with finite lifetimes. Geometry/material/texture resources are shared for the component lifetime and explicitly disposed on teardown. Effects are outside the raycast mesh. Wired swing, cracks, debris, progress UI, world rebuild, and saving only on completion into `src/main.js`.
- Tests: independent controller/edit checks passed 8/8; independent effects/controller checks passed 4/4; `npm test` passed 27/27; `npm run build` passed. Tested all five materials across 20/60/120 Hz, unchanged data at 0.99 seconds, a single commit at one second, invalid starts, overlap, cancellations, 50 effect start/clear cycles with stable scene children, and disposal events.
- Browser: inspected mid-operation grass, stone, and wood fixtures through the actual raycast/controller/effects. Each block remained rendered while cracks, particles, swing, and percentage progressed. Observed successful completion for all three and final zero particles, hidden cracks, and a resting hand. Browser warning/error logs were empty.
- Problems/fixes: found that the removal-start success branch could report an undefined failure reason. Corrected the conditional before browser testing. The first preview completion wait timed out; subsequent inspection showed it completed safely. The preview was still passing its old capped delta to the controller, slowing operations when background-tab frames were throttled. Changed it to the actual elapsed delta, matching production (physics remains capped). Rechecked stone and wood completion.
- Files: `src/interactions.js`, `src/interaction-controller.js`, `src/interaction-effects.js`, `src/main.js`, `src/ui.js`, `src/style.css`, `tests/timed-interactions.test.js`, `tests/effects.test.js`, `tests/browser-checks.js`.
- Limit: right-click placement remains immediate only in this intermediate stage; it is the next change. Actual captured mouse input is still unverified.

### Stage 5 — Animated placement
- Extended the same controller to placement, preserving the selected block and source face at start. Validation runs without mutations throughout the one-second preview and again at commit. Conflicting clicks are ignored by the shared busy state; moving into the destination, new occupancy, a different face/target, or interruption cancels safely.
- Added a translucent textured preview, light edges, smooth assembly growth, inward-moving voxel particles, and a forward hand motion using the existing effects/view components. The preview reuses the world atlas; effects teardown deliberately does not dispose that shared atlas. No geometry is added to collision/storage before completion.
- Files: `src/interaction-controller.js`, `src/interaction-effects.js`, `src/main.js`, `tests/timed-interactions.test.js`, `tests/effects.test.js`, `tests/browser-checks.js`.
- Validation: placement controller checks passed 6/6; combined effects/controller checks passed 8/8; `npm test` passed 31/31; `npm run build` passed. Tests cover unchanged data at 0.99 seconds, captured material, once-only completion, overlap, moving-player collision, occupied cells, changed face, menu interruption, invalid bounds/reach/materials, preview growth/transparency, and shared atlas ownership.
- Browser: clicked Build wood and observed a translucent preview, construction debris, forward hand motion, and an empty destination at progress 0.575. Observed successful placement with no residual effects. Started another build and selected Grass mid-operation; observed Grass selected at progress 0.591 while the destination stayed empty. Completion still placed captured Wood, with zero particles, hidden preview, no active swing, zero failed browser checks, and empty warning/error logs.
- Problems: none observed in placement checks. Full captured-input play remains unverified; integration/refinement follows next.

### Stage 6 — Integration and refinement
- Added `tests/extension-integration.test.js` to connect real world data, player physics, hand motion, effects, controller, and the existing storage functions. Completed edits save once; partial/cancelled actions never save. Physics continues during the animation, and walking into a construction cell cancels it before a block can appear.
- Refinements: expose/copy the actual raycast hit point so destruction debris originates near the clicked surface point; keep the source/destination safety rules unchanged. Added tests for foreground renderer-state restoration, narrow-aspect placement, and a long render frame that must still revalidate reach. No world-generation, physics, save-format, dependency, or framework changes.
- Memory/resource checks: 50 alternating cancelled remove/place operations retain the same effect scene objects, leave zero live particles and no visible overlays, preserve every world byte, and perform zero saves. Existing disposal-event checks cover owned geometry/materials/crack textures; the world atlas remains caller-owned. These verify bounded allocation/lifecycle, not a claim of a full heap-profiler audit.
- Browser integration: cancelled construction mid-operation and observed progress 0.267, unchanged world/save, zero particles, hidden preview, and no swing. Paused during stone destruction and observed the menu/HUD transition and complete effect cleanup. Completed a build through the real frame loop, then used Reload timed save: the restored world matched the pre-refresh array byte-for-byte; the isolated reset removed that save and restored seed 42. Browser warning/error logs were empty for the component tests. Test saves use separate keys from playable-world data.
- Game preview: opened the development game at port 5174 and inspected the Q guide. Play displayed the handled mouse-capture error, leaving pointer lock off and HUD/progress hidden. Pressing Q and 5 in the menu did not change the selected Pickaxe or Grass block.
- Observed layout issue: the extra Q control row left Reset too close to the footer at 1280 × 720. Added a height-specific footer-spacing rule and visually rechecked the title/error-message layout.
- Commands: focused integration/interaction tests passed 9/9; final `npm test` passed 37/37; `npm run build`, `git diff --check`, and `git diff 162128d --exit-code -- SPEC.md` passed.
- Files: `src/interactions.js`, `src/interaction-controller.js`, `src/interaction-effects.js`, `src/style.css`, `tests/extension-integration.test.js`, `tests/interactions.test.js`, `tests/first-person.test.js`, `tests/timed-interactions.test.js`, `tests/browser-checks.js`.
- Limit: live pointer-captured movement, Q, and mouse-button gameplay cannot be claimed as verified in this environment. The original gameplay regression tests remain green; actual desktop Chromium input is still a manual smoke-test requirement.

### Stage 7 — Final validation and delivery
- Updated `README.md` for Q, independent tool/block selection, one-second clicking semantics, cancellation rules, save compatibility, component responsibilities, developer preview instructions, actual test results, and limitations. Updated the actual production title screenshot and added an explicitly labelled live component screenshot of stone damage, particles, and the held pickaxe. No assets/models/dependencies were downloaded.
- Final executed commands: `npm test` passed 37/37; `npm run build` passed; `git diff --check` and `git diff 162128d --exit-code -- SPEC.md` passed. The production output is 568.87 kB JavaScript / 145.59 kB gzip and 7.39 kB CSS / 2.48 kB gzip. Vite's existing bundle-size advisory is non-fatal.
- Production check: reloaded the existing `http://127.0.0.1:4173/` preview. It served the rebuilt `/assets/index-BEHANr3H.js`, displayed the Q guide, retained Grass/Pickaxe defaults, kept interaction progress hidden in the menu, and had empty browser warning/error logs. Its actual viewport was 653 × 844; the component preview remained 1280 × 720. No viewport override was used in this extension.
- Final browser run: captured a live frame-loop stone-destruction screenshot with the block still present. An adjacent DOM sample recorded progress 0.382, damage stage 1, 14 particles, and an active swing. Observed completion and used Reload timed save. The combined animated/original save and UI checks reported 13 passes, zero failures, `passed-after-reload`, zero particles, hidden preview, and no swing; warning/error logs were empty. Isolated animated and original test saves were cleared by their reset checks.
- Final changed files: `src/first-person.js`, `src/interaction-controller.js`, `src/interaction-effects.js`, `src/interactions.js`, `src/controls.js`, `src/main.js`, `src/ui.js`, `src/style.css`; `tests/first-person.test.js`, `tests/timed-interactions.test.js`, `tests/effects.test.js`, `tests/extension-integration.test.js`, `tests/controls.test.js`, `tests/interactions.test.js`, `tests/browser-checks.js`; `README.md`, `DEVELOPMENT_LOG.md`, `screenshots/voxel-grove.png`, `screenshots/tools-preview.png`.
- Aggregate diff from the extension baseline `162128d`: 19 files changed, 994 insertions, 32 deletions, including the two screenshot changes. Statistics were obtained from `git diff 162128d --stat` / `--shortstat` after staging the final deliverables.

### Extension acceptance audit
| Requirement | Executed evidence |
| --- | --- |
| 1. Right hand visible | Actual foreground component screenshot; camera-parenting, lower-right projection, and menu hiding tests |
| 2. Three distinguishable tools | Inspected Pickaxe/Axe/Shovel via component buttons; distinct geometry and cyclic selection tests |
| 3. Q changes held tool | Real control-handler EventTarget test verifies capture gating/non-repeat callback; actual menu Q does nothing; live captured Q unverified |
| 4. Breaking triggers hand animation | Browser grass/stone/wood operations and standalone swing screenshot; controller/view integration tests |
| 5. Progressive cracks and particles | Actual mid-operation screenshots; four-stage damage and bounded/cleanup tests |
| 6. Delayed destruction | Data unchanged at 0.99 simulated seconds, removed at completion across 20/60/120 Hz; real frame-loop preview shows retained block mid-operation |
| 7–8. Construction preview and delayed addition | Browser translucent Wood build; empty destination mid-operation; completion/cleanup; all materials tested at varied update rates |
| 9. Invalid/cancelled actions preserve data | Reach/bounds/player/source/face/occupancy/interruption tests; browser cancellation checks; 50 alternating cancellations preserve world/save/render objects |
| 10. Saving/loading works | Commit-only storage integration tests and real browser animated save/reload byte comparison/reset |
| 11. Existing gameplay preserved | All original world, mesh, physics, raycast/edit, storage, and control regression tests pass; movement tested during construction; live captured play remains unverified |
| 12. Production build | Build succeeds; actual rebuilt bundle and title screen verified with empty browser logs |

### Extension limitations
- The test browser did not permit pointer capture. Live captured movement/jumping, Q cycling, mouse-driven gameplay, and Escape release remain unverified. Component and synthetic input checks are not represented as live gameplay checks.
- No full heap-profiler or cross-device performance benchmark was performed. Bounded pools, repeated lifecycle tests, disposal events, and actual browser rendering were checked. Vite's advisory remains.
- Click-to-complete requires continuing to aim at the source block (and the same face for placement). Q intentionally cancels before switching tools. These routine interaction choices were stated up front; no unrelated gameplay systems were added.
- No critical logic failure remains known from the executed checks. `SPEC.md`, seed 42 terrain, physics, save format, and dependencies are preserved. The prior development history and stage commits remain intact.

## Combat Extension — Implementation and Testing

### Stage 1 — Architecture review and plan
- Read `SPEC.md`, the supplied `EXTENSION_MOBS_HEALTH.md`, README, prior development history, and the relevant world/storage, physics, controls, raycast/edit, timed interaction, UI, first-person, and rendering code. Baseline: `55d1a5ef4b6b8c54c4839893e90d2f45ebb5f413`; existing 37 tests passed. The supplied extension specification was present as an untracked file and was kept unchanged for inclusion in the repository.
- Specification SHA-256 values before changes: original `fe8d48dd51ae707bc7c19f22c71f8742c0c94682fa7b9dcbdfad9e07769ad585`; extension `d08ad68e7cef483a77dcc1824ff81c1a4bcdbdd8338a9e379ee07108815acb06`.
- Plan: (1) add pure enemy records/spawning in `src/mobs.js` and original geometric models in `src/mob-view.js`; parameterize the existing AABB collision dimensions instead of duplicating physics. (2) add deterministic wander/chase/attack states and voxel line-of-sight checks. (3) add separately testable health in `src/health.js` and health/damage UI. (4) add melee target resolution/cooldowns in `src/combat.js`, compare actual mob/block raycast distances, and reuse the held-tool swing. (5) connect death/respawn to existing pause, cancellation, safe spawn, and enemy reset. (6) refine visuals and test all 16 acceptance checks plus existing regressions.
- Integration files: `src/main.js`, `src/physics.js`, `src/ui.js`, `src/style.css`, and `src/first-person.js`, with focused tests and an isolated combat browser preview. Existing world generation, edit validation, and save format remain authoritative.
- Assumptions: enemy range measurements use 3D distance between entity feet; player melee uses actual visible geometry distance from the camera. Blocked enemies may stop/turn rather than use expensive pathfinding. Respawn preserves edits, restores 100 HP, and recomputes safe enemy positions; enemy/health state is session-only. All gameplay simulation/damage pauses with menus, hidden tabs, or death.
- Browser pointer-lock limitations from previous stages remain recorded; component checks are not represented as completed live gameplay tests.

### Stage 2 — Enemy entities and valid spawning
- Added `src/mobs.js` with separate type/position/HP/speed/damage/state records, deterministic safe-column selection, three Mosslings and one Stoneguard, eight-unit horizontal spawn exclusion, two-unit separation, and identity-preserving reset. Spawn selection prefers ground over tree crowns; the existing world floor remains valid support in fully excavated columns. No world blocks are modified.
- Added original box-geometry models in `src/mob-view.js`, shared geometry, per-model materials, explicit disposal, and a hit-mesh list for later targeting. Parameterized `collides`/`moveAxis` in `src/physics.js` with optional entity dimensions; the player keeps its original defaults. Connected static enemies to the game and world reset.
- Validation: first focused run passed 8/9; rotated visual corners exceeded the chosen fixed collision footprint. Narrowed model X/Z scales (Mossling 0.85, Stoneguard 0.9); reran `node --test tests/mobs.test.js tests/physics.test.js` (9/9 passed), then `npm run build` passed.
- Browser: ran the local development server; occupied ports 5173/5174 led Vite to select 5175. Added `/tests/combat-checks.html` and its script as an isolated component preview. Both spawn checks passed; inspected Mossling and the larger Stoneguard via their preview controls, with empty warning/error logs.
- Files: `src/mobs.js`, `src/mob-view.js`, `src/physics.js`, `src/main.js`, `tests/mobs.test.js`, `tests/combat-checks.html`, `tests/combat-checks.js`.
- Limitations: enemies are static until the next stage; no behavior/damage claims yet. Real pointer-captured gameplay remains unverified.

### Stage 3 — Enemy behavior
- Implemented deterministic wander/pause decisions, ten-unit chase, 1.75-unit attack selection, and individual 1.5-second attack cooldowns in `src/mobs.js`. Movement/gravity use the shared collision solver with fixed substeps. Blocked actors stop/turn rather than pass through terrain; no expensive navigation system was introduced.
- Added exact crossed-voxel traversal in `src/visibility.js` for attack line-of-sight. Stone, wood, leaves, grass, and floor obstructions block attacks. A false/fatal attack callback immediately stops the remaining enemy updates.
- Incremental checks: wander/gravity tests passed 2/2 before chase was added; chase tests passed 3/3 before attacks were added; the resulting AI/physics checks passed 11/11. `npm test` passed 45/45; `npm run build` passed.
- Browser: actual component state snapshots showed all four wandering, all four chasing after approach, then two attacking while the other two chased. The callback recorded two attacks from separate enemies. Player health is deliberately not connected until stage 4. The preview has explicit active/pause controls; it does not claim captured input testing.
- Files: `src/mobs.js`, `src/visibility.js`, `src/main.js`, `tests/enemy-ai.test.js`, `tests/combat-checks.js`.
- Problems: none observed in the state/collision/cooldown checks. Simple blocked movement is intentional and permitted by the specification; enemies can remain behind obstacles.

### Stage 4 — Player health
- Added `src/health.js` with 100 maximum/starting HP, positive finite damage only, zero clamping, dead-state detection, active-state protection, and explicit full restore. No timer/regeneration/status-effect system was added.
- Connected enemy callbacks to health, stopped movement/interactions at zero, and added a numeric accessible health bar plus brief damage vignette/HP feedback in the existing UI. Dead, paused, and hidden gameplay gates reject further damage. The full death/respawn overlay follows in stage 6.
- Validation: independent health tests passed 2/2; full `npm test` passed 47/47; `npm run build` passed. Browser component hit reduced HP from 100 to 90 and synchronized `aria-valuenow` and the visible `90 / 100` label; paused damage left both unchanged. The damage-feedback layer is driven by the frame loop.
- Files: `src/health.js`, `src/main.js`, `src/ui.js`, `src/style.css`, `tests/health.test.js`, `tests/combat-checks.html`, `tests/combat-checks.js`.
- Problems: none observed in the damage arithmetic or UI synchronization checks. Zero HP is frozen but has no respawn control yet in this intermediate stage; completion of that flow is required before final delivery.

### Stage 5 — Player melee combat
- Added `src/combat.js` to compare the nearest living-enemy mesh hit with the existing world raycast. Visible enemies within three camera units take 25 damage with a 0.6-second cooldown; nearer blocks retain mining priority. An enemy outside melee reach still occludes blocks behind its model. Attacks recast at the moment of damage, preventing stale targeting through a new wall.
- Reused the mouse handler and first-person view for a short attack swing. Mining/construction remain mutually exclusive with the held-tool animation; right-click placement and independent block/tool selection are preserved. Enemy target text displays name, HP, and distance. Death removes enemies from targeting immediately.
- Tests: `node --test tests/combat.test.js tests/first-person.test.js` passed 6/6; full `npm test` passed 50/50; `npm run build` passed. Checks cover two-hit Mosslings, three-hit Stoneguards, cooldown/pause, reach, actual mesh occlusion, wall priority, unchanged world data, and delayed mining of a nearer wall.
- Browser: real component buttons applied 25 damage, showed a held-tool swing and warm enemy hit color, blocked melee behind a stone wall, defeated the Mossling on the second hit, and reduced the Stoneguard from 60 to 35 HP. These are component tests; captured gameplay input remains unverified.
- Files: `src/combat.js`, `src/main.js`, `src/first-person.js`, `src/mobs.js`, `src/mob-view.js`, `src/ui.js`, `tests/combat.test.js`, `tests/combat-checks.js`.
- Problems: no combat logic failure was observed. The stationary model preview initially did not advance enemy hit-flash timers, though the normal game loop did. Effect timer handling and the brief death animation were refined in stage 7. Player death/respawn was the next integration step.

### Stage 6 — Death and respawn
- Added `src/respawn.js` as a small session-state operation: reuse safe player spawn, restore 100 HP, and reset existing enemy records. It never changes world data or calls storage. Main-loop death handling cancels pending edits/effects/swings, clears movement, releases pointer capture, and gates further simulation/damage. Q also checks the gameplay gate.
- Added a focused death dialog and Respawn button in the existing UI. Death takes priority over pointer-lock/menu transitions. Respawn requests capture from its button gesture; if capture fails, the safe restored game remains at the Resume menu. World reset also resets session combat/health, a fresh-world reset assumption consistent with its existing behavior.
- Validation: `node --test tests/respawn.test.js` passed 2/2; full `npm test` passed 52/52; `npm run build` passed. Tests cover lethal-step early stop, cancellation of half-completed construction, frozen dead enemies, full entity reset, a saved block obstructing the original spawn, and unchanged world/save bytes after respawn/reload.
- Browser: zero HP displayed the real death dialog with Respawn focused, menu/HUD hidden, and no held tool. A simulated lock-release UI update retained that dialog. Respawn restored 100 HP and all four enemies, checked clear/distant positions, and preserved both the isolated browser save and world bytes. Its disposable test key was removed afterward; playable saves were untouched. Browser warning/error logs were empty.
- Files: `src/respawn.js`, `src/main.js`, `src/ui.js`, `src/style.css`, `tests/respawn.test.js`, `tests/combat-checks.js`.
- Problems: none observed in this sequence. The component preview intentionally bypasses pointer capture; the production Respawn capture gesture remains part of the final live-input limitation check.

### Stage 7 — Combat effects and integration refinement
- Added elapsed-time walking/idle motion, attack lean/arm swing, blended hit-color fade, and a 0.4-second shrinking/tilting death effect. Enemy effects have a shared timer update usable by the stationary preview and normal enemy update steps. Defeated enemies stop acting immediately while their models complete the effect. Respawn restores the same model objects.
- An integration regression demonstrated that construction could start inside a creature (`true` instead of expected rejection). Added an optional occupancy predicate to the existing timed editor, checking both at start and throughout the preview. Main supplies living-enemy AABB occupancy using the shared dimension-aware collision helper. This also cancels when a creature enters a pending construction cell; dead creatures do not block building.
- Checks: the occupancy regression initially failed, then the localized fix passed. Combined enemy-behavior/respawn/spawn/occupancy checks passed 11/11. Effects/combat/occupancy checks initially passed 5/6 because strict equality distinguished JavaScript `-0` from `0` in an animation assertion; switched to a tolerance without changing production code. Rerun passed 6/6. Full `npm test` passed 55/55; `npm run build` passed.
- Resource validation: 100 hit/death/reset cycles retain identical mesh/material identities and dispose one shared geometry plus 20 owned materials on teardown. Browser four-enemy animation completed 120 rendered frames with stable counts of three geometries and one texture in the isolated arena. This is a bounded-resource observation, not a cross-device FPS or heap-profiler claim.
- Browser: inspected wandering poses and the larger Stoneguard, observed attack damage (100 to 80 HP) and subsequent natural zero-health death, respawned, and defeated a Mossling. Frame-loop diagnostics recorded the intermediate death effect and then zero visible dead models. Hit flash now expires in the stationary preview too. Existing tool/hotbar visuals remain visible.
- Files: `src/mobs.js`, `src/mob-view.js`, `src/physics.js`, `src/interaction-controller.js`, `src/main.js`, `tests/mob-effects.test.js`, `tests/combat-integration.test.js`, `tests/combat-checks.js`.
- Limitations: obstacles can stop enemies; no pathfinding, jumping, or mob-vs-mob separation is introduced. Actual pointer-captured gameplay still needs the final environment check.

### Stage 8 — Final regression and acceptance validation
- Extended enemy-behavior tests to both creature sizes across 20/60/120 updates per second: chase speed, collision with wood/leaves, containment within world bounds, and type-specific damage. Focused enemy-behavior checks passed 6/6. Final `npm test` passed 56/56; `npm run build` passed (25 modules, 578.76 kB JS / 149.15 kB gzip, 8.41 kB CSS / 2.73 kB gzip). The existing Vite bundle advisory remains non-fatal; no dependency changes were needed.
- Production: reloaded the actual `http://127.0.0.1:4173/` game and verified `/assets/index-9zxIAOLo.js`, the combat guide, 100 HP, and hidden death/HUD state in the title menu. Play still reported handled pointer-capture failure, leaving gameplay paused. Menu Q/5 input retained Pickaxe/Grass. The production warning/error log was empty. The first keyboard-input check did not reach the page. Repeating the menu check with another browser input method succeeded.
- Combat browser rerun: 14 passing checks, zero failures, empty warning/error logs. Observed health 100→90, paused protection, a nearer wall blocking melee, Mossling 40→15→0, Stoneguard 60→35→10→0, intermediate death-animation frames, death-dialog priority/focus, and Respawn restoring all four healthy enemies with a clear player and unchanged isolated localStorage/world bytes. Its disposable test save was removed.
- Original browser regression: observed stone cracks/debris and tool swing with the stone still visible at partial progress; completed it, built Wood while Grass was selected during progress, and saw an empty destination/unchanged save before completion. Combined actual browser reload checks reported 13 passes, zero failures, `passed-after-reload`, no particles/preview, and empty warning/error logs. Both original and animated isolated saves were reset; the playable save was untouched.
- Updated README controls, creature stats, combat/health/respawn semantics, architecture map, preview instructions, executed test counts, and limitations. Saved genuine screenshots of the rebuilt production title and the explicitly labelled combat component arena. Reviewed the final integrations and ran `git diff --check`; original and extension specification hashes match stage 1, and Git diffs against their original versions are empty.
- Final files: `src/combat.js`, `src/health.js`, `src/mobs.js`, `src/mob-view.js`, `src/visibility.js`, `src/respawn.js`; modified `src/main.js`, `src/physics.js`, `src/first-person.js`, `src/interaction-controller.js`, `src/ui.js`, `src/style.css`; `tests/combat.test.js`, `tests/combat-integration.test.js`, `tests/enemy-ai.test.js`, `tests/health.test.js`, `tests/mob-effects.test.js`, `tests/mobs.test.js`, `tests/respawn.test.js`, `tests/combat-checks.html`, `tests/combat-checks.js`; README, this log, `screenshots/combat-preview.png`, updated `screenshots/voxel-grove.png`, and the unchanged supplied `EXTENSION_MOBS_HEALTH.md` added for provenance.
- Aggregate diff from combat baseline `55d1a5e`: 26 files changed, 1,230 insertions and 42 deletions, including the two screenshot changes and the unchanged supplied extension specification. Obtained with `git diff 55d1a5e --shortstat` / `--stat` after staging all deliverables.
- The stages above summarize the implementation and validation sequence.

### Combat acceptance audit
| Criterion | Executed evidence and scope |
| --- | --- |
| 1. Both types render | Browser arena/screenshots show original green Mossling and larger grey Stoneguard; model dimensions/colors tested |
| 2. Four valid spawns | Deterministic count/type/stats, clear AABBs, support, bounds, eight-unit exclusion, edited-world reset tests; browser spawn checks |
| 3. Distant wander | Deterministic slow movement/pause tests and browser state/pose observations |
| 4. Nearby chase | Exact speeds and ten-unit state selection at varied update rates; browser chase preview |
| 5. Attack range/cooldown | 1.75-unit path/range and 1.5-second cooldown tests; real AI callbacks/damage in browser |
| 6. Solid-terrain collision | Both sizes tested against terrain, tree wood/leaves, gravity, and world bounds using shared collision solver |
| 7. Correct player damage | Health math, Mossling 10/Stoneguard 15 callback tests; browser health/UI synchronization |
| 8. Non-negative health | Oversized lethal hits clamp at zero; further/dead/paused/invalid damage ignored |
| 9. Damage/defeat enemies | Actual geometry raycasts, 25 damage, 0.6-second cooldown, two/three-hit tests; browser defeats both types |
| 10. No wall attacks | Enemy voxel-line tests and melee nearest-block occlusion; browser wall blocks hit |
| 11. Death screen | Lethal simulation stops immediately; browser natural and explicit zero HP shows focused Respawn dialog, with menu/HUD hidden |
| 12. Respawn reset | Safe spawn with saved obstruction, full health/enemy reset, identity preservation; actual browser Respawn button |
| 13. Preserve modifications | Byte-identical world/storage and reload tests; actual browser save preservation after respawn |
| 14. Block mechanics | All original raycast/edit/timed-animation/physics/save tests plus creature-occupancy cancellation; original browser animated mining/building/save regression |
| 15. Menus/controls | Existing control-handler tests, actual menu Q/5 gating, browser menu/hotbar/death transitions; captured movement/Q/clicks/Escape remain unverified |
| 16. Production build | Final build succeeds; rebuilt production bundle starts and renders |

### Combat limitations
- The test browser rejected pointer capture. Live captured movement/jumping, mouse-driven combat/mining/building, Q, Escape, and recapture from Respawn require a desktop Chromium smoke test. Component fixtures and synthetic input checks are not recorded as those live-input checks.
- Enemies use permitted simple obstacle stopping/sliding and can remain behind terrain; they do not jump, pathfind, or separate from each other. Health/enemies intentionally do not persist. World edits and the existing save format do persist.
- No cross-device FPS benchmark or full heap-profiler audit was run. Shared geometry/material reuse, 100 reset cycles, disposal events, and 120 browser frames with stable resource counts were checked. The existing bundle-size advisory remains.
- No critical implementation failure remains known from executed checks. These verification limits remain explicit; both specifications and prior development history are preserved.
