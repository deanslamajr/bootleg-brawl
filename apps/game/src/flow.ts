// Run progression: stage -> its "after" interludes -> the next campaign node (or the map vote)
// -> that stage's "before" interludes -> the stage. Progress is saved locally after every step.

import type { GameApp } from "./app";
import { saveRun, type RunState } from "./settings";

export function newRun(app: GameApp, party: string[]): RunState {
  const s = app.settings;
  const start = app.pendingStage ?? app.content.raw.campaign.start;
  app.pendingStage = null;
  const run: RunState = {
    version: 1,
    seed: (Math.random() * 0x7fffffff) | 0,
    party,
    scores: [0, 0, 0, 0],
    lives: [-1, -1, -1, -1],
    credits: -999,
    difficulty: s.difficulty,
    friendlyFire: s.friendlyFire,
    cabinetMode: s.cabinetMode,
    stageId: start,
    queue: [...(app.content.raw.stages[start]?.file.interludes.before ?? [])],
    cleared: [],
  };
  app.run = run;
  saveRun(run);
  return run;
}

export async function goNext(app: GameApp): Promise<void> {
  const run = app.run;
  const { TitleScene } = await import("./scenes/title");
  if (!run) return app.setScene(new TitleScene(app));
  saveRun(run);
  const next = run.queue.shift();
  if (next) {
    saveRun(run);
    return openInterlude(app, next);
  }
  if (run.stageId) {
    const { StageScene } = await import("./scenes/stage");
    return app.setScene(new StageScene(app, run.stageId));
  }
  const { CreditsScene } = await import("./scenes/credits");
  saveRun(null);
  return app.setScene(new CreditsScene(app));
}

export async function openInterlude(app: GameApp, id: string): Promise<void> {
  const i = app.content.raw.interludes[id];
  if (!i) return goNext(app);
  switch (i.subtype) {
    case "cutscene": {
      const { CutsceneScene } = await import("./scenes/cutscene");
      return app.setScene(new CutsceneScene(app, i));
    }
    case "minigame": {
      const { MinigameScene } = await import("./scenes/minigame");
      return app.setScene(new MinigameScene(app, i));
    }
    case "map": {
      const { MapScene } = await import("./scenes/map");
      return app.setScene(new MapScene(app, i));
    }
    default:
      // Shops, bonus rooms and QTEs are post-v1 modules; skip them when absent.
      return goNext(app);
  }
}

export interface StageResult {
  stageId: string;
  scores: number[];
  lives: number[];
  credits: number;
  party: string[];
}

export function stageCleared(app: GameApp, r: StageResult): Promise<void> {
  const run = app.run!;
  const raw = app.content.raw;
  run.scores = r.scores;
  run.lives = r.lives;
  run.credits = r.credits;
  run.party = r.party;
  run.cleared.push(r.stageId);
  const st = raw.stages[r.stageId]!.file;
  run.queue = [...st.interludes.after];
  const node = raw.campaign.nodes.find((n) => n.stageId === r.stageId);
  const options = node?.options ?? [];
  const hasMap = run.queue.some((q) => raw.interludes[q]?.subtype === "map");
  if (options.length === 0) {
    run.stageId = "";
    if (!run.queue.includes(raw.campaign.endingInterlude))
      run.queue.push(raw.campaign.endingInterlude);
  } else if (options.length === 1 && !hasMap) {
    run.stageId = options[0]!;
    run.queue.push(...(raw.stages[run.stageId]?.file.interludes.before ?? []));
  } else {
    // The map vote picks; default to the first option if the vote never runs.
    run.stageId = options[0]!;
  }
  saveRun(run);
  return goNext(app);
}

/** Called by the map vote with the chosen stage. */
export function chooseStage(app: GameApp, stageId: string): void {
  const run = app.run!;
  run.stageId = stageId;
  run.queue.push(...(app.content.raw.stages[stageId]?.file.interludes.before ?? []));
  saveRun(run);
}
