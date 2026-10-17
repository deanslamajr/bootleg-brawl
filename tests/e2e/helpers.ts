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
  ready: boolean;
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
