// Text layout at the native 480x270: measured rectangles of labels that used to overlap must not
// intersect. Screenshots go to test-results/layout/ for the playtest checklist.

import { expect, test, type Page } from "@playwright/test";
import {
  IN,
  boot,
  bounds,
  intersects,
  press,
  startSoloStage,
  status,
  waitForScene,
  type Hook,
  type Rect,
} from "./helpers";

const SHOTS = "test-results/layout";

async function must(page: Page, label: string): Promise<Rect> {
  const handle = await page.waitForFunction(
    (label) => (window as unknown as { __bootleg: Hook }).__bootleg.bounds(label),
    label,
    { timeout: 30_000, polling: 100 },
  );
  return (await handle.jsonValue()) as Rect;
}

async function down(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await press(page, [0], IN.DOWN);
}

test.use({ viewport: { width: 480, height: 270 } });

test("title, options and controls text do not overlap", async ({ page }) => {
  await boot(page, "/?debug");
  await press(page, [0], IN.START);
  const menu = await must(page, "title-menu");
  for (let i = 0; i < 4; i++)
    expect(intersects(menu, await must(page, `title-portrait-${i}`)), `portrait ${i}`).toBe(false);
  await page.screenshot({ path: `${SHOTS}/title.png` });

  // NEW GAME, CONTINUE RUN, OPTIONS.
  await down(page, 2);
  await press(page, [0], IN.ATTACK);
  expect(await waitForScene(page, ["options"])).toBe("options");
  const opts = await must(page, "options-menu");
  const hints = [];
  for (let i = 0; i < 3; i++) hints.push(await must(page, `options-hint-${i}`));
  for (let i = 0; i < 3; i++) {
    expect(intersects(hints[i]!, opts), `hint ${i} and menu`).toBe(false);
    for (let j = i + 1; j < 3; j++)
      expect(intersects(hints[i]!, hints[j]!), `hint ${i} and ${j}`).toBe(false);
  }
  await page.screenshot({ path: `${SHOTS}/options.png` });

  // CONTROLS P1 follows DIFFICULTY, FRIENDLY FIRE, CABINET MODE, MUSIC and SOUND.
  await down(page, 5);
  await press(page, [0], IN.ATTACK);
  expect(await waitForScene(page, ["controls"])).toBe("controls");
  expect((await status(page)).target).toBe("p1");

  // ATTACK is the fifth action. Select it and press H.
  await down(page, 4);
  await press(page, [0], IN.ATTACK);
  expect((await status(page)).capturing).toBe("attack");
  await page.keyboard.press("KeyH");
  await page.waitForFunction(
    () => (window as unknown as { __bootleg: Hook }).__bootleg.status().capturing === "",
    null,
    { timeout: 5_000 },
  );
  const saved = await page.evaluate(() => localStorage.getItem("bootleg-brawl.keys.v1"));
  expect(saved).toContain('"KeyH"');
  expect(JSON.parse(saved!)[0].attack).toEqual(["KeyH"]);
});

test("select and stage text do not overlap", async ({ page }) => {
  await boot(page);
  await press(page, [0], IN.START);
  await press(page, [0], IN.START);
  expect(await waitForScene(page, ["select"])).toBe("select");
  expect(intersects(await must(page, "select-stat-0"), await must(page, "select-card-1"))).toBe(
    false,
  );
  await page.screenshot({ path: `${SHOTS}/select.png` });
  await press(page, [0], IN.TAUNT);
  await waitForScene(page, ["title"]);

  await startSoloStage(page);
  // The first segment's intro banner shows once the title card ends.
  const playTick = Number((await status(page)).tick);
  const banner = await must(page, "hud-banner");
  expect(Number((await status(page)).tick) - playTick).toBeLessThanOrEqual(20);
  expect(intersects(banner, await must(page, "hud-panel-0"))).toBe(false);
  expect(intersects(banner, await must(page, "hud-go"))).toBe(false);
  await page.screenshot({ path: `${SHOTS}/stage.png` });

  // Let a bot fight until P1 strings a combo, then measure the counter against the panel.
  await page.evaluate(() => {
    const h = (window as unknown as { __bootleg: Hook }).__bootleg;
    h.useBots(true);
    h.setSpeed(4);
  });
  const combo = await must(page, "hud-combo-0");
  expect(intersects(combo, await bounds(page, "hud-lives-0"))).toBe(false);
  expect(intersects(combo, await bounds(page, "hud-info-0"))).toBe(false);
});
