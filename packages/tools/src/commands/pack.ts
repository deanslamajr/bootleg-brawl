import { createRegistry } from "@bb/mechanics";
import { loadContent } from "../lib/content-fs";
import { pack } from "../lib/pack";

export function packCommand(): number {
  const t0 = Date.now();
  const { raw, errors } = loadContent(createRegistry());
  if (errors.length) {
    for (const e of errors) console.error(e);
    console.error(`pack: ${errors.length} content error(s); run pnpm tools validate`);
    return 1;
  }
  const r = pack(raw);
  for (const w of r.warnings) console.warn(`warning: ${w}`);
  for (const e of r.errors) console.error(e);
  const total = Object.values(r.bytes).reduce((a, b) => a + b, 0);
  console.log(
    `pack: ${r.manifest.entries.length} bundles, ${(total / 1024).toFixed(0)} KB, ${Date.now() - t0} ms, content ${r.manifest.contentHash}`,
  );
  return r.errors.length ? 1 : 0;
}
