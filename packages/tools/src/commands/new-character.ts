// tools new-character <id> --archetype <a> --rig <r>: scaffolds a character from its archetype
// template with a DESIGN.md of the prompts the concept pass must answer. The placeholder text
// is deliberately invalid (TODO tells) so the character cannot ship unedited.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { archetype as archetypeSchema, ID_RE, rigId as rigSchema } from "@bb/schema";
import { CONTENT } from "../lib/paths";

const TEMPLATE_FOR: Record<string, string> = {
  balanced: "balanced",
  fast: "fast",
  grappler: "grappler",
  ranged: "ranged",
  weird: "balanced",
  nonhuman: "fast",
  "class-party": "balanced",
  family: "balanced",
  "mascot-vehicle": "grappler",
};

const BANDS: Record<
  string,
  { hp: number; walk: number; run: number; jump: number; weight: number; dmg: number }
> = {
  balanced: { hp: 110, walk: 1.25, run: 2.7, jump: 4.9, weight: 1, dmg: 1 },
  fast: { hp: 90, walk: 1.55, run: 3.2, jump: 5.3, weight: 0.75, dmg: 0.9 },
  grappler: { hp: 140, walk: 1.0, run: 2.3, jump: 4.4, weight: 1.6, dmg: 1.15 },
  ranged: { hp: 95, walk: 1.35, run: 2.9, jump: 5.0, weight: 0.8, dmg: 0.95 },
};

export function newCharacterCommand(args: string[]): number {
  const id = args.find((a) => !a.startsWith("--"));
  const opt = (k: string, d: string) =>
    args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ??
    (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1]! : d);
  if (!id || !ID_RE.test(id)) {
    console.error(
      "usage: tools new-character <id> --archetype <balanced|fast|grappler|ranged|...> --rig <small|medium|large|huge|nonhuman>",
    );
    return 1;
  }
  const arch = archetypeSchema.parse(opt("archetype", "balanced"));
  const rig = rigSchema.parse(opt("rig", "medium"));
  const dir = join(CONTENT, "characters", id);
  if (existsSync(dir)) {
    console.error(`content/characters/${id} already exists`);
    return 1;
  }
  mkdirSync(dir, { recursive: true });
  const band = BANDS[TEMPLATE_FOR[arch]!] ?? BANDS.balanced!;
  const character = {
    id,
    schemaVersion: 1,
    displayName: `TODO ${id}`,
    shortName: id.slice(0, 8).toUpperCase(),
    archetype: arch,
    rig,
    palette: "brat",
    altPalettes: [],
    stats: {
      hp: band.hp,
      walkSpeed: band.walk,
      runSpeed: band.run,
      jumpVel: band.jump,
      weight: band.weight,
      reach: 1,
      damageMult: band.dmg,
      specialCost: 10,
    },
    kit: { requires: [], flags: [], gags: [] },
    teamUps: [],
    voice: {
      continueLine: "TODO continue plea",
      selectLine: "TODO select line",
      tauntLines: ["TODO taunt"],
      endingText: "TODO ending",
    },
    unlock: "secret",
    portrait: "idle:0",
    parodyMeta: {
      bootlegOf: "TODO generic role description, never a name",
      gag: "TODO the gag the original never had",
      forbiddenTerms: [],
      tells: [],
    },
  };
  writeFileSync(join(dir, "character.json"), JSON.stringify(character, null, 1) + "\n");
  writeFileSync(
    join(dir, "states.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        extends: `template:${TEMPLATE_FOR[arch]}`,
        states: {},
        patch: {},
        remove: [],
      },
      null,
      1,
    ) + "\n",
  );
  writeFileSync(
    join(dir, "overlays.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        body: {
          scale: 1,
          headR: 7,
          torsoW: 9,
          armW: 3,
          legW: 4,
          footL: 5,
          handR: 2,
          skin: 2,
          torso: 6,
          legs: 8,
          feet: 13,
          arms: 2,
          hide: [],
        },
        layers: { head: [], torso: [], legs: [], weapon: [], fx: [] },
        uniqueFrames: {},
      },
      null,
      1,
    ) + "\n",
  );
  writeFileSync(
    join(dir, "DESIGN.md"),
    `# ${id}

Archetype: ${arch}. Rig: ${rig}. Template: template:${TEMPLATE_FOR[arch]}.

Answer each prompt, then edit the JSON files. An agent may propose three concepts; a human picks one
and reads every name and line against the IP rule (no names, likenesses, catchphrases or places from
any franchise).

1. Which generic role does this character bootleg? Describe the role, never name the original.
2. Name: a dictionary word, a pun or a misprint. Never a one-letter change.
3. The gag the original never had.
4. Improvised weapon: what it is, how many hits, how it breaks or respawns.
5. Specials: the desperation special and its directional variants.
6. Continue plea, select line, three taunts, ending text.
7. Team-up partner and move.
8. Two bootleg tells (asymmetry, wrong stat, mistranslation, wrong-game prop).
9. Palette: 16 colors from content/palettes/master.json; add it to content/palettes/palettes.json.

Checklist before the PR: \`pnpm tools validate content/characters/${id}\`, \`pnpm tools balance ${id}\`,
\`pnpm tools record-golden --character ${id}\`, add the id to content/roster.json rosterOrder, \`pnpm tools pack\`.
`,
  );
  console.log(
    `created content/characters/${id} (extends template:${TEMPLATE_FOR[arch]}). Fill in DESIGN.md, then validate.`,
  );
  return 0;
}
