// Attract mode: the cabinet marquee, the Announcer's ticker, and the main menu.

import { Container, Graphics, Sprite } from "pixi.js";
import { IN, VIEW_H, VIEW_W, type InputFrame } from "@bb/engine";
import { Label } from "@bb/engine/render";
import type { GameApp, Scene } from "../app";
import { loadRun } from "../settings";
import { C, Marquee, Menu, label } from "../ui";

const PATTER =
  "WELCOME TO 999 GAMES IN 1. ALL OF THEM COUNTERFEIT. THE BABY ATE THE CHIP. PLEASE INSERT FAMILY. " +
  "PRESS START TO BE THE SIMPLETONS. GOOD LUCKY. © NOBODY. ALL RIGHTS RESERVE.";

export class TitleScene implements Scene {
  readonly name = "title";
  readonly root = new Container();
  private readonly marquee = new Marquee(PATTER);
  private readonly menu: Menu;
  private readonly press = label("PRESS START", VIEW_W / 2, 150, {
    color: C.white,
    align: "center",
  });
  private showMenu = false;
  private t = 0;
  private readonly stars = new Graphics();

  constructor(private readonly app: GameApp) {
    const hasRun = !!loadRun();
    this.menu = new Menu([
      { label: () => "NEW GAME", select: () => void this.newGame() },
      {
        label: () => "CONTINUE RUN",
        disabled: () => !hasRun,
        select: () => void this.continueRun(),
      },
      { label: () => "OPTIONS", select: () => void this.options() },
      { label: () => "CREDITS", select: () => void this.credits() },
      ...(app.debug
        ? [{ label: () => "GAME SELECT: ALL", select: () => void this.allGames() }]
        : []),
    ]);
    this.menu.position.set(VIEW_W / 2 - 60, 112);
    this.menu.visible = false;
    this.menu.label = "title-menu";
    const bg = new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill(0x1a1420);
    for (let i = 0; i < 12; i++)
      bg.rect(0, 40 + i * 6, VIEW_W, 3).fill({
        color: [0x3e1a6a, 0x6a2aa0, 0xd03a8a, 0xf04a3a][i % 4]!,
        alpha: 0.5,
      });
    const big = new Label("999-IN-1", { color: C.yellow, scale: 4, align: "center" });
    big.position.set(VIEW_W / 2, 30);
    const sub = new Label("THE BOOTLEG BRAWL", { color: C.white, scale: 2, align: "center" });
    sub.position.set(VIEW_W / 2, 74);
    const tag = new Label("NOW WITH 3 GAMES THAT LOAD", { color: C.pink, align: "center" });
    tag.position.set(VIEW_W / 2, 98);
    this.marquee.position.set(0, VIEW_H - 14);
    const copy = label("© NOBODY. ALL RIGHTS RESERVE.", VIEW_W / 2, VIEW_H - 28, {
      color: C.gray,
      align: "center",
    });
    this.root.addChild(bg, this.stars, big, sub, tag, this.press, this.menu, this.marquee, copy);
    void this.addFamily();
  }

  private async addFamily(): Promise<void> {
    const roster = this.app.content.raw.roster.rosterOrder;
    let x = 60;
    for (const [i, id] of roster.entries()) {
      const t = await this.app.assets.portrait(id);
      if (!t || this.root.destroyed) continue;
      // Below the menu's last row (the debug row ends at y 182), above the copyright at 242.
      const s = new Sprite(t);
      s.position.set(x, 192);
      s.label = `title-portrait-${i}`;
      x += 100;
      this.root.addChild(s);
    }
  }

  enter(): void {
    this.app.music("title");
  }

  tick(_inputs: InputFrame[]): void {
    this.t++;
    this.marquee.tick();
    this.press.visible = !this.showMenu && (this.t >> 5) % 2 === 0;
    const slot = this.app.input.anyPressed(
      IN.START | IN.ATTACK | IN.JUMP | IN.UP | IN.DOWN | IN.LEFT | IN.RIGHT,
    );
    if (slot < 0) return;
    if (!this.showMenu) {
      if (this.app.input.pressed(slot) & (IN.START | IN.ATTACK)) {
        this.showMenu = true;
        this.menu.visible = true;
        this.app.sfx("confirm");
      }
      return;
    }
    if (this.menu.handle(this.app.input.pressed(slot))) this.app.sfx("select");
  }

  private async newGame(): Promise<void> {
    const { SelectScene } = await import("./select");
    await this.app.setScene(new SelectScene(this.app));
  }

  private async continueRun(): Promise<void> {
    this.app.run = loadRun();
    const { goNext } = await import("../flow");
    await goNext(this.app);
  }

  private async options(): Promise<void> {
    const { OptionsScene } = await import("./options");
    await this.app.setScene(new OptionsScene(this.app));
  }

  private async allGames(): Promise<void> {
    const { AllGamesScene } = await import("./all-games");
    await this.app.setScene(new AllGamesScene(this.app));
  }

  private async credits(): Promise<void> {
    const { CreditsScene } = await import("./credits");
    await this.app.setScene(new CreditsScene(this.app));
  }
}
