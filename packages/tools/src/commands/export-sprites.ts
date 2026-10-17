// tools export-sprites: exports Aseprite sources (content/**/*.aseprite) to PNG + JSON with the
// Aseprite CLI when both exist. v1 art is procedural (rig poses + overlay shapes), so with no
// sources this is a no-op that says so.

import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CONTENT, ROOT } from "../lib/paths";

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith(".aseprite") || f.endsWith(".ase")) out.push(p);
  }
  return out;
}

export function exportSpritesCommand(): number {
  const sources = walk(CONTENT);
  if (sources.length === 0) {
    console.log(
      "export-sprites: no Aseprite sources in content/ (v1 art is baked from rigs and overlays)",
    );
    return 0;
  }
  const bin = process.env.ASEPRITE ?? "aseprite";
  const probe = spawnSync(bin, ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    console.error(
      `export-sprites: ${sources.length} Aseprite source(s) found but the Aseprite CLI (${bin}) is not installed`,
    );
    return 1;
  }
  for (const src of sources) {
    const base = src.replace(/\.(aseprite|ase)$/, "");
    execFileSync(
      bin,
      [
        "-b",
        src,
        "--sheet",
        `${base}.png`,
        "--data",
        `${base}.json`,
        "--format",
        "json-array",
        "--list-tags",
      ],
      { stdio: "inherit" },
    );
    console.log(`exported ${relative(ROOT, src)}`);
  }
  return 0;
}
