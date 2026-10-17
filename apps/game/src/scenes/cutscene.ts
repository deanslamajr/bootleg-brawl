// Cutscene interludes: text panels with actors, backgrounds and screen effects.

import { Container, Graphics, Sprite, TilingSprite } from "pixi.js";
import type { CutsceneStep, InterludeFile } from "@bb/schema";
import { IN, VIEW_H, VIEW_W, type InputFrame } from "@bb/engine";
import type { GameApp, Scene } from "../app";
import { goNext } from "../flow";
import { C, label } from "../ui";

type Cutscene = Extract<InterludeFile, { subtype: "cutscene" }>;

interface ActorView {
  sprite: Sprite;
  x0: number;
  x1: number;
}

export class CutsceneScene implements Scene {
  readonly name = "cutscene";
  readonly root = new Container();
  private readonly stage = new Container();
  private readonly fx = new Graphics();
  private readonly textBox = new Container();
  private step = -1;
  private t = 0;
  private actors: ActorView[] = [];
  private readonly party: string[];

  constructor(
    private readonly app: GameApp,
    private readonly cs: Cutscene,
  ) {
    this.party = (app.run?.party ?? []).filter(Boolean);
    this.root.addChild(
      new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill(0x1a1420),
      this.stage,
      this.fx,
      this.textBox,
    );
  }

  private backgroundStage(layerId: string): string | null {
    for (const [sid, st] of Object.entries(this.app.content.raw.stages))
      if (st.layers[layerId]) return sid;
    return null;
  }

  async enter(): Promise<void> {
    const sheets = new Set<string>(this.party);
    const bgStages = new Set<string>();
    for (const s of this.cs.steps) {
      for (const a of s.actors) sheets.add(a.def);
      if (s.background) {
        const sid = this.backgroundStage(s.background);
        if (sid) bgStages.add(sid);
      }
    }
    await this.app.assets.ensureSheets(
      [...sheets].filter((s) => this.app.content.defIndex[s] !== undefined),
    );
    await Promise.all([...bgStages].map((s) => this.app.assets.ensureLayers(s)));
    if (this.cs.music) this.app.music(this.cs.music);
    this.next();
  }

  private actorSprite(defId: string, pose: string, tier = 0): Sprite | null {
    const content = this.app.content;
    const idx = content.defIndex[defId];
    if (idx === undefined) return null;
    const d = content.defs[idx]!;
    const pal = d.enemy
      ? d.enemy.tiers[Math.min(tier, d.enemy.tiers.length - 1)]!.palette
      : d.palette;
    const fr =
      this.app.assets.frame(d.sheet, pose, pal) ?? this.app.assets.frame(d.sheet, "idle:0", pal);
    if (!fr) return null;
    const s = new Sprite(fr.tex);
    s.anchor.set(fr.meta.ax / fr.meta.w, fr.meta.ay / fr.meta.h);
    return s;
  }

  private build(step: CutsceneStep): void {
    this.stage.removeChildren().forEach((c) => c.destroy());
    this.textBox.removeChildren().forEach((c) => c.destroy());
    this.actors = [];
    if (step.background) {
      const sid = this.backgroundStage(step.background);
      const tex = sid ? this.app.assets.layer(sid, step.background) : null;
      if (tex)
        this.stage.addChild(new TilingSprite({ texture: tex, width: VIEW_W, height: tex.height }));
    }
    const add = (
      def: string,
      pose: string,
      x: number,
      y: number,
      facing: number,
      toX?: number,
      tier = 0,
    ) => {
      const s = this.actorSprite(def, pose, tier);
      if (!s) return;
      s.position.set(x, y);
      s.scale.x = facing;
      this.stage.addChild(s);
      this.actors.push({ sprite: s, x0: x, x1: toX ?? x });
    };
    if (step.party)
      this.party.forEach((id, i) => add(id, "idle:0", 70 + i * 34, 226 + (i % 2) * 8, 1));
    for (const a of step.actors) add(a.def, a.pose, a.x, a.y, a.facing, a.toX, a.tier);
    const panel = new Graphics()
      .rect(8, VIEW_H - 62, VIEW_W - 16, 54)
      .fill({ color: 0x1a1420, alpha: 0.92 })
      .rect(8, VIEW_H - 62, VIEW_W - 16, 2)
      .fill(C.yellow);
    this.textBox.addChild(panel);
    if (step.speaker)
      this.textBox.addChild(label(step.speaker, 16, VIEW_H - 56, { color: C.pink }));
    this.textBox.addChild(
      label(step.text, 16, VIEW_H - 44, { color: C.white, maxWidth: VIEW_W - 40 }),
    );
    if (step.sfx) this.app.sfx(step.sfx);
    if (this.cs.title && this.step === 0)
      this.stage.addChild(
        label(this.cs.title, VIEW_W / 2, 12, { color: C.yellow, scale: 2, align: "center" }),
      );
  }

  private next(): void {
    this.step++;
    this.t = 0;
    const step = this.cs.steps[this.step];
    if (!step) {
      void this.done();
      return;
    }
    this.build(step);
  }

  private async done(): Promise<void> {
    if (this.cs.credits) {
      const { CreditsScene } = await import("./credits");
      await this.app.setScene(new CreditsScene(this.app, true));
      return;
    }
    await goNext(this.app);
  }

  tick(_inputs: InputFrame[]): void {
    const step = this.cs.steps[this.step];
    if (!step) return;
    this.t++;
    const k = Math.min(1, this.t / step.ticks);
    for (const a of this.actors) a.sprite.x = a.x0 + (a.x1 - a.x0) * k;
    this.fx.clear();
    this.stage.position.set(0, 0);
    switch (step.effect) {
      case "static":
        if (this.t < 50)
          for (let i = 0; i < 120; i++)
            this.fx
              .rect(
                Math.random() * VIEW_W,
                Math.random() * (VIEW_H - 64),
                4 + Math.random() * 30,
                1 + Math.random() * 2,
              )
              .fill({ color: Math.random() < 0.5 ? 0xffffff : 0x6e6a7e, alpha: 0.8 });
        break;
      case "shake":
        this.stage.position.set(Math.random() * 4 - 2, Math.random() * 4 - 2);
        break;
      case "flash":
        if (this.t < 12)
          this.fx.rect(0, 0, VIEW_W, VIEW_H).fill({ color: 0xffffff, alpha: 1 - this.t / 12 });
        break;
      case "suck":
        for (const a of this.actors) {
          a.sprite.scale.set(
            Math.sign(a.sprite.scale.x) * Math.max(0.05, 1 - k),
            Math.max(0.05, 1 - k),
          );
          a.sprite.x += (380 - a.sprite.x) * k * 0.1;
        }
        break;
      case "fade":
        this.fx.rect(0, 0, VIEW_W, VIEW_H).fill({ color: 0x1a1420, alpha: k });
        break;
    }
    const skip = this.app.input.anyPressed(IN.ATTACK | IN.START) >= 0;
    if (this.t >= step.ticks || (skip && this.t > step.minTicks)) this.next();
  }
}
