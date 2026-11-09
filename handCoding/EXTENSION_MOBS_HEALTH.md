# Voxel Grove — Mobs, Combat, and Health Extension

## Objective

Extend the existing Voxel Grove game with hostile voxel creatures, basic enemy AI, melee combat, player health, and death/respawn mechanics.

Preserve all previously implemented functionality.

This document overrides the original `SPEC.md` exclusion of combat and enemies, but only for the features defined here. All other original requirements remain in effect.

## 1. Hostile Mobs

Implement two original voxel-style monster types.

**Mossling**
- Small green creature.
- 40 health points.
- 10 damage per attack.
- Movement speed approximately 1.3 world units per second.
- Visually distinguishable from Stoneguard.

**Stoneguard**
- Larger grey stone-like creature.
- 60 health points.
- 15 damage per attack.
- Movement speed approximately 0.8 world units per second.
- Visually distinguishable from Mossling.

Generate the mob models using Three.js geometry or other freely usable assets. Do not copy proprietary Minecraft character assets.

Spawn three Mosslings and one Stoneguard in safe, valid world positions.

Mobs must not spawn inside solid terrain, outside world boundaries, or within eight horizontal world units of the initial player spawn.

## 2. Enemy AI

Implement three basic behavioral states:

1. **Idle/Wander:** Move around slowly when the player is not nearby.
2. **Chase:** Approach the player when within 10 world units.
3. **Attack:** Attack when within 1.75 world units and with an unobstructed attack path.

Requirements:

- Enemies must remain on valid terrain.
- Enemies must not pass through solid blocks or trees.
- Enemies must not move outside the world.
- If an obstacle blocks movement, enemies may stop, change direction, or use a simple alternate path.
- Enemies should not attack through solid walls.
- Each enemy has an attack cooldown of 1.5 seconds.
- Enemy updates must use frame-rate-independent timing.
- Avoid expensive pathfinding that is unnecessary for the small game world.

Use deterministic rule-based game AI. No external AI model or API is required.

## 3. Player Health

Implement a player health system.

- Maximum health: 100 HP.
- Starting health: 100 HP.
- Enemy attacks reduce health by the appropriate damage amount.
- Health must never fall below 0 or exceed the maximum.
- Display health in the game interface using a health bar, hearts, or both.
- Display visual feedback when the player receives damage.
- Prevent additional damage while the game is paused or the death screen is active.
- Do not implement automatic health regeneration in this version.

## 4. Player Combat

Implement melee attacks against mobs.

- Left-click attacks a visible mob when it is the nearest valid target under the crosshair and within 3 world units.
- Otherwise, left-click retains its existing block-mining behavior.
- Do not allow attacking mobs through solid blocks.
- Player attacks deal 25 damage.
- Apply a 0.6-second player attack cooldown.
- Show appropriate hit feedback.
- Enemies die and disappear when their health reaches 0.
- Add a short death animation or voxel particle effect.

If the game already includes held tools and swing animations, reuse them where appropriate.

Do not break the existing right-click block placement, Q tool selection, or number-key hotbar controls.

## 5. Death and Respawn

When player health reaches zero:

- Stop player movement and combat.
- Stop enemy damage and active combat interactions.
- Display a death overlay.
- Provide a Respawn button.

Respawning must:

- Restore player health to 100.
- Return the player to a safe spawn position.
- Reset enemy positions and health.
- Restore normal gameplay.
- Preserve existing saved world modifications.

Enemy state does not need to persist across browser reloads.

## 6. Visual Effects

Provide simple, readable combat effects:

- Idle or walking animation for mobs.
- Attack animation or movement.
- Visible player damage feedback.
- Enemy hit feedback.
- Small particle or disappearance effect upon enemy death.

Keep the effects consistent with the existing voxel visual style.

## 7. Compatibility and Performance

- Preserve terrain generation and block rendering.
- Preserve first-person movement and jumping.
- Preserve collision detection.
- Preserve block placement and destruction.
- Preserve existing hand/tool animations if implemented.
- Preserve localStorage world persistence.
- Preserve pause/menu functionality.
- Avoid gameplay updates that incorrectly damage the player while the tab is inactive or gameplay is paused.
- Keep all changes inside the authorized project directory.
- The game must remain responsive with all four enemies active.

## 8. Acceptance Tests

Verify the following:

1. Both enemy types render correctly.
2. Four enemies spawn in valid positions.
3. Enemies wander when the player is far away.
4. Enemies chase when the player approaches.
5. Enemies attack only within the specified range and cooldown.
6. Enemies do not pass through solid terrain.
7. Player health decreases correctly after attacks.
8. Player health never becomes negative.
9. The player can damage and defeat enemies.
10. Attacks cannot pass through solid blocks.
11. The death screen appears at zero health.
12. Respawning restores health and resets enemies.
13. Existing world modifications remain saved after respawning.
14. Existing block interaction mechanics continue working.
15. Existing menus and controls continue working.
16. `npm run build` succeeds.

Report tests that cannot be verified rather than marking them as passed.

## 9. Exclusions

Do not implement:

- Multiplayer.
- Ranged weapons.
- Crafting systems.
- Loot and equipment progression.
- Hunger or stamina.
- Day-night cycles.
- Boss enemies.
- Additional monster types.
- Network-based AI.
- Unrelated game features.

## 10. Deliverables

- Updated working game.
- Two hostile monster types.
- Enemy behavior and combat.
- Player health interface.
- Death and respawn system.
- Updated README.
- Actual validation results.
- Description of architectural changes.
- Known limitations.
