// GAME SELECT: the cabinet menu is the map. Everyone votes; majority wins, ties go to the
// lowest player slot, and the timer defaults to the first working option. In v1 only one
// entry works; the rest are "loading".

import { Container, Graphics } from "pixi.js";
import type { InterludeFile } from "@bb/schema";
import { IN, VIEW_H, VIEW_W, type InputFrame } from "@bb/engine";
import { Label } from "@bb/engine/render";
import type { GameApp, Scene } from "../app";
import { chooseStage, goNext } from "../flow";
import { C, label } from "../ui";

type MapFile = Extract<InterludeFile, { subtype: "map" }>;
const SLOT_COLORS = [0xffd93a, 0x4aa0f0, 0x5ac04a, 0xff8ac8];

export class MapScene implements Scene {
  readonly name = "map";
  readonly root = new Container();
  private readonly cursors = [0, 0, 0, 0];
  private readonly votes: (number | null)[] = [null, null, null, null];
  private readonly rows: Label[] = [];
  private readonly marks = new Graphics();
  private readonly msg = label("", VIEW_W / 2, 230, { color: C.pink, align: "center" });
  private readonly timer = label("", VIEW_W - 36, 12, { color: C.white });
  private t = 0;
  private done = false;
  private readonly active: boolean[];

  constructor(
    private readonly app: GameApp,
    private readonly map: MapFile,
  ) {
    this.active = (app.run?.party ?? []).map((p) => !!p);
    if (!this.active.some(Boolean)) this.active[0] = true;
    const bg = new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill(0x0e1a4a);
    for (let y = 0; y < VIEW_H; y += 3)
      bg.rect(0, y, VIEW_W, 1).fill({ color: 0x000000, alpha: 0.25 });
    this.root.addChild(
      bg,
      label(map.title, VIEW_W / 2, 12, { color: C.yellow, scale: 2, align: "center" }),
      this.timer,
    );
    map.entries.forEach((e, i) => {
      const l = label(e.label, 70, 50 + i * 20, { color: e.stageId ? C.white : C.gray });
      this.rows.push(l);
      this.root.addChild(l);
    });
    this.root.addChild(
      this.marks,
      this.msg,
      label(map.footer, VIEW_W / 2, 250, { color: C.gray, align: "center", maxWidth: 460 }),
    );
  }

  enter(): void {
    this.app.music("interlude");
  }

  tick(_inputs: InputFrame[]): void {
    if (this.done) return;
    this.t++;
    const n = this.map.entries.length;
    for (let i = 0; i < 4; i++) {
      if (!this.active[i]) continue;
      if (this.app.bots && this.votes[i] === null && this.t > 60)
        this.votes[i] = this.map.entries.findIndex((e) => !!e.stageId);
      const p = this.app.input.pressed(i);
      if (this.votes[i] !== null) {
        if (p & IN.TAUNT) this.votes[i] = null;
        continue;
      }
      if (p & IN.UP) this.cursors[i] = (this.cursors[i]! + n - 1) % n;
      if (p & IN.DOWN) this.cursors[i] = (this.cursors[i]! + 1) % n;
      if (p & (IN.UP | IN.DOWN)) this.app.sfx("select");
      if (p & (IN.ATTACK | IN.START)) {
        const e = this.map.entries[this.cursors[i]!]!;
        if (e.stageId) {
          this.votes[i] = this.cursors[i]!;
          this.app.sfx("confirm");
        } else {
          this.msg.set(`${e.label.split(":")[0]}: ${e.disabledText ?? "LOADING..."}`);
          this.app.sfx("tink");
        }
      }
    }
    const left = Math.max(0, this.map.voteTicks - this.t);
    this.timer.set(String(Math.ceil(left / 60)));
    this.draw();
    const allVoted = this.active.every((a, i) => !a || this.votes[i] !== null);
    if (allVoted || left === 0) void this.resolve();
  }

  private draw(): void {
    const g = this.marks;
    g.clear();
    for (let i = 0; i < 4; i++) {
      if (!this.active[i]) continue;
      const row = this.votes[i] ?? this.cursors[i]!;
      const x = 30 + i * 9;
      const y = 50 + row * 20;
      g.rect(x, y, 6, 8).fill(SLOT_COLORS[i]!);
      if (this.votes[i] !== null) g.rect(x, y + 9, 6, 1).fill(0xffffff);
    }
  }

  private async resolve(): Promise<void> {
    this.done = true;
    const tally = new Map<number, number>();
    for (let i = 0; i < 4; i++) {
      const v = this.votes[i];
      if (v !== null && v !== undefined) tally.set(v, (tally.get(v) ?? 0) + 1);
    }
    let pick = -1;
    let best = 0;
    // Ties go to the lowest player slot's vote.
    for (let i = 0; i < 4; i++) {
      const v = this.votes[i];
      if (v === null || v === undefined) continue;
      const n = tally.get(v)!;
      if (n > best) {
        best = n;
        pick = v;
      }
    }
    if (pick < 0) pick = this.map.entries.findIndex((e) => !!e.stageId);
    const entry = this.map.entries[pick];
    if (entry?.stageId) chooseStage(this.app, entry.stageId);
    this.app.sfx("go");
    await goNext(this.app);
  }
}
