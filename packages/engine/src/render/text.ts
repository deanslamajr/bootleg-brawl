// Bitmap text from the cabinet font. Glyphs are white sprites tinted per label, with an optional
// one-pixel drop shadow for readability over busy backgrounds.

import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import { FONT_CHARS, glyph, textWidth } from "./font";

let glyphTex: Map<string, Texture> | null = null;

function glyphs(): Map<string, Texture> {
  if (glyphTex) return glyphTex;
  const cols = 16;
  const rows = Math.ceil(FONT_CHARS.length / cols);
  const canvas = document.createElement("canvas");
  canvas.width = cols * 8;
  canvas.height = rows * 8;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(canvas.width, canvas.height);
  FONT_CHARS.forEach((ch, i) => {
    const g = glyph(ch);
    const ox = (i % cols) * 8;
    const oy = Math.floor(i / cols) * 8;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        if (g.bits[y * 8 + x]) {
          const p = ((oy + y) * canvas.width + ox + x) * 4;
          img.data[p] = img.data[p + 1] = img.data[p + 2] = img.data[p + 3] = 255;
        }
  });
  ctx.putImageData(img, 0, 0);
  const base = Texture.from(canvas);
  base.source.scaleMode = "nearest";
  glyphTex = new Map();
  FONT_CHARS.forEach((ch, i) => {
    glyphTex!.set(
      ch,
      new Texture({
        source: base.source,
        frame: new Rectangle((i % cols) * 8, Math.floor(i / cols) * 8, 8, 8),
      }),
    );
  });
  return glyphTex;
}

export interface LabelOpts {
  color?: number;
  scale?: number;
  shadow?: number | null;
  align?: "left" | "center" | "right";
  /** Wraps at this many pixels (unscaled). */
  maxWidth?: number;
}

export class Label extends Container {
  private current = "";
  private opts: Required<Omit<LabelOpts, "maxWidth">> & { maxWidth?: number };

  constructor(text = "", opts: LabelOpts = {}) {
    super();
    this.opts = { color: 0xffffff, scale: 1, shadow: 0x1a1420, align: "left", ...opts };
    this.set(text);
  }

  get textWidth(): number {
    return Math.max(...this.lines(this.current).map((l) => textWidth(l, this.opts.scale)), 0);
  }

  private lines(text: string): string[] {
    const out: string[] = [];
    for (const para of text.toUpperCase().split("\n")) {
      if (!this.opts.maxWidth) {
        out.push(para);
        continue;
      }
      let line = "";
      for (const word of para.split(" ")) {
        const test = line ? `${line} ${word}` : word;
        if (textWidth(test) > this.opts.maxWidth && line) {
          out.push(line);
          line = word;
        } else line = test;
      }
      out.push(line);
    }
    return out;
  }

  set(text: string, color?: number): this {
    if (text === this.current && (color === undefined || color === this.opts.color)) return this;
    this.current = text;
    if (color !== undefined) this.opts.color = color;
    this.removeChildren().forEach((c) => c.destroy());
    const g = glyphs();
    const s = this.opts.scale;
    const lines = this.lines(text);
    const widest = Math.max(...lines.map((l) => textWidth(l, s)), 0);
    lines.forEach((line, li) => {
      const w = textWidth(line, s);
      let x =
        this.opts.align === "center"
          ? (widest - w) / 2
          : this.opts.align === "right"
            ? widest - w
            : 0;
      const y = li * 10 * s;
      for (const ch of line) {
        const key = g.has(ch) ? ch : g.has(ch.toUpperCase()) ? ch.toUpperCase() : "?";
        const tex = g.get(key);
        if (tex && ch !== " ") {
          if (this.opts.shadow !== null) {
            const sh = new Sprite(tex);
            sh.tint = this.opts.shadow;
            sh.position.set(Math.round(x + s), Math.round(y + s));
            sh.scale.set(s);
            this.addChild(sh);
          }
          const sp = new Sprite(tex);
          sp.tint = this.opts.color;
          sp.position.set(Math.round(x), Math.round(y));
          sp.scale.set(s);
          this.addChild(sp);
        }
        x += glyph(ch).advance * s;
      }
    });
    if (this.opts.align === "center") this.pivot.x = Math.round(widest / 2);
    else if (this.opts.align === "right") this.pivot.x = Math.round(widest);
    return this;
  }
}

export function hexNum(hex: string): number {
  return parseInt(hex.slice(1), 16);
}
