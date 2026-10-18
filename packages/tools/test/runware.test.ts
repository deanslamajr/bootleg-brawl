import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenScanner } from "@bb/schema";
import {
  ArtError,
  RunwareClient,
  buildImageTask,
  estimateCost,
  markKept,
  readApiKey,
  readLedger,
  snapSize,
  type ImageTask,
} from "../src/art/runware";
import { artCommand } from "../src/commands/art";
import { ROOT } from "../src/lib/paths";

const tmp = mkdtempSync(join(tmpdir(), "bb-runware-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const scanner = new ForbiddenScanner(["zorbleton"]);
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");

/** A fetch stub that records requests and answers from a queue. */
function stub(...answers: { status?: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answers.shift() ?? answers[answers.length - 1]!;
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

function client(ledgerPath: string, f: typeof fetch, total = 5) {
  return new RunwareClient({
    apiKey: "test-key",
    ledgerPath,
    budget: { total, phase: "2" },
    scanner,
    fetch: f,
    retryWaits: [0, 0],
    now: () => new Date("2026-10-17T12:00:00Z"),
  });
}

const request = {
  model: "klein4b" as const,
  prompt: "1990s arcade pixel art, a tired intern",
  width: 500,
  height: 700,
  seed: 1234567,
  candidates: 2,
};

describe("the Runware task", () => {
  it("has the documented shape, with sizes rounded up to multiples of 64", () => {
    const t = buildImageTask({ ...request, reference: "data:image/png;base64,AAAA" }, "uuid-1");
    expect(t).toMatchObject({
      taskType: "imageInference",
      taskUUID: "uuid-1",
      model: "runware:400@4",
      width: 512,
      height: 704,
      steps: 4,
      CFGScale: 7,
      seed: 1234567,
      numberResults: 2,
      outputType: "base64Data",
      outputFormat: "PNG",
      includeCost: true,
      inputs: { referenceImages: ["data:image/png;base64,AAAA"] },
    });
    expect(snapSize("schnell", 3000, 10)).toEqual([2048, 128]);
  });
  it("snaps Kontext to its fixed sizes and drops references for text-only models", () => {
    expect(snapSize("kontext", 512, 768)).toEqual([832, 1248]);
    const s = buildImageTask({ ...request, model: "schnell", reference: "x" });
    expect(s.inputs).toBeUndefined();
    expect(s.lora?.[0]?.model).toBe("civitai:720776@805962");
  });
  it("estimates from the highest charge the probe measured", () => {
    const t = buildImageTask({ ...request, width: 1024, height: 1024, reference: "x" });
    expect(estimateCost(t)).toBeCloseTo(0.003, 6);
    expect(estimateCost(buildImageTask({ ...request, model: "kontext" }))).toBeCloseTo(0.1, 6);
  });
});

describe("the Runware client", () => {
  it("posts one task with a bearer key and logs one ledger line per image", async () => {
    const ledger = join(tmp, "a.jsonl");
    const { f, calls } = stub({
      body: {
        data: [
          { taskUUID: "t", imageUUID: "i1", imageBase64Data: PNG, seed: 11, cost: 0.0019 },
          { taskUUID: "t", imageUUID: "i2", imageBase64Data: PNG, seed: 12, cost: 0.0019 },
        ],
      },
    });
    const out = await client(ledger, f).run(buildImageTask(request, "t"), {
      target: "enemy:interns",
      part: "head",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.runware.ai/v1");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key",
    );
    const sent = JSON.parse(calls[0]!.init.body as string) as ImageTask[];
    expect(sent).toHaveLength(1);
    expect(sent[0]!.includeCost).toBe(true);
    expect(out.map((r) => r.seed)).toEqual([11, 12]);
    const lines = readLedger(ledger);
    expect(lines).toEqual([
      {
        time: "2026-10-17T12:00:00.000Z",
        phase: "2",
        target: "enemy:interns",
        part: "head",
        model: "runware:400@4",
        size: "512x704",
        taskUUID: "t",
        imageUUID: "i1",
        cost: 0.0019,
        kept: false,
      },
      expect.objectContaining({ imageUUID: "i2", kept: false }),
    ]);
    expect(readFileSync(ledger, "utf8")).not.toContain("test-key");
    expect(markKept(ledger, "i2")).toBe(true);
    expect(readLedger(ledger).map((e) => e.kept)).toEqual([false, true]);
  });

  it("refuses a prompt with a forbidden term before any request", async () => {
    const { f, calls } = stub({ body: {} });
    const task = buildImageTask({ ...request, prompt: "a street in Zorbleton" });
    await expect(
      client(join(tmp, "b.jsonl"), f).run(task, { target: "x", part: "y" }),
    ).rejects.toThrow(/forbidden term "zorbleton"/);
    expect(calls).toHaveLength(0);
  });

  it("refuses a request that would pass the cap", async () => {
    const ledger = join(tmp, "c.jsonl");
    writeFileSync(
      ledger,
      JSON.stringify({ phase: "2", cost: 4.999, imageUUID: "old", kept: true }) + "\n",
    );
    const { f, calls } = stub({ body: {} });
    const err = await client(ledger, f)
      .run(buildImageTask(request), { target: "x", part: "y" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArtError);
    expect((err as ArtError).lines).toEqual(["art: budget cap reached ($5.00 of $5.00)"]);
    expect(calls).toHaveLength(0);
  });

  it("enforces the phase cap too", async () => {
    const ledger = join(tmp, "d.jsonl");
    writeFileSync(
      ledger,
      JSON.stringify({ phase: "2", cost: 1.5, imageUUID: "old", kept: true }) + "\n",
    );
    const { f } = stub({ body: {} });
    await expect(
      client(ledger, f).run(buildImageTask(request), { target: "x", part: "y" }),
    ).rejects.toThrow("art: phase 2 cap reached ($1.50 of $1.50)");
  });

  it("retries a 5xx twice, then reports an errors array", async () => {
    const ledger = join(tmp, "e.jsonl");
    const { f, calls } = stub(
      { status: 502, body: {} },
      { status: 503, body: {} },
      {
        status: 400,
        body: { errors: [{ code: "invalidDimensions", message: "bad size", parameter: "width" }] },
      },
    );
    const err = (await client(ledger, f)
      .run(buildImageTask(request), { target: "x", part: "y" })
      .catch((e: unknown) => e)) as ArtError;
    expect(calls).toHaveLength(3);
    expect(err.lines).toEqual(["art: runware error invalidDimensions: bad size (parameter width)"]);
    expect(readLedger(ledger)).toEqual([]);
  });
});

describe("credentials", () => {
  it("reads the key from the environment first, then from .env", () => {
    expect(readApiKey(tmp, { RUNWARE_API_KEY: "env-key" })).toBe("env-key");
    expect(readApiKey(tmp, {})).toBeUndefined();
    writeFileSync(join(tmp, ".env"), 'OTHER=1\nRUNWARE_API_KEY="file-key"\n');
    expect(readApiKey(tmp, {})).toBe("file-key");
  });
});

describe("pnpm tools art", () => {
  it("prints a dry run with no network call and no key", async () => {
    const saved = process.env.RUNWARE_API_KEY;
    delete process.env.RUNWARE_API_KEY;
    const { f, calls } = stub({ body: {} });
    const logs: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => logs.push(a.join(" "));
    try {
      expect(await artCommand(["gen", "enemy:interns", "--part", "head", "--dry-run"], f)).toBe(0);
    } finally {
      console.log = log;
      if (saved !== undefined) process.env.RUNWARE_API_KEY = saved;
    }
    expect(calls).toHaveLength(0);
    const out = logs.join("\n");
    expect(out).toContain('"includeCost": true');
    expect(out).toContain('"outputFormat": "PNG"');
    expect(out).toMatch(/estimate \$0\.\d{4}/);
  });

  // Skipped where a real key exists in .env, so the test can never reach the network.
  it.skipIf(!!readApiKey(ROOT, {}))("exits 1 without a key", async () => {
    const saved = process.env.RUNWARE_API_KEY;
    delete process.env.RUNWARE_API_KEY;
    const { f, calls } = stub({ body: {} });
    const errs: string[] = [];
    const error = console.error;
    console.error = (...a: unknown[]) => errs.push(a.join(" "));
    try {
      expect(await artCommand(["gen", "enemy:interns"], f)).toBe(1);
    } finally {
      console.error = error;
      if (saved !== undefined) process.env.RUNWARE_API_KEY = saved;
    }
    expect(errs).toEqual(["art: RUNWARE_API_KEY is not set"]);
    expect(calls).toHaveLength(0);
  });
});
