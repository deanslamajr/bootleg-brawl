// Controls: remaps one keyboard layout or the pad buttons. Pick an action, then press the new
// key or button. Escape stays the pause key and cancels a capture, and so does the touch PAUSE
// button, so a player with no keyboard can leave a capture.

import { Container, Graphics } from "pixi.js";
import { IN, VIEW_H, VIEW_W } from "@bb/engine";
import { ACTIONS, keyName, type Action } from "@bb/engine/input";
import type { GameApp, Scene } from "../app";
import { C, Menu, label } from "../ui";

/** A keyboard layout index, or "pad" for the shared pad buttons. */
export type ControlsTarget = 0 | 1 | "pad";

export class ControlsScene implements Scene {
  readonly name = "controls";
  readonly root = new Container();
  private readonly menu: Menu;
  private readonly prompt = label("", VIEW_W / 2, 226, { color: C.yellow, align: "center" });
  private readonly note = label("", VIEW_W / 2, 238, {
    color: C.pink,
    align: "center",
    maxWidth: 460,
  });
  private capturing: Action | null = null;

  constructor(
    private readonly app: GameApp,
    private readonly target: ControlsTarget,
  ) {
    const title = target === "pad" ? "CONTROLS PAD" : `CONTROLS P${target + 1}`;
    this.menu = new Menu(
      [
        ...ACTIONS.map((a) => ({
          label: () => `${a.toUpperCase().padEnd(10)}${this.bound(a)}`,
          select: () => this.capture(a),
        })),
        { label: () => "BACK", select: () => void this.back() },
      ],
      15,
    );
    this.menu.position.set(120, 50);
    this.menu.label = "controls-menu";
    this.root.addChild(
      new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill(0x1a1420),
      label(title, VIEW_W / 2, 18, { color: C.yellow, scale: 2, align: "center" }),
      this.menu,
      this.prompt,
      this.note,
      label("ESC IS ALWAYS PAUSE. TAUNT: BACK", VIEW_W / 2, 256, {
        color: C.gray,
        align: "center",
      }),
    );
  }

  status(): Record<string, unknown> {
    return {
      target: this.target === "pad" ? "pad" : `p${this.target + 1}`,
      capturing: this.capturing ?? "",
    };
  }

  private bound(a: Action): string {
    if (this.target === "pad") {
      const b = this.app.input.pad[a];
      return b.length ? b.map((i) => `B${i}`).join(" ") : "NONE";
    }
    const k = this.app.input.keys[this.target]![a];
    return k.length ? k.map(keyName).join(" ") : "NONE";
  }

  private capture(a: Action): void {
    this.capturing = a;
    // Drop the press that selected the row.
    this.app.input.takeLastKey();
    this.app.input.takeLastPadButton();
    this.prompt.set(this.target === "pad" ? "PRESS A PAD BUTTON" : "PRESS A KEY");
    this.note.set("");
  }

  private endCapture(note = ""): void {
    this.capturing = null;
    this.prompt.set("");
    this.note.set(note);
    this.menu.refresh();
  }

  /** What Escape does here: cancel an open capture. */
  escape(): void {
    if (this.capturing) this.endCapture();
  }

  tick(): void {
    const input = this.app.input;
    const a = this.capturing;
    if (a) {
      const key = input.takeLastKey();
      if (key === "Escape") return this.endCapture();
      if (this.target === "pad") {
        const b = input.takeLastPadButton();
        if (b === null) return;
        const from = input.setPadButton(a, b);
        this.app.sfx("confirm");
        return this.endCapture(
          from ? `B${b} MOVED FROM ${from.toUpperCase()} TO ${a.toUpperCase()}.` : "",
        );
      }
      if (!key) return;
      const from = input.setKey(this.target, a, key);
      this.app.sfx("confirm");
      const where = from && from.layout !== this.target ? `P${from.layout + 1} ` : "";
      return this.endCapture(
        from
          ? `${keyName(key)} MOVED FROM ${where}${from.action.toUpperCase()} TO ${a.toUpperCase()}.`
          : "",
      );
    }
    const slot = input.anyPressed(0x3ff);
    if (slot < 0) return;
    const p = input.pressed(slot);
    if (p & IN.TAUNT) return void this.back();
    if (this.menu.handle(p)) this.app.sfx("select");
  }

  private async back(): Promise<void> {
    const { OptionsScene } = await import("./options");
    await this.app.setScene(new OptionsScene(this.app));
  }
}
