# Voxel Grove

A small, Minecraft-inspired voxel sandbox that runs in the browser. Explore a
hand-sized floating island generated from seed 42, dig into its hills with a
pickaxe, axe or shovel, and build with five kinds of blocks. Mining and
building are animated: you see your hand swing the tool, the block crack
and burst into fragments, or a translucent block grow into place. Your
changes are saved automatically.

The island is not entirely friendly: three **Mosslings** and a hulking
**Stoneguard** roam it. They wander until you come close, then chase and
attack. Fight back with your tool, watch your hearts, and respawn if you fall.
Respawning never touches your saved island.

Built with plain JavaScript (ES modules), [Three.js](https://threejs.org/) and
[Vite](https://vite.dev/). No backend, no external assets: every texture,
icon and model is generated procedurally at startup.

## Requirements

- Node.js 18 or newer (developed with Node 25) and npm
- A modern desktop browser with WebGL 2 (Chrome / Edge recommended)

## Setup

```bash
npm install
```

## Run

Start the development server, then open the printed URL (usually
<http://localhost:5173>):

```bash
npm run dev
```

Build an optimised production bundle into `dist/`:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

Run the automated logic tests (world generation, physics, block rules, timed
actions, persistence, monsters and combat) with Node's built-in test runner:

```bash
npm test
```

## How to play

Click **Play** on the title screen. The game captures your mouse (pointer
lock) so you can look around freely. Press **Esc** at any time to release the
mouse and open the pause menu; click **Resume** to continue.

| Control | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse | Look around |
| `Space` | Jump (only when standing on the ground) |
| Left click | Attack the monster under the crosshair (within 3 units); otherwise mine the block (about 1 second) |
| Right click | Build the selected block against the targeted face (about 1 second) |
| `1`–`5` | Select Grass, Dirt, Stone, Wood or Leaves (mouse wheel also cycles) |
| `Q` | Switch tool: Pickaxe → Axe → Shovel |
| `Esc` | Release the mouse / pause |

### Mining, building and tools

- Your right hand and the active tool are always visible in the lower-right
  corner. They breathe gently when idle, bob as you walk, lag slightly behind
  quick turns, dip when you land, and get darker in shade.
- **Mining** (left click): the hand swings the tool three times. Cracks
  spread across the block and chips fly off with each strike. On the third
  strike the block shatters into fragments and is removed.
- **Building** (right click): a translucent preview of the selected block
  grows out of the face you clicked, inside a glowing outline, while sparks
  gather around it. When it is complete, the real block appears with a puff
  of dust. The block type is the one that was selected when you clicked.
- A ring around the crosshair shows progress. Only one action runs at a
  time; extra clicks are ignored while it runs. Hold the button to keep
  mining or building block after block.
- An action stops without changing the world if you walk out of reach, step
  into the space being built, pause the game, or reset the world. Its
  effects disappear immediately.
- **Tools are cosmetic.** `Q` changes what your hand holds and the tool name
  shown next to the hotbar. It never changes which blocks you can edit or how
  long it takes. Block selection (`1`–`5`) is completely separate.

### Monsters, health and combat

| Monster | Health | Damage per hit | Speed | Looks |
| --- | --- | --- | --- | --- |
| Mossling (×3) | 40 | 10 | 1.3 units/s | small dark-green moss blob with glowing eyes and a flowered sprout; hops |
| Stoneguard (×1) | 60 | 15 | 0.8 units/s | tall grey stone golem with mossy shoulders, glowing eyes and an amber core |

- **Spawning.** Monsters appear on solid ground (never inside terrain, on
  trees or outside the world), more than 8 units from where you spawn.
- **Behaviour.** They **wander** slowly while you are far away. They
  **chase** you once you are within 10 units, hopping up one-block steps and
  sliding along walls (they cannot pass through blocks or trees). They
  **attack** when within 1.75 units with nothing in between: a short wind-up
  (a lunge, or a two-armed slam), then the hit, at most once every 1.5
  seconds. Step away during the wind-up and it misses.
- **Your health.** 100 HP, shown as ten hearts (half hearts for 5 HP) plus a
  number above the hotbar. There is no regeneration. A hit flashes the screen
  red, shakes the hearts, jolts your view and knocks you back. Below 30 HP the
  screen edges pulse red.
- **Fighting back.** Aim at a monster within 3 units and left-click. The
  crosshair turns red when one is in reach. Each hit deals 25 damage
  (Mosslings fall in 2 hits, the Stoneguard in 3) and is limited to one
  every 0.6 s; a small meter under the crosshair shows the cooldown. You
  can't hit through blocks. Struck monsters flash, get knocked back and shed
  fragments. Defeated ones topple over and burst into voxels. A click on a
  monster during the cooldown does nothing; it never mines the block behind
  it.
- **Death and respawn.** At 0 HP, play stops, the view falls over and the
  death screen appears. **Respawn** restores 100 HP, returns you to the safe
  spawn point, and resets all monsters to full health at their spawn spots.
  Your saved block changes are untouched.
- Nothing can hurt you while the game is paused, on the death screen, or in
  a background tab (switching tabs pauses the game). **Reset world** also
  restores your health and the monsters.

### Rules of the world

- The island is 32 × 32 blocks (horizontal coordinates 0–31) and 48 blocks
  tall. You cannot edit outside it, and invisible walls keep you on the island.
- You can edit blocks up to **6 units** from the camera. The highlighted
  outline shows exactly which block you are targeting; nothing is outlined
  when the closest block is out of reach.
- You cannot place a block where it would overlap your body or a monster.
- The rock base hanging under the island is indestructible, so you can never
  fall out of the world (you can still build on it if you dig all the way
  down).

### Saving and resetting

- Every block you mine or build is saved to your browser's `localStorage` the
  moment the action completes, so a refresh keeps your island exactly as you
  left it. Cancelled actions save nothing.
- **Reset world** (on the title and pause menus) asks for confirmation, then
  erases your saved changes and restores the original island generated from
  seed 42.
- If saved data is ever unreadable, the game ignores it, tells you, and starts
  from the original island instead of crashing.

## Project structure

```
index.html              App shell: canvas, HUD, menus, reset dialog
src/
  main.js               Entry point (starts the game, shows a WebGL error if needed)
  Game.js               Orchestrator: renderer, frame loop, state machine, input wiring
  config.js             Tunable constants (world size, physics, reach, storage key)
  world/
    blocks.js           Block ids, names, textures and the hotbar order
    terrain.js          Deterministic seeded terrain + tree generation
    World.js            Voxel storage, bounds, edits diff, reset, safe spawn search
    mesher.js           Face-culled, ambient-occluded voxel mesh builder
  player/Player.js      AABB physics: gravity, jumping, per-axis collision
  player/Health.js      Player health (0–100, clamped, no regeneration)
  entities/
    mobTypes.js         Mossling / Stoneguard stats and the spawn list
    Body.js             Creature collision body (same voxel rules as the player)
    Mob.js              Creature AI: wander / chase / attack / dying
    MobManager.js       Safe spawning, fixed-step updates, targeting, line of sight
    PlayerCombat.js     Melee targeting, damage and cooldown
  interaction/
    raycast.js          Voxel DDA raycast (exact block under the crosshair)
    BlockInteraction.js Break/place validation (reach, bounds, player overlap)
    BlockActions.js     Timed one-at-a-time mining/building with cancellation
  persistence/storage.js localStorage save/load/clear with validation
  render/
    textures.js         Procedural 16×16 pixel-art textures
    WorldRenderer.js    Chunked meshes rebuilt on edit + decorative rock base
    Environment.js      Sky shader, sun/shadows, fog, clouds, islets, motes
    effects.js          Target highlight
    FirstPersonRig.js   First-person voxel arm + tool, all hand animations
    tools.js            Procedural pixel-art pickaxe/axe/shovel (3D models + HUD icons)
    voxelModel.js       Vertex-coloured voxel model builder (arm, tools)
    actionEffects.js    Crack overlay (10 stages) and construction ghost
    particles.js        Pooled voxel debris and spark particles
    mobModels.js        Voxel Mossling and Stoneguard models
    MobRenderer.js      Creature animation, hit flash, health bars, shadows, death bursts
  input/Input.js        Keyboard/mouse state
  ui/UI.js              Menus, hotbar, tool panel, progress ring, hearts, death screen, toasts
  style.css             Interface styling
tests/                  Node test suites for the pure game logic
```

See `IMPLEMENTATION_SUMMARY.md` for architecture notes, design decisions,
the tests that were run, and known limitations.
