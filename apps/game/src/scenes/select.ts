// Character select: each player slot owns a card and scrolls the roster behind it, so the
// roster can grow past four without leaving the screen (D84). Hot-join with Start; cabinet
// mode locks each slot to a character like the four-player cabinets did.

import { Container, Graphics, Sprite, type Texture } from "pixi.js";
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
  lidd: "SHELL: NOT FOUND",
};
/** Card i sits where the v1 four-card row put it, so the layout test still holds. */
const cardX = (i: number): number => 30 + i * 108;
/** The portrait fits between the name and the archetype line. */
const PORTRAIT_H = 60;

interface SlotState {
  joined: boolean;
  cursor: number;
  ready: boolean;
}

interface SlotCard {
  x: number;
  card: Graphics;
  name: Label;
  portrait: Sprite;
  archetype: Label;
  stat: Label;
  page: Label;
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
  private readonly cards: SlotCard[] = [];
  private readonly portraits = new Map<string, Texture>();
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
    for (let i = 0; i < 4; i++) this.cards.push(this.makeCard(i));
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
    for (const id of this.roster)
      void app.assets.portrait(id).then((t) => {
        if (!t || this.root.destroyed) return;
        this.portraits.set(id, t);
        this.refresh();
      });
    this.refresh();
  }

  private makeCard(i: number): SlotCard {
    const x = cardX(i);
    const card = new Graphics()
      .rect(x, 40, 96, 120)
      .fill(0x2e2a3a)
      .rect(x, 40, 96, 2)
      .fill(SLOT_COLORS[i]!);
    card.label = `select-card-${i}`;
    const name = label("", x + 48, 46, { color: C.white, align: "center" });
    const portrait = new Sprite();
    portrait.visible = false;
    const archetype = label("", x + 48, 120, { color: C.gray, align: "center" });
    // The card is 96 px wide; a long stat wraps to a second line at y 142.
    const stat = label("", x + 48, 132, { color: C.pink, align: "center", maxWidth: 92 });
    stat.label = `select-stat-${i}`;
    const page = label("", x + 48, 151, { color: C.gray, align: "center" });
    this.root.addChild(card, portrait, name, archetype, stat, page);
    return { x, card, name, portrait, archetype, stat, page };
  }

  /** Writes every card from its slot: the character under the cursor, or the join prompt. */
  private refresh(): void {
    const cab = this.app.settings.cabinetMode;
    const n = this.roster.length;
    this.slots.forEach((s, i) => {
      const c = this.cards[i]!;
      const id = this.roster[s.cursor]!;
      const d = this.app.content.defs[this.app.content.defIndex[id]!]!;
      c.card.alpha = s.joined ? 1 : 0.55;
      c.name.set(s.joined ? d.player!.shortName : `P${i + 1}`);
      c.archetype.set(s.joined ? d.player!.archetype.toUpperCase() : "");
      c.stat.set(s.joined ? (WRONG_STATS[id] ?? "STATS: YES") : "");
      c.page.set(s.joined && !cab && n > 1 ? `← ${s.cursor + 1}/${n} →` : "");
      const t = this.portraits.get(id);
      c.portrait.visible = s.joined && t !== undefined;
      if (t) {
        c.portrait.texture = t;
        const scale = Math.min(1.5, PORTRAIT_H / t.height);
        c.portrait.scale.set(scale);
        c.portrait.position.set(c.x + 48 - (t.width * scale) / 2, 58);
      }
    });
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
    this.refresh();
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
        const x = cardX(i);
        g.rect(x - 2, 38, 100, 124).stroke({ color: SLOT_COLORS[i]!, width: s.ready ? 2 : 1 });
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
