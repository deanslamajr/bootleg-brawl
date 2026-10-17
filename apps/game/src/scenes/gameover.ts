import { Container, Graphics } from "pixi.js";
import { IN, VIEW_H, VIEW_W, type Sim } from "@bb/engine";
import type { GameApp, Scene } from "../app";
import { saveRun } from "../settings";
import { C, label } from "../ui";

export class GameOverScene implements Scene {
  readonly name = "gameover";
  readonly root = new Container();
  private t = 0;

  constructor(
    private readonly app: GameApp,
    sim: Sim,
  ) {
    saveRun(null);
    this.root.addChild(
      new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill(0x1a1420),
      label("GAME OVER", VIEW_W / 2, 70, { color: C.red, scale: 3, align: "center" }),
      label('ANNOUNCER: "THANK YOU FOR PLAYING. PLEASE TO INSERT COIN."', VIEW_W / 2, 120, {
        color: C.white,
        align: "center",
        maxWidth: 440,
      }),
    );
    sim.g.players.forEach((p, i) => {
      if (p.def < 0) return;
      const d = app.content.defs[p.def]!;
      this.root.addChild(
        label(
          `${d.player?.shortName ?? ""} ${String(p.score).padStart(7, "0")}`,
          40 + i * 110,
          170,
          { color: C.yellow },
        ),
      );
    });
  }

  enter(): void {
    this.app.music("stinger-gameover");
  }

  tick(): void {
    this.t++;
    if (this.t > 420 || (this.t > 60 && this.app.input.anyPressed(IN.START | IN.ATTACK) >= 0))
      void this.back();
  }

  private async back(): Promise<void> {
    this.t = -99999;
    const { TitleScene } = await import("./title");
    await this.app.setScene(new TitleScene(this.app));
  }
}
