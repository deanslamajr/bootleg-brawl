// bake-rigs: composes rig + overlays per pose into a trimmed, packed, indexed atlas per actor,
// plus the shared items atlas. Output: { png bytes, sheet meta }.

import { deflateSync } from "node:zlib";
import type { ItemSprite, OverlaysFile, RigFile, StatesFile } from "@bb/schema";
import { resolveStates, type RawContent } from "@bb/engine";
import { encodeIndexedPng } from "@bb/engine/render/png";
import { IndexedImage } from "./raster";
import { drawPose, drawShape } from "./sprite";

export interface FrameMeta {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Anchor (feet) relative to the frame's top-left. */
  ax: number;
  ay: number;
  hand: [number, number];
  handAngle: number;
  head: [number, number];
  /** Items atlas only: the palette this frame is colored with. */
  palette?: string;
}

export interface SheetMeta {
  id: string;
  width: number;
  height: number;
  palette: string[];
  frames: Record<string, FrameMeta>;
}

export interface BakedSheet {
  meta: SheetMeta;
  png: Uint8Array;
  warnings: string[];
  /** Pixels outside the rig frame box on upright poses. */
  overflow: number;
}

interface Cell {
  key: string;
  img: IndexedImage;
  ax: number;
  ay: number;
  hand: [number, number];
  handAngle: number;
  head: [number, number];
  palette?: string;
}

/** Shelf packer. Frames are sorted by height for a tight fit; width is a power of two. */
function pack(
  cells: Cell[],
  width = 512,
): { w: number; h: number; pos: Map<string, [number, number]> } {
  const sorted = [...cells].sort((a, b) => b.img.height - a.img.height || (a.key < b.key ? -1 : 1));
  const maxW = Math.max(...cells.map((c) => c.img.width), 1);
  while (width < maxW + 2) width *= 2;
  const pos = new Map<string, [number, number]>();
  let x = 1;
  let y = 1;
  let shelf = 0;
  for (const c of sorted) {
    if (x + c.img.width + 1 > width) {
      x = 1;
      y += shelf + 1;
      shelf = 0;
    }
    pos.set(c.key, [x, y]);
    x += c.img.width + 1;
    shelf = Math.max(shelf, c.img.height);
  }
  let h = y + shelf + 1;
  let ph = 16;
  while (ph < h) ph *= 2;
  h = ph;
  return { w: width, h, pos };
}

function assemble(
  id: string,
  cells: Cell[],
  palette: string[],
): { meta: SheetMeta; png: Uint8Array } {
  const { w, h, pos } = pack(cells);
  const atlas = new IndexedImage(w, h);
  const frames: Record<string, FrameMeta> = {};
  for (const c of [...cells].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    const [x, y] = pos.get(c.key)!;
    atlas.blit(c.img, x, y);
    frames[c.key] = {
      x,
      y,
      w: c.img.width,
      h: c.img.height,
      ax: c.ax,
      ay: c.ay,
      hand: c.hand,
      handAngle: Math.round(c.handAngle * 1000) / 1000,
      head: c.head,
      ...(c.palette ? { palette: c.palette } : {}),
    };
  }
  const png = encodeIndexedPng(
    { width: w, height: h, data: atlas.data, palette },
    (raw) => new Uint8Array(deflateSync(raw, { level: 9 })),
  );
  return { meta: { id, width: w, height: h, palette, frames }, png };
}

function trim(img: IndexedImage, anchor: [number, number]) {
  const b = img.bounds() ?? { x: anchor[0], y: anchor[1], w: 1, h: 1 };
  return { img: img.crop(b.x, b.y, b.w, b.h), ox: b.x, oy: b.y };
}

/** Pose names an actor's resolved states reference, plus its portrait pose. */
export function posesUsed(
  states: StatesFile,
  templates: Record<string, StatesFile>,
  extra: string[] = [],
): string[] {
  const table = resolveStates(states, templates);
  const set = new Set<string>(extra);
  for (const s of Object.values(table)) for (const f of s.frames) set.add(f.pose);
  return [...set].sort();
}

function hasWeaponVariant(overlays: OverlaysFile, pose: string): boolean {
  const all = [
    ...overlays.layers.head,
    ...overlays.layers.torso,
    ...overlays.layers.legs,
    ...overlays.layers.weapon,
    ...overlays.layers.fx,
  ];
  return all.some(
    (s) => s.whenWeapon !== undefined && (!s.states || s.states.some((p) => pose.startsWith(p))),
  );
}

export function bakeActor(
  id: string,
  rig: RigFile,
  overlays: OverlaysFile,
  poses: string[],
  palette: string[],
): BakedSheet {
  const cells: Cell[] = [];
  const warnings: string[] = [];
  let overflow = 0;
  for (const pose of poses) {
    if (!rig.poses[pose] && !overlays.uniqueFrames[pose])
      warnings.push(`${id}: pose ${pose} is not in rig ${rig.id} or uniqueFrames`);
    const variants: [string, boolean][] = [[pose, true]];
    if (hasWeaponVariant(overlays, pose)) variants.push([`${pose}~bare`, false]);
    for (const [key, impro] of variants) {
      const f = drawPose(rig, overlays, pose, { impro });
      overflow += f.overflow;
      const t = trim(f.img, f.anchor);
      cells.push({
        key,
        img: t.img,
        ax: f.anchor[0] - t.ox,
        ay: f.anchor[1] - t.oy,
        hand: [Math.round(f.hand[0] - t.ox), Math.round(f.hand[1] - t.oy)],
        handAngle: f.handAngle,
        head: [Math.round(f.head[0] - t.ox), Math.round(f.head[1] - t.oy)],
      });
    }
  }
  if (overflow > 0)
    warnings.push(
      `${id}: ${overflow} px of the idle pose fall outside the ${rig.id} rig frame box`,
    );
  const { meta, png } = assemble(id, cells, palette);
  return { meta, png, warnings, overflow };
}

export function drawItem(
  sprite: ItemSprite,
  frame?: string,
): { img: IndexedImage; ax: number; ay: number } {
  const shapes = frame ? (sprite.frames[frame] ?? sprite.shapes) : sprite.shapes;
  const W = sprite.size[0] * 2 + 16;
  const H = sprite.size[1] * 2 + 16;
  const img = new IndexedImage(W, H);
  const ax = Math.floor(W / 2);
  const ay = H - 8;
  for (const s of [...shapes].sort((a, b) => a.z - b.z)) drawShape(img, s, () => [ax, ay], 1, 0);
  return { img, ax, ay };
}

/** The shared items atlas: props, pickups, weapons (in-hand) and projectiles. */
export function bakeItems(raw: RawContent): BakedSheet {
  const cells: Cell[] = [];
  const add = (key: string, sprite: ItemSprite, frame?: string) => {
    const d = drawItem(sprite, frame);
    const t = trim(d.img, [d.ax, d.ay]);
    cells.push({
      key,
      img: t.img,
      ax: d.ax - t.ox,
      ay: d.ay - t.oy,
      hand: [0, 0],
      handAngle: 0,
      head: [0, 0],
      palette: sprite.palette,
    });
  };
  const groups: [string, Record<string, { sprite: ItemSprite }>][] = [
    ["", raw.items.props],
    ["", raw.items.pickups],
    ["weapon:", raw.items.weapons],
    ["", raw.items.projectiles],
  ];
  const seen = new Set<string>();
  for (const [prefix, table] of groups) {
    for (const id of Object.keys(table).sort()) {
      const key = prefix + id;
      if (seen.has(key)) continue;
      seen.add(key);
      const sprite = table[id]!.sprite;
      add(key, sprite);
      for (const f of Object.keys(sprite.frames).sort()) add(`${key}:${f}`, sprite, f);
    }
  }
  // Items share one index space; each frame is colored with its own palette at load time.
  const { meta, png } = assemble("items", cells, raw.palettes["items-a"] ?? []);
  return { meta, png, warnings: [], overflow: 0 };
}
