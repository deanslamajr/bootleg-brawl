## What changed

<!-- One or two sentences. -->

## Checks

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass
- [ ] `pnpm content` passes (validate, forbidden-terms scan, bundle budgets)
- [ ] Golden replays still match, or the PR says why they were re-recorded
- [ ] Milestone gate: the manual playtest checklist (private, in the owner's docs repository) completed and attached

## New or changed character or stage (human checklist)

- [ ] It is funny
- [ ] It is legally distinct: no franchise names, likenesses, catchphrases, places or story beats. `pnpm tools validate` passed the deny-list scan (D82)
- [ ] It plays like its archetype (`pnpm tools balance` is within band)
- [ ] The continue line reads well
- [ ] Two bootleg tells are listed in `parodyMeta.tells`
- [ ] Stages: `pnpm tools metrics <stage> --players=1,2,4 --strict` meets the pacing targets
- [ ] No file under `packages/engine` changed, or the PR says why (plan P2 proof)
