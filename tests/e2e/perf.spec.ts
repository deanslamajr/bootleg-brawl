// Nightly: main-thread frame work and sim tick time with four bots in Game 0 on a throttled CPU
// (Chromium only). The rAF interval is logged for information only, because vsync holds it near
// 16.7 ms whether a frame takes 2 ms or 15 ms. PERF_THROTTLE sets the CPU slowdown (default 4).

import { expect, test } from "@playwright/test";
import { IN, boot, press, waitForScene, type Hook } from "./helpers";

const THROTTLE = Number(process.env.PERF_THROTTLE ?? 4);

function p95(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.95)] ?? 0;
}

test("p95 frame work stays under 12 ms with four players", async ({ page }) => {
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
  console.log(`throttle ${THROTTLE}x, ${perf.frame.length} frames, ${perf.tick.length} ticks`);
  console.log(`p95 frame interval ${interval.toFixed(2)} ms (information only)`);
  console.log(`p95 frame work ${frame.toFixed(2)} ms`);
  console.log(`p95 tick ${tick.toFixed(2)} ms`);
  expect(perf.frame.length).toBeGreaterThan(300);
  expect(frame).toBeLessThan(12);
  expect(tick).toBeLessThan(4);
});
