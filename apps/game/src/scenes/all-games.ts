// GAME SELECT: ALL (debug builds, ?debug): every stage in the manifest, including ones not in
// the campaign yet, so backlog stages can be playtested before they are wired in.

import { Container, Graphics } from "pixi.js";
import { IN, VIEW_H, VIEW_W } from "@bb/engine";
import type { GameApp, Scene } from "../app";
import { C, Menu, label } from "../ui";

export class AllGamesScene implements Scene {
  readonly name = "all-games";
  readonly root = new Container();
  private readonly menu: Menu;

  constructor(private readonly app: GameApp) {
    const stages = Object.values(app.content.raw.stages).sort(
      (a, b) => a.file.gameNumber - b.file.gameNumber,
    );
    const inCampaign = new Set(app.content.raw.campaign.nodes.map((n) => n.stageId));
    this.menu = new Menu(
      stages.map((s) => ({
        label: () =>
          `GAME ${s.file.gameNumber}: ${s.file.titleCard.title}${inCampaign.has(s.file.id) ? "" : " (NOT IN CAMPAIGN)"}`,
        select: () => void this.pick(s.file.id),
      })),
    );
    this.menu.position.set(30, 50);
    this.root.addChild(
      new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill(0x0e1a4a),
      label("GAME SELECT: ALL", VIEW_W / 2, 16, { color: C.yellow, scale: 2, align: "center" }),
      this.menu,
    );
  }

  tick(): void {
    const slot = this.app.input.anyPressed(0x3ff);
    if (slot < 0) return;
    const p = this.app.input.pressed(slot);
    if (this.menu.handle(p)) this.app.sfx("select");
    if (p & IN.TAUNT) void this.back();
  }

  private async pick(id: string): Promise<void> {
    this.app.pendingStage = id;
    const { SelectScene } = await import("./select");
    await this.app.setScene(new SelectScene(this.app));
  }

  private async back(): Promise<void> {
    const { TitleScene } = await import("./title");
    await this.app.setScene(new TitleScene(this.app));
  }
}
