// Options: difficulty preset, friendly fire, cabinet mode, volumes, controls reset.

import { Container, Graphics } from "pixi.js";
import { IN, VIEW_H, VIEW_W, type Difficulty, type FriendlyFire } from "@bb/engine";
import type { GameApp, Scene } from "../app";
import { C, Menu, label } from "../ui";

const DIFFS: Difficulty[] = ["casual", "arcade", "1-credit"];
const FF: FriendlyFire[] = ["off", "weapons", "chaos"];

export class OptionsScene implements Scene {
  readonly name = "options";
  readonly root = new Container();
  private readonly menu: Menu;

  constructor(private readonly app: GameApp) {
    const s = app.settings;
    const cycle = <T>(list: T[], cur: T, dir: number) =>
      list[(list.indexOf(cur) + dir + list.length) % list.length]!;
    this.menu = new Menu(
      [
        {
          label: () => `DIFFICULTY      ${s.difficulty.toUpperCase()}`,
          change: (d) => (s.difficulty = cycle(DIFFS, s.difficulty, d)),
        },
        {
          label: () => `FRIENDLY FIRE   ${s.friendlyFire.toUpperCase()}`,
          change: (d) => (s.friendlyFire = cycle(FF, s.friendlyFire, d)),
        },
        {
          label: () => `CABINET MODE    ${s.cabinetMode ? "ON" : "OFF"}`,
          change: () => (s.cabinetMode = !s.cabinetMode),
        },
        {
          label: () => `MUSIC           ${Math.round(s.musicVolume * 10)}`,
          change: (d) => (s.musicVolume = Math.max(0, Math.min(1, s.musicVolume + d / 10))),
        },
        {
          label: () => `SOUND           ${Math.round(s.sfxVolume * 10)}`,
          change: (d) => (s.sfxVolume = Math.max(0, Math.min(1, s.sfxVolume + d / 10))),
        },
        { label: () => "RESET CONTROLS", select: () => app.input.resetKeys() },
        { label: () => "BACK", select: () => void this.back() },
      ],
      16,
    );
    this.menu.position.set(110, 70);
    const bg = new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill(0x1a1420);
    this.root.addChild(
      bg,
      label("OPTIONS", VIEW_W / 2, 30, { color: C.yellow, scale: 2, align: "center" }),
      this.menu,
      label(
        "P1: WASD MOVE  J ATTACK  K JUMP  J+K OR U SPECIAL  L TAUNT  ENTER START",
        VIEW_W / 2,
        210,
        { color: C.gray, align: "center", maxWidth: 460 },
      ),
      label("P2: ARROWS  NUMPAD 1/2/3 (OR , . /)  PADS: PRESS START TO JOIN", VIEW_W / 2, 230, {
        color: C.gray,
        align: "center",
        maxWidth: 460,
      }),
      label("CASUAL: UNLIMITED CONTINUES. 1-CREDIT: GOOD LUCKY.", VIEW_W / 2, 250, {
        color: C.pink,
        align: "center",
      }),
    );
  }

  tick(): void {
    const slot = this.app.input.anyPressed(0x3ff);
    if (slot < 0) return;
    const p = this.app.input.pressed(slot);
    if (this.menu.handle(p)) {
      this.app.sfx("select");
      this.app.saveSettings();
    }
    if (p & IN.TAUNT) void this.back();
  }

  private async back(): Promise<void> {
    this.app.saveSettings();
    const { TitleScene } = await import("./title");
    await this.app.setScene(new TitleScene(this.app));
  }
}
