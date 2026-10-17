# 999-IN-1: The Bootleg Brawl

A browser beat 'em up for one to four players. The Simpletons, a family of five, chase a sycophant named Lickspittle into a cursed counterfeit arcade cabinet. Every stage is one of the cabinet's 999 games, and every game is a bootleg of a different arcade brawler.

The design lives in [the implementation plan](docs/999-IN-1%20The%20Bootleg%20Brawl%20%E2%80%94%20Implementation%20Plan.md). Choices the plan did not settle are in [DECISIONS.md](DECISIONS.md). Agent rules are in [CLAUDE.md](CLAUDE.md).

## Quick start

1. Install Node 22 and pnpm 11.
2. Run `pnpm install`.
3. Run `pnpm dev`. This packs the content, then starts two dev servers.
4. Open http://localhost:5180 for the game and http://localhost:5181 for the sandbox.

Add `?debug` to the game URL for the frame and tick overlay and the GAME SELECT: ALL menu. Add `?flags=mech.elevator,-mech.arena` to turn mechanic modules on or off for a playtest.

## Controls

| Action  | Player 1 keys | Player 2 keys          | Gamepad             |
| ------- | ------------- | ---------------------- | ------------------- |
| Move    | W A S D       | Arrow keys             | Left stick or d-pad |
| Attack  | J             | Numpad 1 or `,`        | X / Square          |
| Jump    | K             | Numpad 2 or `.`        | A / Cross           |
| Special | J + K, or U   | Numpad 1 + 2, or `;`   | Y / Triangle        |
| Run     | Double-tap, I | Double-tap, Numpad 5   | Double-tap or RB    |
| Taunt   | L             | Numpad 3 or `/`        | B / Circle          |
| Start   | Enter         | Numpad Enter, R. Shift | Start               |
| Pause   | Esc           | Esc                    | Esc                 |

Walk into a dazed or light enemy to grab it. Attack over an item to pick it up. Taunt next to a teammate to start a team-up. Press Start on an empty slot to join during a stage. Hold Start to drop out.

## What v1 contains

- Four playable characters: Sarge, Boomer, Brat and Mensa, with two team-ups and a generic shoulder toss.
- Three stages: Game 0 (Anytown), Game 1 (Gecko Justice) and Game 2 (Mediocre City Ultra Turbo).
- Six bosses plus Lickspittle, who escapes at the end of every game.
- Eight enemy families in four corporate tiers, from Intern to Vice President.
- Interludes: the sucked-in cutscene, FOLD THE LAUNDRY, the cartridge swap, GAME SELECT and the cliffhanger ending.
- Seven mechanic modules: `elevator`, `auto-scroll`, `throw-toward-camera`, `environmental-spawn`, `civilians`, `charge-shot` and `arena`.
- The content pipeline, the sandbox and the stage preview tool.

## Repository layout

```
apps/game                 the shipped SPA: boot, menus, HUD, run flow, interludes
apps/sandbox              character room and stage preview tool
packages/engine           sim, ECS, collision, combat, content compiler, renderer, audio, input
packages/mechanics/*      one package per mechanic module
packages/mechanics-all    the module registry the apps and tools load (@bb/mechanics)
packages/schema           zod schemas, migrations, forbidden-terms scanner
packages/tools            the content CLI (validate, pack, metrics, balance, goldens, deploy)
content/                  every character, enemy, boss, stage, interlude, sound and track
tests/                    sim, content, golden replay and Playwright suites
deploy/                   nginx and Kubernetes configuration
docs/                     the implementation plan
```

## Commands

| Command                | What it does                                                        |
| ---------------------- | ------------------------------------------------------------------- |
| `pnpm dev`             | Packs content and runs the game and sandbox dev servers             |
| `pnpm content`         | export-sprites, bake-rigs, pack, validate                           |
| `pnpm test`            | Unit, sim, content and golden replay suites (Vitest)                |
| `pnpm test:e2e`        | Playwright against the built `dist/` (run `pnpm build` first)       |
| `pnpm lint`            | ESLint and Prettier                                                 |
| `pnpm typecheck`       | TypeScript over every package                                       |
| `pnpm build`           | Production build into `dist/`, with hashed bundles and the manifest |
| `pnpm tools <command>` | The content CLI. Run `pnpm tools help` for the full list            |

The content CLI commands:

- `validate [path]` makes sure that schemas, references, rig coverage, frame data, palettes, frame boxes, team-ups, bootleg tells and the campaign graph are correct. It also runs the forbidden-terms scan.
- `pack` bakes atlases, background layers and sounds, then writes content-hashed bundles and `manifest.json`.
- `bake-rigs <id>|--all` writes baked atlases to `generated/bake/` for inspection.
- `new-character <id> --archetype <a> --rig <r>` and `new-stage <id>` scaffold new content.
- `gen-waves <stage> <segment> --difficulty=3 --families=interns` drafts scroll-lock waves.
- `metrics <stage> --players=1,2,4` runs bot playthroughs and compares the pacing with its targets.
- `balance [ids]` compares each character with its archetype band.
- `record-golden` records the golden replays and `verify-golden` replays them.
- `play <stage> [party]` runs one headless bot playthrough.
- `perf` measures sim tick and snapshot time at the worst-case entity count.
- `migrate [--write]` upgrades content files to the current schema versions.

## How the content pipeline works

Characters, enemies, bosses and stages are JSON files under `content/`. The engine never lists content. The manifest does.

Sprites are not hand-drawn frames. Each actor has a body on one of five shared rigs and an `overlays.json` of vector shapes. The bake step draws every pose the actor's states use, with outlines and shading, and packs an indexed 16-color atlas. Enemy tiers are palette swaps of one atlas. Backgrounds are painter ops in `layers/*.json`. Sounds are synth parameters rendered to WAV at build time. Music is tracker JSON that the game synthesizes at run time.

To add a character:

1. Run `pnpm tools new-character <id> --archetype ranged --rig small`.
2. Answer the prompts in `content/characters/<id>/DESIGN.md`. A human reads every name and line against the IP rule.
3. Add a 16-color palette to `content/palettes/palettes.json`, using colors from `master.json`.
4. Edit `overlays.json` and look at the result in the sandbox. Press R to reload content.
5. Tune hitboxes in the sandbox box editor. Pause, then edit a box and press Write.
6. Run `pnpm tools validate content/characters/<id>` until it passes.
7. Run `pnpm tools balance <id>` and `pnpm tools record-golden --character <id>`.
8. Add the id to `rosterOrder` in `content/roster.json`, then run `pnpm tools pack`.

To add a stage:

1. Run `pnpm tools new-stage <id> --template street`.
2. Fill in `BRIEF.md`: the place, the one thing that happens there, the families and the bosses.
3. Draft waves with `pnpm tools gen-waves`, then place them in the sandbox stage preview.
4. Run `pnpm tools validate content/stages/<id>` and `pnpm tools metrics <id> --players=2`.
5. When the stage is ready, add it to `content/campaign.json`. Until then it loads from the sandbox and from GAME SELECT: ALL.

## Testing

- Unit and sim tests cover fixed-point math, the PRNG, snapshots, the command parser, state transitions, combat, grabs, team-ups, the stun-lock breaker and every module.
- Golden replays in `tests/golden/` replay recorded inputs and compare the state hash every 60 ticks. CI runs them on Linux and macOS. A hash change means sim behavior changed. Re-record with `pnpm tools record-golden` and say why in the pull request.
- The content suite runs the validator, including the forbidden-terms scan.
- Playwright boots the built game in Chromium and WebKit and joins four players. Bots then play Game 0 to the boss, and the test waits for the first interlude.
- The nightly workflow runs balance, pacing metrics with `--strict`, `pnpm tools perf` and a throttled frame-time test.

Before an end-to-end run, make sure that nothing listens on port 4180.

## Deploying

The game is a static SPA in an nginx image. It runs on the same GKE cluster and shared Gateway as Marble Melancholy. Every deploy needs the owner's approval.

1. Create the Artifact Registry repository `bootleg-brawl` in project `example-gcp-project`.
2. Add a Certificate Manager certificate and map entry for the host. The default host is `bootleg.llmgag.world`. Set `BOOTLEG_HOST` to use another one.
3. Run `pnpm deploy:status` and record the state of the shared Gateway.
4. Run `pnpm deploy`. It builds `dist/`, pushes the image, applies `deploy/k8s/bootleg.yaml` and waits for the rollout.
5. Run `pnpm deploy:status` again and compare the Gateway state with step 3.

If the repository variable `DEPLOY_ENABLED` is `true` and the workload identity secrets exist, the CI `deploy` job does the same from `main`.
