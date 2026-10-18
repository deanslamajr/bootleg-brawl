import type { Page } from "@playwright/test";

export const IN = {
  UP: 1,
  DOWN: 2,
  LEFT: 4,
  RIGHT: 8,
  ATTACK: 16,
  JUMP: 32,
  SPECIAL: 64,
  TAUNT: 128,
  START: 256,
} as const;

export interface Hook {
  status(): Record<string, unknown>;
  inject(slot: number, bits: number | null): void;
  useBots(on: boolean): void;
  setSpeed(n: number): void;
  bounds(label: string): Rect | null;
  samplePerf(on: boolean): void;
  perf(): { frame: number[]; tick: number[] };
  /** What the Escape key does on the current scene. */
  escape(): void;
  /** The touch pad: whether it shows, its last mask, and the screen rectangles in CSS px. */
  touch(): TouchStatus;
  ready: boolean;
}

export interface TouchStatus {
  shown: boolean;
  rotate: boolean;
  bits: number;
  canvas: Rect;
  controls: Record<string, Rect>;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function intersects(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return false;
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export async function bounds(page: Page, label: string): Promise<Rect | null> {
  return page.evaluate(
    (label) => (window as unknown as { __bootleg: Hook }).__bootleg.bounds(label),
    label,
  );
}

/** Opens the game and waits for the boot scene to hand over to the title. */
export async function boot(page: Page, url = "/"): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(
    () => (window as unknown as { __bootleg?: { ready: boolean } }).__bootleg?.ready === true,
    null,
    { timeout: 60_000 },
  );
  await waitForScene(page, ["title"]);
}

/** Waits until the stage scene is in the given mode. */
export async function waitForMode(page: Page, mode: string, timeout = 60_000): Promise<void> {
  await page.waitForFunction(
    (mode) => {
      const s = (window as unknown as { __bootleg: Hook }).__bootleg.status();
      return s.scene === "stage" && s.mode === mode;
    },
    mode,
    { timeout, polling: 50 },
  );
}

/** From the title: one player picks the first character and skips the title card. */
export async function startSoloStage(page: Page): Promise<void> {
  await press(page, [0], IN.START);
  await press(page, [0], IN.START);
  await waitForScene(page, ["select"]);
  await press(page, [0], IN.START);
  await press(page, [0], IN.ATTACK);
  await waitForScene(page, ["stage"]);
  await waitForMode(page, "card");
  await page.waitForTimeout(1000);
  await press(page, [0], IN.ATTACK);
  await waitForMode(page, "play");
}

export async function status(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => (window as unknown as { __bootleg: Hook }).__bootleg.status());
}

/** Holds bits on the given slots for a few frames, then releases them (one clean press). */
export async function press(page: Page, slots: number[], bits: number): Promise<void> {
  await page.evaluate(
    ({ slots, bits }) => {
      const h = (window as unknown as { __bootleg: Hook }).__bootleg;
      for (const s of slots) h.inject(s, bits);
    },
    { slots, bits },
  );
  await page.waitForTimeout(120);
  await page.evaluate(
    ({ slots }) => {
      const h = (window as unknown as { __bootleg: Hook }).__bootleg;
      for (const s of slots) h.inject(s, 0);
    },
    { slots },
  );
  await page.waitForTimeout(120);
}

export async function waitForScene(
  page: Page,
  names: string[],
  timeout = 180_000,
): Promise<string> {
  const handle = await page.waitForFunction(
    (names) => {
      const s = (window as unknown as { __bootleg?: Hook }).__bootleg?.status();
      return s && names.includes(String(s.scene)) ? String(s.scene) : false;
    },
    names,
    { timeout, polling: 250 },
  );
  return (await handle.jsonValue()) as string;
}
