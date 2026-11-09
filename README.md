# Voxel Grove — Three Implementation Approaches

This repository contains three implementations of **Voxel Grove**, a browser-based 3D voxel sandbox, developed to compare different software development workflows for **Generative AI HW 4-1**.

All three projects follow the same core game specification but use different implementation approaches. Each folder is a standalone application with its own source code, dependencies, tests, and project documentation.

## Implementation approaches

| Project | Approach | How it was implemented |
| --- | --- | --- |
| [`handCoding/`](handCoding/) | **Manual coding** | The developer implemented the game directly, including the gameplay systems, rendering, interfaces, and subsequent feature extensions. Development steps and checks are recorded in its development log. |
| [`ai-vibe/`](ai-vibe/) | **AI-led development (vibe coding)** | The developer provided the game requirements and directed the desired outcome while AI coding tools handled the primary implementation and iteration. The resulting application is maintained as a separate codebase. |
| [`collaborative/`](collaborative/) | **Human foundation + AI implementation** | The developer first built a small, static Three.js prototype manually: 10 fixed blocks, a fixed camera, lighting, and a render loop. Claude Code subsequently implemented the full interactive game from the supplied specifications. The original prototype modules were replaced during that phase and are not included in the current project folder. |

The distinction is **who performed the implementation work and at what stage**, not whether the finished games share the same requirements. In particular, the collaborative approach should not be read as a claim that the current full-game source files were all manually authored.

## Shared project requirements

Each implementation targets the same core experience:

- A procedurally generated **32 × 32** voxel island using seed **42**.
- First-person movement, jumping, gravity, and block collision.
- Mining and placing grass, dirt, stone, wood, and leaves.
- A crosshair, block hotbar, title/pause interfaces, and local saving of world edits.
- First-person hand and tool visuals with animated block interactions.
- A gameplay extension with **Mosslings**, a **Stoneguard**, enemy behavior, melee combat, player health, and respawning.

The shared requirements are defined in each project's `SPEC.md` and `EXTENSION_MOBS_HEALTH.md`. The three implementations can differ in architecture, appearance, interaction details, and test coverage.

## Repository structure

```text
genAI_hw4-1_codebase/
├── README.md
├── handCoding/       # Manual implementation
├── ai-vibe/          # AI-led implementation
└── collaborative/    # Manually built prototype, then AI-developed full game
```

## Run a project locally

Each project uses **JavaScript, Three.js, and Vite**. Use a current Node.js version compatible with Vite (Node.js **22.12+** recommended) and npm.

From the repository root, select **one** project folder, for example:

```bash
cd handCoding
npm install
npm run dev
```

Open the local URL printed by Vite (typically `http://localhost:5173`). To run another version, return to the repository root and enter `ai-vibe` or `collaborative` instead.

For any of the three projects:

```bash
npm test         # Run that project's automated tests
npm run build    # Create a production build
npm run preview  # Preview the production build locally
```

## Project documentation

| Project | Further details |
| --- | --- |
| `handCoding` | [README](handCoding/README.md) · [Development log](handCoding/DEVELOPMENT_LOG.md) |
| `ai-vibe` | [README](ai-vibe/README.md) · [Implementation summary](ai-vibe/IMPLEMENTATION_SUMMARY.md) |
| `collaborative` | [README](collaborative/README.md) · [Foundation summary](collaborative/FOUNDATION_LOG.md) · [Collaboration log](collaborative/COLLABORATION_LOG.md) |

The documentation records the reported development processes and validation work. It is not a substitute for independent verification of authorship or a full manual gameplay test.
