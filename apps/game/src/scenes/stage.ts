// A cabinet game: title card, then the sim at 60 Hz with the renderer reading it. Boss cards,
// pause, stage clear and game over are overlays on top.

import { Container, Graphics, Sprite } from "pixi.js";
import {
  FX,
  IN,
  PHASE,
  SLOT,
  Sim,
  VIEW_H,
  VIEW_W,
  type InputFrame,
  type SimEvent,
} from "@bb/engine";
import { Label, StageRenderer } from "@bb/engine/render";
import type { GameApp, Scene } from "../app";
import { stageCleared } from "../flow";
import { C, Menu, box, label } from "../ui";

type Mode = "loading" | "card" | "play" | "clear" | "paused";

export class StageScene implements Scene {
  readonly name = "stage";
  readonly root = new Container();
  sim: Sim | null = null;
  private renderer: StageRenderer | null = null;
  private mode: Mode = "loading";
  private t = 0;
  private readonly cardLayer = new Container();
  private readonly overlay = new Container();
  private cardLine: Label | null = null;
  private cardFix: Label | null = null;
  private cardStrike: Graphics | null = null;
  private typed = 0;
  private pauseMenu: Menu | null = null;
  private bossCardTicks = 0;
  /** Events the sim emitted while it was built (the first segment's intro banner). */
  private startEvents: SimEvent[] = [];
  private escHeld = false;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.code === "Escape") this.escHeld = true;
  };
  /** Losing focus or hiding the tab pauses play, so an alt-tab does not cost a life. */
  private readonly onBlur = () => {
    if (this.mode === "play") this.pause();
  };
  private readonly onVisibility = () => {
    if (!document.hidden) return;
    this.onBlur();
  };

  constructor(
    private readonly app: GameApp,
    readonly stageId: string,
  ) {
    this.root.addChild(this.cardLayer, this.overlay);
  }

  async enter(): Promise<void> {
    const app = this.app;
    const run = app.run!;
    const content = app.content;
    const party = run.party.map((id) => (id ? (content.defIndex[id] ?? -1) : -1));
    this.sim = new Sim({
      content,
      stageId: this.stageId,
      seed: run.seed + run.cleared.length * 7919,
      registry: app.registry,
      difficulty: run.difficulty,
      friendlyFire: run.friendlyFire,
      party,
      scores: run.scores,
      lives: run.lives.map((l) => (l > 0 ? l : undefined)) as number[],
      credits: run.credits === -999 ? undefined : run.credits,
      cabinetMode: run.cabinetMode,
    });
    // The first step clears these, so the renderer gets them when the card ends.
    this.startEvents = [...this.sim.events];
    this.buildCard();
    this.mode = "card";
    // Assets load during the title card; the next stage is not known until the map vote.
    const sheets = StageRenderer.sheetsFor(content, this.sim);
    await Promise.all([app.assets.ensureSheets(sheets), app.assets.ensureLayers(this.stageId)]);
    this.renderer = new StageRenderer(app.assets, content, this.sim, this.stageId);
    this.root.addChildAt(this.renderer.root, 0);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibility);
    app.music("stinger-title");
  }

  exit(): void {
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  status(): Record<string, unknown> {
    const sim = this.sim;
    if (!sim) return { mode: this.mode };
    return {
      mode: this.mode,
      stage: this.stageId,
      phase: sim.g.phase,
      seg: sim.g.seg,
      tick: sim.g.tick,
      cam: sim.g.camX >> 16,
      ents: sim.world.count(),
      kos: sim.g.players.reduce((n, p) => n + p.kos, 0),
      hash: sim.hash().toString(16),
    };
  }

  // ------------------------------------------------------------------ title card

  private buildCard(): void {
    const st = this.sim!.stage;
    const tc = st.titleCard;
    const L = this.cardLayer;
    L.addChild(new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill(0x1a1420));
    for (let i = 0; i < 6; i++)
      L.addChild(
        new Graphics().rect(0, 22 + i * 4, VIEW_W, 2).fill({ color: 0x6a2aa0, alpha: 0.6 }),
      );
    L.addChild(
      label(`GAME ${st.gameNumber} OF 999`, VIEW_W / 2, 50, {
        color: C.pink,
        scale: 2,
        align: "center",
      }),
    );
    L.addChild(
      label(tc.title, VIEW_W / 2, 78, {
        color: C.yellow,
        scale: 2,
        align: "center",
        maxWidth: 230,
      }),
    );
    L.addChild(label(tc.subtitle, VIEW_W / 2, 118, { color: C.white, align: "center" }));
    L.addChild(
      label(tc.houseRulesText, VIEW_W / 2, 140, { color: C.gray, align: "center", maxWidth: 420 }),
    );
    const boss = st.bossTriggers.find((b) => !b.midBoss);
    if (boss) {
      const bf = this.app.content.raw.bosses[boss.bossId]?.file;
      if (bf)
        L.addChild(
          label(
            `WANTED: ${bf.displayName.toUpperCase()}  BOUNTY ${bf.card.bounty}¢`,
            VIEW_W / 2,
            176,
            { color: C.red, align: "center" },
          ),
        );
    }
    this.cardLine = label("", VIEW_W / 2, 204, { color: C.white, align: "center", maxWidth: 440 });
    L.addChild(this.cardLine);
    L.addChild(label(tc.copyright, VIEW_W / 2, VIEW_H - 14, { color: C.gray, align: "center" }));
  }

  private tickCard(inputs: InputFrame[]): void {
    const tc = this.sim!.stage.titleCard;
    this.t++;
    if (this.t % 2 === 0 && this.typed < tc.announcerLine.length) {
      this.typed++;
      if (this.typed % 3 === 0) this.app.audio.play("announcer", 0, "announcer");
      this.cardLine!.set(`ANNOUNCER: "${tc.announcerLine.slice(0, this.typed)}"`);
    }
    // The pedant in the party fixes the Announcer's grammar.
    const pedant = this.sim!.g.players.some(
      (p) => p.def >= 0 && this.app.content.defs[p.def]!.player?.gags.includes("grammarPedant"),
    );
    if (
      pedant &&
      tc.announcerLineCorrected &&
      this.typed >= tc.announcerLine.length &&
      this.t > tc.announcerLine.length * 2 + 50 &&
      !this.cardFix
    ) {
      const w = this.cardLine!.textWidth;
      this.cardStrike = new Graphics().rect(VIEW_W / 2 - w / 2, 208, w, 1).fill(C.red);
      this.cardFix = label(`"${tc.announcerLineCorrected}" —MENSA`, VIEW_W / 2, 224, {
        color: C.yellow,
        align: "center",
        maxWidth: 440,
      });
      this.cardLayer.addChild(this.cardStrike, this.cardFix);
      this.app.sfx("tink");
    }
    const skip = inputs.some(
      (b, i) => (this.app.input.pressed(i) & (IN.ATTACK | IN.START)) !== 0 && b !== 0,
    );
    const ready = !!this.renderer;
    if (ready && (this.t > 330 || (skip && this.t > 40))) {
      this.mode = "play";
      this.cardLayer.visible = false;
      this.renderer!.onStep(this.startEvents);
      this.startEvents = [];
    }
  }

  // ------------------------------------------------------------------ play

  tick(inputs: InputFrame[]): void {
    const sim = this.sim;
    if (!sim) return;
    if (this.escHeld) {
      this.escHeld = false;
      if (this.mode === "play") this.pause();
      else if (this.mode === "paused") this.resume();
    }
    switch (this.mode) {
      case "card":
        this.tickCard(inputs);
        return;
      case "paused": {
        const slot = this.app.input.anyPressed(0x3ff);
        if (slot >= 0 && this.pauseMenu?.handle(this.app.input.pressed(slot)))
          this.app.sfx("select");
        return;
      }
      case "clear":
        this.t++;
        if (this.t === 150) void this.finish();
        sim.step([0, 0, 0, 0]);
        this.renderer?.onStep(sim.events);
        return;
      case "play":
        break;
      default:
        return;
    }
    sim.step(inputs);
    const events = sim.events;
    this.renderer?.onStep(events);
    this.route(events);
    if (this.bossCardTicks > 0) {
      this.bossCardTicks--;
      if (this.bossCardTicks === 0 || sim.g.phase !== PHASE.bossIntro)
        this.overlay.removeChildren().forEach((c) => c.destroy({ children: true }));
    }
  }

  private route(events: SimEvent[]): void {
    const app = this.app;
    const sim = this.sim!;
    for (const ev of events) {
      switch (ev.t) {
        case "sfx":
          app.sfx(ev.id, ev.x !== undefined ? (ev.x - VIEW_W / 2) / (VIEW_W / 2) : 0);
          break;
        case "music":
          if (ev.action === "stinger") app.music(ev.track, sim.stage.music.track);
          else if (ev.action === "stop") app.music(undefined);
          else if (ev.track) app.music(ev.track);
          break;
        case "bossCard":
          this.showBossCard(ev.def, ev.partner);
          if (!ev.midBoss) this.prefetchNext();
          break;
        case "text":
          if (ev.kind === "bulletin") app.sfx("bulletin");
          break;
        case "go":
          app.sfx("go");
          break;
        case "continue":
          if (ev.seconds === 10) app.music("stinger-continue", sim.stage.music.track);
          else app.sfx("continue");
          break;
        case "stageClear":
          this.mode = "clear";
          this.t = 0;
          this.showClear();
          break;
        case "gameOver":
          void this.gameOver();
          break;
      }
    }
  }

  private showBossCard(def: number, partner: number): void {
    const app = this.app;
    const d = app.content.defs[def]!;
    const b = d.boss!;
    app.music("stinger-boss");
    app.sfx("card");
    app.audio.duck(2.5);
    const c = new Container();
    c.addChild(new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill({ color: 0x1a1420, alpha: 0.75 }));
    const panel = box(320, 150, 0x3e1a6a, C.red);
    panel.position.set(80, 50);
    c.addChild(panel);
    const fr = app.assets.frame(d.sheet, b.card.portrait, d.palette);
    if (fr) {
      const s = new Sprite(fr.tex);
      s.anchor.set(fr.meta.ax / fr.meta.w, fr.meta.ay / fr.meta.h);
      const sc = Math.min(2, 96 / Math.max(fr.meta.h, fr.meta.w));
      s.scale.set(sc);
      s.position.set(140, 180);
      c.addChild(s);
    }
    const names =
      partner >= 0 ? `${d.displayName} & ${app.content.defs[partner]!.displayName}` : d.displayName;
    c.addChild(label(names.toUpperCase(), 200, 60, { color: C.yellow, maxWidth: 190 }));
    c.addChild(label(b.card.title, 200, 82, { color: C.pink, maxWidth: 190 }));
    b.card.stats.forEach((s, i) =>
      c.addChild(
        label(`${s.label}: ${s.value}`, 200, 110 + i * 11, { color: C.white, maxWidth: 190 }),
      ),
    );
    c.addChild(
      label(`"${b.card.taunt}"`, VIEW_W / 2, 206, {
        color: C.white,
        align: "center",
        maxWidth: 420,
      }),
    );
    c.addChild(label(`BOUNTY: ${b.card.bounty}¢`, 200, 178, { color: C.red, scale: 1 }));
    this.overlay.addChild(c);
    this.bossCardTicks = 150;
  }

  /** Loads the next game's layers and sprites while the boss fight runs. */
  private prefetchNext(): void {
    const raw = this.app.content.raw;
    const node = raw.campaign.nodes.find((n) => n.stageId === this.stageId);
    for (const next of node?.options ?? []) {
      void this.app.assets.ensureLayers(next);
      const st = raw.stages[next];
      if (!st) continue;
      const fams = new Set<string>();
      for (const seg of Object.values(st.segments))
        for (const l of seg.scrollLocks) for (const w of l.waves) fams.add(w.family);
      for (const b of st.file.bossTriggers) fams.add(b.bossId);
      void this.app.assets.ensureSheets(
        [...fams].filter((f) => this.app.content.defIndex[f] !== undefined),
      );
    }
  }

  private showClear(): void {
    const sim = this.sim!;
    const c = new Container();
    c.addChild(new Graphics().rect(0, 80, VIEW_W, 90).fill({ color: 0x1a1420, alpha: 0.85 }));
    c.addChild(
      label(`GAME ${sim.stage.gameNumber} CLEAR`, VIEW_W / 2, 90, {
        color: C.yellow,
        scale: 2,
        align: "center",
      }),
    );
    sim.g.players.forEach((p, i) => {
      if (p.def < 0) return;
      const d = this.app.content.defs[p.def]!;
      c.addChild(
        label(
          `${d.player?.shortName ?? ""} ${String(p.score).padStart(7, "0")}  KO ${p.kos}`,
          30 + i * 112,
          130,
          { color: C.white },
        ),
      );
    });
    this.overlay.addChild(c);
    this.app.music("boss-down");
  }

  private async finish(): Promise<void> {
    const sim = this.sim!;
    const content = this.app.content;
    await stageCleared(this.app, {
      stageId: this.stageId,
      scores: sim.g.players.map((p) => p.score),
      lives: sim.g.players.map((p) => (p.status === SLOT.playing ? Math.max(1, p.lives) : 0)),
      credits: sim.g.credits,
      party: sim.g.players.map((p) =>
        p.status === SLOT.playing && p.def >= 0 ? content.defs[p.def]!.id : "",
      ),
    });
  }

  private async gameOver(): Promise<void> {
    const { GameOverScene } = await import("./gameover");
    await this.app.setScene(new GameOverScene(this.app, this.sim!));
  }

  private pause(): void {
    this.mode = "paused";
    this.app.sfx("pause");
    const c = new Container();
    c.addChild(new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill({ color: 0x1a1420, alpha: 0.7 }));
    c.addChild(label("PAUSED", VIEW_W / 2, 80, { color: C.yellow, scale: 2, align: "center" }));
    this.pauseMenu = new Menu([
      { label: () => "RESUME", select: () => this.resume() },
      { label: () => "QUIT TO TITLE", select: () => void this.quit() },
    ]);
    this.pauseMenu.position.set(VIEW_W / 2 - 50, 120);
    c.addChild(this.pauseMenu);
    c.label = "pause";
    this.overlay.addChild(c);
  }

  private resume(): void {
    this.mode = "play";
    const p = this.overlay.children.find((ch) => ch.label === "pause");
    p?.destroy({ children: true });
  }

  private async quit(): Promise<void> {
    const { TitleScene } = await import("./title");
    await this.app.setScene(new TitleScene(this.app));
  }

  render(alpha: number): void {
    if (this.mode === "card" || !this.renderer) return;
    this.renderer.update(this.mode === "paused" ? 1 : alpha);
    void FX;
  }
}
