// After a deploy: the live URL serves the game, the manifest and a bundle.

import { expect, test } from "@playwright/test";

test("live URL boots to the title", async ({ page, request }) => {
  const health = await request.get("healthz");
  expect(health.ok()).toBe(true);
  const manifest = await request.get("manifest.json");
  expect(manifest.ok()).toBe(true);
  await page.goto("/");
  await page.waitForFunction(
    () => (window as unknown as { __bootleg?: { ready: boolean } }).__bootleg?.ready === true,
    null,
    { timeout: 60_000 },
  );
  const scene = await page.evaluate(
    () =>
      (window as unknown as { __bootleg: { status(): { scene: string } } }).__bootleg.status()
        .scene,
  );
  expect(scene).toBe("title");
});
