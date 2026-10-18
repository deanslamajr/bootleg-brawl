// The Runware REST client for the art tool (DECISIONS D52). It builds one task per request,
// refuses prompts with a forbidden term, refuses a request that would pass the spend cap, and
// appends one ledger line per charged image. It never prints or stores the API key.

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ArtModel, ForbiddenScanner } from "@bb/schema";

export const RUNWARE_URL = "https://api.runware.ai/v1";

/** One line per problem; the command prints them and exits 1. */
export class ArtError extends Error {
  constructor(readonly lines: string[]) {
    super(lines.join("\n"));
    this.name = "ArtError";
  }
}

export interface Lora {
  model: string;
  weight: number;
}

export interface ModelInfo {
  air: string;
  steps: number;
  CFGScale: number;
  scheduler?: string;
  lora?: Lora[];
  /** How the model takes an identity reference, if it takes one. */
  reference: boolean;
  /** Dimension rule from the model's schema.json (read 2026-10-17). */
  sizes: "multiple-of-64" | "kontext-pairs";
}

/** The pixel-art LoRA for FLUX.1 schnell (D59). It does not fit FLUX.1 dev. */
export const PIXEL_LORA: Lora = { model: "civitai:720776@805962", weight: 0.64 };

export const MODELS: Record<ArtModel, ModelInfo> = {
  klein4b: {
    air: "runware:400@4",
    steps: 4,
    CFGScale: 7,
    reference: true,
    sizes: "multiple-of-64",
  },
  schnell: {
    air: "runware:100@1",
    steps: 4,
    CFGScale: 43,
    scheduler: "FlowMatchEulerDiscreteScheduler",
    lora: [PIXEL_LORA],
    reference: false,
    sizes: "multiple-of-64",
  },
  dev: {
    air: "runware:101@1",
    steps: 28,
    CFGScale: 3.5,
    lora: [PIXEL_LORA],
    reference: false,
    sizes: "multiple-of-64",
  },
  kontext: {
    air: "runware:106@1",
    steps: 28,
    CFGScale: 2.5,
    reference: true,
    sizes: "kontext-pairs",
  },
};

/** Kontext dev only accepts these sizes (its schema.json `oneOf`). */
export const KONTEXT_SIZES: [number, number][] = [
  [1568, 672],
  [1504, 688],
  [1456, 720],
  [1392, 752],
  [1328, 800],
  [1248, 832],
  [1184, 880],
  [1104, 944],
  [1024, 1024],
  [944, 1104],
  [880, 1184],
  [832, 1248],
  [800, 1328],
  [752, 1392],
  [720, 1456],
  [688, 1504],
  [672, 1568],
];

/** The background-removal task the probe tries. The probe reads the error if the id is wrong. */
export const REMOVE_BG_MODEL = "runware:109@1";

/** Sizes the model accepts: multiples of 64 from 128 to 2048, or the nearest Kontext pair. */
export function snapSize(model: ArtModel, w: number, h: number): [number, number] {
  if (MODELS[model].sizes === "kontext-pairs") {
    const want = Math.log(w / h);
    let best = KONTEXT_SIZES[8]!;
    for (const s of KONTEXT_SIZES)
      if (Math.abs(Math.log(s[0] / s[1]) - want) < Math.abs(Math.log(best[0] / best[1]) - want))
        best = s;
    return [best[0], best[1]];
  }
  const snap = (v: number) => Math.min(2048, Math.max(128, Math.ceil(v / 64) * 64));
  return [snap(w), snap(h)];
}

export interface ImageTask {
  taskType: "imageInference";
  taskUUID: string;
  model: string;
  positivePrompt: string;
  width: number;
  height: number;
  steps: number;
  CFGScale: number;
  seed: number;
  numberResults: number;
  outputType: "base64Data";
  outputFormat: "PNG";
  includeCost: true;
  scheduler?: string;
  lora?: Lora[];
  inputs?: { referenceImages?: string[]; seedImage?: string };
  referenceImages?: string[];
}

export interface RemoveBgTask {
  taskType: "removeBackground";
  taskUUID: string;
  model: string;
  inputs: { image: string };
  outputType: "base64Data";
  outputFormat: "PNG";
  includeCost: true;
}

export type Task = ImageTask | RemoveBgTask;

/** Where a reference goes: the documented `inputs.referenceImages`, or the fallbacks the probe tries. */
export type RefStyle = "inputs.referenceImages" | "referenceImages" | "inputs.seedImage";

export interface ImageRequest {
  model: ArtModel;
  /** The full prompt, style prefix included. */
  prompt: string;
  width: number;
  height: number;
  seed: number;
  candidates: number;
  /** A data URI or image UUID. Ignored by models that take no reference. */
  reference?: string;
  refStyle?: RefStyle;
  steps?: number;
  CFGScale?: number;
  scheduler?: string;
  lora?: Lora[];
}

export function buildImageTask(req: ImageRequest, uuid: string = randomUUID()): ImageTask {
  const info = MODELS[req.model];
  const [width, height] = snapSize(req.model, req.width, req.height);
  const scheduler = req.scheduler ?? info.scheduler;
  const lora = req.lora ?? info.lora;
  const task: ImageTask = {
    taskType: "imageInference",
    taskUUID: uuid,
    model: info.air,
    positivePrompt: req.prompt,
    width,
    height,
    steps: req.steps ?? info.steps,
    CFGScale: req.CFGScale ?? info.CFGScale,
    seed: req.seed,
    numberResults: req.candidates,
    outputType: "base64Data",
    outputFormat: "PNG",
    includeCost: true,
    ...(scheduler ? { scheduler } : {}),
    ...(lora?.length ? { lora } : {}),
  };
  if (req.reference && info.reference) {
    const style = req.refStyle ?? "inputs.referenceImages";
    if (style === "inputs.referenceImages") task.inputs = { referenceImages: [req.reference] };
    else if (style === "referenceImages") task.referenceImages = [req.reference];
    else task.inputs = { seedImage: req.reference };
  }
  return task;
}

export function buildRemoveBgTask(image: string, uuid: string = randomUUID()): RemoveBgTask {
  return {
    taskType: "removeBackground",
    taskUUID: uuid,
    model: REMOVE_BG_MODEL,
    inputs: { image },
    outputType: "base64Data",
    outputFormat: "PNG",
    includeCost: true,
  };
}

/**
 * The estimated charge for a task in USD. It rounds up on purpose, because the cap check uses
 * it, and the ledger records the real charge. The numbers are the highest charge per image the
 * probe measured on 2026-10-17 (D58). schnell and Kontext cost two to four
 * times their rate cards. dev did not run, so its number is a guess at the same ratio.
 */
export function estimateCost(task: Task): number {
  if (task.taskType === "removeBackground") return 0.001;
  const mp = Math.max(1, (task.width * task.height) / (1024 * 1024));
  const steps = Math.max(1, task.steps / 28);
  let each: number;
  switch (task.model) {
    case MODELS.klein4b.air:
      each = 0.0015 * mp;
      break;
    case MODELS.schnell.air:
      each = 0.009 * mp;
      break;
    case MODELS.dev.air:
      each = 0.02 * mp * steps;
      break;
    case MODELS.kontext.air:
      each = 0.05 * mp * steps;
      break;
    default:
      each = 0.05 * mp;
  }
  return each * task.numberResults;
}

// ---- credentials

/** The key from the environment, or from `.env` at the repository root. */
export function readApiKey(root: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.RUNWARE_API_KEY) return env.RUNWARE_API_KEY;
  const file = join(root, ".env");
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((l) => /^\s*(export\s+)?RUNWARE_API_KEY\s*=/.test(l));
  const v = line
    ?.slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2");
  return v || undefined;
}

// ---- the ledger

export interface LedgerEntry {
  time: string;
  phase: string;
  target: string;
  part: string;
  model: string;
  size: string;
  taskUUID: string;
  imageUUID: string;
  cost: number;
  /** True when the response carried no cost and the line holds the estimate. */
  estimated?: boolean;
  kept: boolean;
}

export function readLedger(path: string): LedgerEntry[] {
  if (!existsSync(path)) return [];
  const out: LedgerEntry[] = [];
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (!line.trim()) return;
      try {
        out.push(JSON.parse(line) as LedgerEntry);
      } catch {
        throw new ArtError([
          `art: ${path} line ${i + 1} is not JSON; fix the ledger before spending`,
        ]);
      }
    });
  return out;
}

export function spent(entries: LedgerEntry[], phase?: string): number {
  return entries
    .filter((e) => phase === undefined || e.phase === phase)
    .reduce((n, e) => n + e.cost, 0);
}

export function appendLedger(path: string, entry: LedgerEntry): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + "\n");
}

/** Marks the ledger line of one image as kept. Returns false when no line matches. */
export function markKept(path: string, imageUUID: string): boolean {
  const entries = readLedger(path);
  let hit = false;
  for (const e of entries)
    if (e.imageUUID === imageUUID) {
      e.kept = true;
      hit = true;
    }
  if (hit) writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return hit;
}

/** Spend caps per phase from the plan's section 4.2. `--phase-cap` overrides them. */
export const PHASE_CAPS: Record<string, number> = {
  "0": 0.15,
  "2": 1.5,
  "3": 0.5,
  "4": 0.5,
  "5": 1.35,
};

export interface Budget {
  /** The hard cap over the whole ledger. */
  total: number;
  phase: string;
  phaseCap?: number;
}

/** Throws when the request would pass the total cap or the phase cap. */
export function checkBudget(entries: LedgerEntry[], estimate: number, b: Budget): void {
  const all = spent(entries);
  if (all + estimate > b.total + 1e-9)
    throw new ArtError([`art: budget cap reached ($${all.toFixed(2)} of $${b.total.toFixed(2)})`]);
  const cap = b.phaseCap ?? PHASE_CAPS[b.phase];
  if (cap !== undefined) {
    const p = spent(entries, b.phase);
    if (p + estimate > cap + 1e-9)
      throw new ArtError([
        `art: phase ${b.phase} cap reached ($${p.toFixed(2)} of $${cap.toFixed(2)})`,
      ]);
  }
}

/** The total cap: `--budget`, then ART_BUDGET_USD, then $5.00. */
export function totalBudget(
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const v = Number(flag ?? env.ART_BUDGET_USD ?? 5);
  if (!Number.isFinite(v) || v < 0)
    throw new ArtError([`art: budget ${flag ?? env.ART_BUDGET_USD} is not a number`]);
  return v;
}

/** Throws when the prompt has a forbidden term. The validator scans content; this scans what is sent. */
export function scanPrompt(scanner: ForbiddenScanner, prompt: string, where: string): void {
  const hits = scanner.scanText(prompt, where);
  if (hits.length)
    throw new ArtError(
      hits.map((h) => `art: forbidden term "${h.term}" in the prompt for ${where}`),
    );
}

// ---- the client

export interface ResultImage {
  bytes: Uint8Array;
  seed: number;
  cost: number;
  imageUUID: string;
  taskUUID: string;
}

export interface ClientOptions {
  apiKey: string;
  ledgerPath: string;
  budget: Budget;
  scanner: ForbiddenScanner;
  fetch?: typeof fetch;
  /** Waits between 5xx retries, in ms. */
  retryWaits?: number[];
  now?: () => Date;
  log?: (line: string) => void;
}

interface RunwareResponse {
  data?: {
    taskUUID: string;
    imageUUID: string;
    imageBase64Data?: string;
    seed?: number;
    cost?: number;
  }[];
  errors?: { code?: string; message?: string; parameter?: string; taskUUID?: string }[];
}

export class RunwareClient {
  constructor(private readonly o: ClientOptions) {}

  /**
   * Sends one task. Every charged image gets a ledger line before anything else happens, so a
   * later crash cannot lose a charge. An `errors` array becomes an ArtError.
   */
  async run(task: Task, label: { target: string; part: string }): Promise<ResultImage[]> {
    if (task.taskType === "imageInference")
      scanPrompt(this.o.scanner, task.positivePrompt, `${label.target} ${label.part}`);
    const estimate = estimateCost(task);
    checkBudget(readLedger(this.o.ledgerPath), estimate, this.o.budget);
    const body = await this.post([task]);
    const results: ResultImage[] = [];
    const time = (this.o.now ?? (() => new Date()))().toISOString();
    const size = task.taskType === "imageInference" ? `${task.width}x${task.height}` : "";
    const perImage =
      estimate / Math.max(1, task.taskType === "imageInference" ? task.numberResults : 1);
    for (const d of body.data ?? []) {
      const estimated = typeof d.cost !== "number";
      const cost = estimated ? perImage : d.cost!;
      appendLedger(this.o.ledgerPath, {
        time,
        phase: this.o.budget.phase,
        target: label.target,
        part: label.part,
        model: task.model,
        size,
        taskUUID: d.taskUUID ?? task.taskUUID,
        imageUUID: d.imageUUID,
        cost,
        ...(estimated ? { estimated } : {}),
        kept: false,
      });
      if (d.imageBase64Data)
        results.push({
          bytes: new Uint8Array(Buffer.from(d.imageBase64Data, "base64")),
          seed: d.seed ?? (task.taskType === "imageInference" ? task.seed : 0),
          cost,
          imageUUID: d.imageUUID,
          taskUUID: d.taskUUID ?? task.taskUUID,
        });
    }
    if (body.errors?.length)
      throw new ArtError(
        body.errors.map(
          (e) =>
            `art: runware error ${e.code ?? "?"}: ${e.message ?? "no message"}${e.parameter ? ` (parameter ${e.parameter})` : ""}`,
        ),
      );
    if (!results.length) throw new ArtError(["art: runware returned no images"]);
    return results;
  }

  private async post(tasks: Task[]): Promise<RunwareResponse> {
    const f = this.o.fetch ?? fetch;
    const waits = this.o.retryWaits ?? [1000, 4000];
    for (let attempt = 0; ; attempt++) {
      const res = await f(RUNWARE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.o.apiKey}` },
        body: JSON.stringify(tasks),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.status >= 500 && attempt < waits.length) {
        this.o.log?.(`art: runware returned HTTP ${res.status}; retrying`);
        await new Promise((r) => setTimeout(r, waits[attempt]));
        continue;
      }
      const text = await res.text();
      let body: RunwareResponse;
      try {
        body = JSON.parse(text) as RunwareResponse;
      } catch {
        throw new ArtError([
          `art: runware returned HTTP ${res.status} with a body that is not JSON`,
        ]);
      }
      if (!res.ok && !body.errors?.length)
        throw new ArtError([`art: runware returned HTTP ${res.status}`]);
      return body;
    }
  }
}

/** A PNG as a data URI, for a reference image. */
export function dataUri(png: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}
