// FOLD THE LAUNDRY: a between-stage button-mash bonus. Most folds wins the bonus.

import { Container, Graphics } from "pixi.js";
import type { InterludeFile } from "@bb/schema";
import { IN, VIEW_H, VIEW_W, type InputFrame } from "@bb/engine";
import { Label } from "@bb/engine/render";
import type { GameApp, Scene } from "../app";
import { goNext } from "../flow";
import { saveRun } from "../settings";
import { C, label } from "../ui";

type Minigame = Extract<InterludeFile, { subtype: "minigame" }>;
const SLOT_COLORS = [0xffd93a, 0x4aa0f0, 0x5ac04a, 0xff8ac8];

export class MinigameScene implements Scene {
  readonly name = "minigame";
  readonly root = new Container();
  private readonly presses = [0, 0, 0, 0];
  private readonly counts: Label[] = [];
  private readonly piles = new Graphics();
  private readonly timer = label("", VIEW_W / 2, 52, { color: C.white, scale: 2, align: "center" });
  private t = -120;
  private finished = false;
  private result: Label | null = null;
  private readonly active: boolean[];

  constructor(
    private readonly app: GameApp,
    private readonly mg: Minigame,
  ) {
    this.active = (app.run?.party ?? []).map((p) => !!p);
    if (!this.active.some(Boolean)) this.active[0] = true;
    const bg = new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill(0x2a9a8a);
    for (let i = 0; i < 16; i++)
      bg.rect(i * 30, 0, 15, VIEW_H).fill({ color: 0x6ae0c8, alpha: 0.3 });
    this.root.addChild(
      bg,
      label(mg.title, VIEW_W / 2, 12, { color: C.yellow, scale: 2, align: "center" }),
      label(mg.instructions, VIEW_W / 2, 36, { color: C.white, align: "center" }),
      this.timer,
      this.piles,
    );
    for (let i = 0; i < 4; i++) {
      const l = label("", 40 + i * 110, 210, { color: SLOT_COLORS[i] });
      this.counts.push(l);
      this.root.addChild(l);
    }
  }

  enter(): void {
    this.app.music(this.mg.music ?? "interlude");
  }

  status(): Record<string, unknown> {
    return { t: this.t, presses: this.presses.join("/") };
  }

  tick(_inputs: InputFrame[]): void {
    this.t++;
    if (this.finished) {
      if (this.t > 150 || (this.t > 40 && this.app.input.anyPressed(IN.START) >= 0))
        void goNext(this.app);
      return;
    }
    if (this.t < 0) {
      this.timer.set(this.t < -60 ? "READY" : "FOLD!");
      return;
    }
    for (let i = 0; i < 4; i++) {
      if (!this.active[i]) continue;
      if (this.app.input.pressed(i) & IN.ATTACK) {
        this.presses[i]!++;
        this.app.sfx(this.presses[i]! % this.mg.pressesPerItem === 0 ? "fold" : "mash");
      }
    }
    // Bots in tests mash at a steady rate.
    if (this.app.bots)
      for (let i = 0; i < 4; i++) if (this.active[i] && this.t % (5 + i) === 0) this.presses[i]!++;
    const left = Math.max(0, this.mg.durationTicks - this.t);
    this.timer.set(String(Math.ceil(left / 60)));
    this.draw();
    if (left === 0) this.finish();
  }

  private folds(i: number): number {
    return Math.floor(this.presses[i]! / this.mg.pressesPerItem);
  }

  private draw(): void {
    const g = this.piles;
    g.clear();
    for (let i = 0; i < 4; i++) {
      if (!this.active[i]) continue;
      const x = 40 + i * 110;
      const n = this.folds(i);
      for (let k = 0; k < Math.min(18, n); k++)
        g.rect(x, 196 - k * 6, 60, 5)
          .fill(k % 2 ? 0xf4f0e8 : SLOT_COLORS[i]!)
          .rect(x, 196 - k * 6, 60, 1)
          .fill(0x1a1420);
      const messy = 6 - (this.presses[i]! % this.mg.pressesPerItem);
      g.ellipse(x + 30, 100, 24 + messy * 2, 10 + messy).fill(0xff8ac8);
      const name = this.app.run?.party[i]
        ? this.app.content.defs[this.app.content.defIndex[this.app.run.party[i]!]!]!.player
            ?.shortName
        : `P${i + 1}`;
      this.counts[i]!.set(`${name}\n${n} ${this.mg.itemNoun}`);
    }
  }

  private finish(): void {
    this.finished = true;
    this.t = 0;
    const run = this.app.run;
    let best = -1;
    let bestN = -1;
    for (let i = 0; i < 4; i++) {
      if (!this.active[i]) continue;
      const n = this.folds(i);
      if (run) run.scores[i] = (run.scores[i] ?? 0) + n * this.mg.scorePerItem;
      if (n > bestN) {
        bestN = n;
        best = i;
      }
    }
    if (run && best >= 0) {
      run.scores[best] = (run.scores[best] ?? 0) + this.mg.winnerBonus;
      saveRun(run);
    }
    this.result = label(
      best >= 0 ? `P${best + 1} WINS THE LAUNDRY. +${this.mg.winnerBonus}` : "NOBODY FOLDED.",
      VIEW_W / 2,
      130,
      { color: C.yellow, align: "center", scale: 1 },
    );
    this.root.addChild(
      new Graphics().rect(0, 120, VIEW_W, 28).fill({ color: 0x1a1420, alpha: 0.8 }),
      this.result,
    );
    this.app.sfx("coin");
  }
}
