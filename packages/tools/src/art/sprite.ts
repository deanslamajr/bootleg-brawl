// Paper-doll compositor: draws a rig pose with the character's body proportions and overlay
// shapes into an indexed image. This replaces hand-exported frames: every frame is regenerable
// from content/rigs and the character's overlays.json.

import type { OverlaysFile, Pose, RigFile, Shape } from "@bb/schema";
import {
  IndexedImage,
  capsuleGeo,
  ellipseGeo,
  paint,
  polyGeo,
  rectGeo,
  shadeOf,
  type Geometry,
} from "./raster";

export interface DrawnFrame {
  img: IndexedImage;
  anchor: [number, number];
  /** Attach points in image pixels. */
  hand: [number, number];
  handAngle: number;
  head: [number, number];
  /** Pixels drawn outside the rig frame box around the anchor (validator input). */
  overflow: number;
}

interface Part {
  z: number;
  order: number;
  draw(img: IndexedImage): void;
}

const TURN = 1 / 256;

/** A filter prefix matches a pose name exactly, as "name:" or as a plain prefix ("atk" matches "atk1:0"). */
function prefixHit(prefix: string, name: string): boolean {
  return name === prefix || name.startsWith(prefix);
}

/** Shape filters test the pose name and, for unique frames, the rig pose it is built on. */
function matches(shape: Shape, names: string[], impro: boolean): boolean {
  if (shape.states && !shape.states.some((p) => names.some((n) => prefixHit(p, n)))) return false;
  if (shape.exceptStates && shape.exceptStates.some((p) => names.some((n) => prefixHit(p, n))))
    return false;
  if (shape.whenWeapon !== undefined && shape.whenWeapon !== impro) return false;
  return true;
}

export function drawPose(
  rig: RigFile,
  overlays: OverlaysFile,
  poseName: string,
  opts: { impro?: boolean } = {},
): DrawnFrame {
  const body = overlays.body;
  const s = rig.scale * (body.scale ?? 1);
  const W = Math.ceil(rig.frameBox[0] * 2.2 + 40);
  const H = Math.ceil(rig.frameBox[1] * 1.7 + 40);
  const ax = Math.floor(W / 2);
  const ay = H - 14;
  const img = new IndexedImage(W, H);
  const unique = overlays.uniqueFrames[poseName];
  const pose: Pose = rig.poses[unique?.base ?? poseName] ??
    rig.poses["idle:0"] ?? { j: {}, rot: 0 };
  const rot = (pose.rot ?? 0) * TURN;
  const pivot = pose.j.hip ?? pose.j.c ?? [0, -20];
  const ca = Math.cos(rot * Math.PI * 2);
  const sa = Math.sin(rot * Math.PI * 2);
  const J = (name: string): [number, number] => {
    const j = pose.j[name] ?? pivot;
    const dx = j[0] - pivot[0];
    const dy = j[1] - pivot[1];
    const x = pivot[0] + dx * ca - dy * sa;
    const y = pivot[1] + dx * sa + dy * ca;
    return [ax + x * s, ay + y * s];
  };
  const hide = new Set(body.hide);
  const parts: Part[] = [];
  let order = 0;
  const add = (z: number, draw: (img: IndexedImage) => void) =>
    parts.push({ z, order: order++, draw });
  const P =
    (g: Geometry, color: number, shade = true, outline = true) =>
    (im: IndexedImage) =>
      paint(im, g, { color, shade, outline });

  if (rig.kind === "humanoid") {
    const armR = Math.max(1, (body.armW * s) / 2);
    const legR = Math.max(1, (body.legW * s) / 2);
    const handR = Math.max(1, body.handR * s);
    const limb = (
      a: string,
      b: string,
      c: string,
      r: number,
      color: number,
      z: number,
      end: "hand" | "foot",
    ) => {
      const handColor = z < 30 ? shadeOf(body.skin) : body.skin;
      add(z, (im) => {
        P(capsuleGeo(...J(a), ...J(b), r), color)(im);
        // Shins stop at the ankle (one radius above the foot joint) so the cap hides in the shoe.
        const [cx, cy] = J(c);
        const lift = end === "foot" && !hide.has("feet") ? r * 0.92 : 0;
        P(capsuleGeo(...J(b), cx, cy - lift, r * 0.92), color)(im);
        if (end === "hand" && !hide.has("hands"))
          P(ellipseGeo(...J(c), handR, handR), handColor)(im);
        if (end === "foot" && !hide.has("feet")) {
          const [fx, fy] = J(c);
          const fl = body.footL * s;
          const ry = Math.max(1.2, 1.8 * s);
          // The sole rests on the anchor row so the outline stays inside the frame box.
          P(ellipseGeo(fx + (fl / 2) * ca - 0.5, fy - ry, fl / 2 + 0.5, ry, rot), body.feet)(im);
        }
      });
    };
    if (!hide.has("armB")) limb("sB", "eB", "hB", armR, shadeOf(body.arms), 10, "hand");
    if (!hide.has("legB")) limb("hip", "kB", "fB", legR, shadeOf(body.legs), 20, "foot");
    if (!hide.has("torso")) {
      add(30, (im) => {
        const [hx, hy] = J("hip");
        const [nx, ny] = J("neck");
        const len = Math.hypot(nx - hx, ny - hy);
        const ang = Math.atan2(ny - hy, nx - hx) / (Math.PI * 2) + 0.25;
        P(
          ellipseGeo((hx + nx) / 2, (hy + ny) / 2, (body.torsoW * s) / 2, len / 2 + 2 * s, ang),
          body.torso,
        )(im);
      });
    }
    if (!hide.has("legF")) limb("hip", "kF", "fF", legR, body.legs, 40, "foot");
    if (!hide.has("head")) {
      add(50, (im) => {
        const [hx, hy] = J("head");
        const [nx, ny] = J("neck");
        P(capsuleGeo(nx, ny, (nx + hx) / 2, (ny + hy) / 2, Math.max(1, armR)), body.skin)(im);
        const rx = (body.headW ?? body.headR * 2) * s * 0.5;
        const ry = (body.headH ?? body.headR * 2) * s * 0.5;
        P(ellipseGeo(hx, hy, rx, ry, rot), body.skin)(im);
      });
      if (!hide.has("face")) {
        add(52, (im) => {
          const [hx, hy] = J("head");
          const r = body.headR * s;
          const off = (u: number, v: number): [number, number] => [
            hx + (u * ca - v * sa) * r,
            hy + (u * sa + v * ca) * r,
          ];
          const [ex, ey] = off(0.42, -0.12);
          if (r >= 4.5) {
            im.set(Math.round(ex), Math.round(ey), 12);
            im.set(Math.round(ex) - 1, Math.round(ey), 12);
            im.set(Math.round(ex) - 1, Math.round(ey) - 1, 12);
            im.set(Math.round(ex), Math.round(ey) - 1, 12);
            im.set(Math.round(ex), Math.round(ey), 13);
          } else im.set(Math.round(ex), Math.round(ey), 13);
          const [mx, my] = off(0.55, 0.45);
          im.set(Math.round(mx), Math.round(my), 13);
          im.set(Math.round(mx) - 1, Math.round(my), 13);
        });
      }
    }
    if (!hide.has("armF")) limb("sF", "eF", "hF", armR, body.arms, 60, "hand");
  }

  const impro = opts.impro ?? true;
  const layerShapes = [
    ...overlays.layers.legs,
    ...overlays.layers.torso,
    ...overlays.layers.head,
    ...overlays.layers.weapon,
    ...overlays.layers.fx,
  ];
  const shapes = unique
    ? [...(unique.keepOverlays ? layerShapes : []), ...unique.shapes]
    : layerShapes;
  if (unique && !unique.keepBody) parts.length = 0;
  const names = unique?.base ? [poseName, unique.base] : [poseName];
  for (const sh of shapes) {
    if (!matches(sh, names, impro)) continue;
    add(sh.z, (im) => drawShape(im, sh, J, s, rot));
  }

  parts.sort((a, b) => a.z - b.z || a.order - b.order);
  for (const p of parts) p.draw(img);

  const [hx, hy] = J("hF");
  const [ex, ey] = J("eF");
  const head = J("head");
  // Overflow: pixels outside the rig frame box, measured only for upright poses.
  let overflow = 0;
  if (poseName.startsWith("idle")) {
    const fx0 = ax - rig.anchor[0];
    const fy0 = ay - rig.anchor[1];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (
          img.data[y * W + x] &&
          (x < fx0 || x >= fx0 + rig.frameBox[0] || y < fy0 || y >= fy0 + rig.frameBox[1])
        )
          overflow++;
  }
  return {
    img,
    anchor: [ax, ay],
    hand: [hx, hy],
    handAngle: Math.atan2(hy - ey, hx - ex) / (Math.PI * 2),
    head,
    overflow,
  };
}

export function drawShape(
  im: IndexedImage,
  sh: Shape,
  J: (name: string) => [number, number],
  s: number,
  bodyRot: number,
): void {
  const [jx, jy] = J(sh.at);
  let ang = sh.rot * TURN + bodyRot;
  if (sh.alignTo) {
    const [bx, by] = J(sh.alignTo);
    ang = Math.atan2(jy - by, jx - bx) / (Math.PI * 2) + sh.rot * TURN;
  }
  const c = Math.cos(ang * Math.PI * 2);
  const n = Math.sin(ang * Math.PI * 2);
  const ox = (sh.dx * c - sh.dy * n) * s;
  const oy = (sh.dx * n + sh.dy * c) * s;
  const cx = jx + ox;
  const cy = jy + oy;
  const opts = { color: sh.color, outline: sh.outline, shade: sh.shade };
  switch (sh.shape) {
    case "ellipse":
      paint(im, ellipseGeo(cx, cy, (sh.w * s) / 2, (sh.h * s) / 2, ang), opts);
      return;
    case "circle":
      paint(im, ellipseGeo(cx, cy, sh.r * s, sh.r * s, ang), opts);
      return;
    case "rect":
      paint(im, rectGeo(cx, cy, Math.max(1, sh.w * s), Math.max(1, sh.h * s), ang), opts);
      return;
    case "line": {
      const [tx, ty] = sh.to ? J(sh.to) : [cx + sh.w * s * c, cy + sh.w * s * n];
      paint(
        im,
        capsuleGeo(cx, cy, tx + (sh.to ? ox : 0), ty + (sh.to ? oy : 0), Math.max(0.6, sh.r * s)),
        opts,
      );
      return;
    }
    case "poly":
    case "tri": {
      const pts = (
        sh.points ?? [
          [0, -sh.h / 2],
          [sh.w / 2, sh.h / 2],
          [-sh.w / 2, sh.h / 2],
        ]
      ).map(
        ([px, py]) => [cx + (px * c - py * n) * s, cy + (px * n + py * c) * s] as [number, number],
      );
      paint(im, polyGeo(pts), opts);
      return;
    }
  }
}
