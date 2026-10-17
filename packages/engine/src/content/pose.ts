// Pose geometry shared by the compile step (auto hurtboxes) and the renderer (attach points).

import type { OverlaysFile, Pose, RigFile } from "@bb/schema";
import { icos, isin, FX } from "../math/fixed";
import type { CBox } from "./types";

export const HUMANOID_JOINTS = [
  "head",
  "neck",
  "hip",
  "sF",
  "eF",
  "hF",
  "sB",
  "eB",
  "hB",
  "kF",
  "fF",
  "kB",
  "fB",
] as const;

export type Body = OverlaysFile["body"];

export function totalScale(rig: RigFile, body: Body): number {
  return rig.scale * (body.scale ?? 1);
}

/** Joint position in pixels relative to the anchor, y up negative. Rotation applies about the hip. */
export function jointPx(rig: RigFile, pose: Pose, body: Body, name: string): [number, number] {
  const s = totalScale(rig, body);
  const j = pose.j[name] ?? pose.j.hip ?? pose.j.c ?? [0, -20];
  let x = j[0];
  let y = j[1];
  if (pose.rot) {
    const pivot = pose.j.hip ?? pose.j.c ?? [0, -20];
    // Table trig keeps compiled hurtboxes identical on every engine.
    const c = icos(Math.round(pose.rot)) / FX;
    const sn = isin(Math.round(pose.rot)) / FX;
    const dx = x - pivot[0];
    const dy = y - pivot[1];
    x = pivot[0] + dx * c - dy * sn;
    y = pivot[1] + dx * sn + dy * c;
  }
  return [x * s, y * s];
}

/** Body bounds (torso, head and legs; arms excluded) as a hurtbox in px. */
export function autoHurtbox(rig: RigFile, poseName: string, body: Body): CBox {
  const pose = rig.poses[poseName];
  const s = totalScale(rig, body);
  if (!pose || rig.kind === "nonhuman") {
    const w = Math.round(rig.frameBox[0] * 0.55 * (body.scale ?? 1));
    const h = Math.round(rig.frameBox[1] * 0.5 * (body.scale ?? 1));
    return { x: -Math.round(w / 2), z: 0, w, h };
  }
  const names = rig.kind === "humanoid" ? ["head", "neck", "hip", "kF", "fF", "kB", "fB"] : Object.keys(pose.j);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of names) {
    if (!pose.j[n]) continue;
    const [x, y] = jointPx(rig, pose, body, n);
    const pad = n === "head" ? (body.headR ?? 7) * s : ((body.torsoW ?? 9) / 2) * s;
    minX = Math.min(minX, x - pad);
    maxX = Math.max(maxX, x + pad);
    minY = Math.min(minY, y - pad);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return { x: -8, z: 0, w: 16, h: 40 };
  const z0 = Math.max(0, Math.round(-maxY));
  return {
    x: Math.round(minX),
    z: z0,
    w: Math.max(4, Math.round(maxX - minX)),
    h: Math.max(4, Math.round(-minY) - z0),
  };
}
