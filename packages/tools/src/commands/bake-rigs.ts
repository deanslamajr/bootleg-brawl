// tools bake-rigs <id>|--all: composes rig + overlays into each actor's atlas and writes it to
// generated/bake/ for inspection. `pack` bakes the same way when it builds bundles.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRegistry } from "@bb/mechanics";
import { loadContent } from "../lib/content-fs";
import { bakeActor, bakeItems, posesUsed } from "../art/bake";
import { GENERATED } from "../lib/paths";

export function bakeRigsCommand(args: string[]): number {
  const { raw, errors } = loadContent(createRegistry());
  if (errors.length) {
    errors.forEach((e) => console.error(e));
    return 1;
  }
  const out = join(GENERATED, "bake");
  mkdirSync(out, { recursive: true });
  const all = args.includes("--all");
  const want = args.filter((a) => !a.startsWith("--"));
  let warnings = 0;
  const actors: [
    string,
    {
      file: { rig: string };
      states: (typeof raw.templates)[string];
      overlays: (typeof raw.characters)[string]["overlays"];
    },
    string,
    string[],
  ][] = [
    ...Object.entries(raw.characters).map(
      ([id, s]) =>
        [id, s, s.file.palette, [s.file.portrait]] as [string, typeof s, string, string[]],
    ),
    ...Object.entries(raw.enemies).map(
      ([id, s]) => [id, s, s.file.tiers[0]!.palette, []] as [string, typeof s, string, string[]],
    ),
    ...Object.entries(raw.bosses).map(
      ([id, s]) =>
        [id, s, s.file.palette, [s.file.card.portrait]] as [string, typeof s, string, string[]],
    ),
  ];
  for (const [id, src, palette, extra] of actors) {
    if (!all && !want.includes(id)) continue;
    const rig = raw.rigs[src.file.rig]!;
    const poses = posesUsed(src.states, raw.templates, extra);
    if (raw.characters[id])
      for (const p of posesUsed(raw.templates["template:weapons"]!, raw.templates))
        if (!poses.includes(p)) poses.push(p);
    const b = bakeActor(id, rig, src.overlays, poses.sort(), raw.palettes[palette] ?? []);
    writeFileSync(join(out, `${id}.png`), b.png);
    writeFileSync(join(out, `${id}.sheet.json`), JSON.stringify(b.meta));
    for (const w of b.warnings) console.warn(`warning: ${w}`);
    warnings += b.warnings.length;
    console.log(
      `baked ${id}: ${Object.keys(b.meta.frames).length} frames, ${b.meta.width}x${b.meta.height}`,
    );
  }
  if (all || want.includes("items")) {
    const items = bakeItems(raw);
    writeFileSync(join(out, "items.png"), items.png);
    console.log(`baked items: ${Object.keys(items.meta.frames).length} frames`);
  }
  console.log(`bake-rigs: wrote ${out} (${warnings} warning(s))`);
  return 0;
}
