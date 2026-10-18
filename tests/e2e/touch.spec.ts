// The touch pad in the Pixel 7 landscape profile: it shows at boot, drives the menus and a stage
// from CDP touch points, PAUSE pauses, every control stays off the canvas at each viewport in the
// plan, and portrait shows the rotate message and pauses play. This file sets its own device
// profile, so it runs inside the chromium project with no project of its own.

import { devices, expect, test, type CDPSession, type Page } from "@playwright/test";
import { DEFAULT_SETTINGS } from "../../apps/game/src/settings";
import {
  intersects,
  boot,
  status,
  waitForMode,
  waitForScene,
  type Hook,
  type Rect,
  type TouchStatus,
} from "./helpers";

test.use({ ...devices["Pixel 7 landscape"] });

interface Point {
  x: number;
  y: number;
  id: number;
}

async function touchStatus(page: Page): Promise<TouchStatus> {
  return page.evaluate(() => (window as unknown as { __bootleg: Hook }).__bootleg.touch());
}

function center(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Raw touch points through CDP. Playwright's touchscreen cannot hold one point while another taps. */
class Fingers {
  constructor(
    private readonly cdp: CDPSession,
    private readonly page: Page,
  ) {}

  private send(type: "touchStart" | "touchMove" | "touchEnd", touchPoints: Point[]) {
    return this.cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  }

  start(points: Point[]) {
    return this.send("touchStart", points);
  }

  move(points: Point[]) {
    return this.send("touchMove", points);
  }

  /** Lifts the listed points. With no list, lifts every point. */
  end(lifted: Point[] = []) {
    return this.send("touchEnd", lifted);
  }

  async control(name: string): Promise<Rect> {
    const t = await touchStatus(this.page);
    const r = t.controls[name];
    expect(r, `control ${name}`).toBeTruthy();
    return r!;
  }

  /** One clean tap on a control's center, held for a few frames like the press helper. */
  async tap(name: string): Promise<void> {
    const c = center(await this.control(name));
    await this.start([{ ...c, id: 1 }]);
    await this.page.waitForTimeout(120);
    await this.end();
    await this.page.waitForTimeout(120);
  }
}

/** The canvas width GameApp.fit gives a viewport when the pad shows (plan section 4.5). */
function expectedWidth(w: number, h: number, inset: number): number {
  const avail = w - 2 * inset;
  const scaleH = h / 270;
  const leftover = (avail - 480 * scaleH) / 2;
  const gutter = Math.max(100, leftover);
  return 480 * Math.min(scaleH, (avail - 2 * gutter) / 480);
}

/** The plan's layout table: viewport, inset per side, and the canvas width it promises. */
const TABLE: [number, number, number, number][] = [
  [863, 360, 0, 640],
  [915, 412, 0, 715],
  [844, 390, 47, 550],
  [780, 360, 0, 580],
  [1024, 768, 0, 824],
];

async function resize(page: Page, w: number, h: number, inset: number): Promise<void> {
  await page.evaluate((inset) => {
    const st = document.documentElement.style;
    if (inset) st.setProperty("--inset-test", `${inset}px`);
    else st.removeProperty("--inset-test");
  }, inset);
  await page.setViewportSize({ width: w, height: h });
  await page.waitForFunction(
    ([w, h]) => window.innerWidth === w && window.innerHeight === h,
    [w, h],
    { timeout: 10_000 },
  );
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
}

test("the pad plays a stage, pauses, fits every viewport and handles portrait", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await boot(page);
  const cdp = await page.context().newCDPSession(page);
  const f = new Fingers(cdp, page);

  // 1. A coarse primary pointer shows the pad at boot.
  const at = await touchStatus(page);
  expect(at.shown).toBe(true);
  expect(at.rotate).toBe(false);
  expect(Object.keys(at.controls).sort()).toEqual(
    ["attack", "jump", "pause", "special", "start", "stick", "taunt"].sort(),
  );

  // 2. START twice: the title menu, then NEW GAME.
  await f.tap("start");
  await f.tap("start");
  expect(await waitForScene(page, ["select"])).toBe("select");

  // 3. Join, ready, skip the title card.
  await f.tap("start");
  await f.tap("attack");
  expect(await waitForScene(page, ["stage"])).toBe("stage");
  await waitForMode(page, "card");
  await page.waitForTimeout(1000);
  await f.tap("attack");
  await waitForMode(page, "play");

  await page.screenshot({ path: "test-results/layout/touch.png" });

  // 4. One thumb holds the stick right at 60 percent while another taps ATK in the same event.
  const stick = center(await f.control("stick"));
  const radius = (await f.control("stick")).w / 2;
  const atk = center(await f.control("attack"));
  const before = await status(page);
  await f.start([
    { ...stick, id: 1 },
    { ...atk, id: 2 },
  ]);
  await f.move([
    { x: stick.x + radius * 0.6, y: stick.y, id: 1 },
    { ...atk, id: 2 },
  ]);
  await page.waitForTimeout(100);
  const held = await touchStatus(page);
  expect(held.bits & 8, "RIGHT while the stick is held").toBe(8);
  expect(held.bits & 16, "ATTACK while ATK is held").toBe(16);
  await f.end([{ ...atk, id: 2 }]);
  // The camera follows once the player passes 55 percent of the view, a few seconds of walking.
  await page.waitForFunction(
    (cam) => {
      const s = (window as unknown as { __bootleg: Hook }).__bootleg.status();
      return Number(s.cam) > cam;
    },
    Number(before.cam),
    { timeout: 30_000, polling: 100 },
  );
  const after = await status(page);
  expect(Number(after.tick)).toBeGreaterThan(Number(before.tick));
  expect(Number(after.cam)).toBeGreaterThan(Number(before.cam));
  await f.end();
  await page.waitForTimeout(100);
  expect((await touchStatus(page)).bits).toBe(0);

  // 5. PAUSE pauses. START picks RESUME.
  await f.tap("pause");
  await waitForMode(page, "paused", 5_000);
  await f.tap("start");
  await waitForMode(page, "play", 5_000);

  // 6. Every viewport in the plan, with and without a 47 px notch inset.
  for (const [w, h, inset, width] of TABLE) {
    for (const ins of [0, 47]) {
      await resize(page, w, h, ins);
      const t = await touchStatus(page);
      const label = `${w}x${h} inset ${ins}`;
      expect(t.shown, label).toBe(true);
      for (const [name, r] of Object.entries(t.controls))
        expect(intersects(r, t.canvas), `${name} over the canvas at ${label}`).toBe(false);
      for (const name of ["attack", "jump", "special", "taunt"]) {
        expect(t.controls[name]!.w, `${name} width at ${label}`).toBeGreaterThanOrEqual(48);
        expect(t.controls[name]!.h, `${name} height at ${label}`).toBeGreaterThanOrEqual(48);
      }
      expect(Math.abs(t.canvas.w - expectedWidth(w, h, ins)), `width at ${label}`).toBeLessThan(1);
      if (ins === inset) expect(Math.abs(t.canvas.w - width), `table at ${label}`).toBeLessThan(1);
      expect(t.canvas.x, `left inset at ${label}`).toBeGreaterThanOrEqual(ins + 100 - 1);
      expect(w - t.canvas.x - t.canvas.w, `right inset at ${label}`).toBeGreaterThanOrEqual(
        ins + 100 - 1,
      );
    }
  }

  // 7. Portrait shows the rotate message and pauses. Landscape clears it and stays paused.
  await resize(page, 360, 863, 0);
  expect((await touchStatus(page)).rotate).toBe(true);
  await waitForMode(page, "paused", 5_000);
  await resize(page, 863, 360, 0);
  expect((await touchStatus(page)).rotate).toBe(false);
  await page.waitForTimeout(300);
  expect((await status(page)).mode).toBe("paused");
  await f.tap("start");
  await waitForMode(page, "play", 5_000);

  // 8. Nothing threw along the way.
  expect(errors).toEqual([]);
});

test("OFF waits for a keyboard or a gamepad", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    (settings) => {
      localStorage.setItem("bootleg-brawl.settings.v1", JSON.stringify(settings));
    },
    { ...DEFAULT_SETTINGS, touchControls: "off" },
  );
  await boot(page);

  // A coarse pointer and no physical device yet: OFF defers to the auto rule.
  expect((await touchStatus(page)).shown).toBe(true);

  // The first trusted key press lets OFF take effect.
  await page.keyboard.press("KeyJ");
  await page.waitForFunction(
    () => !(window as unknown as { __bootleg: Hook }).__bootleg.touch().shown,
    null,
    { timeout: 5_000, polling: 50 },
  );
  const saved = await page.evaluate(() => localStorage.getItem("bootleg-brawl.settings.v1"));
  expect(saved).toContain('"touchControls":"off"');
  expect(errors).toEqual([]);
});
