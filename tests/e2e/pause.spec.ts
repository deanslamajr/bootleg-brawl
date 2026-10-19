// Losing window focus pauses a stage, and the pause menu resumes it. The music pauses with it.
// The escape hook, which the touch PAUSE button calls, toggles the pause like the Escape key.

import { expect, test } from "@playwright/test";
import {
  IN,
  audio,
  boot,
  press,
  startSoloStage,
  status,
  waitForAudio,
  waitForMode,
  type Hook,
} from "./helpers";

test("a blur pauses play and the music, and RESUME continues both", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  await startSoloStage(page);

  // Injected inputs never fire keydown, so no audio context exists yet. A real click is a user
  // gesture, and it creates and starts the context.
  await page.mouse.click(480, 270);
  await waitForAudio(page, "running");

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await waitForMode(page, "paused", 5_000);
  const before = Number((await status(page)).tick);
  await waitForAudio(page, "suspended");
  expect((await audio(page)).paused).toBe(true);
  await page.waitForTimeout(500);
  const after = await status(page);
  expect(after.mode).toBe("paused");
  expect(Number(after.tick)).toBe(before);

  // Keys in the pause menu must not wake the context. The arrows are Player 2's keys, and the
  // menu reads every slot, so Down then Up leaves the cursor on RESUME.
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(300);
  expect((await audio(page)).context).toBe("suspended");

  // RESUME is the first row of the pause menu.
  await press(page, [0], IN.START);
  await waitForMode(page, "play", 5_000);
  await waitForAudio(page, "running");
  await page.waitForTimeout(300);
  expect(Number((await status(page)).tick)).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

test("the escape hook pauses play and a second call resumes it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  await startSoloStage(page);

  const escape = () =>
    page.evaluate(() => (window as unknown as { __bootleg: Hook }).__bootleg.escape());
  await escape();
  await waitForMode(page, "paused", 5_000);
  const before = Number((await status(page)).tick);
  await page.waitForTimeout(300);
  expect(Number((await status(page)).tick)).toBe(before);

  await escape();
  await waitForMode(page, "play", 5_000);
  await page.waitForTimeout(300);
  expect(Number((await status(page)).tick)).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});
