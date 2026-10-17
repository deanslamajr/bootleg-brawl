// Credits roll. After the v1 ending it runs over the family still inside the cabinet.

import { Container, Graphics } from "pixi.js";
import { IN, VIEW_H, VIEW_W } from "@bb/engine";
import type { GameApp, Scene } from "../app";
import { saveRun } from "../settings";
import { C, label } from "../ui";

export class CreditsScene implements Scene {
  readonly name = "credits";
  readonly root = new Container();
  private readonly roll = new Container();
  private t = 0;
  private end = 0;

  constructor(
    private readonly app: GameApp,
    ending = false,
  ) {
    if (ending) saveRun(null);
    this.root.addChild(new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill(0x1a1420), this.roll);
    const lines: [string, number][] = [];
    if (ending) {
      lines.push(["THE END??", C.yellow], ["NO. 996 GAMES REMAIN.", C.pink], ["", 0]);
      for (const id of app.content.raw.roster.rosterOrder) {
        const c = app.content.raw.characters[id];
        if (c && app.run?.party.includes(id))
          lines.push([c.file.voice.endingText, C.white], ["", 0]);
      }
    }
    for (const l of app.content.raw.campaign.credits) lines.push([l, C.white], ["", 0]);
    lines.push(["INSERT COIN", C.yellow]);
    let y = VIEW_H + 10;
    for (const [text, color] of lines) {
      if (text)
        this.roll.addChild(label(text, VIEW_W / 2, y, { color, align: "center", maxWidth: 420 }));
      y += text.length > 50 ? 26 : 16;
    }
    this.end = y + 40;
  }

  enter(): void {
    this.app.music("ending");
  }

  status(): Record<string, unknown> {
    return { t: this.t };
  }

  tick(): void {
    this.t++;
    this.roll.y = -Math.floor(this.t / 2);
    if (this.t / 2 > this.end || (this.t > 60 && this.app.input.anyPressed(IN.START) >= 0))
      void this.back();
  }

  private async back(): Promise<void> {
    this.t = -99999;
    const { TitleScene } = await import("./title");
    await this.app.setScene(new TitleScene(this.app));
  }
}
