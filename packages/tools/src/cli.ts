// The content CLI: `pnpm tools <command> [args]`. Every command exits non-zero on failure so CI
// and agents can use it as a feedback loop.

import { genRigs } from "./commands/gen-rigs";
import { packCommand } from "./commands/pack";
import { validateCommand } from "./commands/validate";
import { playCommand } from "./commands/play";
import { bakeRigsCommand } from "./commands/bake-rigs";
import { exportSpritesCommand } from "./commands/export-sprites";
import { migrateCommand } from "./commands/migrate";
import { newCharacterCommand } from "./commands/new-character";
import { newStageCommand } from "./commands/new-stage";
import { metricsCommand } from "./commands/metrics";
import { genWavesCommand } from "./commands/gen-waves";
import { balanceCommand } from "./commands/balance";
import { recordGoldenCommand, verifyGoldenCommand } from "./commands/record-golden";
import { perfCommand } from "./commands/perf";
import { deployCommand, deployStatusCommand } from "./commands/deploy";

type Command = (args: string[]) => void | number | Promise<void | number>;

const commands: Record<string, { run: Command; help: string }> = {
  validate: {
    run: validateCommand,
    help: "schemas, references, rigs, palettes, IP scan [path] [--flags=a,b]",
  },
  migrate: { run: migrateCommand, help: "apply schema migrations to content files [--write]" },
  "export-sprites": {
    run: exportSpritesCommand,
    help: "export Aseprite sources with the Aseprite CLI, if any exist",
  },
  "bake-rigs": {
    run: bakeRigsCommand,
    help: "compose rig + overlays into atlases in generated/bake <id>|--all",
  },
  pack: {
    run: packCommand,
    help: "bake atlases, layers and sounds; write hashed bundles and the manifest",
  },
  metrics: {
    run: metricsCommand,
    help: "bot pacing metrics for a stage <stage> [--players=1,2,4] [--seed=N] [--strict]",
  },
  "gen-waves": {
    run: genWavesCommand,
    help: "draft scroll-lock waves <stage> <segment> --difficulty= --families= [--write]",
  },
  "new-character": {
    run: newCharacterCommand,
    help: "scaffold a character <id> --archetype <a> --rig <r>",
  },
  "new-stage": {
    run: newStageCommand,
    help: "scaffold a stage <id> --type walk-right --template street",
  },
  balance: {
    run: balanceCommand,
    help: "archetype balance envelope per character [ids] [--record]",
  },
  "record-golden": {
    run: recordGoldenCommand,
    help: "record golden replays [--character id|--stage id|--all]",
  },
  "verify-golden": {
    run: verifyGoldenCommand,
    help: "replay every golden and compare state hashes",
  },
  play: { run: playCommand, help: "headless bot playthrough <stage> [party] [--seed=] [--ticks=]" },
  perf: { run: perfCommand, help: "sim tick and snapshot timing at the worst-case entity count" },
  "gen-rigs": {
    run: () => genRigs(),
    help: "regenerate content/rigs/*.rig.json from the pose library",
  },
  deploy: { run: deployCommand, help: "build, push and roll out to the cluster (needs approval)" },
  "deploy-status": { run: deployStatusCommand, help: "rollout, route, Gateway and HTTPS state" },
};

async function main(): Promise<void> {
  const [name, ...args] = process.argv.slice(2);
  if (!name || name === "help" || !commands[name]) {
    console.log("usage: pnpm tools <command>\n");
    for (const [k, v] of Object.entries(commands)) console.log(`  ${k.padEnd(16)} ${v.help}`);
    process.exit(name && name !== "help" ? 1 : 0);
  }
  const code = await commands[name]!.run(args);
  if (typeof code === "number" && code !== 0) process.exit(code);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
