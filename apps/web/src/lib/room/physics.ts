// The sofa simulation: soft-body potatoes landing on spring-loaded cushions. Wildly more than a lobby needs.
//
// Potatoes are rings of point masses integrated with Verlet and held in shape by shape matching
// (Müller et al., "Meshless deformations based on shape matching"), so they squash, shear and wobble back.
// The seat is one long chain of spring nodes: a landing dents the cushion, the dent ripples to the neighbours,
// and the rebound throws the potato back up. Potatoes collide with each other point-against-polygon.
// Units are stage pixels and seconds; y points down. No DOM in here.

import type { PotatoKind } from '@couchpotato/shared';

/** How a potato feels. `stiff` is the share of the way back to its shape per step; `shear` lets it squash. */
export interface Material {
  mass: number;
  stiff: number;
  shear: number;
  /** Fraction of downward speed kept as bounce when it hits the cushion. */
  bounce: number;
  friction: number;
  /** Air drag per step while falling; the chip flutters. */
  drag: number;
  flutter: number;
  /** How hard it rights itself on the seat. The fry barely bothers. */
  upright: number;
}

export const MATERIALS: Record<PotatoKind, Material> = {
  boiled: { mass: 1, stiff: 0.18, shear: 0.45, bounce: 0.15, friction: 0.5, drag: 0, flutter: 0, upright: 0.012 },
  grilled: { mass: 1.1, stiff: 0.3, shear: 0.3, bounce: 0.2, friction: 0.55, drag: 0, flutter: 0, upright: 0.012 },
  chip: { mass: 0.35, stiff: 0.45, shear: 0.25, bounce: 0.25, friction: 0.4, drag: 0.012, flutter: 1, upright: 0.01 },
  fry: { mass: 0.7, stiff: 0.6, shear: 0.15, bounce: 0.3, friction: 0.5, drag: 0, flutter: 0, upright: 0.002 },
  mashed: { mass: 1, stiff: 0.05, shear: 0.8, bounce: 0, friction: 0.8, drag: 0, flutter: 0, upright: 0.015 },
  jacket: { mass: 2.2, stiff: 0.45, shear: 0.2, bounce: 0.1, friction: 0.6, drag: 0, flutter: 0, upright: 0.012 },
  hashbrown: { mass: 1, stiff: 0.4, shear: 0.25, bounce: 0.15, friction: 0.9, drag: 0, flutter: 0, upright: 0.01 },
  sweet: { mass: 0.9, stiff: 0.22, shear: 0.4, bounce: 0.6, friction: 0.45, drag: 0, flutter: 0, upright: 0.012 },
};

// The sofa, front-on. Cushions run from LEFT to RIGHT; potatoes sit SIT pixels behind the cushion's front edge.
export const SOFA = {
  left: 458,
  right: 1182,
  seats: 12,
  armTop: 404,
  backEdge: 430,
  frontEdge: 468,
  faceBottom: 514,
  sit: 16,
  floor: 640,
} as const;
export const seatX = (seat: number) => SOFA.left + ((SOFA.right - SOFA.left) / SOFA.seats) * (seat + 0.5);

const G = 2600;
export const STEP = 1 / 240;
const NODES = SOFA.seats * 8 + 1;
const SPACING = (SOFA.right - SOFA.left) / (NODES - 1);

export interface Body {
  id: string;
  kind: PotatoKind;
  seat: number;
  mat: Material;
  n: number;
  x: Float64Array;
  y: Float64Array;
  ox: Float64Array;
  oy: Float64Array;
  /** Rest offsets from the centroid. */
  qx: Float64Array;
  qy: Float64Array;
  /** Rest centroid in sprite pixels, so the sprite can be drawn around the moving centroid. */
  spriteCx: number;
  spriteCy: number;
  invAqq: [number, number, number, number];
  /** Latest fit, for drawing: centroid and an area-preserving 2×2 deformation. */
  cx: number;
  cy: number;
  m: [number, number, number, number];
  grounded: boolean;
  /** Falling off for good (left the room); no more cushion contact. */
  ghost: boolean;
  /** Seconds since it last touched the cushion. */
  air: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface Thud {
  body: Body;
  x: number;
  y: number;
  /** Impact speed in px/s times mass. */
  force: number;
}

export class World {
  bodies: Body[] = [];
  /** Cushion surface, one node per SPACING px. */
  ny = new Float64Array(NODES).fill(SOFA.frontEdge);
  nv = new Float64Array(NODES);
  private thuds: Thud[] = [];
  private t = 0;

  /**
   * Add a potato. `outline` is its silhouette in sprite pixels, in order around the edge.
   * It starts with its centroid at (x, y), turned by `spin` radians.
   */
  add(id: string, kind: PotatoKind, seat: number, outline: [number, number][], x: number, y: number, spin = 0): Body {
    const n = outline.length;
    let sx = 0;
    let sy = 0;
    for (const [px, py] of outline) {
      sx += px;
      sy += py;
    }
    sx /= n;
    sy /= n;
    const b: Body = {
      id, kind, seat, mat: MATERIALS[kind], n,
      x: new Float64Array(n), y: new Float64Array(n), ox: new Float64Array(n), oy: new Float64Array(n),
      qx: new Float64Array(n), qy: new Float64Array(n),
      spriteCx: sx, spriteCy: sy, invAqq: [1, 0, 0, 1],
      cx: x, cy: y, m: [1, 0, 0, 1], grounded: false, ghost: false, air: 0,
      minX: 0, maxX: 0, minY: 0, maxY: 0,
    };
    let a = 0, bb = 0, d = 0;
    const cos = Math.cos(spin);
    const sin = Math.sin(spin);
    outline.forEach(([px, py], i) => {
      const qx = px - sx;
      const qy = py - sy;
      b.qx[i] = qx;
      b.qy[i] = qy;
      a += qx * qx;
      bb += qx * qy;
      d += qy * qy;
      b.x[i] = b.ox[i] = x + qx * cos - qy * sin;
      b.y[i] = b.oy[i] = y + qx * sin + qy * cos;
    });
    const det = a * d - bb * bb;
    b.invAqq = [d / det, -bb / det, -bb / det, a / det];
    this.bodies.push(b);
    return b;
  }

  /** Give a body a kick in px/s, plus some spin (rad/s). */
  kick(b: Body, vx: number, vy: number, spin = 0) {
    for (let i = 0; i < b.n; i++) {
      const rx = b.x[i] - b.cx;
      const ry = b.y[i] - b.cy;
      b.ox[i] = b.x[i] - (vx - spin * ry) * STEP;
      b.oy[i] = b.y[i] - (vy + spin * rx) * STEP;
    }
  }

  remove(b: Body) {
    this.bodies = this.bodies.filter((x) => x !== b);
  }

  /** Surface height of the cushion at x (the front edge). */
  surface(x: number): number {
    const f = (x - SOFA.left) / SPACING;
    if (f <= 0) return this.ny[0];
    if (f >= NODES - 1) return this.ny[NODES - 1];
    const i = Math.floor(f);
    const t = f - i;
    return this.ny[i] * (1 - t) + this.ny[i + 1] * t;
  }

  /** Advance one fixed step. Returns the hard landings that happened, for dust, faces and shakes. */
  step(): Thud[] {
    this.thuds = [];
    this.t += STEP;
    this.cushions();
    for (const b of this.bodies) this.integrate(b);
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.bodies) this.match(b);
      for (const b of this.bodies) this.contact(b);
      this.collideAll();
    }
    for (const b of this.bodies) this.settle(b);
    return this.thuds;
  }

  private cushions() {
    // Each node is pulled back to rest and towards its neighbours, so dents spread as ripples.
    // Seams between cushions hold a little firmer than the middle of a cushion.
    const ks = 1500;
    const kc = 3200;
    const damp = 16;
    for (let i = 0; i < NODES; i++) {
      const seam = i % 8 === 0;
      const left = i > 0 ? this.ny[i - 1] : SOFA.frontEdge;
      const right = i < NODES - 1 ? this.ny[i + 1] : SOFA.frontEdge;
      const y = this.ny[i];
      const a = -(seam ? ks * 3 : ks) * (y - SOFA.frontEdge) + kc * (left + right - 2 * y) - damp * this.nv[i];
      this.nv[i] = clamp(this.nv[i] + a * STEP, 900);
    }
    for (let i = 0; i < NODES; i++) {
      this.ny[i] += this.nv[i] * STEP;
      // A cushion compresses only so far, and never bulges above its stuffing by much.
      this.ny[i] = Math.min(Math.max(this.ny[i], SOFA.frontEdge - 10), SOFA.frontEdge + 34);
    }
  }

  private integrate(b: Body) {
    const { drag, flutter } = b.mat;
    const airborne = !b.grounded;
    const sway = airborne && flutter ? Math.sin(this.t * 9 + b.seat) * 1400 * flutter : 0;
    for (let i = 0; i < b.n; i++) {
      const k = airborne ? 1 - drag : 0.999;
      // Speed limit: nothing on a sofa should cross the room in a few frames.
      const vx = clamp((b.x[i] - b.ox[i]) * k, MAX_STEP);
      const vy = clamp((b.y[i] - b.oy[i]) * k, MAX_STEP);
      b.ox[i] = b.x[i];
      b.oy[i] = b.y[i];
      b.x[i] += vx + sway * STEP * STEP;
      b.y[i] += vy + G * STEP * STEP;
    }
    b.grounded = false;
  }

  /** Pull every point towards the best rigid-ish fit of the rest shape. */
  private match(b: Body) {
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < b.n; i++) {
      cx += b.x[i];
      cy += b.y[i];
    }
    cx /= b.n;
    cy /= b.n;
    let a = 0, bb = 0, c = 0, d = 0;
    for (let i = 0; i < b.n; i++) {
      const px = b.x[i] - cx;
      const py = b.y[i] - cy;
      a += px * b.qx[i];
      bb += px * b.qy[i];
      c += py * b.qx[i];
      d += py * b.qy[i];
    }
    // Rotation from the polar decomposition; in 2D it's just an angle.
    let angle = Math.atan2(c - bb, a + d);
    if (b.grounded || b.air < 0.05) angle *= 1 - b.mat.upright;
    const rc = Math.cos(angle);
    const rs = Math.sin(angle);
    // Linear fit A = Apq · Aqq⁻¹, scaled to keep the area so squashes look like squashes, not shrinking.
    const [i0, i1, i2, i3] = b.invAqq;
    let la = a * i0 + bb * i2;
    let lb = a * i1 + bb * i3;
    let lc = c * i0 + d * i2;
    let ld = c * i1 + d * i3;
    const det = la * ld - lb * lc;
    // A collapsed or inside-out fit says nothing useful; fall back to the plain rotation that step.
    const sane = det > 0.3 && Math.abs(la) + Math.abs(lb) + Math.abs(lc) + Math.abs(ld) < 5 * Math.sqrt(det);
    const norm = sane ? 1 / Math.sqrt(det) : 0;
    la = sane ? la * norm : rc;
    lb = sane ? lb * norm : -rs;
    lc = sane ? lc * norm : rs;
    ld = sane ? ld * norm : rc;
    const s = b.mat.shear;
    const ma = s * la + (1 - s) * rc;
    const mb = s * lb + (1 - s) * -rs;
    const mc = s * lc + (1 - s) * rs;
    const md = s * ld + (1 - s) * rc;
    const k = b.mat.stiff;
    for (let i = 0; i < b.n; i++) {
      const gx = cx + ma * b.qx[i] + mb * b.qy[i];
      const gy = cy + mc * b.qx[i] + md * b.qy[i];
      b.x[i] += (gx - b.x[i]) * k;
      b.y[i] += (gy - b.y[i]) * k;
    }
    b.cx = cx;
    b.cy = cy;
    // What the eye should see: mostly the deformation, with the rotation.
    b.m = [0.75 * la + 0.25 * rc, 0.75 * lb - 0.25 * rs, 0.75 * lc + 0.25 * rs, 0.75 * ld + 0.25 * rc];
  }

  private contact(b: Body) {
    const pm = b.mat.mass / b.n;
    for (let i = 0; i < b.n; i++) {
      const x = b.x[i];
      let y = b.y[i];
      // Arms: a flat top, and side walls the potatoes can't pass through below it.
      const inLeftArm = x < SOFA.left && x > SOFA.left - 48;
      const inRightArm = x > SOFA.right && x < SOFA.right + 48;
      if (!b.ghost && (inLeftArm || inRightArm) && y > SOFA.armTop) {
        if (b.oy[i] <= SOFA.armTop + 1) {
          b.y[i] = SOFA.armTop;
          b.grounded = true;
        } else {
          b.x[i] = inLeftArm ? SOFA.left : SOFA.right;
          b.ox[i] = b.x[i];
        }
        continue;
      }
      if (!b.ghost && x >= SOFA.left && x <= SOFA.right) {
        const surf = this.surface(x) - SOFA.sit;
        // Only things arriving from above land on the seat; something on the floor stays in front of the sofa.
        if (y > surf && b.oy[i] < surf + 24) {
          const depth = y - surf;
          const vy = (b.y[i] - b.oy[i]) / STEP;
          // The cushion gives: part of the overlap is the potato rising, part is the cushion sinking.
          const give = Math.min(0.85, pm * 6);
          // A rising cushion lifts, it doesn't launch: cap how far one step can shove a point up.
          y = Math.max(surf + depth * give, y - 2.5);
          b.y[i] = y;
          this.press(x, depth * give, vy * pm);
          // Friction slides less; bounce keeps a little of the fall.
          b.ox[i] = b.x[i] - (b.x[i] - b.ox[i]) * (1 - b.mat.friction);
          if (vy > 0) b.oy[i] = b.y[i] + vy * STEP * b.mat.bounce;
          if (vy > 700) this.thud(b, x, y, vy);
          b.grounded = true;
          b.air = 0;
        }
      }
      if (y > SOFA.floor) {
        b.y[i] = SOFA.floor;
        b.grounded = true;
      }
    }
  }

  /** Push the cushion down around x by `depth`, adding the impact's momentum so it sinks and springs back. */
  private press(x: number, depth: number, momentum: number) {
    const f = (x - SOFA.left) / SPACING;
    const i = Math.max(0, Math.min(NODES - 2, Math.floor(f)));
    const t = f - i;
    this.ny[i] += depth * (1 - t);
    this.ny[i + 1] += depth * t;
    const kick = Math.min(Math.max(0, momentum) * 0.03, 60);
    this.nv[i] += kick * (1 - t);
    this.nv[i + 1] += kick * t;
  }

  private thud(b: Body, x: number, y: number, vy: number) {
    const force = vy * b.mat.mass;
    const prev = this.thuds.find((t) => t.body === b);
    if (prev) prev.force = Math.max(prev.force, force);
    else this.thuds.push({ body: b, x, y, force });
  }

  private collideAll() {
    for (const b of this.bodies) bounds(b);
    for (let i = 0; i < this.bodies.length; i++) {
      for (let j = i + 1; j < this.bodies.length; j++) {
        const a = this.bodies[i];
        const b = this.bodies[j];
        if (a.ghost || b.ghost) continue;
        if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) continue;
        pushOut(a, b);
        pushOut(b, a);
      }
    }
  }

  /**
   * Seated potatoes stop rolling and shuffle back towards their own seat,
   * so a sofa of them settles into a row instead of a heap on the floor.
   */
  private settle(b: Body) {
    if (!b.grounded) {
      b.air += STEP;
      return;
    }
    if (b.ghost) return;
    let mvx = 0;
    let mvy = 0;
    for (let i = 0; i < b.n; i++) {
      mvx += b.x[i] - b.ox[i];
      mvy += b.y[i] - b.oy[i];
    }
    mvx /= b.n;
    mvy /= b.n;
    // Bleed off spin (each point's velocity relative to the body's) and most sliding.
    for (let i = 0; i < b.n; i++) {
      const rvx = b.x[i] - b.ox[i] - mvx;
      const rvy = b.y[i] - b.oy[i] - mvy;
      b.ox[i] += rvx * 0.06 + mvx * 0.04;
      b.oy[i] += rvy * 0.06 + mvy * (0.1 - b.mat.bounce * 0.12);
    }
    const dx = seatX(b.seat) - b.cx;
    if (Math.abs(dx) < 1.5) return;
    const pull = Math.sign(dx) * Math.min(Math.abs(dx), 50) * 0.004;
    for (let i = 0; i < b.n; i++) b.x[i] += pull;
  }
}

const MAX_STEP = 5000 * STEP;
const clamp = (v: number, max: number) => (v > max ? max : v < -max ? -max : v);

function bounds(b: Body) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < b.n; i++) {
    if (b.x[i] < minX) minX = b.x[i];
    if (b.x[i] > maxX) maxX = b.x[i];
    if (b.y[i] < minY) minY = b.y[i];
    if (b.y[i] > maxY) maxY = b.y[i];
  }
  b.minX = minX;
  b.maxX = maxX;
  b.minY = minY;
  b.maxY = maxY;
}

function inside(b: Body, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = b.n - 1; i < b.n; j = i++) {
    if (b.y[i] > y !== b.y[j] > y && x < ((b.x[j] - b.x[i]) * (y - b.y[i])) / (b.y[j] - b.y[i]) + b.x[i]) hit = !hit;
  }
  return hit;
}

/** Every point of `a` that ended up inside `b` is pushed to b's nearest edge; the edge takes its share back. */
function pushOut(a: Body, b: Body) {
  const wa = b.mat.mass / (a.mat.mass + b.mat.mass);
  for (let i = 0; i < a.n; i++) {
    const px = a.x[i];
    const py = a.y[i];
    if (px < b.minX || px > b.maxX || py < b.minY || py > b.maxY || !inside(b, px, py)) continue;
    let best = Infinity;
    let bj = 0;
    let bt = 0;
    let bx = 0;
    let by = 0;
    for (let j = 0; j < b.n; j++) {
      const k = (j + 1) % b.n;
      const ex = b.x[k] - b.x[j];
      const ey = b.y[k] - b.y[j];
      const len = ex * ex + ey * ey || 1;
      const t = Math.max(0, Math.min(1, ((px - b.x[j]) * ex + (py - b.y[j]) * ey) / len));
      const cx = b.x[j] + ex * t;
      const cy = b.y[j] + ey * t;
      const d = (px - cx) ** 2 + (py - cy) ** 2;
      if (d < best) {
        best = d;
        bj = j;
        bt = t;
        bx = cx;
        by = cy;
      }
    }
    const dx = clamp(bx - px, 4);
    const dy = clamp(by - py, 4);
    a.x[i] += dx * wa;
    a.y[i] += dy * wa;
    const k = (bj + 1) % b.n;
    const wb = 1 - wa;
    b.x[bj] -= dx * wb * (1 - bt);
    b.y[bj] -= dy * wb * (1 - bt);
    b.x[k] -= dx * wb * bt;
    b.y[k] -= dy * wb * bt;
  }
}
