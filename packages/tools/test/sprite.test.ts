import { describe, expect, it } from "vitest";
import { shape } from "@bb/schema";
import { drawShape } from "../src/art/sprite";
import { IndexedImage } from "../src/art/raster";
import type { SpriteImage } from "../src/art/sprites";

// A 3x5 head: hair (4) on the top row, skin (2) below, anchored at the bottom middle.
const head = new IndexedImage(3, 5);
head.fill(2);
for (let x = 0; x < 3; x++) head.set(x, 0, 4);
const sprites: Record<string, SpriteImage> = {
  "h.png": { img: head, anchor: [1.5, 5], file: "h.png", paletteSize: 16 },
};
const sh = shape.parse({ shape: "sprite", file: "h.png", at: "neck", alignTo: "head" });
// The medium rig's idle neck and head: the head leans 8 degrees forward at rest.
const IDLE: Record<string, [number, number]> = { neck: [0, -42], head: [1, -49] };
const rest = (n: string) => IDLE[n];

function draw(joints: Record<string, [number, number]>) {
  const im = new IndexedImage(64, 80);
  drawShape(im, sh, (n) => [32 + joints[n]![0], 70 + joints[n]![1]], 1, 0, sprites, rest);
  const b = im.bounds()!;
  return { im, b };
}

describe("a sprite aligned to a joint", () => {
  it("is drawn as generated in the idle pose", () => {
    const { im, b } = draw(IDLE);
    expect([b.w, b.h]).toEqual([3, 5]);
    expect(im.get(b.x + 1, b.y)).toBe(4);
  });
  it("snaps a small lean back to upright", () => {
    const { b } = draw({ neck: [0, -42], head: [2, -49] });
    expect([b.w, b.h]).toEqual([3, 5]);
  });
  it("turns a quarter counterclockwise when the head lies behind the neck", () => {
    // The medium rig's down:0 pose.
    const { im, b } = draw({ neck: [-15, -5], head: [-22, -6] });
    expect([b.w, b.h]).toEqual([5, 3]);
    // The hair row is now the left column, and every source pixel survives.
    for (let y = 0; y < 3; y++) expect(im.get(b.x, b.y + y)).toBe(4);
    expect(im.data.filter((v) => v).length).toBe(15);
  });
});
