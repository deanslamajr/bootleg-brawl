// RenderSync for a running stage: reads the sim (never writes it), interpolates positions,
// draws parallax layers, actors, items, effects and the HUD.

import { Container, Graphics, Sprite, TilingSprite } from "pixi.js";
import type { LayerRef } from "@bb/schema";
import type { CompiledContent } from "../content/types";
import { FX } from "../math/fixed";
import type { Sim, SimEvent } from "../sim/sim";
import { COSTUMES } from "../sim/systems/director";
import { F, KIND, PHASE, SK, SLOT, VIEW_H, VIEW_W } from "../sim/types";
import type { AssetStore } from "./assets";
import { Label, hexNum } from "./text";

const SLOT_COLORS = [0xffd93a, 0x4aa0f0, 0x5ac04a, 0xff8ac8];
/** Top of a banner's text. Its backing starts 4 px higher. */
const BANNER_Y = 52;

interface Effect {
  node: Container;
  ttl: number;
  vy: number;
  ent: number;
  ox: number;
  oy: number;
  world: boolean;
}

class EntityView extends Container {
  readonly shadow = new Graphics();
  readonly body = new Sprite();
  weapon: Sprite | null = null;
  hat: Sprite | null = null;
  extra: Sprite | null = null;
  badge: Label | null = null;
  constructor(readonly defIndex: number) {
    super();
    this.addChild(this.shadow, this.body);
  }
}

interface PanelView {
  root: Container;
  name: Label;
  score: Label;
  lives: Label;
  info: Label;
  bar: Graphics;
}

export class StageRenderer {
  readonly root = new Container();
  private readonly sky = new Graphics();
  private readonly bg = new Container();
  private readonly world = new Container();
  private readonly fg = new Container();
  private readonly fx = new Container();
  private readonly hud = new Container();
  private readonly overlay = new Container();
  private readonly flash = new Graphics();
  private readonly views = new Map<number, EntityView>();
  private layers: { ref: LayerRef; node: TilingSprite | Sprite }[] = [];
  private segBuilt = -1;
  private effects: Effect[] = [];
  private shake = 0;
  private flashTicks = 0;
  private staticTicks = 0;
  private goTicks = 0;
  private drift = 0;
  private readonly panels: PanelView[] = [];
  private readonly credits = new Label("", { color: 0xf4f0e8 });
  private readonly bossBar = new Graphics();
  private readonly bossName = new Label("", { color: 0xf4f0e8 });
  private readonly contBox = new Container();
  private readonly contText = new Label("", { color: 0xffffff, maxWidth: 300, align: "center" });
  private readonly goLabel = new Label("GO →", { color: 0xffd93a, scale: 2 });
  private readonly staticG = new Graphics();
  private readonly railG = new Graphics();
  private comboLabels: Label[] = [];
  private comboTimers = [0, 0, 0, 0];
  debug: Label | null = null;

  constructor(
    readonly assets: AssetStore,
    readonly content: CompiledContent,
    public sim: Sim,
    readonly stageId: string,
    /** Display options. Gore needs the player's option and the stage's rules.gore opt-in. */
    readonly opts: { gore?: boolean } = {},
  ) {
    this.world.sortableChildren = true;
    this.root.addChild(
      this.sky,
      this.bg,
      this.world,
      this.fg,
      this.fx,
      this.railG,
      this.hud,
      this.overlay,
      this.staticG,
      this.flash,
    );
    this.buildHud();
  }

  /** Every sheet the stage can show, for preloading at the title card. */
  static sheetsFor(content: CompiledContent, sim: Sim): string[] {
    const set = new Set<string>(["items"]);
    for (const p of sim.g.players) if (p.def >= 0) set.add(content.defs[p.def]!.sheet);
    for (const id of content.raw.roster.rosterOrder) set.add(id);
    const st = sim.stage;
    for (const seg of sim.segments) {
      for (const l of seg.scrollLocks) for (const w of l.waves) set.add(w.family);
      for (const p of seg.placements) if (p.kind === "civilian" || p.kind === "npc") set.add(p.id);
      for (const g of seg.gags) if (g.params.family) set.add(g.params.family);
    }
    for (const b of st.bossTriggers) {
      set.add(b.bossId);
      const partner = content.raw.bosses[b.bossId]?.file.partner;
      if (partner) set.add(partner);
      for (const ph of content.raw.bosses[b.bossId]?.file.phases ?? [])
        for (const p of ph.patterns)
          for (const s of p.steps) if (s.do === "spawn") set.add(s.family);
    }
    for (const a of Object.values(content.raw.arenas))
      for (const ph of a.phases) if (ph.spawn) set.add(ph.spawn.family);
    set.add("deadweight-dave");
    set.add("lickspittle");
    return [...set].filter((s) => s === "items" || content.defIndex[s] !== undefined);
  }

  // ------------------------------------------------------------------ layers

  private buildLayers(): void {
    for (const l of this.layers) l.node.destroy();
    this.layers = [];
    this.bg.removeChildren();
    this.fg.removeChildren();
    const seg = this.sim.segment();
    this.sky.clear().rect(0, 0, VIEW_W, VIEW_H).fill(hexNum(seg.sky));
    for (const ref of [...seg.layers].sort((a, b) => a.depth - b.depth)) {
      const tex = this.assets.layer(this.stageId, ref.layer);
      if (!tex) continue;
      const node = ref.repeat
        ? new TilingSprite({ texture: tex, width: VIEW_W, height: tex.height })
        : new Sprite(tex);
      node.y = ref.y;
      (ref.foreground ? this.fg : this.bg).addChild(node);
      this.layers.push({ ref, node });
    }
    this.segBuilt = this.sim.g.seg;
  }

  // ------------------------------------------------------------------ events

  /** Called after each sim step with that step's events. */
  onStep(events: readonly SimEvent[]): void {
    const sim = this.sim;
    for (const ev of events) {
      switch (ev.t) {
        case "hit":
          this.spark(ev.x, ev.y, ev.z, ev.power);
          break;
        case "text":
          this.addText(ev);
          break;
        case "shake":
          this.shake = Math.max(this.shake, ev.ticks);
          break;
        case "flash":
          this.flashTicks = Math.max(this.flashTicks, ev.ticks);
          break;
        case "static":
          this.staticTicks = 40;
          break;
        case "go":
          this.goTicks = 150;
          break;
        case "combo":
          this.comboTimers[ev.slot] = 60;
          this.comboLabels[ev.slot]?.set(`${ev.count} HIT`);
          break;
        case "crack":
          this.crack(ev.x, ev.y);
          break;
        case "ko":
          if (this.opts.gore) this.splatter(ev.ent);
          break;
      }
    }
    for (const e of this.effects) e.ttl--;
    this.effects = this.effects.filter((e) => {
      if (e.ttl > 0) return true;
      e.node.destroy({ children: true });
      return false;
    });
    if (this.shake > 0) this.shake--;
    if (this.flashTicks > 0) this.flashTicks--;
    if (this.staticTicks > 0) this.staticTicks--;
    if (this.goTicks > 0) this.goTicks--;
    for (let i = 0; i < 4; i++) if (this.comboTimers[i]! > 0) this.comboTimers[i]!--;
    const auto = this.sim.segment().layers;
    this.drift += 1;
    void auto;
    void sim;
  }

  private spark(x: number, y: number, z: number, power: number): void {
    const g = new Graphics();
    const r = Math.min(12, 4 + power / 3);
    g.star(0, 0, 5, r, r / 2.4).fill(0xffffff);
    g.star(0, 0, 5, r * 0.6, r / 4).fill(this.opts.gore ? 0xf04a3a : 0xffd93a);
    this.effects.push({ node: g, ttl: 7, vy: 0, ent: -1, ox: x, oy: y - z, world: true });
    this.fx.addChild(g);
  }

  /** Gore option: six red drops burst from a KO'd actor. Display only. */
  private splatter(e: number): void {
    const c = this.sim.c;
    const g = new Graphics();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.circle(Math.cos(a) * 9, Math.sin(a) * 6 - 18, 2 + (i % 3)).fill(0xc02030);
    }
    g.label = "gore-splatter";
    const ox = c.x[e]! / FX;
    const oy = c.y[e]! / FX - c.z[e]! / FX;
    this.effects.push({ node: g, ttl: 40, vy: 0.15, ent: -1, ox, oy, world: true });
    this.fx.addChild(g);
  }

  private crack(x: number, y: number): void {
    const g = new Graphics();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
      const len = 30 + Math.random() * 40;
      g.moveTo(0, 0).lineTo(Math.cos(a) * len, Math.sin(a) * len);
    }
    g.stroke({ color: 0xffffff, width: 1, alpha: 0.9 });
    g.position.set(x, y);
    this.effects.push({ node: g, ttl: 60, vy: 0, ent: -1, ox: 0, oy: 0, world: false });
    this.overlay.addChild(g);
  }

  private addText(ev: Extract<SimEvent, { t: "text" }>): void {
    const color = ev.color ? hexNum(ev.color) : 0xffffff;
    if (ev.kind === "banner") {
      const c = new Container();
      const lab = new Label(ev.text, { color: 0xffd93a, align: "center", maxWidth: 440 });
      const h = lab.height + 8;
      const bgr = new Graphics().rect(0, -4, VIEW_W, h).fill({ color: 0x1a1420, alpha: 0.8 });
      lab.position.set(VIEW_W / 2, 0);
      c.addChild(bgr, lab);
      // Below the HUD panels and combo counters, above GO (y 120) and the continue box.
      c.position.set(0, BANNER_Y);
      c.label = "hud-banner";
      // Replace an existing banner.
      for (const e of this.effects)
        if ((e.node as Container & { banner?: boolean }).banner) e.ttl = 0;
      (c as Container & { banner?: boolean }).banner = true;
      this.effects.push({
        node: c,
        ttl: ev.ticks,
        vy: 0,
        ent: -1,
        ox: 0,
        oy: BANNER_Y,
        world: false,
      });
      this.overlay.addChild(c);
      return;
    }
    if (ev.kind === "bulletin") {
      const c = new Container();
      const tv = new Graphics()
        .roundRect(0, 0, 54, 44, 4)
        .fill(0x4a4658)
        .rect(5, 5, 44, 32)
        .fill(0x1e3a8a)
        .circle(27, 20, 9)
        .fill(0xffd0a8)
        .rect(22, 13, 10, 3)
        .fill(0x2e2a3a)
        .rect(17, 29, 20, 8)
        .fill(0x2e2a3a)
        .rect(25, 29, 4, 6)
        .fill(0xc02030);
      const box = new Graphics().rect(56, 6, 300, 34).fill({ color: 0x1a1420, alpha: 0.85 });
      const name = new Label("DIRK HEADLINE: LIVE", { color: 0xf04a3a });
      name.position.set(62, 8);
      const lab = new Label(ev.text, { color: 0xffffff, maxWidth: 288 });
      lab.position.set(62, 19);
      c.addChild(tv, box, name, lab);
      c.position.set(8, 212);
      this.effects.push({ node: c, ttl: ev.ticks, vy: 0, ent: -1, ox: 8, oy: 212, world: false });
      this.overlay.addChild(c);
      return;
    }
    if (ev.kind === "big") {
      const lab = new Label(ev.text, { color, scale: 2, align: "center" });
      const x = ev.x !== undefined ? ev.x : this.sim.g.camX / FX + VIEW_W / 2;
      this.effects.push({
        node: lab,
        ttl: ev.ticks,
        vy: -0.3,
        ent: -1,
        ox: x,
        oy: 90,
        world: true,
      });
      this.fx.addChild(lab);
      return;
    }
    if (ev.kind === "bubble") {
      const c = new Container();
      const lab = new Label(ev.text, {
        color: 0x1a1420,
        shadow: null,
        maxWidth: 150,
        align: "left",
      });
      const w = Math.min(160, lab.textWidth + 8);
      const h = lab.height + 6;
      const b = new Graphics()
        .rect(-2, -2, w + 4, h + 4)
        .fill(0x1a1420)
        .rect(0, 0, w, h)
        .fill(0xffffff)
        .poly([6, h, 14, h, 6, h + 6])
        .fill(0xffffff);
      lab.position.set(4, 3);
      c.addChild(b, lab);
      c.pivot.set(8, h + 60);
      this.effects.push({
        node: c,
        ttl: ev.ticks,
        vy: 0,
        ent: ev.ent ?? -1,
        ox: ev.x ?? 0,
        oy: ev.y ?? 0,
        world: true,
      });
      this.fx.addChild(c);
      return;
    }
    const lab = new Label(ev.text, { color, align: "center" });
    this.effects.push({
      node: lab,
      ttl: ev.ticks,
      vy: -0.4,
      ent: -1,
      ox: ev.x ?? this.sim.g.camX / FX + VIEW_W / 2,
      oy: (ev.y ?? 150) - 60,
      world: true,
    });
    this.fx.addChild(lab);
  }

  // ------------------------------------------------------------------ frame

  update(alpha: number): void {
    const sim = this.sim;
    const g = sim.g;
    if (this.segBuilt !== g.seg) this.buildLayers();
    const camX = (sim.prevCamX + (g.camX - sim.prevCamX) * alpha) / FX;
    const camY = (sim.prevCamY + (g.camY - sim.prevCamY) * alpha) / FX;
    const sx =
      this.shake > 0 ? Math.round((Math.random() * 2 - 1) * Math.min(3, 1 + this.shake / 6)) : 0;
    const sy =
      this.shake > 0 ? Math.round((Math.random() * 2 - 1) * Math.min(2, 1 + this.shake / 8)) : 0;
    for (const l of this.layers) {
      const off = camX * l.ref.speedX - this.drift * l.ref.drift;
      if (l.node instanceof TilingSprite) {
        l.node.tilePosition.x = -Math.round(off);
        l.node.tilePosition.y = Math.round(camY * l.ref.speedY);
        l.node.x = sx;
        l.node.y = l.ref.y + sy;
      } else {
        l.node.x = -Math.round(off) + sx;
        l.node.y = l.ref.y + Math.round(camY * l.ref.speedY) + sy;
      }
    }
    this.world.position.set(sx - Math.round(camX), sy);
    this.fx.position.set(sx - Math.round(camX), sy);
    this.drawEntities(alpha);
    this.drawRail(camX);
    for (const e of this.effects) {
      if (e.world) {
        if (e.ent >= 0 && sim.world.alive[e.ent]) {
          e.ox = sim.c.x[e.ent]! / FX;
          e.oy = sim.c.y[e.ent]! / FX - sim.c.z[e.ent]! / FX;
        }
        e.oy += e.vy;
        let x = e.ox;
        // Keep speech bubbles on screen.
        if (e.ent >= 0 || e.node.pivot.y > 0) {
          const w = e.node.width;
          x = Math.max(
            camX + 4 + e.node.pivot.x,
            Math.min(camX + VIEW_W - w + e.node.pivot.x - 4, x),
          );
        }
        e.node.position.set(Math.round(x), Math.round(e.oy));
      }
    }
    this.flash.clear();
    if (this.flashTicks > 0)
      this.flash.rect(0, 0, VIEW_W, VIEW_H).fill({ color: 0xffffff, alpha: 0.6 });
    this.staticG.clear();
    if (this.staticTicks > 0) {
      for (let i = 0; i < 180; i++)
        this.staticG
          .rect(
            Math.random() * VIEW_W,
            Math.random() * VIEW_H,
            2 + Math.random() * 20,
            1 + Math.random() * 2,
          )
          .fill({ color: Math.random() < 0.5 ? 0xffffff : 0x4a4658, alpha: 0.8 });
    }
    this.updateHud();
  }

  private drawRail(camX: number): void {
    const g = this.sim.g;
    this.railG.clear();
    if (!g.flags.arenaId || g.flags.railX === undefined) return;
    const x = Math.round((g.flags.railX ?? 0) / FX - camX);
    const y = Math.round((g.flags.railY ?? 0) / FX);
    this.railG.rect(0, 20, VIEW_W, 3).fill(0x6e6a7e);
    this.railG
      .roundRect(x - 12, 14, 24, 14, 3)
      .fill(0x9a96a8)
      .rect(x - 3, 26, 6, 8)
      .fill(0x4a4658);
    if ((g.flags.railTell ?? 0) > 0 && (g.tick >> 2) % 2 === 0) {
      this.railG.ellipse(x, y, 14, 5).stroke({ color: 0xf04a3a, width: 2 });
      this.railG.rect(x - 1, 34, 2, y - 34).fill({ color: 0xf04a3a, alpha: 0.5 });
    }
  }

  private paletteFor(e: number): string {
    const sim = this.sim;
    const d = sim.def(e);
    const c = sim.c;
    if (d.player) {
      const alts = sim.content.raw.characters[d.id]?.file.altPalettes ?? [];
      const v = c.variant[e]!;
      return v > 0 && alts[v - 1] ? alts[v - 1]! : d.palette;
    }
    if (d.enemy) return d.enemy.tiers[Math.min(c.tier[e]!, d.enemy.tiers.length - 1)]!.palette;
    return d.palette;
  }

  private drawEntities(alpha: number): void {
    const sim = this.sim;
    const c = sim.c;
    const seen = new Set<number>();
    for (let e = 0; e < sim.world.high; e++) {
      if (!sim.world.alive[e]) continue;
      const defIdx = c.def[e]!;
      let v = this.views.get(e);
      if (v && v.defIndex !== defIdx) {
        v.destroy({ children: true });
        this.views.delete(e);
        v = undefined;
      }
      if (!v) {
        v = new EntityView(defIdx);
        this.views.set(e, v);
        this.world.addChild(v);
      }
      seen.add(e);
      this.drawOne(e, v, alpha);
    }
    for (const [e, v] of this.views) {
      if (!seen.has(e)) {
        v.destroy({ children: true });
        this.views.delete(e);
      }
    }
  }

  private drawOne(e: number, v: EntityView, alpha: number): void {
    const sim = this.sim;
    const c = sim.c;
    const d = sim.def(e);
    const kind = c.kind[e]!;
    const ix = (sim.prevX[e]! + (c.x[e]! - sim.prevX[e]!) * alpha) / FX;
    const iy = (sim.prevY[e]! + (c.y[e]! - sim.prevY[e]!) * alpha) / FX;
    const iz = (sim.prevZ[e]! + (c.z[e]! - sim.prevZ[e]!) * alpha) / FX;
    const hidden = (c.flags[e]! & F.hidden) !== 0;
    v.visible = !hidden;
    if (hidden) return;
    const f = sim.frame(e);
    let pose = f.pose;
    if (
      kind === KIND.player &&
      !c.impro[e] &&
      this.assets.sheets.get(d.sheet)?.frames[`${pose}~bare`]
    )
      pose = `${pose}~bare`;
    if (
      kind === KIND.prop &&
      c.variant[e] === 1 &&
      this.assets.sheets.get("items")?.frames[`${d.id}:broken`]
    )
      pose = `${d.id}:broken`;
    if (
      kind === KIND.prop &&
      c.variant[e] === 2 &&
      this.assets.sheets.get("items")?.frames[`${d.id}:f1`]
    )
      pose = `${d.id}:f1`;
    const fr = this.assets.frame(d.sheet, pose, this.paletteFor(e));
    if (!fr) {
      v.visible = false;
      return;
    }
    const { tex, meta } = fr;
    const body = v.body;
    body.texture = tex;
    body.anchor.set(meta.ax / meta.w, meta.ay / meta.h);
    const facing = c.facing[e]! || 1;
    let scale = 1;
    if (c.tiny[e]) scale = 0.5;
    if (kind === KIND.projectile) scale = (c.scale[e]! || 100) / 100;
    if (c.flags[e]! & F.camFly)
      scale = 1 + (sim.world.has("camFly") ? sim.world.get<Uint16Array>("camFly")[e]! / 12 : 0);
    body.scale.set(facing * scale, scale);
    body.rotation = kind === KIND.projectile && d.projectile?.spin ? (sim.g.tick / 3) * facing : 0;
    let bx = 0;
    if (c.hitstop[e]! > 0 && (kind === KIND.enemy || kind === KIND.player || kind === KIND.boss))
      bx = sim.g.tick % 2 ? 1 : -1;
    body.position.set(bx, -Math.round(iz));
    // Blink while invulnerable after a respawn or getup, and while a KO fades.
    let a = 1;
    if (c.invuln[e]! > 0 && (sim.g.tick >> 2) % 2 === 0) a = 0.35;
    if (sim.stateKind(e) === SK.ko && c.stick[e]! > 40 && (sim.g.tick >> 2) % 2 === 0) a = 0.2;
    if (c.flags[e]! & F.emerging) a = 0.7;
    body.alpha = a;
    v.position.set(Math.round(ix), Math.round(iy));
    v.zIndex =
      Math.round(iy * 4) + (kind === KIND.prop ? -2 : 0) + (c.flags[e]! & F.camFly ? 2000 : 0);

    // Shadow.
    v.shadow.clear();
    if (this.sim.stage.skin.shadow !== "none" && kind !== KIND.prop) {
      const base = (10 * d.shadowPct * d.scalePct) / 10000;
      const shrink = Math.max(0.4, 1 - iz / 120);
      v.shadow
        .ellipse(0, 0, Math.max(3, base * shrink), Math.max(1.5, base * 0.32 * shrink))
        .fill({ color: 0x000000, alpha: 0.35 });
    }

    // Weapon in hand.
    const w = c.weapon[e]!;
    if (w > 0 && (kind === KIND.player || kind === KIND.enemy)) {
      const ws = sim.content.weapons[w - 1]!;
      const wf = this.assets.frame("items", `weapon:${ws.id}`, "items-a");
      if (wf) {
        if (!v.weapon) {
          v.weapon = new Sprite();
          v.addChild(v.weapon);
        }
        v.weapon.visible = true;
        v.weapon.texture = wf.tex;
        v.weapon.anchor.set(wf.meta.ax / wf.meta.w, wf.meta.ay / wf.meta.h);
        const hx = (meta.hand[0] - meta.ax) * scale;
        const hy = (meta.hand[1] - meta.ay) * scale;
        v.weapon.position.set(bx + hx * facing, hy - Math.round(iz));
        v.weapon.scale.set(facing * scale, scale);
        v.weapon.rotation = meta.handAngle * Math.PI * 2 * facing;
      }
    } else if (v.weapon) v.weapon.visible = false;

    // Deadweight Dave's costume hat.
    const costume = c.flags[e]! & F.firstEnemy ? COSTUMES[c.variant[e]!] : undefined;
    if (costume && costume !== "none") {
      const hf = this.assets.frame("items", `hat-${costume}`, "items-a");
      if (hf) {
        if (!v.hat) {
          v.hat = new Sprite();
          v.addChild(v.hat);
        }
        v.hat.texture = hf.tex;
        v.hat.anchor.set(hf.meta.ax / hf.meta.w, 0.75);
        v.hat.position.set(
          bx + (meta.head[0] - meta.ax) * facing,
          meta.head[1] - meta.ay - Math.round(iz) - 2,
        );
        v.hat.scale.set(facing, 1);
      }
    }

    // Surfboards under players on the auto-scroll surf, the tow truck on a towed boss.
    const surf = kind === KIND.player && (sim.g.flags.surf ?? 0) > 0;
    const tow = (c.flags[e]! & F.towing) !== 0;
    if (surf || tow) {
      const xf = this.assets.frame("items", surf ? "manhole-surf" : "tow-truck", "items-a");
      if (xf) {
        if (!v.extra) {
          v.extra = new Sprite();
          v.addChildAt(v.extra, 1);
        }
        v.extra.visible = true;
        v.extra.texture = xf.tex;
        v.extra.anchor.set(xf.meta.ax / xf.meta.w, xf.meta.ay / xf.meta.h);
        v.extra.position.set(tow ? 50 : 0, surf ? -Math.round(iz) + 2 : 0);
      }
    } else if (v.extra) v.extra.visible = false;

    // VP name badge.
    if (kind === KIND.enemy && c.flags[e]! & F.miniBoss) {
      const tier = d.enemy!.tiers[Math.min(c.tier[e]!, d.enemy!.tiers.length - 1)]!;
      if (!v.badge) {
        v.badge = new Label("VP", { color: 0xffd93a, align: "center" });
        v.addChild(v.badge);
      }
      void tier;
      v.badge.position.set(0, meta.ay > 0 ? -meta.ay - Math.round(iz) - 12 : -70);
    }
  }

  // ------------------------------------------------------------------ HUD

  private buildHud(): void {
    for (let i = 0; i < 4; i++) {
      const root = new Container();
      root.position.set(4 + i * 119, 3);
      root.label = `hud-panel-${i}`;
      const name = new Label("", { color: SLOT_COLORS[i] });
      const score = new Label("", { color: 0xf4f0e8 });
      score.position.set(0, 9);
      const bar = new Graphics();
      bar.position.set(0, 19);
      const lives = new Label("", { color: 0xf4f0e8 });
      lives.position.set(88, 0);
      lives.label = `hud-lives-${i}`;
      const info = new Label("", { color: 0x8ad0ff });
      info.position.set(0, 26);
      info.label = `hud-info-${i}`;
      root.addChild(name, score, bar, lives, info);
      this.hud.addChild(root);
      this.panels.push({ root, name, score, lives, info, bar });
      // Under the weapon line, which can be as wide as the panel.
      const combo = new Label("", { color: 0xffd93a });
      combo.position.set(4 + i * 119 + 4, 39);
      combo.label = `hud-combo-${i}`;
      this.comboLabels.push(combo);
      this.hud.addChild(combo);
    }
    this.credits.position.set(VIEW_W - 90, VIEW_H - 10);
    this.bossName.position.set(100, VIEW_H - 22);
    this.hud.addChild(this.credits, this.bossBar, this.bossName);
    const box = new Graphics()
      .rect(-160, -26, 320, 52)
      .fill({ color: 0x1a1420, alpha: 0.9 })
      .rect(-160, -26, 320, 2)
      .fill(0xffd93a);
    this.contText.position.set(0, -20);
    this.contBox.addChild(box, this.contText);
    this.contBox.position.set(VIEW_W / 2, 150);
    this.hud.addChild(this.contBox);
    this.goLabel.position.set(VIEW_W - 90, 120);
    this.goLabel.label = "hud-go";
    this.hud.addChild(this.goLabel);
  }

  private updateHud(): void {
    const sim = this.sim;
    const g = sim.g;
    const c = sim.c;
    const blink = (g.tick >> 5) % 2 === 0;
    let contShown = false;
    g.players.forEach((p, i) => {
      const pv = this.panels[i]!;
      pv.bar.clear();
      pv.info.set("");
      const d = p.def >= 0 ? sim.content.defs[p.def] : undefined;
      switch (p.status) {
        case SLOT.empty:
          pv.name.set(blink ? "PRESS START" : "");
          pv.score.set("");
          pv.lives.set("");
          break;
        case SLOT.picking: {
          const cd = sim.content.defs[sim.content.roster[p.cursor]!]!;
          pv.name.set(`< ${cd.player?.shortName ?? cd.id} >`);
          pv.score.set("PICK!");
          pv.lives.set("");
          break;
        }
        case SLOT.playing: {
          pv.name.set(d?.player?.shortName ?? "");
          pv.score.set(String(p.score).padStart(7, "0"));
          pv.lives.set(`×${Math.max(0, p.lives)}`);
          const e = p.ent;
          if (e >= 0 && sim.world.alive[e]) {
            const pct = Math.max(0, c.hp[e]! / Math.max(1, c.maxHp[e]!));
            pv.bar
              .rect(0, 0, 104, 5)
              .fill(0x1a1420)
              .rect(1, 1, Math.round(102 * pct), 3)
              .fill(pct > 0.3 ? 0xffd93a : 0xf04a3a);
            for (let s = 1; s < 8; s++)
              pv.bar.rect(1 + s * 13, 1, 1, 3).fill({ color: 0x1a1420, alpha: 0.6 });
            const w = c.weapon[e]!;
            if (w > 0) pv.info.set(`${sim.content.weapons[w - 1]!.displayName} ${c.weaponHits[e]}`);
            else if (c.tiny[e]) pv.info.set("8-BIT!");
            else if (d?.player?.improvised && d.player.improvised.hits > 0)
              pv.info.set(
                c.impro[e]
                  ? `${d.player.improvised.name} ${c.improHits[e]}`
                  : `NO ${d.player.improvised.name}`,
              );
          }
          break;
        }
        case SLOT.continue:
          pv.name.set(d?.player?.shortName ?? "");
          pv.score.set(`CONTINUE? ${Math.ceil(p.contTimer / 60)}`);
          pv.lives.set("");
          if (!contShown && d?.player) {
            contShown = true;
            this.contText.set(
              `${d.player.shortName}: "${d.player.voice.continueLine}"\nPRESS START   ${Math.ceil(p.contTimer / 60)}`,
            );
          }
          break;
        case SLOT.out:
          pv.name.set("GAME OVER");
          pv.score.set(String(p.score).padStart(7, "0"));
          pv.lives.set("");
          break;
      }
      this.comboLabels[i]!.visible = this.comboTimers[i]! > 0;
    });
    this.contBox.visible = contShown;
    this.credits.set(g.credits < 0 ? "FREE PLAY" : `CREDITS ${g.credits}`);
    // Boss bar.
    this.bossBar.clear();
    const bosses = g.bosses.filter(
      (b) => sim.world.alive[b] && c.kind[b] === KIND.boss && !(c.flags[b]! & F.towing),
    );
    let miniBoss = -1;
    if (bosses.length === 0)
      for (let e = 0; e < sim.world.high; e++)
        if (sim.world.alive[e] && c.flags[e]! & F.miniBoss && c.kind[e] === KIND.enemy)
          miniBoss = e;
    const shown = bosses.length ? bosses : miniBoss >= 0 ? [miniBoss] : [];
    if (shown.length && g.phase !== PHASE.bossIntro) {
      let hp = 0;
      let max = 0;
      for (const b of shown) {
        hp += Math.max(0, c.hp[b]!);
        max += c.maxHp[b]!;
      }
      const d = sim.def(shown[0]!);
      const name =
        bosses.length > 1
          ? bosses.map((b) => sim.def(b).displayName.toUpperCase()).join(" & ")
          : d.enemy
            ? d.enemy.tiers[
                Math.min(c.tier[shown[0]!]!, d.enemy.tiers.length - 1)
              ]!.displayName.toUpperCase()
            : d.displayName.toUpperCase();
      this.bossName.set(name);
      this.bossName.visible = true;
      this.bossBar
        .rect(100, VIEW_H - 12, 280, 7)
        .fill(0x1a1420)
        .rect(101, VIEW_H - 11, Math.round(278 * (hp / Math.max(1, max))), 5)
        .fill(0xf04a3a);
    } else this.bossName.visible = false;
    this.goLabel.visible = this.goTicks > 0 && (g.tick >> 3) % 2 === 0 && g.phase === PHASE.play;
    if (this.debug) this.debug.position.set(4, 40);
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
