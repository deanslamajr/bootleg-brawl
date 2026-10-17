// tools record-golden [--character id | --stage id | --all]: (re)records golden replays.
// A hash change in CI means behavior changed; re-record only with a justification in the PR.

import { goldenSpecs, record, saveGolden, verify, loadGoldens } from "../lib/golden";

export function recordGoldenCommand(args: string[]): number {
  const want = (k: string) =>
    args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ??
    (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : undefined);
  const character = want("character");
  const stage = want("stage");
  const specs = goldenSpecs().filter((s) => {
    if (args.includes("--all")) return true;
    if (character) return s.name === `character-${character}`;
    if (stage) return s.name === `stage-${stage}`;
    return true;
  });
  for (const s of specs) {
    const t0 = Date.now();
    const g = record(s);
    saveGolden(g);
    console.log(`recorded ${g.name}: ${g.ticks} ticks, final ${g.final} (${Date.now() - t0} ms)`);
  }
  return 0;
}

export function verifyGoldenCommand(): number {
  let bad = 0;
  for (const g of loadGoldens()) {
    const r = verify(g);
    console.log(r.message);
    if (!r.ok) bad++;
  }
  return bad ? 1 : 0;
}
