// Loads every content file from the repo: JSON parse, migrate, schema-validate. Errors carry the
// file path so the validator output is line-level and usable by CI and agents.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import {
  buildSchemas,
  CONTENT_VERSIONS,
  formatIssues,
  migrateDoc,
  type ArenaFile,
  type ContentType,
  type InterludeFile,
  type LayerFile,
  type SegmentFile,
  type TrackFile,
} from "@bb/schema";
import type { ModuleRegistry, RawContent, StageSource } from "@bb/engine";
import { CONTENT, ROOT } from "./paths";

export interface LoadedDoc {
  file: string;
  type: ContentType;
  doc: unknown;
}

export interface LoadResult {
  raw: RawContent;
  errors: string[];
  warnings: string[];
  docs: LoadedDoc[];
  /** Number of files that needed a migration. */
  migrated: { file: string; from: number; to: number }[];
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => statSync(join(dir, d)).isDirectory())
    .sort();
}

function listFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .sort();
}

export function loadContent(registry: ModuleRegistry, root = CONTENT): LoadResult {
  const schemas = buildSchemas(registry.schemaFragments());
  const errors: string[] = [];
  const warnings: string[] = [];
  const docs: LoadedDoc[] = [];
  const migrated: LoadResult["migrated"] = [];

  const read = <T>(path: string, type: ContentType, optional = false): T | undefined => {
    const rel = relative(ROOT, path);
    if (!existsSync(path)) {
      if (!optional) errors.push(`${rel}: missing file`);
      return undefined;
    }
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      errors.push(`${rel}: invalid JSON: ${(e as Error).message}`);
      return undefined;
    }
    let doc = json as Record<string, unknown>;
    try {
      const info = CONTENT_VERSIONS[type];
      const m = migrateDoc(type, doc, info.current, info.minimum);
      if (m.applied > 0) migrated.push({ file: rel, from: m.from, to: m.to });
      doc = m.doc;
    } catch (e) {
      errors.push(`${rel}: ${(e as Error).message}`);
      return undefined;
    }
    const r = schemas[type].safeParse(doc);
    if (!r.success) {
      errors.push(...formatIssues(rel, r.error));
      return undefined;
    }
    docs.push({ file: rel, type, doc: r.data });
    return r.data as T;
  };

  // The deny list is private and not in git (D61). Loading works without it; validate does not.
  const forbidden = read<{ terms: string[] }>(
    join(root, "forbidden-terms.json"),
    "forbidden-terms",
    true,
  );
  const master = read<{ colors: string[] }>(join(root, "palettes/master.json"), "master-palette");
  const palettes: Record<string, string[]> = {};
  for (const f of listFiles(join(root, "palettes"), ".json")) {
    if (f === "master.json") continue;
    const p = read<{ palettes: Record<string, string[]> }>(join(root, "palettes", f), "palettes");
    if (p) Object.assign(palettes, p.palettes);
  }
  const rigs: RawContent["rigs"] = {};
  for (const f of listFiles(join(root, "rigs"), ".rig.json")) {
    const r = read<RawContent["rigs"][string]>(join(root, "rigs", f), "rig");
    if (r) rigs[r.id] = r;
  }
  const templates: RawContent["templates"] = {};
  for (const f of listFiles(join(root, "templates"), ".states.json")) {
    const t = read<RawContent["templates"][string]>(join(root, "templates", f), "states");
    if (t) templates[`template:${f.replace(".states.json", "")}`] = t;
  }
  let items: RawContent["items"] = {
    schemaVersion: 1,
    props: {},
    pickups: {},
    weapons: {},
    projectiles: {},
  };
  for (const f of listFiles(join(root, "items"), ".json")) {
    const it = read<RawContent["items"]>(join(root, "items", f), "items");
    if (it)
      items = {
        schemaVersion: 1,
        props: { ...items.props, ...it.props },
        pickups: { ...items.pickups, ...it.pickups },
        weapons: { ...items.weapons, ...it.weapons },
        projectiles: { ...items.projectiles, ...it.projectiles },
      };
  }

  const actor = <F>(dir: string, main: string, type: ContentType) => {
    const out: Record<
      string,
      {
        file: F;
        states: RawContent["templates"][string];
        overlays: RawContent["characters"][string]["overlays"];
      }
    > = {};
    for (const id of listDirs(join(root, dir))) {
      const base = join(root, dir, id);
      const file = read<F & { id: string; states: string; overlays: string }>(
        join(base, main),
        type,
      );
      if (!file) continue;
      if (file.id !== id)
        errors.push(
          `${relative(ROOT, join(base, main))}: id "${file.id}" does not match its folder "${id}"`,
        );
      const states = read<RawContent["templates"][string]>(join(base, file.states), "states");
      const overlays = read<RawContent["characters"][string]["overlays"]>(
        join(base, file.overlays),
        "overlays",
      );
      if (states && overlays) out[id] = { file, states, overlays };
    }
    return out;
  };
  const characters = actor<RawContent["characters"][string]["file"]>(
    "characters",
    "character.json",
    "character",
  );
  const enemies = actor<RawContent["enemies"][string]["file"]>("enemies", "family.json", "enemy");
  const bosses = actor<RawContent["bosses"][string]["file"]>("bosses", "boss.json", "boss");
  const arenas: Record<string, ArenaFile> = {};
  for (const id of listDirs(join(root, "bosses"))) {
    const a = read<ArenaFile>(join(root, "bosses", id, "arena.json"), "arena", true);
    if (a) arenas[a.id] = a;
  }

  const stages: Record<string, StageSource> = {};
  for (const id of listDirs(join(root, "stages"))) {
    const base = join(root, "stages", id);
    const file = read<StageSource["file"]>(join(base, "stage.json"), "stage");
    if (!file) continue;
    if (file.id !== id)
      errors.push(`content/stages/${id}/stage.json: id "${file.id}" does not match its folder`);
    const segments: Record<string, SegmentFile> = {};
    for (const f of listFiles(join(base, "segments"), ".json")) {
      const s = read<SegmentFile>(join(base, "segments", f), "segment");
      if (s) {
        if (s.id !== basename(f, ".json"))
          errors.push(
            `content/stages/${id}/segments/${f}: id "${s.id}" does not match the file name`,
          );
        segments[s.id] = s;
      }
    }
    const layers: Record<string, LayerFile> = {};
    for (const f of listFiles(join(base, "layers"), ".json")) {
      const l = read<LayerFile>(join(base, "layers", f), "layer");
      if (l) layers[l.id] = l;
    }
    stages[id] = { file, segments, layers };
  }
  const interludes: Record<string, InterludeFile> = {};
  for (const f of listFiles(join(root, "interludes"), ".json")) {
    const i = read<InterludeFile>(join(root, "interludes", f), "interlude");
    if (i) interludes[i.id] = i;
  }
  const tracks: Record<string, TrackFile> = {};
  for (const f of listFiles(join(root, "music"), ".track.json")) {
    const t = read<TrackFile>(join(root, "music", f), "track");
    if (t) tracks[t.id] = t;
  }
  let sfx: RawContent["sfx"] = { schemaVersion: 1, sounds: {} };
  for (const f of listFiles(join(root, "sfx"), ".sfx.json")) {
    const s = read<RawContent["sfx"]>(join(root, "sfx", f), "sfx");
    if (s) sfx = { schemaVersion: 1, sounds: { ...sfx.sounds, ...s.sounds } };
  }
  const settings = read<{ flags: string[] }>(join(root, "settings.json"), "settings", true);
  const campaign = read<RawContent["campaign"]>(join(root, "campaign.json"), "campaign");
  const roster = read<RawContent["roster"]>(join(root, "roster.json"), "roster");

  const raw: RawContent = {
    rigs,
    templates,
    palettes,
    masterPalette: master?.colors ?? [],
    items,
    characters,
    enemies,
    bosses,
    arenas,
    stages,
    interludes,
    campaign: campaign ?? {
      schemaVersion: 1,
      start: "",
      finale: "",
      nodes: [],
      endingInterlude: "",
      credits: [],
    },
    roster: roster ?? { schemaVersion: 1, rosterOrder: [] },
    sfx,
    tracks,
    forbiddenTerms: forbidden?.terms ?? [],
    flags: settings?.flags ?? [],
  };
  return { raw, errors, warnings, docs, migrated };
}
