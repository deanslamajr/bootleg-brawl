// Nightly load and memory budgets (Chromium only). First playable: the title is ready within 5 s
// on a 20 Mbps link with 40 ms latency and a cold cache. Memory: the JS heap stays under 300 MB
// at the Game 0 boss, when Game 1 is prefetched, so two stages are resident.

import { expect, test } from "@playwright/test";
import { IN, press, waitForScene, type Hook } from "./helpers";

const MBPS = 20;

test("first playable under 5 s and heap under 300 MB with two stages", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 40,
    downloadThroughput: (MBPS * 1_000_000) / 8,
    uploadThroughput: (MBPS * 1_000_000) / 8,
  });
  await page.goto("/");
  const handle = await page.waitForFunction(
    () =>
      (window as unknown as { __bootleg?: { ready: boolean } }).__bootleg?.ready === true &&
      performance.now(),
    null,
    { timeout: 60_000, polling: 20 },
  );
  const firstPlayable = (await handle.jsonValue()) as number;
  console.log(`first playable ${Math.round(firstPlayable)} ms`);
  expect(firstPlayable).toBeLessThan(5000);

  // Lift the network limit for the playthrough: it measures memory, not load time.
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await waitForScene(page, ["title"]);
  await press(page, [0], IN.START);
  await press(page, [0], IN.START);
  await waitForScene(page, ["select"]);
  await press(page, [0, 1, 2, 3], IN.START);
  await press(page, [0, 1, 2, 3], IN.ATTACK);
  await waitForScene(page, ["stage"]);
  await page.waitForTimeout(1500);
  await press(page, [0], IN.ATTACK);
  await page.evaluate(() => {
    const h = (window as unknown as { __bootleg: Hook }).__bootleg;
    h.useBots(true);
    h.setSpeed(16);
  });
  // Segment 3, phase 3 is the Game 0 boss fight. The boss card started the Game 1 prefetch.
  await page.waitForFunction(
    () => {
      const s = (window as unknown as { __bootleg: Hook }).__bootleg.status();
      return s.scene === "stage" && Number(s.seg) === 3 && Number(s.phase) === 3;
    },
    null,
    { timeout: 180_000, polling: 250 },
  );
  await page.evaluate(() => (window as unknown as { __bootleg: Hook }).__bootleg.setSpeed(1));
  await page.waitForTimeout(3000);
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("Performance.enable");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const metric = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
  const used = metric("JSHeapUsedSize") / (1024 * 1024);
  const total = metric("JSHeapTotalSize") / (1024 * 1024);
  console.log(`heap used ${used.toFixed(1)} MB (total ${total.toFixed(1)} MB)`);
  expect(used).toBeLessThan(300);
});
