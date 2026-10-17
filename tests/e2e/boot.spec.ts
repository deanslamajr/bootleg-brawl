// Boot, title, select four characters, play Game 0 to the boss with deterministic bot input,
// and reach the interlude. Runs against the built dist/ in Chromium and WebKit.

import { expect, test } from "@playwright/test";
import { IN, press, status, waitForScene } from "./helpers";

test("boot to the first interlude with four players", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/?debug");
  await page.waitForFunction(
    () => (window as unknown as { __bootleg?: { ready: boolean } }).__bootleg?.ready === true,
    null,
    { timeout: 60_000 },
  );
  expect(await waitForScene(page, ["title"])).toBe("title");

  await press(page, [0], IN.START);
  await press(page, [0], IN.START);
  expect(await waitForScene(page, ["select"])).toBe("select");

  // Four players join and pick distinct characters.
  await press(page, [0, 1, 2, 3], IN.START);
  await press(page, [0, 1, 2, 3], IN.ATTACK);
  expect(await waitForScene(page, ["stage"])).toBe("stage");
  await page.waitForFunction(() => {
    const s = (
      window as unknown as { __bootleg: { status(): Record<string, unknown> } }
    ).__bootleg.status();
    return s.mode === "card" || s.mode === "play";
  });

  // Skip the title card, then let the bots play Game 0 at high speed.
  await page.waitForTimeout(1500);
  await press(page, [0], IN.ATTACK);
  await page.evaluate(() => {
    const h = (
      window as unknown as { __bootleg: { useBots(on: boolean): void; setSpeed(n: number): void } }
    ).__bootleg;
    h.useBots(true);
    h.setSpeed(16);
  });
  await page.waitForFunction(
    () => {
      const s = (
        window as unknown as { __bootleg: { status(): Record<string, unknown> } }
      ).__bootleg.status();
      return s.scene === "stage" && Number(s.seg) === 3 && Number(s.phase) === 3;
    },
    null,
    { timeout: 180_000, polling: 250 },
  );
  const boss = await status(page);
  expect(boss.stage).toBe("game-0");

  const scene = await waitForScene(page, ["cutscene", "minigame"]);
  expect(["cutscene", "minigame"]).toContain(scene);
  expect(errors).toEqual([]);
});
