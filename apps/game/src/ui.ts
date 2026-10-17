// Small UI kit on top of the bitmap font: boxes, menus and the marquee.

import { Container, Graphics } from "pixi.js";
import { IN, VIEW_W } from "@bb/engine";
import { Label } from "@bb/engine/render";

export const C = {
  ink: 0x1a1420,
  panel: 0x2e2a3a,
  white: 0xf4f0e8,
  yellow: 0xffd93a,
  red: 0xf04a3a,
  blue: 0x4aa0f0,
  green: 0x5ac04a,
  pink: 0xff8ac8,
  gray: 0x9a96a8,
};

export function box(w: number, h: number, color = C.panel, border = C.yellow): Graphics {
  return new Graphics()
    .rect(0, 0, w, h)
    .fill(C.ink)
    .rect(1, 1, w - 2, h - 2)
    .fill(color)
    .rect(1, 1, w - 2, 1)
    .fill(border);
}

export function label(
  text: string,
  x: number,
  y: number,
  opts: ConstructorParameters<typeof Label>[1] = {},
): Label {
  const l = new Label(text, opts);
  l.position.set(x, y);
  return l;
}

export interface MenuItem {
  label: () => string;
  /** Left/right changes the value. */
  change?: (dir: number) => void;
  select?: () => void;
  disabled?: () => boolean;
}

export class Menu extends Container {
  index = 0;
  private labels: Label[] = [];
  private readonly arrow = new Label("→", { color: C.yellow });

  constructor(
    readonly items: MenuItem[],
    readonly spacing = 14,
  ) {
    super();
    items.forEach((_, i) => {
      const l = new Label("", { color: C.white });
      l.position.set(12, i * spacing);
      this.labels.push(l);
      this.addChild(l);
    });
    this.addChild(this.arrow);
    this.refresh();
  }

  refresh(): void {
    this.items.forEach((it, i) => {
      const dis = it.disabled?.() ?? false;
      this.labels[i]!.set(it.label(), dis ? C.gray : i === this.index ? C.yellow : C.white);
    });
    this.arrow.position.set(0, this.index * this.spacing);
  }

  /** Handles menu input for one slot's newly pressed bits. Returns true when something happened. */
  handle(pressed: number): boolean {
    if (!pressed) return false;
    const n = this.items.length;
    if (pressed & IN.UP) this.index = (this.index + n - 1) % n;
    else if (pressed & IN.DOWN) this.index = (this.index + 1) % n;
    else if (pressed & (IN.LEFT | IN.RIGHT))
      this.items[this.index]!.change?.(pressed & IN.LEFT ? -1 : 1);
    else if (pressed & (IN.ATTACK | IN.START | IN.JUMP)) {
      const it = this.items[this.index]!;
      if (!it.disabled?.()) it.select?.();
    } else return false;
    this.refresh();
    return true;
  }
}

/** A scrolling one-line ticker (the Announcer's attract-mode patter). */
export class Marquee extends Container {
  private readonly lab: Label;
  private x0 = VIEW_W;
  constructor(text: string, color = C.yellow) {
    super();
    this.lab = new Label(text, { color });
    this.addChild(this.lab);
  }
  tick(): void {
    this.x0 -= 1;
    if (this.x0 < -this.lab.textWidth) this.x0 = VIEW_W;
    this.lab.x = Math.round(this.x0);
  }
}
