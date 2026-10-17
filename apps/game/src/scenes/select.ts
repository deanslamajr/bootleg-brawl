// Character select: free pick from the roster, hot-join with Start, cabinet mode locks each
// slot to a character like the four-player cabinets did.

import { Container, Graphics, Sprite } from "pixi.js";
import { IN, VIEW_H, VIEW_W, type InputFrame } from "@bb/engine";
import { Label } from "@bb/engine/render";
import type { GameApp, Scene } from "../app";
import { newRun, goNext } from "../flow";
import { C, label } from "../ui";

const SLOT_COLORS = [0xffd93a, 0x4aa0f0, 0x5ac04a, 0xff8ac8];
const WRONG_STATS: Record<string, string> = {
  sarge: "HEIGHT 9 FT 2 IN",
  boomer: "SPEED: FAST",
  brat: "MANNERS: 10",
  mensa: "IQ: 9",
};

interface SlotState {
  joined: boolean;
  cursor: number;
  ready: boolean;
}

export class SelectScene implements Scene {
  readonly name = "select";
  readonly root = new Container();
  private readonly slots: SlotState[] = [0, 1, 2, 3].map((i) => ({
    joined: false,
    cursor: i,
    ready: false,
  }));
  private readonly roster: string[];
  private readonly cursors = new Graphics();
  private readonly slotLabels: Label[] = [];
  private readonly timerLabel = label("", VIEW_W - 40, 14, { color: C.white });
  private timer = 60 * 25;
  private started = false;

  constructor(private readonly app: GameApp) {
    this.roster = app.content.raw.roster.rosterOrder;
    const bg = new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill(0x1a1420);
    for (let i = 0; i < 8; i++)
      bg.rect(0, 200 + i * 9, VIEW_W, 4).fill({ color: 0x3e1a6a, alpha: 0.6 });
    this.root.addChild(
      bg,
      label("SELECT YOUR SIMPLETON", VIEW_W / 2, 12, {
        color: C.yellow,
        scale: 2,
        align: "center",
      }),
      this.timerLabel,
    );
    this.roster.forEach((id, i) => {
      const d = app.content.defs[app.content.defIndex[id]!]!;
      const x = 30 + i * 108;
      const card = new Graphics()
        .rect(x, 40, 96, 120)
        .fill(0x2e2a3a)
        .rect(x, 40, 96, 2)
        .fill(C.yellow);
      this.root.addChild(card);
      this.root.addChild(
        label(d.player!.shortName, x + 48, 46, { color: C.white, align: "center" }),
      );
      this.root.addChild(
        label(d.player!.archetype.toUpperCase(), x + 48, 128, { color: C.gray, align: "center" }),
      );
      this.root.addChild(
        label(WRONG_STATS[id] ?? "STATS: YES", x + 48, 140, { color: C.pink, align: "center" }),
      );
      void app.assets.portrait(id).then((t) => {
        if (!t || this.root.destroyed) return;
        const s = new Sprite(t);
        s.scale.set(1.5);
        s.position.set(x + 12, 58);
        this.root.addChildAt(s, this.root.children.indexOf(card) + 1);
      });
    });
    this.root.addChild(this.cursors);
    for (let i = 0; i < 4; i++) {
      const l = label("", 10 + i * 118, 176, { color: SLOT_COLORS[i] });
      this.slotLabels.push(l);
      this.root.addChild(l);
    }
    this.root.addChild(
      label("START: JOIN   ←→: PICK   ATTACK: READY   TAUNT: BACK", VIEW_W / 2, 252, {
        color: C.gray,
        align: "center",
      }),
    );
  }

  enter(): void {
    this.app.music("title");
  }

  tick(_inputs: InputFrame[]): void {
    if (this.started) return;
    const input = this.app.input;
    const cab = this.app.settings.cabinetMode;
    const n = this.roster.length;
    for (let i = 0; i < 4; i++) {
      const s = this.slots[i]!;
      const p = input.pressed(i);
      if (!s.joined) {
        if (p & (IN.START | IN.ATTACK)) {
          s.cursor = cab ? i % n : this.firstFree(i);
          s.joined = true;
          this.app.sfx("confirm");
        }
        continue;
      }
      if (!s.ready) {
        if (!cab && p & IN.LEFT) s.cursor = (s.cursor + n - 1) % n;
        if (!cab && p & IN.RIGHT) s.cursor = (s.cursor + 1) % n;
        if (p & (IN.LEFT | IN.RIGHT)) this.app.sfx("select");
        if (p & (IN.ATTACK | IN.START)) {
          s.ready = true;
          this.app.sfx("confirm");
        }
        if (p & IN.TAUNT) {
          s.joined = false;
          this.app.input.release(i);
        }
      } else if (p & IN.TAUNT) s.ready = false;
    }
    if (this.slots.some((s) => s.joined)) this.timer--;
    const joined = this.slots.filter((s) => s.joined);
    if (
      (joined.length > 0 && joined.every((s) => s.ready)) ||
      (joined.length > 0 && this.timer <= 0)
    )
      void this.start();
    if (input.anyPressed(IN.TAUNT) >= 0 && joined.length === 0) void this.back();
    this.draw();
  }

  private firstFree(i: number): number {
    const used = new Set(this.slots.filter((s) => s.joined).map((s) => s.cursor));
    for (let k = 0; k < this.roster.length; k++) {
      const c = (i + k) % this.roster.length;
      if (!used.has(c)) return c;
    }
    return i % this.roster.length;
  }

  private draw(): void {
    const g = this.cursors;
    g.clear();
    this.slots.forEach((s, i) => {
      const id = this.roster[s.cursor]!;
      const d = this.app.content.defs[this.app.content.defIndex[id]!]!;
      if (s.joined) {
        const x = 30 + s.cursor * 108 + i * 2;
        g.rect(x - 2, 38 + i * 2, 100 - i * 4, 124 - i * 4).stroke({
          color: SLOT_COLORS[i]!,
          width: s.ready ? 2 : 1,
        });
        this.slotLabels[i]!.set(`P${i + 1} ${d.player!.shortName}${s.ready ? " OK!" : ""}`);
      } else this.slotLabels[i]!.set((performance.now() >> 9) % 2 ? `P${i + 1} PRESS START` : "");
    });
    this.timerLabel.set(String(Math.max(0, Math.ceil(this.timer / 60))));
  }

  private async start(): Promise<void> {
    this.started = true;
    const party = this.slots.map((s) => (s.joined ? this.roster[s.cursor]! : ""));
    newRun(this.app, party);
    this.app.sfx("go");
    await goNext(this.app);
  }

  private async back(): Promise<void> {
    const { TitleScene } = await import("./title");
    await this.app.setScene(new TitleScene(this.app));
  }
}
