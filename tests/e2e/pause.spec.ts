// Losing window focus pauses a stage, and the pause menu resumes it.

import { expect, test } from "@playwright/test";
import { IN, boot, press, startSoloStage, status, waitForMode } from "./helpers";

test("a blur pauses play and RESUME continues it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  await startSoloStage(page);

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await waitForMode(page, "paused", 5_000);
  const before = Number((await status(page)).tick);
  await page.waitForTimeout(500);
  const after = await status(page);
  expect(after.mode).toBe("paused");
  expect(Number(after.tick)).toBe(before);

  // RESUME is the first row of the pause menu.
  await press(page, [0], IN.START);
  await waitForMode(page, "play", 5_000);
  await page.waitForTimeout(300);
  expect(Number((await status(page)).tick)).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});
