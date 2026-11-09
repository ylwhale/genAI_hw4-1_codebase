
# Voxel Grove — Game Specification

## Goal
Build a playable, visually appealing, Minecraft-inspired
3D voxel sandbox game for desktop browsers.

## Technology
- JavaScript (ES modules)
- Three.js for 3D rendering
- Vite for development and builds
- HTML and CSS for the interface
- No backend, multiplayer, or paid services
- No prebuilt Minecraft clone or game template

## World
- Generate a 32 x 32 voxel terrain.
- Use a fixed random seed of 42.
- Include hills, grass, dirt, stone, and trees.
- Provide a safe player spawn point.
- Include five selectable blocks:
  grass, dirt, stone, wood, and leaves.
- Use original, procedural, or freely usable visuals.
- Make the world visually attractive with lighting,
  sky colors, and atmospheric effects.

## Player controls
- WASD: move
- Mouse: look around
- Space: jump
- Left click: remove a targeted block
- Right click: place the selected block
- Number keys 1–5: select the block type
- Escape: release mouse capture

## Interactions
- Display a center-screen crosshair.
- Show a five-slot block selection hotbar.
- Allow block interactions within 6 world units.
- Do not permit placing a block inside the player.
- Do not permit editing outside world boundaries.
- Disable the browser context menu during gameplay.

## Physics
- Implement gravity.
- Implement basic collision with solid blocks.
- Prevent falling through the terrain.
- Prevent walking through solid terrain.

## Persistence
- Save world edits to localStorage.
- Restore edits when the page reloads.
- Provide a way to reset the saved world.

## Interface
- Show a title screen with a Play button.
- Explain the controls before gameplay.
- Display a crosshair and block hotbar.
- Resize the renderer with the browser window.

## Quality
- The game must run locally in a modern desktop
  Chromium browser.
- npm run dev must start the game.
- npm run build must complete successfully.
- Avoid uncaught JavaScript errors during normal play.
- Aim for responsive movement and smooth rendering.
- Use reasonable rendering optimizations.

## Deliverables
- Complete source code
- package.json and package-lock.json
- README.md with setup and controls
- A working local playable game

## Out of scope
- Multiplayer
- Crafting and inventory limits
- Combat and enemies
- Infinite terrain
- Server-side persistence
- Mobile controls
- Audio systems


## Detailed Behavior and Acceptance Criteria

### World boundaries
- The world spans 32 blocks along both the X and Z axes.
- Valid horizontal block coordinates are 0 through 31.
- Terrain must be deterministic for seed 42.
- Resetting the world must regenerate the same initial terrain.
- Models may choose their own terrain generation algorithm.
- Player spawning must avoid collision with terrain and trees.

### Player physics
- The player must not pass through solid blocks.
- The player must not fall through the ground.
- Gravity must pull the player downward.
- Jumping must work when the player is grounded.
- The player must not repeatedly jump while airborne.
- Movement and collision must remain stable during normal play.

### Block interactions
- Raycasting must target the visible block under the crosshair.
- Interaction distance is measured from the camera.
- Blocks beyond 6 world units cannot be edited.
- Placed blocks must not intersect the player's collision volume.
- Block placement and removal must update the visible world.
- Invalid block operations must leave the world unchanged.

### Persistence
- Save block modifications using localStorage.
- Saved edits must survive a browser refresh.
- Reset must clear saved modifications.
- Reset must restore the original generated world.
- Corrupt saved data must not crash the application.

### Interface behavior
- The Play button must enter the playable game.
- Pointer lock must activate for first-person controls.
- Escape must release pointer lock.
- Gameplay interactions must not occur while the menu is active.
- The selected hotbar block must be visually distinguishable.

### Validation
The application must pass these functional checks:

1. The game launches without a blank screen.
2. The player can move and look around.
3. The player can jump and land on terrain.
4. The player cannot walk through solid blocks.
5. The player can remove a nearby block.
6. The player can place a nearby block.
7. The hotbar changes the selected block type.
8. The player cannot place blocks inside themselves.
9. The player cannot edit blocks beyond the reach limit.
10. Block modifications persist after refresh.
11. Reset restores the original world.
12. The production build succeeds.

### Development constraints
- All features must work without an external backend.
- The implementation must not require paid services.
- Avoid unnecessary dependencies.
- The game must remain playable on a typical modern laptop.
- Visual quality should be achieved without sacrificing
  essential gameplay functionality.

