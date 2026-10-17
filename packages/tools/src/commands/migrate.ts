// tools migrate [--write]: applies schema migrations to every content file. Without --write it
// reports what would change; with it, files are rewritten at the current version.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTENT_VERSIONS, migrateDoc, type ContentType } from "@bb/schema";
import { createRegistry } from "@bb/mechanics";
import { loadContent } from "../lib/content-fs";
import { ROOT } from "../lib/paths";

export function migrateCommand(args: string[]): number {
  const write = args.includes("--write");
  const { migrated, docs } = loadContent(createRegistry());
  if (migrated.length === 0) {
    console.log(`migrate: all ${docs.length} files are at their current schema versions`);
    return 0;
  }
  const types = new Map(docs.map((d) => [d.file, d.type]));
  for (const m of migrated) {
    console.log(`${m.file}: v${m.from} -> v${m.to}${write ? " (rewritten)" : ""}`);
    if (!write) continue;
    const path = join(ROOT, m.file);
    const type = (types.get(m.file) ?? "character") as ContentType;
    const doc = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const info = CONTENT_VERSIONS[type];
    writeFileSync(
      path,
      JSON.stringify(migrateDoc(type, doc, info.current, info.minimum).doc, null, 1) + "\n",
    );
  }
  if (!write) console.log(`migrate: ${migrated.length} file(s) need migration; run with --write`);
  return 0;
}
