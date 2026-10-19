// Nightly: main-thread frame work and sim tick time with four bots in Game 0 on a throttled CPU
// (Chromium only). The rAF interval is logged for information only, because vsync holds it near
// 16.7 ms whether a frame takes 2 ms or 15 ms. PERF_THROTTLE sets the CPU slowdown (default 4).
// The second test repeats the run in the Pixel 7 landscape profile with the touch pad shown. It
// is the proxy for the phone target: it measures main-thread work on a desktop GPU, so a real
// phone run stays in the playtest checklist.

import { devices, expect, test, type Page } from "@playwright/test";
import { IN, boot, press, waitForScene, type Hook } from "./helpers";

const THROTTLE = Number(process.env.PERF_THROTTLE ?? 4);

function p95(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.95)] ?? 0;
}

async function measure(page: Page, label: string): Promise<void> {
  await boot(page);
  await press(page, [0], IN.START);
  await press(page, [0], IN.START);
  await waitForScene(page, ["select"]);
  await press(page, [0, 1, 2, 3], IN.START);
  await press(page, [0, 1, 2, 3], IN.ATTACK);
  await waitForScene(page, ["stage"]);
  await page.waitForTimeout(1500);
  await press(page, [0], IN.ATTACK);
  await page.evaluate(() => (window as unknown as { __bootleg: Hook }).__bootleg.useBots(true));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });

  await page.evaluate(() => (window as unknown as { __bootleg: Hook }).__bootleg.samplePerf(true));
  const interval = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const deltas: number[] = [];
        let last = performance.now();
        const loop = (t: number) => {
          deltas.push(t - last);
          last = t;
          if (deltas.length < 600) requestAnimationFrame(loop);
          else {
            deltas.sort((a, b) => a - b);
            resolve(deltas[Math.floor(deltas.length * 0.95)]!);
          }
        };
        requestAnimationFrame(loop);
      }),
  );
  await page.waitForTimeout(10_000);
  const perf = await page.evaluate(() => {
    const h = (window as unknown as { __bootleg: Hook }).__bootleg;
    h.samplePerf(false);
    return h.perf();
  });
  const frame = p95(perf.frame);
  const tick = p95(perf.tick);
  console.log(
    `${label}: throttle ${THROTTLE}x, ${perf.frame.length} frames, ${perf.tick.length} ticks`,
  );
  console.log(`${label}: p95 frame interval ${interval.toFixed(2)} ms (information only)`);
  console.log(`${label}: p95 frame work ${frame.toFixed(2)} ms`);
  console.log(`${label}: p95 tick ${tick.toFixed(2)} ms`);
  expect(perf.frame.length).toBeGreaterThan(300);
  expect(frame).toBeLessThan(12);
  expect(tick).toBeLessThan(4);
}

test("p95 frame work stays under 12 ms with four players", async ({ page }) => {
  await measure(page, "desktop");
});

test.describe("phone profile", () => {
  // A describe block may not set defaultBrowserType. The perf project is Chromium already.
  const { defaultBrowserType: _browser, ...phone } = devices["Pixel 7 landscape"]!;
  test.use(phone);

  test("p95 frame work stays under 12 ms with the touch pad shown", async ({ page }) => {
    await measure(page, "phone");
    const shown = await page.evaluate(
      () => (window as unknown as { __bootleg: Hook }).__bootleg.touch().shown,
    );
    expect(shown).toBe(true);
  });
});
