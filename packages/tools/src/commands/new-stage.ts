// tools new-stage <id> --type walk-right --template street: scaffolds a stage with three segments,
// a mid-boss slot, a boss slot and placeholder layers, plus BRIEF.md for the agent-assisted pass.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ID_RE, stageType } from "@bb/schema";
import { CONTENT } from "../lib/paths";

const TEMPLATES: Record<string, { sky: string[]; ground: string; wall: string; trim: string }> = {
  street: { sky: ["#0e1a4a", "#3e1a6a"], ground: "#4a4658", wall: "#6e4a2a", trim: "#ffd93a" },
  indoor: { sky: ["#2e2a3a", "#4a4658"], ground: "#9a6e40", wall: "#6a2aa0", trim: "#ff8ac8" },
  outdoor: { sky: ["#4aa0f0", "#8ad0ff"], ground: "#2e8a3a", wall: "#5ac04a", trim: "#f4f0e8" },
};

export function newStageCommand(args: string[]): number {
  const id = args.find((a) => !a.startsWith("--"));
  const opt = (k: string, d: string) =>
    args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ??
    (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1]! : d);
  if (!id || !ID_RE.test(id)) {
    console.error("usage: tools new-stage <id> --type walk-right --template street|indoor|outdoor");
    return 1;
  }
  const type = stageType.parse(opt("type", "walk-right"));
  const tpl = TEMPLATES[opt("template", "street")] ?? TEMPLATES.street!;
  const dir = join(CONTENT, "stages", id);
  if (existsSync(dir)) {
    console.error(`content/stages/${id} already exists`);
    return 1;
  }
  mkdirSync(join(dir, "segments"), { recursive: true });
  mkdirSync(join(dir, "layers"), { recursive: true });
  const palette = [
    ...new Set(["#1a1420", "#2e2a3a", "#f4f0e8", ...tpl.sky, tpl.ground, tpl.wall, tpl.trim]),
  ];
  const layer = (lid: string, w: number, h: number, ops: unknown[]) =>
    writeFileSync(
      join(dir, "layers", `${lid}.json`),
      JSON.stringify({ id: lid, schemaVersion: 1, width: w, height: h, ops }, null, 1) + "\n",
    );
  layer("sky", 480, 180, [{ op: "gradient", y: 0, h: 180, colors: tpl.sky }]);
  layer("main", 960, 270, [
    { op: "rect", x: 0, y: 30, w: 960, h: 150, color: tpl.wall },
    { op: "rect", x: 0, y: 176, w: 960, h: 4, color: tpl.trim },
    { op: "rect", x: 0, y: 180, w: 960, h: 90, color: tpl.ground },
    { op: "text", x: 380, y: 60, text: `TODO: ${id.toUpperCase()}`, color: tpl.trim, scale: 1 },
  ]);
  const seg = (sid: string, kind: string, length: number, locks: unknown[]) =>
    writeFileSync(
      join(dir, "segments", `${sid}.json`),
      JSON.stringify(
        {
          id: sid,
          schemaVersion: 1,
          kind,
          length,
          depth: [180, 262],
          layers: [
            { layer: "sky", depth: 0, speedX: 0.1 },
            { layer: "main", depth: 1, speedX: 1 },
          ],
          scrollLocks: locks,
          placements: [],
          gags: [],
          intro: `TODO intro for ${sid}`,
        },
        null,
        1,
      ) + "\n",
    );
  seg("part-1", "fight", 1440, [
    { id: "p1-1", at: 200, waves: [{ family: "interns", tier: 0, count: 3 }] },
    { id: "p1-2", at: 700, waves: [{ family: "interns", tier: 1, count: 3 }] },
  ]);
  seg("part-2", "fight", 1200, [
    { id: "p2-1", at: 240, waves: [{ family: "interns", tier: 1, count: 4 }] },
    {
      id: "p2-mid",
      at: 720,
      waves: [{ family: "interns", tier: 0, count: 1, fixed: true, delayTicks: 400 }],
    },
  ]);
  seg("boss", "arena", 480, [
    {
      id: "boss-lock",
      at: 0,
      waves: [{ family: "interns", tier: 0, count: 1, fixed: true, delayTicks: 600 }],
    },
  ]);
  const stage = {
    id,
    schemaVersion: 1,
    gameNumber: 99,
    titleCard: {
      title: `TODO ${id.toUpperCase()}`,
      subtitle: "TODO SUBTITLE",
      houseRulesText: "HOUSE RULES: TODO.",
      announcerLine: "GAME 99 OF 999. TODO.",
    },
    type,
    rules: { requires: [], laneTolerance: 10, difficultyBaseline: 3, friendlyFireDefault: "off" },
    palette,
    segments: ["part-1", "part-2", "boss"],
    bossTriggers: [
      { at: "part-2", lock: "p2-mid", bossId: "pinhead-pete", introCard: true, midBoss: true },
      { at: "boss", lock: "boss-lock", bossId: "hugh-mungus", introCard: true, midBoss: false },
    ],
    interludes: { before: [], after: [] },
    music: { track: "anytown", boss: "boss-theme", cues: [] },
    outro: { lickspittle: "TODO LICKSPITTLE ESCAPE LINE" },
    parodyMeta: {
      bootlegOf: "TODO generic stage role",
      gag: "TODO the one thing that happens here",
      forbiddenTerms: [],
      tells: [],
    },
  };
  writeFileSync(join(dir, "stage.json"), JSON.stringify(stage, null, 1) + "\n");
  writeFileSync(
    join(dir, "BRIEF.md"),
    `# ${id}

A stage is a place plus one thing that happens in it.

- Place:
- The one thing:
- Catalog mappings (\`[C:set-n]\`, \`[C:stage-n]\`):
- House rules (shown on the title card):
- Enemy families and tiers:
- Mid-boss and boss:
- Gags (prop + effect):
- Title card text and the Announcer's line (mistranslated), plus the corrected line:
- Two bootleg tells:

Workflow: an agent proposes the segment breakdown, waves, gags and title card from this brief; a
human edits. Draft waves with \`pnpm tools gen-waves ${id} part-1 --difficulty 3 --families interns\`,
then \`pnpm tools validate content/stages/${id}\` and \`pnpm tools metrics ${id}\`. Add the stage to
content/campaign.json when it is ready; until then it loads from the sandbox and GAME SELECT: ALL.
`,
  );
  console.log(`created content/stages/${id}. Fill in BRIEF.md, then validate.`);
  return 0;
}
