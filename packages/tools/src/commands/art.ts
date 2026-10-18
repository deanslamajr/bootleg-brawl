// tools art: generated sprites and backgrounds through Runware (DECISIONS D50 to D59). `gen`
// writes candidates to generated/art/ only. A human looks at the contact sheet and runs `accept`,
// which is the only subcommand that writes content/.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { deflateSync } from "node:zlib";
import { join, relative } from "node:path";
import { createRegistry } from "@bb/mechanics";
import {
  ForbiddenScanner,
  artModel,
  type ArtConversion,
  type ArtFile,
  type ArtModel,
  type ArtPart,
  type ArtStyleFile,
  type ItemSprite,
  type SpriteMeta,
} from "@bb/schema";
import type { RawContent } from "@bb/engine";
import { encodeIndexedPng } from "@bb/engine/render/png";
import { loadContent } from "../lib/content-fs";
import { partFile } from "../lib/validate";
import { CONTENT, GENERATED, ROOT } from "../lib/paths";
import { posesUsed } from "../art/bake";
import { decodeIndexedPngSync, decodeRgbaPng } from "../art/png-rgba";
import { pixelize, type PixelizeRecipe } from "../art/pixelize";
import { contactSheet } from "../art/preview";
import { IndexedImage } from "../art/raster";
import { drawPose } from "../art/sprite";
import {
  ArtError,
  MODELS,
  PHASE_CAPS,
  RunwareClient,
  buildImageTask,
  buildRemoveBgTask,
  checkBudget,
  dataUri,
  estimateCost,
  markKept,
  readApiKey,
  readLedger,
  spent,
  totalBudget,
  type ImageRequest,
  type RefStyle,
  type Task,
} from "../art/runware";

/** Tracked, so the spend cap survives a fresh clone. */
export const LEDGER = join(ROOT, "content/art/ledger.jsonl");
export const ART_OUT = join(GENERATED, "art");

type Owner = "character" | "enemy" | "boss" | "stage" | "items" | "title";

interface Target {
  name: string;
  owner: Owner;
  id: string;
  /** Only this part (a layer, an item, the bust). */
  only?: string;
  /** The content folder. */
  dir: string;
  /** generated/art/<owner>/<id>. */
  out: string;
  phase: string;
}

const OWNER_DIR: Record<Exclude<Owner, "items" | "title">, string> = {
  character: "characters",
  enemy: "enemies",
  boss: "bosses",
  stage: "stages",
};

export function parseTarget(name: string): Target {
  const [kind, rest = ""] = name.split(/:(.*)/s) as [string, string?];
  const actor = (owner: "character" | "enemy" | "boss", id: string, only?: string): Target => ({
    name,
    owner,
    id,
    only,
    dir: join(CONTENT, OWNER_DIR[owner], id),
    out: join(ART_OUT, owner, id),
    phase: only === "portrait" ? "4" : "2",
  });
  let t: Target;
  switch (kind) {
    case "character":
    case "enemy":
    case "boss":
      t = actor(kind, rest);
      break;
    case "portrait":
      t = actor("character", rest, "portrait");
      break;
    case "card":
      t = actor("boss", rest, "portrait");
      break;
    case "stage":
    case "layer": {
      const [stage = "", layer] = rest.split("/");
      t = {
        name,
        owner: "stage",
        id: stage,
        only: kind === "layer" ? layer : undefined,
        dir: join(CONTENT, "stages", stage),
        out: join(ART_OUT, "stage", stage),
        phase: "3",
      };
      if (kind === "layer" && !layer)
        throw new ArtError([`art: ${name} needs layer:<stage>/<layer>`]);
      break;
    }
    case "items":
    case "item":
      t = {
        name,
        owner: "items",
        id: "items",
        only: kind === "item" ? rest : undefined,
        dir: join(CONTENT, "items"),
        out: join(ART_OUT, "items"),
        phase: "4",
      };
      break;
    case "title":
      t = {
        name,
        owner: "title",
        id: "title",
        dir: join(CONTENT, "art"),
        out: join(ART_OUT, "title"),
        phase: "4",
      };
      break;
    default:
      throw new ArtError([
        `art: unknown target ${name}; use character:, enemy:, boss:, stage:, layer:<stage>/<layer>, items, item:, portrait:, card: or title`,
      ]);
  }
  if ((t.owner !== "items" && t.owner !== "title" && !t.id) || !existsSync(t.dir))
    throw new ArtError([`art: ${name}: ${relative(ROOT, t.dir)} does not exist`]);
  return t;
}

// ---- flags

interface Flags {
  dryRun: boolean;
  part?: string;
  candidates?: number;
  model?: ArtModel;
  phase?: string;
  phaseCap?: number;
  budget?: string;
  baked: boolean;
  reconvert: boolean;
  rest: string[];
}

export function parseFlags(args: string[]): Flags {
  const f: Flags = { dryRun: false, baked: false, reconvert: false, rest: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const [k, inline] = a.startsWith("--") ? (a.split(/=(.*)/s) as [string, string?]) : [a];
    const value = () => {
      const v = inline ?? args[++i];
      if (v === undefined) throw new ArtError([`art: ${k} needs a value`]);
      return v;
    };
    switch (k) {
      case "--dry-run":
        f.dryRun = true;
        break;
      case "--baked":
        f.baked = true;
        break;
      case "--reconvert":
        f.reconvert = true;
        break;
      case "--part":
        f.part = value();
        break;
      case "--candidates":
        f.candidates = Number(value());
        if (!Number.isInteger(f.candidates) || f.candidates < 1 || f.candidates > 4)
          throw new ArtError(["art: --candidates is 1 to 4"]);
        break;
      case "--model": {
        const m = artModel.safeParse(value());
        if (!m.success)
          throw new ArtError([`art: --model is one of ${artModel.options.join(", ")}`]);
        f.model = m.data;
        break;
      }
      case "--phase":
        f.phase = value();
        break;
      case "--phase-cap":
        f.phaseCap = Number(value());
        break;
      case "--budget":
        f.budget = value();
        break;
      default:
        if (a.startsWith("--")) throw new ArtError([`art: unknown flag ${a}`]);
        f.rest.push(a);
    }
  }
  return f;
}

// ---- planning requests

interface Ctx {
  raw: RawContent;
  sprites: ReturnType<typeof loadContent>["sprites"];
  scanner: ForbiddenScanner;
}

interface Plan {
  part: string;
  request: ImageRequest;
  /** Undefined for the look, which stays an RGBA reference image. */
  recipe?: PixelizeRecipe;
  palette: string[];
  /** Set when the request uses the accepted look as its reference. */
  lookFile?: string;
}

function loadCtx(): Ctx {
  const load = loadContent(createRegistry());
  if (load.errors.length) throw new ArtError([...load.errors, "art: fix the content errors first"]);
  return {
    raw: load.raw,
    sprites: load.sprites,
    scanner: new ForbiddenScanner(load.raw.forbiddenTerms),
  };
}

function artOf(ctx: Ctx, t: Target): ArtFile {
  const art = ctx.sprites.art[relative(ROOT, t.dir)];
  if (!art) throw new ArtError([`art: ${relative(ROOT, t.dir)}/art.json is missing`]);
  return art;
}

function styleOf(ctx: Ctx): ArtStyleFile {
  if (!ctx.sprites.style) throw new ArtError(["art: content/art/style.json is missing"]);
  return ctx.sprites.style;
}

function actorPalette(ctx: Ctx, t: Target): string[] {
  const { raw } = ctx;
  const id =
    t.owner === "character"
      ? raw.characters[t.id]?.file.palette
      : t.owner === "enemy"
        ? raw.enemies[t.id]?.file.tiers[0]?.palette
        : raw.bosses[t.id]?.file.palette;
  const pal = id ? raw.palettes[id] : undefined;
  if (!pal) throw new ArtError([`art: ${t.name} has no palette`]);
  return pal;
}

/** The item a part id names: an items-atlas key such as "crate", "weapon:knife" or "crate:broken". */
function itemOf(
  raw: RawContent,
  partId: string,
): { sprite: ItemSprite; frame?: string } | undefined {
  const weapon = partId.startsWith("weapon:");
  const [id = "", frame] = (weapon ? partId.slice(7) : partId).split(":");
  const def = weapon
    ? raw.items.weapons[id]
    : (raw.items.props[id] ?? raw.items.pickups[id] ?? raw.items.projectiles[id]);
  return def ? { sprite: def.sprite, frame } : undefined;
}

function settingsFor(style: ArtStyleFile, model: ArtModel) {
  const s = style.models[model] ?? {};
  return { steps: s.steps, CFGScale: s.CFGScale, scheduler: s.scheduler, lora: s.lora };
}

function lookPath(t: Target): string {
  return join(t.out, "look", "accepted.png");
}

export function planTarget(ctx: Ctx, t: Target, flags: Flags): Plan[] {
  const art = artOf(ctx, t);
  const style = styleOf(ctx);
  const actor = t.owner === "character" || t.owner === "enemy" || t.owner === "boss";
  const prefix = art.style ?? (t.owner === "stage" ? style.layerPrefix : style.prefix);
  const prompt = (p: string) => `${prefix}, ${p}`;
  const want = flags.part ?? t.only;
  const plans: Plan[] = [];

  if (actor && (want === "look" || (!want && !existsSync(lookPath(t))))) {
    if (!art.look) throw new ArtError([`art: ${relative(ROOT, t.dir)}/art.json has no look`]);
    const model = flags.model ?? art.look.model ?? art.model;
    plans.push({
      part: "look",
      palette: actorPalette(ctx, t),
      request: {
        model,
        prompt: prompt(art.look.prompt),
        width: art.look.width,
        height: art.look.height,
        seed: art.seed,
        candidates: flags.candidates ?? 2,
        ...settingsFor(style, model),
      },
    });
    return plans;
  }

  const parts = art.parts.filter((p) => !want || p.id === want);
  if (!parts.length) throw new ArtError([`art: ${t.name} has no part ${want ?? ""} in art.json`]);
  for (const part of parts) {
    const model = flags.model ?? part.model ?? art.model;
    const base = {
      model,
      prompt: prompt(part.prompt),
      seed: part.seed ?? art.seed,
      candidates: flags.candidates ?? part.candidates,
      ...settingsFor(style, model),
    };
    if (actor) {
      if (!part.heightPx) throw new ArtError([`art: ${t.name} part ${part.id} needs heightPx`]);
      const useLook = part.reference && MODELS[model].reference;
      plans.push({
        part: part.id,
        palette: actorPalette(ctx, t),
        lookFile: useLook ? lookPath(t) : undefined,
        request: { ...base, width: part.width ?? 512, height: part.height ?? 512 },
        recipe: recipeOf(part, "part", part.heightPx),
      });
    } else if (t.owner === "stage") {
      const st = ctx.raw.stages[t.id];
      const layer = st?.layers[part.id];
      if (!st || !layer)
        throw new ArtError([`art: ${t.name} part ${part.id} is not a layer of ${t.id}`]);
      const repeats = Object.values(st.segments).some((s) =>
        s.layers.some((l) => l.layer === part.id && l.repeat),
      );
      plans.push({
        part: part.id,
        palette: ["#000000", ...st.file.palette],
        request: {
          ...base,
          width: part.width ?? layer.width * 2,
          height: part.height ?? layer.height * 2,
        },
        recipe: {
          ...recipeOf(part, "layer", part.heightPx ?? layer.height),
          widthPx: part.widthPx ?? layer.width,
          tile: part.tile ?? repeats,
        },
      });
    } else if (t.owner === "items") {
      const it = itemOf(ctx.raw, part.id);
      if (!it) throw new ArtError([`art: items part ${part.id} is not an item`]);
      plans.push({
        part: part.id,
        palette: ctx.raw.palettes[it.sprite.palette] ?? [],
        request: { ...base, width: part.width ?? 512, height: part.height ?? 512 },
        recipe: {
          ...recipeOf(part, "item", part.heightPx ?? it.sprite.size[1]),
          widthPx: part.widthPx ?? it.sprite.size[0],
        },
      });
    } else {
      plans.push({
        part: part.id,
        palette: ["#000000", ...ctx.raw.masterPalette],
        request: { ...base, width: part.width ?? 1024, height: part.height ?? 512 },
        recipe: { ...recipeOf(part, "item", part.heightPx ?? 48), widthPx: part.widthPx },
      });
    }
  }
  return plans;
}

function recipeOf(part: ArtPart, use: PixelizeRecipe["use"], heightPx: number): PixelizeRecipe {
  return {
    use,
    heightPx,
    widthPx: part.widthPx,
    indices: part.indices,
    anchor: part.anchor,
    tile: part.tile,
    conversion: part.conversion,
  };
}

// ---- output

const deflate = (r: Uint8Array) => new Uint8Array(deflateSync(r, { level: 9 }));

function writeIndexed(path: string, img: IndexedImage, palette: string[]): void {
  writeFileSync(
    path,
    encodeIndexedPng({ width: img.width, height: img.height, data: img.data, palette }, deflate),
  );
}

function nextCandidate(dir: string): number {
  if (!existsSync(dir)) return 1;
  const ns = readdirSync(dir)
    .map((f) => /^raw-(\d+)\.png$/.exec(f)?.[1])
    .filter((n): n is string => !!n)
    .map(Number);
  return ns.length ? Math.max(...ns) + 1 : 1;
}

/** A small indexed preview of an RGBA image, for contact sheets of looks and raw results. */
function preview(bytes: Uint8Array, palette: string[], heightPx: number): IndexedImage | null {
  try {
    return pixelize(
      decodeRgbaPng(bytes),
      { use: "part", heightPx, conversion: { cleanup: false } },
      palette,
    ).img;
  } catch {
    return null;
  }
}

function readCandidates(dir: string): IndexedImage[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^cand-\d+\.png$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    .map((f) => {
      const png = decodeIndexedPngSync(new Uint8Array(readFileSync(join(dir, f))));
      const img = new IndexedImage(png.width, png.height);
      img.data.set(png.data);
      return img;
    });
}

/**
 * Converts every saved raw-n.png in `dir` again with the current recipe and rewrites its
 * cand-n.png, its sidecar's anchor and conversion, and the sheet. No network call, no charge.
 */
export function reconvertDir(dir: string, recipe: PixelizeRecipe, palette: string[]): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const f of readdirSync(dir).filter((f) => /^raw-\d+\.png$/.test(f))) {
    const k = f.match(/\d+/)![0];
    const metaPath = join(dir, `cand-${k}.json`);
    if (!existsSync(metaPath)) continue;
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as SpriteMeta;
    const px = pixelize(decodeRgbaPng(new Uint8Array(readFileSync(join(dir, f)))), recipe, palette);
    writeIndexed(join(dir, `cand-${k}.png`), px.img, palette);
    meta.anchor = px.anchor;
    meta.conversion = px.conversion;
    writeFileSync(metaPath, JSON.stringify(meta, null, 1) + "\n");
    n++;
  }
  sheet(join(dir, "sheet.png"), readCandidates(dir), palette);
  return n;
}

function sheet(path: string, images: IndexedImage[], palette: string[]): boolean {
  if (!images.length) return false;
  contactSheet(path, images, palette, 3, Math.min(8, images.length));
  return true;
}

function money(v: number): string {
  return `$${v.toFixed(4)}`;
}

/** The task with reference images cut short, for printing. Prompts print in full for review. */
function printable(task: Task): unknown {
  return JSON.parse(
    JSON.stringify(task, (_k, v) =>
      typeof v === "string" && v.startsWith("data:")
        ? `${v.slice(0, 30)}...(${v.length} chars)`
        : v,
    ),
  );
}

interface Run {
  flags: Flags;
  client?: RunwareClient;
  phase: string;
}

/** The key, unless this is a dry run. Checked before anything else so the error comes first. */
function requireKey(flags: Flags): string | undefined {
  if (flags.dryRun) return undefined;
  const apiKey = readApiKey(ROOT);
  if (!apiKey) throw new ArtError(["art: RUNWARE_API_KEY is not set"]);
  return apiKey;
}

function makeRun(
  flags: Flags,
  phase: string,
  apiKey: string | undefined,
  ctx: Ctx,
  fetchImpl?: typeof fetch,
): Run {
  const p = flags.phase ?? phase;
  if (!apiKey) return { flags, phase: p };
  return {
    flags,
    phase: p,
    client: new RunwareClient({
      apiKey,
      ledgerPath: LEDGER,
      budget: { total: totalBudget(flags.budget), phase: p, phaseCap: flags.phaseCap },
      scanner: ctx.scanner,
      fetch: fetchImpl,
      log: (l) => console.log(l),
    }),
  };
}

function budgetLine(run: Run, estimate: number): string {
  const entries = readLedger(LEDGER);
  const total = totalBudget(run.flags.budget);
  const cap = run.flags.phaseCap ?? PHASE_CAPS[run.phase];
  return (
    `art: estimate ${money(estimate)}; spent ${money(spent(entries))} of $${total.toFixed(2)}` +
    (cap !== undefined
      ? `; phase ${run.phase} ${money(spent(entries, run.phase))} of $${cap.toFixed(2)}`
      : "")
  );
}

// ---- subcommands

async function gen(args: string[], fetchImpl?: typeof fetch): Promise<number> {
  const flags = parseFlags(args);
  const name = flags.rest[0];
  if (!name)
    throw new ArtError([
      "art: usage: art gen <target> [--part <id>] [--candidates 2] [--model m] [--dry-run|--reconvert]",
    ]);
  const t = parseTarget(name);
  if (flags.reconvert) {
    // After a change to heightPx, indices or conversion: the saved images, converted again.
    const ctx = loadCtx();
    for (const plan of planTarget(ctx, t, flags)) {
      if (!plan.recipe) continue;
      const dir = join(t.out, plan.part);
      const n = reconvertDir(dir, plan.recipe, plan.palette);
      console.log(
        `art: ${t.name} ${plan.part}: converted ${n} candidate(s) again, sheet ${relative(ROOT, join(dir, "sheet.png"))}`,
      );
    }
    return 0;
  }
  const apiKey = requireKey(flags);
  const ctx = loadCtx();
  const run = makeRun(flags, t.phase, apiKey, ctx, fetchImpl);
  const plans = planTarget(ctx, t, flags);
  let estimate = 0;
  for (const plan of plans) {
    const look =
      plan.lookFile && existsSync(plan.lookFile) ? readFileSync(plan.lookFile) : undefined;
    if (plan.lookFile && !look && !flags.dryRun)
      throw new ArtError([
        `art: ${t.name} part ${plan.part} uses the look as its reference; run art gen ${t.name} --part look, then art accept ${t.name} look <n>`,
      ]);
    const reference = look
      ? dataUri(new Uint8Array(look))
      : plan.lookFile
        ? `<look: ${relative(ROOT, plan.lookFile)} is not accepted yet>`
        : undefined;
    const task = buildImageTask({ ...plan.request, reference });
    const cost = estimateCost(task);
    estimate += cost;
    const label = { target: t.name, part: plan.part };
    if (!run.client) {
      const hits = ctx.scanner.scanText(task.positivePrompt, `${t.name} ${plan.part}`);
      if (hits.length)
        throw new ArtError(
          hits.map(
            (h) => `art: forbidden term "${h.term}" in the prompt for ${t.name} ${plan.part}`,
          ),
        );
      console.log(JSON.stringify([printable(task)], null, 2));
      console.log(
        `art: ${t.name} ${plan.part}: ${task.numberResults} candidate(s), estimate ${money(cost)}`,
      );
      continue;
    }
    const results = await run.client.run(task, label);
    const dir = join(t.out, plan.part);
    mkdirSync(dir, { recursive: true });
    let n = nextCandidate(dir);
    const shown: IndexedImage[] = [];
    let charged = 0;
    for (const r of results) {
      charged += r.cost;
      writeFileSync(join(dir, `raw-${n}.png`), r.bytes);
      const meta: SpriteMeta = {
        schemaVersion: 1,
        target: t.name,
        part: plan.part,
        model: task.model,
        positivePrompt: task.positivePrompt,
        seed: r.seed,
        width: task.width,
        height: task.height,
        steps: task.steps,
        CFGScale: task.CFGScale,
        ...(task.scheduler ? { scheduler: task.scheduler } : {}),
        lora: task.lora ?? [],
        ...(look ? { reference: "look" } : {}),
        taskUUID: r.taskUUID,
        imageUUID: r.imageUUID,
        cost: r.cost,
        generatedAt: new Date().toISOString(),
        anchor: [0, 0],
        conversion: {},
      };
      if (plan.recipe) {
        try {
          const px = pixelize(decodeRgbaPng(r.bytes), plan.recipe, plan.palette);
          writeIndexed(join(dir, `cand-${n}.png`), px.img, plan.palette);
          meta.anchor = px.anchor;
          meta.conversion = px.conversion;
          shown.push(px.img);
        } catch (e) {
          console.warn(`warning: ${t.name} ${plan.part} candidate ${n}: ${(e as Error).message}`);
        }
      } else {
        const p = preview(r.bytes, plan.palette, 96);
        if (p) shown.push(p);
      }
      writeFileSync(join(dir, `cand-${n}.json`), JSON.stringify(meta, null, 1) + "\n");
      n++;
    }
    const all = plan.recipe ? readCandidates(dir) : shown;
    sheet(join(dir, "sheet.png"), all, plan.palette);
    console.log(
      `art: ${t.name} ${plan.part}: ${results.length} candidate(s), ${money(charged)}, sheet ${relative(ROOT, join(dir, "sheet.png"))}`,
    );
  }
  console.log(budgetLine(run, estimate));
  if (!run.client)
    checkBudget(readLedger(LEDGER), estimate, {
      total: totalBudget(flags.budget),
      phase: run.phase,
      phaseCap: flags.phaseCap,
    });
  if (run.client) {
    if (plans.some((p) => p.part === "look"))
      console.log(
        `art: pick a look with art accept ${t.name} look <n>, then run art gen ${t.name}`,
      );
    else console.log(`art: pick candidates with art accept ${t.name} <part> <n>`);
  }
  return 0;
}

/** Where an accepted part lands in content/, relative to the target's folder. */
function acceptedPath(t: Target, part: string): string {
  if (t.owner === "stage") return join("layers", `${part}.png`);
  return join("sprites", partFile(part));
}

function accept(args: string[]): number {
  const flags = parseFlags(args);
  const [name, part, nStr] = flags.rest;
  if (!name || !part || !nStr) throw new ArtError(["art: usage: art accept <target> <part> <n>"]);
  const t = parseTarget(name);
  const dir = join(t.out, part);
  const meta = join(dir, `cand-${nStr}.json`);
  if (!existsSync(meta)) throw new ArtError([`art: ${relative(ROOT, meta)} does not exist`]);
  const sidecar = JSON.parse(readFileSync(meta, "utf8")) as SpriteMeta;
  const rel = acceptedPath(t, part);
  const sidecarPath = join(t.dir, rel.replace(/\.png$/, ".gen.json"));
  mkdirSync(join(sidecarPath, ".."), { recursive: true });
  if (part === "look") {
    copyFileSync(join(dir, `raw-${nStr}.png`), lookPath(t));
  } else {
    const cand = join(dir, `cand-${nStr}.png`);
    if (!existsSync(cand))
      throw new ArtError([`art: ${relative(ROOT, cand)} does not exist; the conversion failed`]);
    copyFileSync(cand, join(t.dir, rel));
  }
  writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 1) + "\n");
  if (!markKept(LEDGER, sidecar.imageUUID))
    console.warn(`warning: no ledger line has image ${sidecar.imageUUID}`);
  const where = relative(ROOT, t.dir);
  if (part === "look") {
    console.log(
      `art: accepted the look for ${t.name}; its record is ${relative(ROOT, sidecarPath)}`,
    );
    console.log(`art: next, run art gen ${t.name}`);
    return 0;
  }
  console.log(
    `art: accepted ${relative(ROOT, join(t.dir, rel))} and ${relative(ROOT, sidecarPath)}`,
  );
  if (t.owner === "stage")
    console.log(
      `art: next, add { "op": "image", "file": "${part}.png" } first in ${where}/layers/${part}.json`,
    );
  else if (t.owner === "items")
    console.log(`art: next, set "image": "${rel}" on the item's sprite in ${where}/items.json`);
  else if (part === "portrait") console.log(`art: next, set "portraitImage": "${rel}" in ${where}`);
  else if (t.owner !== "title") {
    const at = part === "head" ? `"at": "neck", "alignTo": "head"` : `"at": "<joint>"`;
    console.log(
      `art: next, add { "shape": "sprite", "file": "${rel}", ${at} } to ${where}/overlays.json and hide the parts it replaces`,
    );
  }
  console.log("art: then run pnpm tools validate " + where);
  return 0;
}

function sheetCommand(args: string[]): number {
  const flags = parseFlags(args);
  const name = flags.rest[0];
  if (!name) throw new ArtError(["art: usage: art sheet <target> [--baked]"]);
  const t = parseTarget(name);
  const load = loadContent(createRegistry());
  if (flags.baked) {
    if (t.owner !== "character" && t.owner !== "enemy" && t.owner !== "boss")
      throw new ArtError(["art: --baked works for characters, enemies and bosses"]);
    const src =
      t.owner === "character"
        ? load.raw.characters[t.id]
        : t.owner === "enemy"
          ? load.raw.enemies[t.id]
          : load.raw.bosses[t.id];
    const rig = src ? load.raw.rigs[src.file.rig] : undefined;
    if (!src || !rig) throw new ArtError([`art: ${t.name} does not load`]);
    const ctx: Ctx = { raw: load.raw, sprites: load.sprites, scanner: new ForbiddenScanner([]) };
    const frames = posesUsed(src.states, load.raw.templates).map((p) => {
      const f = drawPose(rig, src.overlays, p, { sprites: load.sprites.actors[t.id] });
      const b = f.img.bounds();
      return b ? f.img.crop(b.x, b.y, b.w, b.h) : f.img;
    });
    mkdirSync(t.out, { recursive: true });
    const path = join(t.out, "baked.png");
    sheet(path, frames, actorPalette(ctx, t));
    console.log(`art: wrote ${relative(ROOT, path)} (${frames.length} frames)`);
    return 0;
  }
  if (!existsSync(t.out))
    throw new ArtError([`art: no candidates for ${t.name}; run art gen first`]);
  const ctx: Ctx = { raw: load.raw, sprites: load.sprites, scanner: new ForbiddenScanner([]) };
  let wrote = 0;
  for (const part of readdirSync(t.out).sort()) {
    const dir = join(t.out, part);
    if (!statSync(dir).isDirectory()) continue;
    if (t.only && part !== t.only) continue;
    let palette: string[];
    if (t.owner === "stage") palette = ["#000000", ...(load.raw.stages[t.id]?.file.palette ?? [])];
    else if (t.owner === "items")
      palette = load.raw.palettes[itemOf(load.raw, part)?.sprite.palette ?? ""] ?? [];
    else if (t.owner === "title") palette = ["#000000", ...load.raw.masterPalette];
    else palette = actorPalette(ctx, t);
    const images =
      part === "look"
        ? readdirSync(dir)
            .filter((f) => /^raw-\d+\.png$/.test(f))
            .sort()
            .map((f) => preview(new Uint8Array(readFileSync(join(dir, f))), palette, 96))
            .filter((i): i is IndexedImage => !!i)
        : readCandidates(dir);
    if (sheet(join(dir, "sheet.png"), images, palette)) {
      console.log(
        `art: wrote ${relative(ROOT, join(dir, "sheet.png"))} (${images.length} candidates)`,
      );
      wrote++;
    }
  }
  if (!wrote) console.log(`art: no candidates for ${t.name}`);
  return 0;
}

function ledgerCommand(args: string[]): number {
  const flags = parseFlags(args);
  const entries = readLedger(LEDGER);
  const total = totalBudget(flags.budget);
  const phases = [...new Set([...Object.keys(PHASE_CAPS), ...entries.map((e) => e.phase)])].sort();
  for (const p of phases) {
    const rows = entries.filter((e) => e.phase === p);
    const cap = PHASE_CAPS[p];
    console.log(
      `phase ${p.padEnd(3)} ${money(spent(entries, p)).padStart(9)}` +
        (cap !== undefined ? ` of $${cap.toFixed(2)}` : "         ") +
        `  ${rows.length} image(s), ${rows.filter((e) => e.kept).length} kept`,
    );
  }
  const all = spent(entries);
  console.log(
    `total     ${money(all).padStart(9)} of $${total.toFixed(2)}, $${Math.max(0, total - all).toFixed(2)} left`,
  );
  return 0;
}

// ---- the probe (WI-0)

interface ProbeRequest {
  id: string;
  target: string;
  part: string;
  plan: Plan;
  /** The request whose first result becomes this request's reference. */
  refFrom?: string;
}

/** The fixed probe set: twelve image requests, then two background removals. */
export function probeRequests(ctx: Ctx): ProbeRequest[] {
  const interns = parseTarget("enemy:interns");
  const flags = parseFlags([]);
  const actor = (part: string, model: ArtModel, size: number): Plan => {
    const p = planTarget(ctx, interns, { ...flags, part, model })[0]!;
    return { ...p, request: { ...p.request, width: size, height: size } };
  };
  const layer = (model: ArtModel) =>
    planTarget(ctx, parseTarget("layer:game-0/mainstreet"), { ...flags, model })[0]!;
  const items = planTarget(ctx, parseTarget("items"), { ...flags, model: "klein4b" }).slice(0, 3);
  const look = "klein4b-512-look";
  const req = (id: string, target: string, plan: Plan, refFrom?: string): ProbeRequest => ({
    id,
    target,
    part: plan.part,
    plan,
    refFrom,
  });
  return [
    req(look, "enemy:interns", actor("look", "klein4b", 512)),
    req("klein4b-512-head", "enemy:interns", actor("head", "klein4b", 512), look),
    req("klein4b-512-torso", "enemy:interns", actor("torso", "klein4b", 512), look),
    req("klein4b-1024-head", "enemy:interns", actor("head", "klein4b", 1024), look),
    req("schnell-512-head", "enemy:interns", actor("head", "schnell", 512)),
    req("schnell-512-torso", "enemy:interns", actor("torso", "schnell", 512)),
    req("schnell-layer", "layer:game-0/mainstreet", layer("schnell")),
    req("dev-layer", "layer:game-0/mainstreet", layer("dev")),
    req("kontext-1024-head", "enemy:interns", actor("head", "kontext", 1024), look),
    ...items.map((p) => req(`klein4b-512-${p.part.replace(/:/g, "-")}`, "items", p)),
  ];
}

const REF_STYLES: RefStyle[] = ["inputs.referenceImages", "referenceImages", "inputs.seedImage"];

/** Converts probe results with dither off and on, and writes the sheet. */
function convertProbe(
  id: string,
  plan: Plan,
  dir: string,
  raws: Uint8Array[],
  conversion: ArtConversion = {},
): void {
  const shown: IndexedImage[] = [];
  raws.forEach((bytes, i) => {
    if (!plan.recipe) {
      const p = preview(bytes, plan.palette, 96);
      if (p) shown.push(p);
      return;
    }
    for (const dither of [false, true]) {
      try {
        const px = pixelize(
          decodeRgbaPng(bytes),
          { ...plan.recipe, conversion: { ...plan.recipe.conversion, ...conversion, dither } },
          plan.palette,
        );
        writeIndexed(
          join(dir, `cand-${i + 1}${dither ? "-dither" : ""}.png`),
          px.img,
          plan.palette,
        );
        shown.push(px.img);
      } catch (e) {
        console.warn(`warning: ${id} result ${i + 1}: ${(e as Error).message}`);
      }
    }
  });
  sheet(join(dir, "sheet.png"), shown, plan.palette);
}

/** Converts the saved probe results again, with no network call and no cost. */
function reconvertProbe(): number {
  const ctx = loadCtx();
  const out = join(ART_OUT, "probe");
  const reqs = probeRequests(ctx);
  const raws = (dir: string) =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => /^raw-\d+\.png$/.test(f))
          .sort()
          .map((f) => new Uint8Array(readFileSync(join(dir, f))))
      : [];
  for (const r of reqs) {
    const dir = join(out, r.id);
    const bytes = raws(dir);
    if (bytes.length) convertProbe(r.id, r.plan, dir, bytes);
    const bg = join(out, `removebg-${r.id}`);
    const bgBytes = raws(bg);
    if (bgBytes.length) convertProbe(`removebg-${r.id}`, r.plan, bg, bgBytes, { key: null });
  }
  console.log(`art: probe converted the saved results again in ${relative(ROOT, out)}`);
  return 0;
}

async function probe(args: string[], fetchImpl?: typeof fetch): Promise<number> {
  const flags = parseFlags(args);
  if (flags.reconvert) return reconvertProbe();
  const apiKey = requireKey(flags);
  const ctx = loadCtx();
  const run = makeRun(flags, "0", apiKey, ctx, fetchImpl);
  const reqs = probeRequests(ctx);
  const out = join(ART_OUT, "probe");
  const firstRaw = new Map<string, Uint8Array>();
  const report: Record<string, unknown>[] = [];
  let estimate = 0;
  for (const r of reqs) {
    const ref = r.refFrom ? firstRaw.get(r.refFrom) : undefined;
    const styles: (RefStyle | undefined)[] =
      r.refFrom && MODELS[r.plan.request.model].reference ? REF_STYLES : [undefined];
    const reference = r.refFrom
      ? ref
        ? dataUri(ref)
        : `<first result of ${r.refFrom}>`
      : undefined;
    estimate += estimateCost(buildImageTask({ ...r.plan.request, reference }));
    if (!run.client) {
      console.log(
        `${r.id}: ${JSON.stringify(printable(buildImageTask({ ...r.plan.request, reference })))}`,
      );
      continue;
    }
    const dir = join(out, r.id);
    mkdirSync(dir, { recursive: true });
    const t0 = Date.now();
    let results;
    let used: RefStyle | undefined;
    let error: string | undefined;
    for (const style of styles) {
      try {
        results = await run.client.run(
          buildImageTask({ ...r.plan.request, reference, refStyle: style }),
          {
            target: r.target,
            part: `${r.part} (probe ${r.id})`,
          },
        );
        used = style;
        break;
      } catch (e) {
        if (!(e instanceof ArtError)) throw e;
        error = e.lines.join(" | ");
        console.warn(`warning: ${r.id}${style ? ` with ${style}` : ""}: ${error}`);
        if (e.lines.some((l) => /budget cap|phase \d+ cap/.test(l))) throw e;
        if (!style || !/reference|seedImage|inputs/i.test(error)) break;
      }
    }
    const seconds = (Date.now() - t0) / 1000;
    if (!results) {
      report.push({ id: r.id, model: r.plan.request.model, error, seconds });
      continue;
    }
    results.forEach((res, i) => {
      writeFileSync(join(dir, `raw-${i + 1}.png`), res.bytes);
      if (i === 0) firstRaw.set(r.id, res.bytes);
    });
    convertProbe(
      r.id,
      r.plan,
      dir,
      results.map((x) => x.bytes),
    );
    const cost = results.reduce((n, x) => n + x.cost, 0);
    report.push({
      id: r.id,
      model: r.plan.request.model,
      refStyle: used,
      results: results.length,
      cost,
      seconds,
    });
    console.log(
      `art: probe ${r.id}: ${results.length} result(s), ${money(cost)}, ${seconds.toFixed(1)} s`,
    );
  }
  // Two background removals on the first klein head and the first schnell head.
  for (const from of ["klein4b-512-head", "schnell-512-head"]) {
    const src = firstRaw.get(from);
    const task = buildRemoveBgTask(src ? dataUri(src) : `<first result of ${from}>`);
    estimate += estimateCost(task);
    if (!run.client) {
      console.log(`removebg-${from}: ${JSON.stringify(printable(task))}`);
      continue;
    }
    if (!src) continue;
    const t0 = Date.now();
    try {
      const [res] = await run.client.run(task, {
        target: "enemy:interns",
        part: `removebg (probe ${from})`,
      });
      const dir = join(out, `removebg-${from}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "raw-1.png"), res!.bytes);
      convertProbe(`removebg-${from}`, reqs.find((q) => q.id === from)!.plan, dir, [res!.bytes], {
        key: null,
      });
      report.push({
        id: `removebg-${from}`,
        model: task.model,
        cost: res!.cost,
        seconds: (Date.now() - t0) / 1000,
      });
    } catch (e) {
      if (!(e instanceof ArtError)) throw e;
      if (e.lines.some((l) => /budget cap|phase \d+ cap/.test(l))) throw e;
      console.warn(`warning: removebg ${from}: ${e.lines.join(" | ")}`);
      report.push({ id: `removebg-${from}`, model: task.model, error: e.lines.join(" | ") });
    }
  }
  if (run.client) {
    writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1) + "\n");
    console.log(
      `art: probe wrote ${relative(ROOT, out)}; write the probe record and its DECISIONS row next`,
    );
  } else console.log(`art: probe: ${reqs.length} image requests and 2 background removals`);
  console.log(budgetLine(run, estimate));
  if (!run.client)
    checkBudget(readLedger(LEDGER), estimate, {
      total: totalBudget(flags.budget),
      phase: run.phase,
      phaseCap: flags.phaseCap,
    });
  return 0;
}

// ---- entry

const USAGE = [
  "usage: pnpm tools art <subcommand>",
  "  probe [--dry-run|--reconvert]                       the fixed Phase 0 probe set",
  "  gen <target> [--part id] [--candidates 2] [--model klein4b|schnell|dev|kontext] [--dry-run]",
  "  gen <target> [--part id] --reconvert                convert the saved candidates again, free",
  "  accept <target> <part> <n>                          copy candidate n into content/",
  "  sheet <target> [--baked]                            contact sheets at 3x",
  "  ledger                                              spend per phase and the remaining budget",
  "targets: character:<id> enemy:<id> boss:<id> stage:<id> layer:<stage>/<layer> items item:<id>",
  "         portrait:<id> card:<id> title",
  "flags: --phase <n> --phase-cap <usd> --budget <usd> (or ART_BUDGET_USD, default 5.00)",
];

export async function artCommand(args: string[], fetchImpl?: typeof fetch): Promise<number> {
  const [sub, ...rest] = args;
  try {
    switch (sub) {
      case "probe":
        return await probe(rest, fetchImpl);
      case "gen":
        return await gen(rest, fetchImpl);
      case "accept":
        return accept(rest);
      case "sheet":
        return sheetCommand(rest);
      case "ledger":
        return ledgerCommand(rest);
      default:
        console.log(USAGE.join("\n"));
        return sub && sub !== "help" ? 1 : 0;
    }
  } catch (e) {
    if (e instanceof ArtError) {
      for (const l of e.lines) console.error(l);
      return 1;
    }
    throw e;
  }
}
