// Turns the SVG potatoes into images the sofa canvas can draw thousands of times a second,
// and samples each potato's outline so its physics hull matches its art exactly.

import { flushSync, mount, unmount } from 'svelte';
import type { PotatoKind } from '@couchpotato/shared';
import Potato from '../Potato.svelte';
import { POTATOES, POTATO_LOOKS, type PotatoFace } from '../potatoes';

/** Sprites are drawn into a 100-unit box scaled to this many stage pixels. */
/** Drawn size of a potato on the TV, in room pixels; sized so twelve fit along the sofa. */
export const SPRITE = 88;
const RASTER = 256;
const FACES: PotatoFace[] = ['happy', 'blink', 'sleep', 'ouch'];

export type Sprites = Map<string, HTMLImageElement>;
export const spriteKey = (kind: PotatoKind, face: PotatoFace) => `${kind}:${face}`;

/** Images don't see the page's CSS, so every var(--token) is swapped for its current value first. */
function resolveVars(svg: string): string {
  const root = getComputedStyle(document.documentElement);
  return svg.replace(/var\((--[\w-]+)\)/g, (_, name: string) => root.getPropertyValue(name).trim() || 'transparent');
}

export async function buildSprites(): Promise<Sprites> {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden';
  document.body.append(host);
  const out: Sprites = new Map();
  try {
    const jobs: Promise<void>[] = [];
    for (const { kind } of POTATOES) {
      for (const face of FACES) {
        const app = mount(Potato, { target: host, props: { kind, face, size: RASTER, still: true, shadow: false } });
        flushSync();
        const el = host.lastElementChild as SVGSVGElement;
        el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        const markup = resolveVars(new XMLSerializer().serializeToString(el));
        unmount(app);
        const img = new Image(RASTER, RASTER);
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
        out.set(spriteKey(kind, face), img);
        jobs.push(img.decode().catch(() => undefined));
      }
    }
    await Promise.all(jobs);
  } finally {
    host.remove();
  }
  return out;
}

/** Points around the potato's outline, in sprite pixels, with its tilt applied, in drawing order. */
export function outline(kind: PotatoKind, points = 20): [number, number][] {
  const look = POTATO_LOOKS[kind];
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', look.body);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = 'position:absolute;width:0;height:0';
  svg.append(path);
  document.body.append(svg);
  const len = path.getTotalLength();
  const tilt = ((look.tilt ?? 0) * Math.PI) / 180;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const scale = SPRITE / 100;
  const pts: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const p = path.getPointAtLength((len * i) / points);
    // Same rotation the art uses: about (50, 56).
    const x = 50 + (p.x - 50) * cos - (p.y - 56) * sin;
    const y = 56 + (p.x - 50) * sin + (p.y - 56) * cos;
    pts.push([x * scale, y * scale]);
  }
  svg.remove();
  return pts;
}
