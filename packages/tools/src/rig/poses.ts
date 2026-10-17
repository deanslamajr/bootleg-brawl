// Generates the shared rig pose libraries (content/rigs/*.rig.json) from keyframe helpers.
// Coordinates are medium-rig unit space: x toward the facing direction, y up is negative,
// the anchor (0, 0) is the point between the feet.
// Run `pnpm tools gen-rigs` after changing this file; the output is committed.

import type { Pose, RigFile } from "@bb/schema";

type J = Record<string, [number, number]>;

const STAND: J = {
  head: [1, -49],
  neck: [0, -42],
  hip: [0, -26],
  sF: [2, -40],
  eF: [5, -33],
  hF: [6, -26],
  sB: [-2, -40],
  eB: [-4, -33],
  hB: [-4, -26],
  kF: [3, -13],
  fF: [4, 0],
  kB: [-3, -13],
  fB: [-4, 0],
};

function P(over: Partial<J> = {}, rot = 0, base: J = STAND): Pose {
  const j: J = {};
  for (const [k, v] of Object.entries(base)) j[k] = [v[0], v[1]];
  for (const [k, v] of Object.entries(over)) if (v) j[k] = [v[0], v[1]];
  return { j, rot };
}

/** Shift every joint above the hip (and the hip) by dx, dy. */
function upper(dx: number, dy: number, base: J = STAND): J {
  const out: J = {};
  for (const k of ["head", "neck", "hip", "sF", "eF", "hF", "sB", "eB", "hB"]) {
    const v = base[k]!;
    out[k] = [v[0] + dx, v[1] + dy];
  }
  return out;
}

function lean(dx: number, base: J = STAND): J {
  // Leans the torso: the head moves most, the hip not at all.
  const out: J = {};
  const scale: Record<string, number> = {
    head: 1,
    neck: 0.85,
    sF: 0.8,
    sB: 0.8,
    eF: 0.7,
    eB: 0.7,
    hF: 0.6,
    hB: 0.6,
  };
  for (const [k, f] of Object.entries(scale)) {
    const v = base[k]!;
    out[k] = [Math.round(v[0] + dx * f), v[1] + Math.round(Math.abs(dx) * 0.15 * f)];
  }
  return out;
}

const r = Math.round;

function humanoidPoses(): Record<string, Pose> {
  const p: Record<string, Pose> = {};

  // idle: a four-frame breathing bob.
  for (let i = 0; i < 4; i++) {
    const b = i === 1 || i === 2 ? 1 : 0;
    p[`idle:${i}`] = P({
      ...upper(0, b),
      kF: [3, -13 + b],
      kB: [-3, -13 + b],
      hF: [6, -26 + b * 2],
      hB: [-4, -26 + b * 2],
    });
  }

  // walk: six frames, legs swing on a cycle, arms opposite.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const s = Math.sin(a);
    const cs = Math.cos(a);
    const bob = r(Math.abs(cs) * -1);
    const ff = r(7 * s);
    const fb = -ff;
    p[`walk:${i}`] = P({
      ...upper(0, bob),
      kF: [r(3 + 4 * s), -13 + bob],
      fF: [ff + 1, s > 0.3 ? -2 : 0],
      kB: [r(-3 - 4 * s), -13 + bob],
      fB: [fb - 1, s < -0.3 ? -2 : 0],
      eF: [r(4 - 4 * s), -33 + bob],
      hF: [r(5 - 7 * s), -26 + bob],
      eB: [r(-3 + 4 * s), -33 + bob],
      hB: [r(-3 + 7 * s), -26 + bob],
    });
  }

  // run: longer stride, forward lean, pumping arms.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const s = Math.sin(a);
    const cs = Math.cos(a);
    const bob = r(Math.abs(cs) * -2);
    const L = lean(5);
    p[`run:${i}`] = P({
      ...Object.fromEntries(
        Object.entries(L).map(([k, v]) => [k, [v[0], v[1] + bob] as [number, number]]),
      ),
      hip: [1, -26 + bob],
      kF: [r(5 + 7 * s), r(-14 + bob + (s > 0 ? -3 * s : 0))],
      fF: [r(2 + 12 * s), s > 0 ? r(-6 * s) : 0],
      kB: [r(-3 - 7 * s), r(-14 + bob + (s < 0 ? 3 * s : 0))],
      fB: [r(-2 - 12 * s), s < 0 ? r(6 * s) : 0],
      eF: [r(6 - 6 * s), -34 + bob],
      hF: [r(10 - 8 * s), r(-30 + bob - 3 * s)],
      eB: [r(-2 + 6 * s), -34 + bob],
      hB: [r(2 + 8 * s), r(-30 + bob + 3 * s)],
    });
  }

  // jump: rise, tuck, fall.
  p["jump:0"] = P({
    ...upper(0, -1),
    eF: [6, -40],
    hF: [8, -46],
    eB: [-6, -38],
    hB: [-8, -44],
    kF: [4, -14],
    fF: [2, -3],
    kB: [-2, -15],
    fB: [-5, -5],
  });
  p["jump:1"] = P({
    ...upper(0, 2),
    eF: [7, -36],
    hF: [10, -38],
    eB: [-5, -35],
    hB: [-2, -36],
    kF: [8, -20],
    fF: [3, -12],
    kB: [2, -18],
    fB: [-4, -10],
  });
  p["jump:2"] = P({
    eF: [7, -38],
    hF: [11, -43],
    eB: [-7, -37],
    hB: [-10, -42],
    kF: [4, -12],
    fF: [5, -1],
    kB: [-4, -12],
    fB: [-6, -1],
  });
  p["land:0"] = P({
    ...upper(0, 5),
    kF: [7, -10],
    fF: [5, 0],
    kB: [-6, -10],
    fB: [-5, 0],
    hF: [10, -22],
    hB: [-8, -22],
  });

  // atk1: jab with the front hand.
  p["atk1:0"] = P({
    ...lean(-1),
    eF: [6, -36],
    hF: [9, -38],
    eB: [-3, -35],
    hB: [2, -37],
    fF: [7, 0],
    kF: [5, -13],
  });
  p["atk1:1"] = P({
    ...lean(3),
    eF: [12, -38],
    hF: [21, -38],
    eB: [-3, -35],
    hB: [3, -37],
    fF: [8, 0],
    kF: [6, -13],
  });
  p["atk1:2"] = P({
    ...lean(1),
    eF: [9, -36],
    hF: [13, -37],
    eB: [-3, -35],
    hB: [2, -36],
    fF: [7, 0],
    kF: [5, -13],
  });
  // atk2: cross with the back hand.
  p["atk2:0"] = P({
    ...lean(-2),
    eF: [6, -35],
    hF: [8, -38],
    eB: [-6, -36],
    hB: [-2, -38],
    fF: [7, 0],
    kF: [5, -13],
  });
  p["atk2:1"] = P({
    ...lean(5),
    sB: [2, -40],
    eB: [12, -38],
    hB: [22, -38],
    eF: [3, -34],
    hF: [5, -37],
    fF: [8, 0],
    kF: [6, -13],
    fB: [-6, 0],
  });
  p["atk2:2"] = P({
    ...lean(2),
    eB: [6, -36],
    hB: [12, -37],
    eF: [4, -34],
    hF: [7, -37],
    fF: [7, 0],
    kF: [5, -13],
  });
  // atk3: front kick, the chain's finisher.
  p["atk3:0"] = P({ ...lean(-3), kF: [8, -19], fF: [6, -10], hF: [8, -36], hB: [-6, -34] });
  p["atk3:1"] = P({
    ...lean(-5),
    kF: [12, -22],
    fF: [24, -24],
    kB: [-2, -13],
    fB: [-3, 0],
    eF: [6, -36],
    hF: [10, -40],
    eB: [-8, -34],
    hB: [-12, -32],
  });
  p["atk3:2"] = P({ ...lean(-2), kF: [8, -16], fF: [10, -6], hF: [8, -34], hB: [-6, -32] });
  // atk4: two-handed overhead smash.
  p["atk4:0"] = P({ ...lean(-3), eF: [2, -50], hF: [0, -58], eB: [-2, -50], hB: [-2, -57] });
  p["atk4:1"] = P({
    ...lean(6),
    eF: [14, -36],
    hF: [22, -28],
    eB: [12, -36],
    hB: [20, -29],
    kF: [7, -12],
    fF: [8, 0],
  });
  p["atk4:2"] = P({
    ...lean(3),
    eF: [11, -33],
    hF: [16, -26],
    eB: [9, -33],
    hB: [14, -26],
    kF: [6, -12],
    fF: [8, 0],
  });

  // dashAtk: flying knee then recover.
  p["dashAtk:0"] = P({
    ...lean(5),
    kF: [12, -20],
    fF: [8, -12],
    eF: [8, -38],
    hF: [4, -34],
    eB: [-8, -36],
    hB: [-14, -36],
  });
  p["dashAtk:1"] = P({
    ...lean(7),
    kF: [17, -24],
    fF: [10, -16],
    kB: [-4, -12],
    fB: [-10, -4],
    eF: [10, -40],
    hF: [6, -36],
    eB: [-8, -38],
    hB: [-16, -40],
  });
  p["dashAtk:2"] = P({
    ...lean(6),
    kF: [15, -22],
    fF: [9, -14],
    kB: [-4, -12],
    fB: [-10, -3],
    eF: [9, -39],
    hF: [5, -35],
    eB: [-8, -37],
    hB: [-15, -39],
  });
  p["dashAtk:3"] = P({ ...lean(2), kF: [7, -14], fF: [8, 0], hF: [8, -30], hB: [-6, -30] });

  // backAtk: the panic elbow behind.
  p["backAtk:0"] = P({ ...lean(2), eB: [-6, -38], hB: [2, -38], eF: [4, -34], hF: [8, -32] });
  p["backAtk:1"] = P({
    ...lean(-3),
    sB: [-4, -40],
    eB: [-16, -38],
    hB: [-8, -39],
    eF: [5, -34],
    hF: [9, -34],
    fB: [-8, 0],
    kB: [-6, -13],
  });
  p["backAtk:2"] = P({ ...lean(-1), eB: [-10, -36], hB: [-4, -36], eF: [5, -34], hF: [8, -32] });

  // jumpAtk: flying kick, held to landing.
  p["jumpAtk:0"] = P({
    ...upper(-1, 1),
    kF: [10, -20],
    fF: [6, -12],
    kB: [-2, -16],
    fB: [-6, -8],
    eF: [6, -40],
    hF: [10, -44],
    eB: [-6, -37],
    hB: [-10, -40],
  });
  p["jumpAtk:1"] = P({
    ...upper(-3, 0),
    kF: [12, -20],
    fF: [24, -14],
    kB: [-2, -18],
    fB: [-8, -10],
    eF: [4, -40],
    hF: [0, -44],
    eB: [-8, -38],
    hB: [-14, -42],
  });
  // dive: downward kick.
  p["dive:0"] = P({
    ...upper(-2, -2),
    kF: [10, -12],
    fF: [16, 2],
    kB: [-2, -18],
    fB: [-8, -12],
    eF: [2, -44],
    hF: [-2, -50],
    eB: [-8, -42],
    hB: [-12, -48],
  });
  p["dive:1"] = P({
    ...upper(-3, -2),
    kF: [11, -10],
    fF: [18, 4],
    kB: [-2, -18],
    fB: [-9, -12],
    eF: [1, -45],
    hF: [-3, -51],
    eB: [-9, -42],
    hB: [-13, -48],
  });

  // grab / grabHit: hold at chest height, knee.
  p["grab:0"] = P({ ...lean(2), eF: [10, -36], hF: [16, -36], eB: [8, -35], hB: [14, -34] });
  p["grab:1"] = P({ ...lean(3), eF: [10, -37], hF: [16, -37], eB: [8, -36], hB: [14, -35] });
  p["grabHit:0"] = P({
    ...lean(2),
    eF: [10, -37],
    hF: [16, -37],
    eB: [8, -36],
    hB: [14, -35],
    kF: [10, -20],
    fF: [6, -10],
  });
  p["grabHit:1"] = P({
    ...lean(4),
    eF: [10, -37],
    hF: [15, -38],
    eB: [8, -36],
    hB: [13, -36],
    kF: [14, -28],
    fF: [9, -18],
  });

  // throw: wind back, hoist, hurl, follow through.
  p["throw:0"] = P({
    ...lean(2),
    eF: [10, -36],
    hF: [15, -36],
    eB: [8, -35],
    hB: [13, -34],
    kF: [6, -12],
    fF: [7, 0],
  });
  p["throw:1"] = P({
    ...lean(-4),
    eF: [2, -48],
    hF: [0, -56],
    eB: [-2, -48],
    hB: [-4, -55],
    kF: [4, -13],
    kB: [-6, -12],
    fB: [-8, 0],
  });
  p["throw:2"] = P({
    ...lean(6),
    eF: [12, -42],
    hF: [20, -40],
    eB: [10, -41],
    hB: [18, -39],
    kF: [8, -13],
    fF: [10, 0],
  });
  p["throw:3"] = P({
    ...lean(3),
    eF: [10, -34],
    hF: [15, -28],
    eB: [8, -33],
    hB: [13, -27],
    fF: [9, 0],
  });

  // grabSlam: hoist the victim overhead and slam it down in front (large rigs).
  p["grabSlam:0"] = P({ ...lean(2), eF: [10, -38], hF: [15, -40], eB: [8, -37], hB: [13, -39] });
  p["grabSlam:1"] = P({
    ...lean(-2),
    eF: [6, -50],
    hF: [6, -60],
    eB: [2, -50],
    hB: [2, -60],
    kF: [5, -13],
    kB: [-5, -13],
  });
  p["grabSlam:2"] = P({
    ...lean(-5),
    eF: [0, -52],
    hF: [-4, -62],
    eB: [-4, -52],
    hB: [-8, -62],
    kF: [6, -14],
    kB: [-6, -13],
  });
  p["grabSlam:3"] = P({
    ...lean(8),
    eF: [14, -36],
    hF: [22, -26],
    eB: [12, -36],
    hB: [20, -26],
    kF: [9, -11],
    fF: [11, 0],
    kB: [-6, -10],
  });
  p["grabSlam:4"] = P({
    ...upper(4, 6),
    eF: [14, -24],
    hF: [20, -14],
    eB: [12, -24],
    hB: [18, -14],
    kF: [9, -9],
    kB: [-7, -9],
  });

  // stomp: lift, stamp, recover.
  p["stomp:0"] = P({ ...lean(-2), kF: [10, -26], fF: [12, -16], hF: [10, -34], hB: [-8, -32] });
  p["stomp:1"] = P({ ...lean(2), kF: [11, -12], fF: [14, 0], hF: [10, -30], hB: [-8, -30] });
  p["stomp:2"] = P({ ...lean(1), kF: [8, -12], fF: [10, 0], hF: [8, -28], hB: [-6, -28] });

  // special: a spin with arms out, six frames.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const s = Math.sin(a);
    const cs = Math.cos(a);
    p[`special:${i}`] = P({
      ...upper(0, -2),
      sF: [r(2 * cs), -41],
      sB: [r(-2 * cs), -41],
      eF: [r(11 * cs), -40],
      hF: [r(20 * cs), r(-40 + 2 * s)],
      eB: [r(-11 * cs), -40],
      hB: [r(-20 * cs), r(-40 - 2 * s)],
      kF: [r(4 * cs), -14],
      fF: [r(6 * cs), 0],
      kB: [r(-4 * cs), -14],
      fB: [r(-6 * cs), 0],
    });
  }

  // hurt: snapped back.
  p["hurt:0"] = P({
    ...lean(-5),
    head: [-5, -47],
    eF: [2, -35],
    hF: [0, -30],
    eB: [-8, -34],
    hB: [-10, -28],
  });
  p["hurt:1"] = P({
    ...lean(-3),
    head: [-3, -48],
    eF: [3, -34],
    hF: [2, -28],
    eB: [-7, -34],
    hB: [-9, -28],
  });

  // Lying flat on the back; head behind, feet toward the facing direction.
  const LIE: J = {
    head: [-22, -6],
    neck: [-15, -5],
    hip: [2, -5],
    sF: [-13, -7],
    eF: [-7, -9],
    hF: [-2, -5],
    sB: [-13, -4],
    eB: [-18, -2],
    hB: [-24, -2],
    kF: [12, -9],
    fF: [21, -3],
    kB: [11, -4],
    fB: [21, -1],
  };
  p["down:0"] = P({}, 0, LIE);
  p["down:1"] = P({ head: [-22, -5], hF: [-1, -4] }, 0, LIE);
  p["ko:0"] = P({}, 0, LIE);
  p["ko:1"] = P({ head: [-23, -5], eF: [-6, -8], hF: [-1, -3] }, 0, LIE);
  p["ko:2"] = P({ head: [-22, -6] }, 0, LIE);
  p["ko:3"] = P({ head: [-22, -5], kF: [12, -8] }, 0, LIE);

  // fall: tumbling backward, rotated about the hip.
  p["fall:0"] = P(
    {
      ...lean(-6),
      eF: [6, -42],
      hF: [10, -48],
      eB: [-6, -42],
      hB: [-8, -48],
      kF: [6, -16],
      fF: [10, -6],
    },
    0,
  );
  p["fall:1"] = P(
    { eF: [6, -42], hF: [10, -48], eB: [-6, -42], hB: [-8, -48], kF: [8, -16], fF: [14, -8] },
    216,
  );
  p["fall:2"] = P(
    { eF: [6, -42], hF: [10, -48], eB: [-6, -42], hB: [-8, -48], kF: [8, -16], fF: [14, -8] },
    196,
  );

  // getup: sit, kneel, stand.
  p["getup:0"] = P(
    {
      head: [-6, -26],
      neck: [-5, -20],
      hip: [-2, -6],
      sF: [-4, -19],
      eF: [2, -12],
      hF: [6, -6],
      sB: [-6, -19],
      eB: [-10, -12],
      hB: [-12, -4],
      kF: [8, -10],
      fF: [14, -1],
      kB: [6, -6],
      fB: [12, 0],
    },
    0,
  );
  p["getup:1"] = P({
    head: [2, -36],
    neck: [1, -29],
    hip: [-1, -16],
    sF: [3, -28],
    eF: [7, -22],
    hF: [9, -16],
    sB: [-1, -28],
    eB: [-4, -22],
    hB: [-5, -15],
    kF: [7, -12],
    fF: [8, 0],
    kB: [-6, -2],
    fB: [-12, 0],
  });
  p["getup:2"] = P({ ...upper(0, 4), kF: [5, -12], kB: [-4, -11] });

  // grabbed: held up, limbs dangling and flailing.
  p["grabbed:0"] = P({
    ...lean(-2),
    eF: [6, -42],
    hF: [8, -48],
    eB: [-6, -40],
    hB: [-9, -46],
    kF: [3, -14],
    fF: [5, -3],
    kB: [-2, -14],
    fB: [-3, -2],
  });
  p["grabbed:1"] = P({
    ...lean(-3),
    eF: [7, -41],
    hF: [11, -46],
    eB: [-7, -41],
    hB: [-8, -48],
    kF: [4, -14],
    fF: [2, -2],
    kB: [-3, -14],
    fB: [-6, -2],
  });

  // thrown: spinning tumble.
  p["thrown:0"] = P(
    { eF: [8, -42], hF: [12, -46], eB: [-6, -42], hB: [-10, -44], kF: [8, -18], fF: [12, -10] },
    64,
  );
  p["thrown:1"] = P(
    { eF: [8, -42], hF: [12, -46], eB: [-6, -42], hB: [-10, -44], kF: [8, -18], fF: [12, -10] },
    128,
  );

  // pickup: crouch and reach.
  p["pickup:0"] = P({ ...upper(4, 8), eF: [12, -20], hF: [16, -10], kF: [9, -10], kB: [-6, -9] });
  p["pickup:1"] = P({ ...upper(2, 4), eF: [10, -26], hF: [12, -20], kF: [7, -11], kB: [-5, -10] });

  // taunt: fist pump, hand on hip.
  p["taunt:0"] = P({ eF: [8, -48], hF: [10, -58], eB: [-6, -32], hB: [-2, -27] });
  p["taunt:1"] = P({ eF: [8, -46], hF: [8, -56], eB: [-6, -32], hB: [-2, -28], head: [2, -50] });

  // victory and cheer.
  p["victory:0"] = P({ eF: [6, -50], hF: [8, -60], eB: [-6, -50], hB: [-8, -60] });
  p["victory:1"] = P({
    ...upper(0, -1),
    eF: [7, -51],
    hF: [10, -61],
    eB: [-7, -51],
    hB: [-10, -61],
  });

  // teamToss: hoist a partner overhead and throw.
  p["teamToss:0"] = P({
    ...upper(0, 3),
    eF: [4, -44],
    hF: [3, -52],
    eB: [-3, -44],
    hB: [-3, -52],
    kF: [6, -12],
    kB: [-6, -12],
  });
  p["teamToss:1"] = P({ ...lean(-3), eF: [2, -50], hF: [0, -60], eB: [-4, -50], hB: [-4, -60] });
  p["teamToss:2"] = P({
    ...lean(6),
    eF: [12, -46],
    hF: [18, -52],
    eB: [9, -46],
    hB: [15, -52],
    fF: [10, 0],
    kF: [8, -13],
  });
  p["teamToss:3"] = P({
    ...lean(3),
    eF: [10, -36],
    hF: [16, -32],
    eB: [8, -36],
    hB: [14, -32],
    fF: [9, 0],
  });
  // Partner curled into a ball for the toss.
  const BALL: J = {
    head: [4, -22],
    neck: [2, -18],
    hip: [-2, -10],
    sF: [3, -18],
    eF: [8, -14],
    hF: [6, -8],
    sB: [0, -18],
    eB: [-4, -14],
    hB: [0, -8],
    kF: [6, -10],
    fF: [2, -4],
    kB: [2, -8],
    fB: [-4, -4],
  };
  p["ball:0"] = P({}, 0, BALL);
  for (let i = 0; i < 4; i++) p[`teamFly:${i}`] = P({}, i * 64, BALL);

  // Weapon swings: the renderer draws the weapon along the front forearm.
  p["swing:0"] = P({ ...lean(-3), eF: [0, -48], hF: [-4, -56], eB: [-2, -46], hB: [-5, -54] });
  p["swing:1"] = P({
    ...lean(5),
    eF: [12, -42],
    hF: [20, -38],
    eB: [10, -41],
    hB: [18, -37],
    kF: [6, -13],
    fF: [8, 0],
  });
  p["swing:2"] = P({
    ...lean(3),
    eF: [11, -32],
    hF: [16, -24],
    eB: [9, -32],
    hB: [14, -24],
    fF: [8, 0],
  });
  p["stab:0"] = P({ ...lean(-2), eF: [2, -34], hF: [6, -36] });
  p["stab:1"] = P({ ...lean(5), eF: [13, -36], hF: [22, -36], fF: [9, 0], kF: [7, -13] });
  p["stab:2"] = P({ ...lean(2), eF: [9, -35], hF: [14, -35], fF: [8, 0] });
  // shoot: throw a projectile from the shoulder.
  p["shoot:0"] = P({ ...lean(-3), eF: [-2, -42], hF: [-6, -48], eB: [6, -36], hB: [10, -38] });
  p["shoot:1"] = P({
    ...lean(5),
    eF: [12, -42],
    hF: [20, -42],
    eB: [-4, -34],
    hB: [-8, -30],
    fF: [9, 0],
  });
  p["shoot:2"] = P({
    ...lean(2),
    eF: [10, -36],
    hF: [16, -34],
    eB: [-4, -34],
    hB: [-6, -28],
    fF: [8, 0],
  });
  // charge: crouched, gathering power.
  p["charge:0"] = P({
    ...upper(-2, 4),
    eF: [8, -32],
    hF: [12, -34],
    eB: [4, -32],
    hB: [10, -33],
    kF: [7, -11],
    kB: [-6, -11],
  });
  p["charge:1"] = P({
    ...upper(-2, 5),
    eF: [8, -31],
    hF: [12, -33],
    eB: [4, -31],
    hB: [10, -32],
    kF: [7, -10],
    kB: [-6, -10],
  });

  // sleep: seated slump.
  p["sleep:0"] = P({
    head: [6, -24],
    neck: [3, -20],
    hip: [-2, -6],
    sF: [2, -19],
    eF: [6, -12],
    hF: [10, -8],
    sB: [-1, -19],
    eB: [-4, -12],
    hB: [2, -8],
    kF: [10, -8],
    fF: [16, 0],
    kB: [8, -6],
    fB: [14, 0],
  });
  p["sleep:1"] = P({
    head: [6, -23],
    neck: [3, -19],
    hip: [-2, -6],
    sF: [2, -18],
    eF: [6, -11],
    hF: [10, -7],
    sB: [-1, -18],
    eB: [-4, -11],
    hB: [2, -7],
    kF: [10, -8],
    fF: [16, 0],
    kB: [8, -6],
    fB: [14, 0],
  });

  // dizzy: wobble with stars (stars are an fx overlay).
  p["dizzy:0"] = P({ ...lean(-3), eF: [7, -30], hF: [9, -22], eB: [-7, -30], hB: [-9, -22] });
  p["dizzy:1"] = P({ ...lean(3), eF: [7, -30], hF: [9, -22], eB: [-7, -30], hB: [-9, -22] });

  // mount: kneeling over a downed opponent, punching down.
  p["mount:0"] = P({
    head: [6, -32],
    neck: [4, -26],
    hip: [-2, -12],
    sF: [6, -25],
    eF: [10, -30],
    hF: [12, -36],
    sB: [2, -25],
    eB: [6, -20],
    hB: [12, -14],
    kF: [8, -4],
    fF: [-2, 0],
    kB: [-8, -4],
    fB: [-14, 0],
  });
  p["mount:1"] = P({
    head: [7, -31],
    neck: [5, -25],
    hip: [-2, -12],
    sF: [6, -24],
    eF: [12, -18],
    hF: [14, -10],
    sB: [2, -24],
    eB: [6, -28],
    hB: [10, -34],
    kF: [8, -4],
    fF: [-2, 0],
    kB: [-8, -4],
    fB: [-14, 0],
  });

  // flip: somersault over an opponent.
  for (let i = 0; i < 3; i++) p[`flip:${i}`] = P({}, 64 + i * 64, BALL);

  // sit: seated (scooters, thrones).
  for (let i = 0; i < 4; i++) {
    const b = i % 2;
    p[`sit:${i}`] = P({
      head: [2, -40 + b],
      neck: [0, -33 + b],
      hip: [-2, -16],
      sF: [2, -31 + b],
      eF: [8, -26],
      hF: [14, -26],
      sB: [-2, -31 + b],
      eB: [2, -24],
      hB: [10, -24],
      kF: [10, -16],
      fF: [12, -4],
      kB: [8, -14],
      fB: [10, -2],
    });
  }
  // roll: lying along the ground and rolling (Pinhead Pete).
  for (let i = 0; i < 4; i++)
    p[`roll:${i}`] = P(
      { hF: [4, -30], hB: [-4, -30], eF: [4, -36], eB: [-4, -36] },
      64 + i * 4,
      STAND,
    );

  // emerge: crouched low (rising out of a manhole).
  p["emerge:0"] = P({
    ...upper(0, 14),
    kF: [8, -6],
    fF: [6, 0],
    kB: [-8, -6],
    fB: [-6, 0],
    eF: [8, -30],
    hF: [10, -40],
    eB: [-8, -30],
    hB: [-10, -40],
  });
  p["emerge:1"] = P({
    ...upper(0, 6),
    kF: [6, -10],
    kB: [-6, -10],
    eF: [8, -38],
    hF: [10, -48],
    eB: [-8, -38],
    hB: [-10, -48],
  });

  // block: forearms crossed.
  p["block:0"] = P({ ...lean(-1), eF: [10, -34], hF: [8, -44], eB: [8, -36], hB: [6, -44] });

  // camFly: flying at the camera, spread out.
  p["camFly:0"] = P({
    eF: [10, -46],
    hF: [16, -54],
    eB: [-10, -46],
    hB: [-16, -54],
    kF: [8, -12],
    fF: [12, -2],
    kB: [-8, -12],
    fB: [-12, -2],
  });
  p["camFly:1"] = P({
    eF: [11, -45],
    hF: [18, -52],
    eB: [-11, -45],
    hB: [-18, -52],
    kF: [9, -12],
    fF: [14, -3],
    kB: [-9, -12],
    fB: [-14, -3],
  });

  // panic: hands up, running away.
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    p[`panic:${i}`] = P({
      eF: [4, -48],
      hF: [6, -56],
      eB: [-4, -48],
      hB: [-6, -56],
      kF: [3 + 4 * s, -13],
      fF: [4 + 6 * s, 0],
      kB: [-3 - 4 * s, -13],
      fB: [-4 - 6 * s, 0],
    });
  }

  // play: a slide-instrument pose (arms forward at mouth height).
  p["play:0"] = P({ ...lean(1), eF: [8, -42], hF: [14, -44], eB: [6, -40], hB: [10, -44] });
  p["play:1"] = P({ ...lean(3), eF: [12, -43], hF: [22, -44], eB: [6, -40], hB: [10, -44] });

  return p;
}

function quadrupedPoses(): Record<string, Pose> {
  const p: Record<string, Pose> = {};
  const B: J = { c: [0, -6], head: [9, -8], tail: [-10, -6], lf: [5, 0], lb: [-5, 0] };
  const Q = (over: Partial<J> = {}, rot = 0) => P(over, rot, B);
  p["idle:0"] = Q();
  p["idle:1"] = Q({ head: [9, -7] });
  for (let i = 0; i < 4; i++) {
    const s = i % 2 === 0 ? 1 : -1;
    p[`walk:${i}`] = Q({ lf: [5 + 2 * s, 0], lb: [-5 - 2 * s, 0], tail: [-10, -6 - s] });
    p[`run:${i}`] = Q({
      lf: [6 + 3 * s, i < 2 ? -1 : 0],
      lb: [-6 - 3 * s, 0],
      c: [0, -7],
      tail: [-11, -8],
    });
  }
  p["atk1:0"] = Q({ head: [11, -9], c: [-1, -7] });
  p["atk1:1"] = Q({ head: [15, -6], c: [2, -6] });
  p["hurt:0"] = Q({ head: [7, -9], c: [-1, -6], tail: [-10, -9] });
  p["fall:0"] = Q({}, 32);
  p["fall:1"] = Q({}, 96);
  p["down:0"] = Q({}, 128);
  p["getup:0"] = Q({ c: [0, -4] });
  p["ko:0"] = Q({}, 128);
  p["ko:1"] = Q({ head: [9, -9] }, 128);
  p["jump:0"] = Q({ lf: [7, -3], lb: [-7, -2] });
  p["grabbed:0"] = Q({ lf: [5, -2], lb: [-5, -2] }, 8);
  p["thrown:0"] = Q({}, 64);
  p["thrown:1"] = Q({}, 160);
  p["sit:0"] = Q({ c: [-1, -7], head: [7, -13], lb: [-4, 0] });
  return p;
}

export function buildRigs(): RigFile[] {
  const humanoid = humanoidPoses();
  const required = {
    idle: 4,
    walk: 6,
    run: 6,
    jump: 3,
    atk1: 3,
    atk2: 3,
    atk3: 3,
    dashAtk: 4,
    backAtk: 3,
    grab: 2,
    grabHit: 2,
    throw: 4,
    stomp: 3,
    special: 6,
    hurt: 2,
    down: 2,
    getup: 3,
    ko: 4,
  };
  const rig = (
    id: RigFile["id"],
    frameBox: [number, number],
    anchor: [number, number],
    scale: number,
    req: Record<string, number>,
  ): RigFile => ({
    id,
    schemaVersion: 1,
    kind: id === "nonhuman" ? "nonhuman" : "humanoid",
    frameBox,
    anchor,
    scale,
    requiredStates: req,
    poses: id === "nonhuman" ? quadrupedPoses() : humanoid,
  });
  return [
    rig("small", [32, 48], [16, 46], 0.72, required),
    rig("medium", [48, 64], [24, 62], 1, required),
    rig("large", [64, 96], [32, 94], 1.3, { ...required, grabSlam: 5 }),
    rig("huge", [128, 128], [64, 126], 2, { idle: 2, walk: 4, hurt: 1, ko: 2 }),
    rig("nonhuman", [32, 24], [16, 22], 1, { idle: 2, walk: 4, atk1: 2, hurt: 1, ko: 2 }),
  ];
}
