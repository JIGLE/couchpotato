// The 3D living room behind the TV lobby, ported from the design mockup (three r147).
// The static room is pre-rendered into a supersampled "plate" (re-baked on mood change or resize);
// each frame only draws the potatoes, a few live props and the seat dents, then a colour grade.
// Colours inside the scene are lighting design, not UI, so they live here rather than in tokens.css.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GammaCorrectionShader } from 'three/examples/jsm/shaders/GammaCorrectionShader.js';

const T = Object.assign({}, THREE, {
  RoomEnvironment, EffectComposer, Pass, ShaderPass, UnrealBloomPass, GammaCorrectionShader,
  BufferGeometryUtils: { mergeBufferGeometries }
});
const LAYER_SPUDS = 1;

/** @param {HTMLCanvasElement} canvas @param {HTMLElement} tagsEl @param {import('./room').RoomOptions} opts */
export function createRoom(canvas, tagsEl, opts) {
  T.ColorManagement.legacyMode = false; // hex colours below are sRGB
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var alive = true, rafId = 0, cleanups = [];
  function listen(target, type, fn) { target.addEventListener(type, fn); cleanups.push(function () { target.removeEventListener(type, fn); }); }

  // ================= renderer =================
  var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  // Quality tiers. The room itself is drawn once, supersampled, with its bloom and depth of field
  // (see "the plate"), so a frame only pays for the potatoes and the colour grade. The loop only
  // trims sharpness and MSAA if a screen really can't hold 60fps.
  var QUALITY = [
    { pr: 1.5, msaa: 4, bloom: true, dof: true }, { pr: 1.25, msaa: 4, bloom: true, dof: true }, { pr: 1, msaa: 4, bloom: true, dof: true },
    { pr: 1, msaa: 2, bloom: true, dof: true }, { pr: 0.85, msaa: 2, bloom: true, dof: true }];
  var tier = 0;
  function pixelRatio() { return Math.min(window.devicePixelRatio || 1, QUALITY[tier].pr); }
  renderer.setPixelRatio(pixelRatio());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputEncoding = T.sRGBEncoding;

  var scene = new T.Scene();
  // The room is modelled with its corner at the back left, then mirrored so the sofa sits on the right of the TV, clear of the join panel.
  var world = new T.Group(); world.scale.x = -1; scene.add(world);
  var WALL_X = -2.0, BACK_Z = -3;
  scene.background = new T.Color('#120d0a');
  var pmrem = new T.PMREMGenerator(renderer);
  if (T.RoomEnvironment) scene.environment = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;

  var camera = new T.PerspectiveCamera(34, 16 / 9, 0.5, 40); // tight near/far: the plate's depth is reused every frame
  // Camera in room coordinates (x is mirrored when it is placed).
  var camTarget = new T.Vector3(0.05, 0.75, -1.1);
  var camBase = new T.Vector3(3.5, 2.9, 4.5);

  // ================= small helpers =================
  function rand(seed) { var s = seed % 2147483647; if (s <= 0) s += 2147483646; return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

  // Tileable value noise, for every procedural texture.
  function makeNoise(seed) {
    var r = rand(seed), g = new Float32Array(512 * 512);
    for (var i = 0; i < g.length; i++) g[i] = r();
    return function (x, y, p) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      var u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
      function v(a, b) { a = (((a % p) + p) % p) & 511; b = (((b % p) + p) % p) & 511; return g[a * 512 + b]; }
      var a = v(xi, yi) + (v(xi + 1, yi) - v(xi, yi)) * u, b = v(xi, yi + 1) + (v(xi + 1, yi + 1) - v(xi, yi + 1)) * u;
      return a + (b - a) * w;
    };
  }
  var N = makeNoise(1234);
  function fbm(x, y, p, oct) { var s = 0, a = 0.5, f = 1, n = 0; for (var o = 0; o < oct; o++) { s += a * N(x * f, y * f, p * f); n += a; a *= 0.5; f *= 2; } return s / n; }

  function tex(canvasEl, srgb, rx, ry) {
    var t = new T.CanvasTexture(canvasEl);
    t.encoding = srgb ? T.sRGBEncoding : T.LinearEncoding;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    t.wrapS = t.wrapT = T.RepeatWrapping;
    if (rx) t.repeat.set(rx, ry || rx);
    return t;
  }
  function paint(w, h, fn) { var c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); return c; }
  // Height field (0..1) -> tangent-space normal map.
  function normalMap(size, heightAt, strength) {
    var H = new Float32Array(size * size);
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) H[y * size + x] = heightAt(x, y);
    return tex(paint(size, size, function (c) {
      var img = c.createImageData(size, size), d = img.data;
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        var l = H[y * size + ((x - 1 + size) % size)], r = H[y * size + ((x + 1) % size)];
        var u = H[((y - 1 + size) % size) * size + x], dn = H[((y + 1) % size) * size + x];
        var nx = (l - r) * strength, ny = (u - dn) * strength, nz = 1, len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        var i = (y * size + x) * 4;
        d[i] = (nx / len * 0.5 + 0.5) * 255; d[i + 1] = (ny / len * 0.5 + 0.5) * 255; d[i + 2] = (nz / len * 0.5 + 0.5) * 255; d[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    }), false);
  }
  function greyMap(size, valueAt) {
    return tex(paint(size, size, function (c) {
      var img = c.createImageData(size, size), d = img.data;
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) { var v = clamp(valueAt(x, y), 0, 1) * 255, i = (y * size + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      c.putImageData(img, 0, 0);
    }), true);
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  // ----- geometry: welded, smoothly shaded rounded boxes -----
  function weld(g) {
    var p = g.attributes.position, src = g.index.array, map = new Map(), pos = [], remap = new Uint32Array(p.count);
    for (var i = 0; i < p.count; i++) {
      var k = Math.round(p.getX(i) * 2e4) + ',' + Math.round(p.getY(i) * 2e4) + ',' + Math.round(p.getZ(i) * 2e4);
      var j = map.get(k);
      if (j === undefined) { j = pos.length / 3; map.set(k, j); pos.push(p.getX(i), p.getY(i), p.getZ(i)); }
      remap[i] = j;
    }
    var out = new T.BufferGeometry(), idx = [];
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    for (var n = 0; n < src.length; n += 3) {
      var a = remap[src[n]], b = remap[src[n + 1]], c = remap[src[n + 2]];
      if (a !== b && b !== c && a !== c) idx.push(a, b, c);
    }
    out.setIndex(idx); out.computeVertexNormals(); return out;
  }
  // Box-projected UVs in metres, chosen by each vertex's dominant normal.
  function boxUV(g, s) {
    var p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
    for (var i = 0; i < p.count; i++) {
      var ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), u, v;
      if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); } else if (ay >= az) { u = p.getX(i); v = p.getZ(i); } else { u = p.getX(i); v = p.getY(i); }
      uv[i * 2] = u * s; uv[i * 2 + 1] = v * s;
    }
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    return g;
  }
  // More vertices near the edges, so the rounding is clean without a huge mesh.
  function warp(u, h, r) {
    var t = Math.abs(u) / h, a = 0.5, inner = h - r;
    var v = t < a ? t / a * inner : inner + (t - a) / (1 - a) * r;
    return u < 0 ? -v : v;
  }
  function roundBox(w, h, d, r, sx, sy, sz, o) {
    o = o || {};
    var g = new T.BoxGeometry(w, h, d, sx, sy, sz), p = g.attributes.position;
    var hw = w / 2, hh = h / 2, hd = d / 2;
    for (var i = 0; i < p.count; i++) {
      var x = warp(p.getX(i), hw, r), y = warp(p.getY(i), hh, r), z = warp(p.getZ(i), hd, r);
      var ix = clamp(x, -(hw - r), hw - r), iy = clamp(y, -(hh - r), hh - r), iz = clamp(z, -(hd - r), hd - r);
      var nx = x - ix, ny = y - iy, nz = z - iz, l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l > 1e-7) { x = ix + nx / l * r; y = iy + ny / l * r; z = iz + nz / l * r; }
      if (o.pillow && y > 0) y += o.pillow * (1 - Math.pow(Math.abs(x) / hw, 6)) * (1 - Math.pow(Math.abs(z) / hd, 4)) * (y / hh);
      if (o.front && z > hd - r) z += o.front(x, y) * smooth(hd - r, hd, z);
      p.setXYZ(i, x, y, z);
    }
    return boxUV(weld(g), o.uv || 4);
  }

  // Drops the triangles nobody can see (sofa backs against the wall, undersides), so the GPU skips them.
  function dropFaces(g, hide) {
    var p = g.attributes.position, ix = g.index.array, keep = [], a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), n = new T.Vector3();
    for (var i = 0; i < ix.length; i += 3) {
      a.fromBufferAttribute(p, ix[i]); b.fromBufferAttribute(p, ix[i + 1]); c.fromBufferAttribute(p, ix[i + 2]);
      n.subVectors(c, b).cross(a.sub(b)).normalize();
      if (!hide(n)) keep.push(ix[i], ix[i + 1], ix[i + 2]);
    }
    g.setIndex(keep); return g;
  }

  // Bakes every static mesh under root into one mesh per material, so the room costs a few dozen
  // draw calls instead of hundreds. Anything that moves, or is see-through, is left alone.
  function mergeStatic(root, skip) {
    if (!T.BufferGeometryUtils) return;
    root.updateMatrixWorld(true);
    var inv = new T.Matrix4().copy(root.matrixWorld).invert(), groups = {}, victims = new Set();
    root.traverse(function (o) {
      if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.material.transparent || skip(o)) return;
      for (var q = o; q && q !== root; q = q.parent) if (!q.visible || skip(q)) return;
      var g = o.geometry, key = [o.material.uuid, o.castShadow, o.receiveShadow, !!g.index, Object.keys(g.attributes).sort().join(), o.layers.mask].join('|');
      (groups[key] = groups[key] || []).push(o);
    });
    Object.keys(groups).forEach(function (k) {
      var list = groups[k]; if (list.length < 2) return;
      var geos = list.map(function (o) {
        var m = new T.Matrix4().multiplyMatrices(inv, o.matrixWorld), g = o.geometry.clone();
        g.morphAttributes = {}; g.clearGroups(); g.applyMatrix4(m);
        if (m.determinant() < 0) { // a mirrored mesh: flip the winding so it still faces out
          if (g.index) { var ia = g.index.array; for (var i = 0; i < ia.length; i += 3) { var t = ia[i + 1]; ia[i + 1] = ia[i + 2]; ia[i + 2] = t; } }
          else { var at = g.attributes; Object.keys(at).forEach(function (n) { var a = at[n], s = a.itemSize; for (var v = 0; v < a.count; v += 3) for (var c = 0; c < s; c++) { var x = a.array[(v + 1) * s + c]; a.array[(v + 1) * s + c] = a.array[(v + 2) * s + c]; a.array[(v + 2) * s + c] = x; } }); }
        }
        return g;
      });
      var merged = T.BufferGeometryUtils.mergeBufferGeometries(geos, false);
      if (!merged) return;
      var mesh = new T.Mesh(merged, list[0].material); mesh.castShadow = list[0].castShadow; mesh.receiveShadow = list[0].receiveShadow; mesh.layers.mask = list[0].layers.mask;
      root.add(mesh);
      list.forEach(function (o) { victims.add(o); });
    });
    victims.forEach(function (o) {
      o.children.slice().forEach(function (c) { if (!victims.has(c)) root.attach(c); });
      if (o.parent) o.parent.remove(o);
    });
  }

  // The seats: potatoes press real dents into the velvet. The dents are worked out on the GPU in the
  // vertex shader (with matching normals), so twelve bouncing potatoes cost no CPU at all.
  var MAX_DENTS = 12;
  function seatMaterial(run) {
    run.dents = []; for (var i = 0; i < MAX_DENTS; i++) run.dents.push(new T.Vector4(0, 0, 0, 1));
    var m = M.velvet.clone();
    // The plate holds the cushions at rest. Each frame the cushion is drawn again only near a dent,
    // fading out (alpha) well before the dent does, so the live cushion melts into the plate.
    run.liveU = { value: 1 }; m.transparent = true;
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uDents = { value: run.dents }; sh.uniforms.uSeat = { value: new T.Vector3(run.L / 2, SEAT_H / 2, SEAT_D / 2) }; sh.uniforms.uLive = run.liveU;
      sh.fragmentShader = 'uniform float uLive; varying float vDentK;\n' + sh.fragmentShader
        .replace('void main() {', 'void main() {\n  if (uLive > 0.5 && vDentK < 0.03) discard;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  if (uLive > 0.5) gl_FragColor.a *= smoothstep(0.03, 0.55, vDentK);');
      sh.vertexShader = sh.vertexShader.replace('void main() {', [
        'uniform vec4 uDents[' + MAX_DENTS + ']; uniform vec3 uSeat;',
        'float seatDent(vec3 q) {',
        '  float lx = q.x + uSeat.x, d = 0.0;',
        '  for (int j = 0; j < ' + MAX_DENTS + '; j++) { vec4 u = uDents[j]; vec2 k = vec2((lx - u.x) / u.w, (q.z - u.y) / 0.2); d += u.z * exp(-dot(k, k)); }',
        '  float edge = clamp((uSeat.x - abs(q.x)) / 0.1, 0.0, 1.0) * clamp((uSeat.z - 0.0 - abs(q.z)) / 0.14, 0.0, 1.0);',
        '  return min(0.12, d) * edge * smoothstep(0.0, uSeat.y, q.y);',
        '}',
        'varying float vDentK;',
        'float seatNear(vec3 q) {',
        '  float lx = q.x + uSeat.x, k = 0.0;',
        '  for (int j = 0; j < ' + MAX_DENTS + '; j++) { vec4 u = uDents[j]; if (u.z > 0.0005) { vec2 c = vec2((lx - u.x) / u.w, (q.z - u.y) / 0.2) * 0.55; k += exp(-dot(c, c)); } }',
        '  return k * 1.5;',
        '}',
        'void main() {',
        '  vDentK = seatNear(position);'].join('\n'));
      sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', [
        '#include <beginnormal_vertex>',
        'float cpD = seatDent(position);',
        'if (cpD > 0.0) {',
        '  float e = 0.012;',
        '  float gx = (seatDent(position + vec3(e, 0.0, 0.0)) - seatDent(position - vec3(e, 0.0, 0.0))) / (2.0 * e);',
        '  float gz = (seatDent(position + vec3(0.0, 0.0, e)) - seatDent(position - vec3(0.0, 0.0, e))) / (2.0 * e);',
        '  objectNormal = normalize(objectNormal + vec3(gx, 0.0, gz) * max(objectNormal.y, 0.0));',
        '}'].join('\n'));
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y -= cpD;');
    };
    return m;
  }

  // ================= textures =================
  // Velvet: fine pile noise plus a soft "crushed" mottling.
  var velvetN = normalMap(256, function (x, y) { return fbm(x / 8, y / 8, 32, 3) * 0.6 + fbm(x / 2, y / 2, 128, 2) * 0.4; }, 2.2);
  var velvetC = greyMap(256, function (x, y) { return 0.86 + 0.14 * fbm(x / 64, y / 64, 4, 3); });
  // Linen: crossed threads.
  var linenN = normalMap(256, function (x, y) {
    var a = Math.sin(x * Math.PI / 2) * 0.5 + 0.5, b = Math.sin(y * Math.PI / 2) * 0.5 + 0.5;
    return (x + y) % 4 < 2 ? a * 0.6 + fbm(x / 4, y / 32, 64, 2) * 0.4 : b * 0.6 + fbm(x / 32, y / 4, 8, 2) * 0.4;
  }, 1.4);
  var linenC = greyMap(256, function (x, y) { return 0.88 + 0.12 * fbm(x / 3, y / 40, 85, 2); });
  // Chunky knit: rows of V stitches.
  var knitH = function (x, y) {
    var cw = 16, ch = 256 / 12, cx = x % cw, cy = (y + (Math.floor(x / cw) % 2) * 0) % ch;
    var side = cx < cw / 2 ? 1 : -1, lx = (cx - cw / 2) * side, ly = cy - ch / 2;
    var ex = (lx - 4 - ly * 0.28) / 3.6, ey = ly / 9.5, e = 1 - (ex * ex + ey * ey);
    return clamp(e, 0, 1) * 0.85 + fbm(x / 4, y / 4, 64, 2) * 0.15;
  };
  var knitN = normalMap(256, knitH, 3.2);
  var knitC = greyMap(256, function (x, y) { return 0.62 + 0.38 * Math.pow(knitH(x, y), 0.6); });
  // Wool rug: dense tufts.
  var woolN = normalMap(256, function (x, y) { return fbm(x / 3, y / 3, 85, 3) * 0.7 + (Math.sin(x * 1.6) * Math.sin(y * 1.6) * 0.5 + 0.5) * 0.3; }, 2.4);
  // Potato skin: freckles and little eye pits.
  var skinN = normalMap(256, function (x, y) {
    var h = fbm(x / 20, y / 20, 13, 4) * 0.7 + fbm(x / 3, y / 3, 85, 2) * 0.3;
    var pit = N(x / 40, y / 40, 7); if (pit > 0.88) h -= (pit - 0.88) * 4;
    return h;
  }, 2.5);
  var skinC = greyMap(256, function (x, y) { var s = fbm(x / 6, y / 6, 43, 3); return 0.9 + 0.1 * fbm(x / 40, y / 40, 7, 3) - (s > 0.72 ? (s - 0.72) * 1.6 : 0); });
  // Painted plaster for the wainscot.
  var paintN = normalMap(256, function (x, y) { return fbm(x / 16, y / 16, 16, 4); }, 0.8);

  // Wallpaper: a quiet damask lattice.
  var wallC = tex(paint(512, 512, function (c, w, h) {
    c.fillStyle = '#ead2ad'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(176,120,70,0.22)'; c.fillStyle = 'rgba(176,120,70,0.16)'; c.lineWidth = 5;
    for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
      [[0, 0], [256, 256]].forEach(function (o) {
        var cx = o[0] + ox * 512 + 128, cy = o[1] + oy * 512 + 128;
        c.beginPath();
        c.moveTo(cx, cy - 92); c.bezierCurveTo(cx + 46, cy - 60, cx + 70, cy - 20, cx + 30, cy + 10);
        c.bezierCurveTo(cx + 70, cy + 40, cx + 40, cy + 80, cx, cy + 92);
        c.bezierCurveTo(cx - 40, cy + 80, cx - 70, cy + 40, cx - 30, cy + 10);
        c.bezierCurveTo(cx - 70, cy - 20, cx - 46, cy - 60, cx, cy - 92);
        c.stroke();
        c.beginPath(); c.arc(cx, cy, 16, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.ellipse(cx, cy - 46, 7, 18, 0, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.ellipse(cx, cy + 46, 7, 18, 0, 0, Math.PI * 2); c.fill();
      });
    }
    var img = c.getImageData(0, 0, w, h), d = img.data;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var k = (y * w + x) * 4, n = (fbm(x / 8, y / 8, 64, 3) - 0.5) * 18; d[k] += n; d[k + 1] += n; d[k + 2] += n; }
    c.putImageData(img, 0, 0);
  }), true, 15, 5.2);
  var wallN = normalMap(256, function (x, y) { return fbm(x / 6, y / 6, 43, 3); }, 0.7);

  // Oak floor boards with grain, gaps and per-board tone.
  var floorC = tex(paint(1024, 1024, function (c, w, h) {
    var r = rand(9), rows = 8, bh = h / rows, img = c.createImageData(w, h), d = img.data;
    var starts = [];
    for (var row = 0; row < rows; row++) { var xs = [-r() * 400], x = xs[0]; while (x < w) { x += 380 + r() * 420; xs.push(x); } starts.push(xs.map(function (v) { return [v, r(), r()]; })); }
    for (var y = 0; y < h; y++) {
      var row2 = Math.floor(y / bh), ly = y - row2 * bh, xs2 = starts[row2];
      for (var x2 = 0; x2 < w; x2++) {
        var bi = 0; while (bi < xs2.length - 1 && xs2[bi + 1][0] <= x2) bi++;
        var b = xs2[bi], tone = b[1], seed = b[2];
        var grain = Math.sin((ly + fbm(x2 / 90 + seed * 9, ly / 30, 64, 3) * 70) * 0.35 + seed * 40) * 0.5 + 0.5;
        var fine = fbm(x2 / 3, ly / 1.5, 341, 2);
        var l = 0.36 + tone * 0.1 + grain * 0.06 + fine * 0.05;
        var gap = (ly < 2 || x2 - b[0] < 2) ? 0.35 : 1;
        var k = (y * w + x2) * 4;
        d[k] = 255 * Math.min(1, l * 1.55) * gap; d[k + 1] = 255 * l * 1.02 * gap; d[k + 2] = 255 * l * 0.62 * gap; d[k + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
  }), true, 5, 5);
  var floorN = normalMap(512, function (x, y) { var bh = 64, ly = y % bh; return (ly < 2 ? 0 : 1) * 0.8 + fbm(x / 40, y / 3, 13, 2) * 0.2; }, 2.0);
  floorN.repeat.set(5, 5);
  // Varnish that is glossier in some boards and scuffed in others.
  var floorR = greyMap(512, function (x, y) { var row = Math.floor(y / 64); return 0.7 + 0.35 * fbm(x / 70 + row * 3.1, y / 10, 7, 3) + 0.25 * Math.max(0, fbm(x / 9, y / 9, 57, 2) - 0.55); });
  floorR.encoding = T.LinearEncoding; floorR.repeat.set(5, 5);
  // Walnut: turned grain, darker latewood and a little figure.
  var walnutC = greyMap(512, function (x, y) { var w = fbm(x / 60, y / 60, 8, 3) * 9; var ring = 0.5 + 0.5 * Math.sin((y / 512 * 34 + w) * Math.PI * 2); return 0.76 + 0.14 * Math.pow(ring, 3) + 0.12 * fbm(x / 4, y / 30, 128, 2); });

  // The rug: a woven terracotta field with borders.
  var rugC = tex(paint(1024, 640, function (c, w, h) {
    c.fillStyle = '#9a3a26'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e9b54d'; rr(c, 34, 34, w - 68, h - 68, 26); c.fill();
    c.fillStyle = '#7e2c1e'; rr(c, 52, 52, w - 104, h - 104, 20); c.fill();
    c.fillStyle = '#b4472e'; rr(c, 92, 92, w - 184, h - 184, 16); c.fill();
    c.strokeStyle = '#f1dfbd'; c.lineWidth = 6; c.setLineDash([18, 14]); rr(c, 72, 72, w - 144, h - 144, 18); c.stroke(); c.setLineDash([]);
    // centre medallion and corner motifs
    function diamond(x, y, s, col) { c.fillStyle = col; c.beginPath(); c.moveTo(x, y - s); c.lineTo(x + s * 1.4, y); c.lineTo(x, y + s); c.lineTo(x - s * 1.4, y); c.closePath(); c.fill(); }
    diamond(w / 2, h / 2, 120, '#e9b54d'); diamond(w / 2, h / 2, 96, '#7e2c1e'); diamond(w / 2, h / 2, 66, '#f1dfbd'); diamond(w / 2, h / 2, 34, '#2f6f6a');
    [[180, 180], [w - 180, 180], [180, h - 180], [w - 180, h - 180]].forEach(function (p) { diamond(p[0], p[1], 34, '#e9b54d'); diamond(p[0], p[1], 18, '#7e2c1e'); });
    for (var i = 0; i < 18; i++) { diamond(130 + i * ((w - 260) / 17), 72, 7, '#7e2c1e'); diamond(130 + i * ((w - 260) / 17), h - 72, 7, '#7e2c1e'); }
    var img = c.getImageData(0, 0, w, h), d = img.data;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var k = (y * w + x) * 4, n = (fbm(x / 2.5, y / 2.5, 409, 2) - 0.5) * 34 + (fbm(x / 60, y / 60, 17, 3) - 0.5) * 22; d[k] += n; d[k + 1] += n; d[k + 2] += n; }
    c.putImageData(img, 0, 0);
  }), true);
  rugC.wrapS = rugC.wrapT = T.ClampToEdgeWrapping;

  // ================= materials =================
  var M = {};
  function phys(o) { return new T.MeshPhysicalMaterial(o); }
  M.velvet = phys({ color: '#155c36', roughness: 0.82, sheen: 0.75, sheenRoughness: 0.42, sheenColor: new T.Color('#4aad72'), normalMap: velvetN, normalScale: new T.Vector2(0.35, 0.35), map: velvetC });
  M.velvetDeep = phys({ color: '#0f4226', roughness: 0.85, sheen: 1, sheenRoughness: 0.4, sheenColor: new T.Color('#3e9a61'), normalMap: velvetN, normalScale: new T.Vector2(0.35, 0.35), map: velvetC });
  // Undersides and wall-facing backs are not modelled, so shadows are drawn from both sides.
  M.velvet.shadowSide = T.DoubleSide;
  M.velvetDeep.shadowSide = T.DoubleSide;
  M.walnut = phys({ color: '#6a3e22', map: walnutC, roughness: 0.42, roughnessMap: walnutC, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  M.brass = new T.MeshStandardMaterial({ color: '#d8b06a', roughness: 0.28, metalness: 1 });
  M.gold = new T.MeshStandardMaterial({ color: '#e7b85a', roughness: 0.22, metalness: 1 });
  M.wall = new T.MeshStandardMaterial({ map: wallC, normalMap: wallN, normalScale: new T.Vector2(0.5, 0.5), roughness: 0.9 });
  M.wainscot = new T.MeshStandardMaterial({ color: '#5a2a22', roughness: 0.55, normalMap: paintN, normalScale: new T.Vector2(0.3, 0.3) });
  M.trim = new T.MeshStandardMaterial({ color: '#f2e6d0', roughness: 0.45, normalMap: paintN, normalScale: new T.Vector2(0.2, 0.2) });
  M.floor = phys({ map: floorC, normalMap: floorN, normalScale: new T.Vector2(0.6, 0.6), roughness: 0.42, roughnessMap: floorR, clearcoat: 0.55, clearcoatRoughness: 0.22 });
  M.rug = phys({ map: rugC, normalMap: woolN, normalScale: new T.Vector2(0.9, 0.9), roughness: 0.95, sheen: 0.6, sheenRoughness: 0.8, sheenColor: new T.Color('#ffcf9a') });
  M.fringe = phys({ color: '#f1dfbd', roughness: 0.9, sheen: 0.5, sheenColor: new T.Color('#ffffff') });
  M.knit = phys({ color: '#e8c27a', map: knitC, normalMap: knitN, normalScale: new T.Vector2(1.1, 1.1), roughness: 0.95, sheen: 0.8, sheenRoughness: 0.6, sheenColor: new T.Color('#fff0d0'), side: T.DoubleSide });
  M.curtain = phys({ color: '#b98339', map: linenC, normalMap: linenN, normalScale: new T.Vector2(0.6, 0.6), roughness: 0.9, sheen: 0.7, sheenRoughness: 0.5, sheenColor: new T.Color('#ffe2b0'), side: T.DoubleSide });
  M.shade = phys({ color: '#f3e3c3', map: linenC, normalMap: linenN, normalScale: new T.Vector2(0.4, 0.4), roughness: 0.9, side: T.DoubleSide, emissive: new T.Color('#ffb866'), emissiveMap: linenC, emissiveIntensity: 0.9 });
  M.ceramic = phys({ color: '#c8583b', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  M.leaf = phys({ color: '#3f8a4a', roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.3, side: T.DoubleSide, sheen: 0.3, sheenColor: new T.Color('#b6f0a0') });

  // ================= room shell =================
  function add(geo, mat, parent, cast, receive) { var m = new T.Mesh(geo, mat); m.castShadow = cast !== false; m.receiveShadow = receive !== false; (parent || world).add(m); return m; }

  // Baked contact shadows. Real-time AO is too expensive for a TV, but nothing here moves, so the
  // soft darkening where things meet is painted once into textures.
  function aoMap(w, h, toPx, shapes) {
    var c = paint(w, h, function (ctx) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      shapes.forEach(function (sh) {
        var a = toPx(sh.a[0], sh.a[1]), b = toPx(sh.b ? sh.b[0] : sh.a[0], sh.b ? sh.b[1] : sh.a[1]), pxm = Math.abs(toPx(1, 0)[0] - toPx(0, 0)[0]) || Math.abs(toPx(0, 1)[1] - toPx(0, 0)[1]);
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,' + sh.o + ')'; ctx.shadowBlur = sh.blur * pxm; ctx.shadowOffsetX = 20000; ctx.fillStyle = '#000';
        ctx.beginPath();
        if (sh.r) ctx.arc(a[0] - 20000, a[1], sh.r * pxm, 0, Math.PI * 2);
        else ctx.rect(Math.min(a[0], b[0]) - 20000, Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        ctx.fill(); ctx.restore();
      });
    });
    var t = tex(c, false); t.wrapS = t.wrapT = T.ClampToEdgeWrapping; return t;
  }
  function withAO(m, map, direct) {
    m.aoMap = map; m.aoMapIntensity = 1;
    m.customProgramCacheKey = function () { return 'ao' + direct; };
    m.onBeforeCompile = function (sh) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', '#include <aomap_fragment>\n#ifdef USE_AOMAP\nreflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, ' + direct.toFixed(2) + ');\nreflectedLight.directSpecular *= mix(1.0, ambientOcclusion, ' + direct.toFixed(2) + ');\n#endif');
    };
    return m;
  }
  function uv2(g) { g.setAttribute('uv2', g.attributes.uv); return g; }
  // Footprints in room coordinates (x, z): sofa runs, table, pouf, lamp, plant.
  var AO_FLOOR = [
    { a: [-2.0, -3.0], b: [1.76, -1.52], o: 0.85, blur: 0.22 }, { a: [-2.0, -3.0], b: [-0.58, 1.0], o: 0.85, blur: 0.22 },
    { a: [0.35, -0.65], r: 0.42, o: 0.35, blur: 0.3 },
    { a: [-1.62, 1.2], r: 0.17, o: 0.6, blur: 0.12 }, { a: [2.12, -2.5], r: 0.24, o: 0.7, blur: 0.12 },
    { a: [-2.4, -3.4], b: [14, -2.95], o: 0.5, blur: 0.3 }, { a: [-2.4, -3.4], b: [-1.95, 14], o: 0.5, blur: 0.3 }
  ];
  var floorAO = aoMap(1152, 1024, function (x, z) { return [(x + 4.5) / 18 * 1152, (z + 3) / 16 * 1024]; }, AO_FLOOR);
  var rugAO = aoMap(520, 380, function (x, z) { return [(x + 0.95) / 2.6 * 520, (0.35 - z) / 1.9 * 380]; }, AO_FLOOR.concat([
    { a: [-0.12, 0.31], r: 0.07, o: 0.5, blur: 0.06 }, { a: [0.06, 0.18], r: 0.07, o: 0.5, blur: 0.06 }]));
  // Walls: a soft shadow behind the sofa back, and darkening into the corner and down to the floor.
  var backAO = aoMap(1152, 448, function (x, y) { return [(x + 4.5) / 18 * 1152, (1 - y / 7) * 448]; }, [
    { a: [-2.0, 0.0], b: [1.76, 1.5], o: 0.7, blur: 0.28 }, { a: [-2.6, -1], b: [-1.92, 8], o: 0.55, blur: 0.4 }, { a: [-3, -1], b: [14, 0.02], o: 0.5, blur: 0.25 }]);
  var sideAO = aoMap(1024, 448, function (z, y) { return [(13 - z) / 16 * 1024, (1 - y / 7) * 448]; }, [
    { a: [-3.0, 0.0], b: [1.0, 1.5], o: 0.7, blur: 0.28 }, { a: [-3.6, -1], b: [-2.92, 8], o: 0.55, blur: 0.4 }, { a: [-3.5, -1], b: [14, 0.02], o: 0.5, blur: 0.25 }]);
  withAO(M.floor, floorAO, 0.75); withAO(M.rug, rugAO, 0.6); withAO(M.wall, backAO, 0.6);
  M.wallSide = withAO(M.wall.clone(), sideAO, 0.6);

  var floor = add(uv2(new T.PlaneGeometry(18, 16)), M.floor, null, false, true);
  floor.rotation.x = -Math.PI / 2; floor.position.set(4.5, 0, 5);
  var backWall = add(uv2(new T.PlaneGeometry(18, 7)), M.wall, null, false, true); backWall.position.set(4.5, 3.5, -3);
  var leftWall = add(uv2(new T.PlaneGeometry(16, 7)), M.wallSide, null, false, true); leftWall.rotation.y = Math.PI / 2; leftWall.position.set(WALL_X, 3.5, 5);

  // Wainscoting with raised panels, a chair rail and a skirting board, along both walls.
  function wainscot(len, along) {
    var g = new T.Group();
    var board = add(new T.PlaneGeometry(len, 1.0), M.wainscot, g, false, true); board.position.set(len / 2, 0.5, 0.001);
    var skirt = add(roundBox(len, 0.16, 0.035, 0.012, 40, 4, 2), M.trim, g); skirt.position.set(len / 2, 0.08, 0.018);
    var bead = add(new T.CylinderGeometry(0.014, 0.014, len, 16), M.trim, g); bead.rotation.z = Math.PI / 2; bead.position.set(len / 2, 0.165, 0.03);
    var rail = add(roundBox(len, 0.07, 0.05, 0.02, 40, 6, 6), M.trim, g); rail.position.set(len / 2, 1.0, 0.025);
    var cap = add(new T.CylinderGeometry(0.02, 0.02, len, 16), M.trim, g); cap.rotation.z = Math.PI / 2; cap.position.set(len / 2, 1.04, 0.045);
    var pw = 0.9, n = Math.floor(len / (pw + 0.18));
    for (var i = 0; i < n; i++) {
      var x0 = 0.15 + i * (pw + 0.18);
      var frame = new T.Shape(); frame.moveTo(0, 0); frame.lineTo(pw, 0); frame.lineTo(pw, 0.56); frame.lineTo(0, 0.56); frame.lineTo(0, 0);
      var hole = new T.Path(); hole.moveTo(0.05, 0.05); hole.lineTo(0.05, 0.51); hole.lineTo(pw - 0.05, 0.51); hole.lineTo(pw - 0.05, 0.05); hole.lineTo(0.05, 0.05);
      frame.holes.push(hole);
      var mg = new T.ExtrudeGeometry(frame, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 4, curveSegments: 4 });
      var mold = add(mg, M.wainscot, g); mold.position.set(x0, 0.3, 0.004);
    }
    return g;
  }
  var wsBack = wainscot(12, 'x'); wsBack.position.set(WALL_X, 0, -3); world.add(wsBack);
  var wsLeft = wainscot(12, 'z'); wsLeft.rotation.y = Math.PI / 2; wsLeft.position.set(WALL_X, 0, 9); world.add(wsLeft);
  wsLeft.traverse(function (o) { o.castShadow = false; });

  // ================= window with curtains =================
  var skyCanvas = function (day) {
    return paint(512, 420, function (c, w, h) {
      var g = c.createLinearGradient(0, 0, 0, h);
      if (day) { g.addColorStop(0, '#6fb3ec'); g.addColorStop(1, '#cfe9f7'); } else { g.addColorStop(0, '#0d1633'); g.addColorStop(1, '#2b3e72'); }
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      var r = rand(day ? 5 : 6);
      if (day) {
        c.fillStyle = 'rgba(255,255,255,0.85)';
        [[120, 120], [330, 190], [420, 90]].forEach(function (p) { for (var i = 0; i < 6; i++) { c.beginPath(); c.arc(p[0] + i * 22 - 50, p[1] + Math.sin(i) * 8, 26 + r() * 14, 0, Math.PI * 2); c.fill(); } });
        c.fillStyle = '#6d9a5d'; c.beginPath(); c.moveTo(0, h); for (var x = 0; x <= w; x += 16) c.lineTo(x, h - 60 - Math.sin(x / 60) * 20 - r() * 6); c.lineTo(w, h); c.fill();
      } else {
        for (var i = 0; i < 90; i++) { c.fillStyle = 'rgba(255,250,230,' + (0.3 + r() * 0.7) + ')'; c.beginPath(); c.arc(r() * w, r() * h * 0.8, r() * 1.6 + 0.4, 0, Math.PI * 2); c.fill(); }
        var mg = c.createRadialGradient(370, 110, 10, 370, 110, 90); mg.addColorStop(0, 'rgba(255,240,200,0.5)'); mg.addColorStop(1, 'rgba(255,240,200,0)'); c.fillStyle = mg; c.fillRect(0, 0, w, h);
        c.fillStyle = '#fff4d8'; c.beginPath(); c.arc(370, 110, 34, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#1b2a4d'; c.beginPath(); c.moveTo(0, h); for (var x2 = 0; x2 <= w; x2 += 12) c.lineTo(x2, h - 50 - Math.sin(x2 / 50) * 14 - (x2 % 72 < 30 ? 40 : 0)); c.lineTo(w, h); c.fill();
        c.fillStyle = '#ffcf7a'; for (var b = 0; b < 8; b++) c.fillRect(20 + b * 62, h - 70 - (b % 3) * 10, 8, 10);
      }
    });
  };
  var skyNight = tex(skyCanvas(false), true), skyDay = tex(skyCanvas(true), true);
  skyNight.wrapS = skyNight.wrapT = skyDay.wrapS = skyDay.wrapT = T.ClampToEdgeWrapping;
  var skyMat = new T.MeshBasicMaterial({ map: skyNight, toneMapped: false });
  var WIN = { z: -0.5, y: 2.3, w: 1.4, h: 1.2 };
  var sky = new T.Mesh(new T.PlaneGeometry(WIN.w, WIN.h), skyMat); sky.rotation.y = Math.PI / 2; sky.position.set(WALL_X + 0.005, WIN.y, WIN.z); world.add(sky);
  // Glass: almost invisible, but it catches the lamp and candle highlights and a faint room reflection.
  var glassMat = phys({ color: '#ffffff', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.1, envMapIntensity: 0.9, depthWrite: false });
  (function windowFrame() {
    var g = new T.Group(); g.position.set(WALL_X + 0.04, WIN.y, WIN.z); g.rotation.y = Math.PI / 2; world.add(g);
    var outer = new T.Shape(); var ow = WIN.w / 2 + 0.09, oh = WIN.h / 2 + 0.09;
    outer.moveTo(-ow, -oh); outer.lineTo(ow, -oh); outer.lineTo(ow, oh); outer.lineTo(-ow, oh); outer.lineTo(-ow, -oh);
    var hole = new T.Path(); hole.moveTo(-WIN.w / 2, -WIN.h / 2); hole.lineTo(-WIN.w / 2, WIN.h / 2); hole.lineTo(WIN.w / 2, WIN.h / 2); hole.lineTo(WIN.w / 2, -WIN.h / 2); hole.lineTo(-WIN.w / 2, -WIN.h / 2);
    outer.holes.push(hole);
    var glass = new T.Mesh(new T.PlaneGeometry(WIN.w, WIN.h), glassMat); glass.position.z = 0.012; glass.renderOrder = 2; g.add(glass);
    add(new T.ExtrudeGeometry(outer, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 5, curveSegments: 4 }), M.trim, g);
    var mv = add(roundBox(0.045, WIN.h, 0.05, 0.015, 2, 20, 2), M.trim, g); mv.position.z = 0.02;
    var mh = add(roundBox(WIN.w, 0.045, 0.05, 0.015, 20, 2, 2), M.trim, g); mh.position.z = 0.02;
    var sill = add(roundBox(WIN.w + 0.36, 0.05, 0.2, 0.02, 24, 4, 6), M.trim, g); sill.position.set(0, -oh - 0.01, 0.1);
    // brass rod with finials and rings
    var rod = add(new T.CylinderGeometry(0.018, 0.018, WIN.w + 1.5, 24), M.brass, g); rod.rotation.z = Math.PI / 2; rod.position.set(0, oh + 0.22, 0.14);
    [-1, 1].forEach(function (s) {
      var fin = add(new T.SphereGeometry(0.045, 24, 16), M.brass, g); fin.position.set(s * (WIN.w / 2 + 0.78), oh + 0.22, 0.14);
      var br = add(new T.CylinderGeometry(0.012, 0.012, 0.14, 12), M.brass, g); br.rotation.x = Math.PI / 2; br.position.set(s * (WIN.w / 2 + 0.6), oh + 0.22, 0.07);
    });
    // curtains: gathered folds that flare towards the floor
    [-1, 1].forEach(function (s) {
      var cw = 0.5, ch = WIN.y + oh + 0.2 - 1.52, segX = 64, segY = 24;
      var geo = new T.PlaneGeometry(cw, ch, segX, segY), p = geo.attributes.position;
      for (var i = 0; i < p.count; i++) {
        var x = p.getX(i), y = p.getY(i), t = 1 - (y + ch / 2) / ch; // 0 at top, 1 at floor
        var phase = (x / cw + 0.5) * Math.PI * 11;
        var depth = 0.045 + 0.02 * t;
        var flare = 1 + 0.12 * t * t;
        p.setXYZ(i, x * flare + s * 0.015 * t, y, Math.sin(phase) * depth + Math.sin(phase * 0.37 + 1) * 0.012);
      }
      geo.computeVertexNormals();
      var cm = add(geo, M.curtain, g); cm.position.set(s * (WIN.w / 2 + 0.3), oh + 0.2 - ch / 2, 0.16);
      for (var r2 = 0; r2 < 7; r2++) { var ring = add(new T.TorusGeometry(0.03, 0.007, 8, 20), M.brass, g); ring.position.set(s * (WIN.w / 2 + 0.3) + (r2 - 3) * 0.09, oh + 0.22, 0.14); }
    });
  })();

  // ================= the logo, framed, with a picture light =================
  var logoCanvas = document.createElement('canvas'); logoCanvas.width = 1600; logoCanvas.height = 1040;
  var logoTex = tex(logoCanvas, true); logoTex.wrapS = logoTex.wrapT = T.ClampToEdgeWrapping;
  function drawLogo() {
    var c = logoCanvas.getContext('2d'), w = logoCanvas.width, h = logoCanvas.height;
    c.fillStyle = '#f4ead8'; c.fillRect(0, 0, w, h);
    var img = c.getImageData(0, 0, w, h), d = img.data;
    for (var y = 0; y < h; y += 1) for (var x = 0; x < w; x += 1) { var k = (y * w + x) * 4, n = (fbm(x / 3, y / 3, 533, 2) - 0.5) * 10; d[k] += n; d[k + 1] += n; d[k + 2] += n; }
    c.putImageData(img, 0, 0);
    // The real Couch Potato mark, path for path.
    c.save(); c.translate(w / 2 - 450, -120); c.scale(9, 9);
    function rrect(x, y, ww, hh, r) { rr(c, x, y, ww, hh, r); }
    c.fillStyle = '#2f6f6a'; rrect(14, 40, 72, 30, 13); c.fill();
    c.fillStyle = '#f0a63a'; c.fill(new Path2D('M31 58 C27 38 41 26 55 28 C71 30 79 43 75 58 C72 71 59 75 49 74 C39 73 33 68 31 58 Z'));
    c.strokeStyle = '#1C1916'; c.lineWidth = 2.4; c.lineCap = 'round'; c.stroke(new Path2D('M42 51 q3.5 3.5 7 0 M56 51 q3.5 3.5 7 0'));
    c.globalAlpha = 0.85; c.fillStyle = '#2f6f6a'; rrect(6, 60, 88, 22, 11); c.fill(); c.globalAlpha = 1;
    rrect(3, 52, 16, 30, 8); c.fill(); rrect(81, 52, 16, 30, 8); c.fill();
    c.restore();
    c.fillStyle = '#1c1916'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.font = '700 176px Unbounded, "Arial Black", sans-serif';
    if ('letterSpacing' in c) c.letterSpacing = '-6px';
    c.fillText('couch potato', w / 2, h - 110);
    c.font = '700 34px Manrope, sans-serif'; if ('letterSpacing' in c) c.letterSpacing = '10px';
    c.fillStyle = '#9a6a3a'; c.fillText('EST. ON THE SOFA', w / 2, h - 56);
    logoTex.needsUpdate = true;
  }
  drawLogo();
  if (document.fonts && document.fonts.load) Promise.all([document.fonts.load('700 150px Unbounded'), document.fonts.load('700 34px Manrope')]).then(drawLogo).catch(function () {});

  var FRAME = { x: -0.25, y: 2.3, w: 1.3, h: 0.92 }, printMat;
  (function frame() {
    var g = new T.Group(); g.position.set(FRAME.x, FRAME.y, -2.985); world.add(g);
    var ow = FRAME.w / 2, oh = FRAME.h / 2, bw = 0.09, lw = ow - bw, lh = oh - bw;
    // Four rounded gilt rails, each with a fine inner bead.
    [[0, oh - bw / 2, FRAME.w, bw], [0, -oh + bw / 2, FRAME.w, bw], [-ow + bw / 2, 0, bw, FRAME.h - bw * 2 + 0.002], [ow - bw / 2, 0, bw, FRAME.h - bw * 2 + 0.002]].forEach(function (r) {
      var rail = add(roundBox(r[2], r[3], 0.06, 0.028, Math.round(r[2] * 60) + 4, Math.round(r[3] * 60) + 4, 8), M.gold, g); rail.position.set(r[0], r[1], 0.03);
    });
    [[0, lh, FRAME.w - bw * 2, 0], [0, -lh, FRAME.w - bw * 2, 0], [-lw, 0, FRAME.h - bw * 2, 1], [lw, 0, FRAME.h - bw * 2, 1]].forEach(function (r) {
      var bead = add(new T.CylinderGeometry(0.008, 0.008, r[2], 12), M.gold, g); bead.rotation.z = r[3] ? 0 : Math.PI / 2; bead.position.set(r[0], r[1], 0.02);
    });
    var mat = add(new T.PlaneGeometry(lw * 2 + 0.01, lh * 2 + 0.01), new T.MeshStandardMaterial({ color: '#efe5d2', roughness: 0.95 }), g, false, true); mat.position.z = 0.006;
    var printW = lw * 2 - 0.16, printH = printW * logoCanvas.height / logoCanvas.width;
    printMat = new T.MeshStandardMaterial({ map: logoTex, roughness: 0.85, emissive: new T.Color('#ffd49a'), emissiveMap: logoTex, emissiveIntensity: 0.25 });
    var print = add(new T.PlaneGeometry(printW, printH), printMat, g, false, true); print.position.z = 0.009; print.scale.x = -1;
    // brass picture light
    var arm = add(new T.CylinderGeometry(0.012, 0.012, 0.22, 12), M.brass, g, false); arm.rotation.x = Math.PI / 2 - 0.5; arm.position.set(0, oh + 0.1, 0.08);
    var hood = add(new T.CylinderGeometry(0.045, 0.045, 0.62, 32, 1, false, 0, Math.PI), M.brass, g, false); hood.rotation.z = Math.PI / 2; hood.rotation.x = -0.6; hood.position.set(0, oh + 0.14, 0.17);
    var glow = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 0.56, 16), new T.MeshBasicMaterial({ color: '#fff1cf', toneMapped: false })); glow.rotation.z = Math.PI / 2; glow.position.set(0, oh + 0.115, 0.18); g.add(glow);
  })();
  // The picture light washes the print and the wall below it. The room is pre-drawn, so it is nearly free.
  var pictureLight = new T.SpotLight('#ffd49a', 2.2, 3.2, 0.75, 0.9, 1.4);
  pictureLight.position.set(FRAME.x, FRAME.y + FRAME.h / 2 + 0.14, -2.8); pictureLight.target.position.set(FRAME.x, FRAME.y - 0.2, -3);
  pictureLight.castShadow = false;
  world.add(pictureLight); world.add(pictureLight.target);

  // ================= the sofa: an L-shaped corner sectional, 12 seats =================
  var S = 0.42, SEAT_H = 0.24, SEAT_TOP = 0.72, SEAT_D = 0.98, SEATS = 12;
  var sofa = new T.Group(); world.add(sofa);
  // Each run is built along its own +x with the back at -z. Run A sits on the back wall;
  // run B turns the corner along the side wall and ends in the second arm.
  var RUNS = [
    { seats: 7, x: WALL_X + 0.32, z: BACK_Z + 0.88, rot: 0, armStart: false, armEnd: true, backBefore: 0.3, backAfter: 0 },
    { seats: 5, x: WALL_X + 0.83, z: BACK_Z + 1.37 + 5 * S, rot: Math.PI / 2, armStart: true, armEnd: false, backBefore: 0, backAfter: 0.98 }
  ];

  // Chesterfield back: real diamond tufting pressed into the geometry.
  var TUFT = { s: 0.36, rows: [-0.22, 0.02, 0.26], dy: 0.24 };
  function tuft(x, y) {
    if (y < TUFT.rows[0] - 0.14) return 0.012;
    var best = 9;
    for (var r = 0; r < TUFT.rows.length; r++) {
      var off = (r % 2) * TUFT.s / 2, by = TUFT.rows[r];
      var bx = Math.round((x - off) / TUFT.s) * TUFT.s + off;
      var dd = (x - bx) * (x - bx) + (y - by) * (y - by); if (dd < best) best = dd;
    }
    var a = x / (TUFT.s / 2) + (y - TUFT.rows[0]) / TUFT.dy, b = x / (TUFT.s / 2) - (y - TUFT.rows[0]) / TUFT.dy;
    var da = Math.abs(a - Math.round(a)), db = Math.abs(b - Math.round(b));
    var inRange = y < TUFT.rows[TUFT.rows.length - 1] + 0.02 ? 1 : 0;
    var crease = (Math.exp(-da * da / 0.012) + Math.exp(-db * db / 0.012)) * 0.006 * inRange;
    return 0.018 - Math.exp(-best / 0.0028) * 0.05 - crease;
  }

  // Rolled arms: an extruded scroll profile with piping traced round its face.
  function armShape() {
    var s = new T.Shape();
    s.moveTo(0.03, 0.0); s.lineTo(0.31, 0.0); s.quadraticCurveTo(0.35, 0.0, 0.35, 0.04);
    s.lineTo(0.35, 0.5);
    s.bezierCurveTo(0.35, 0.56, 0.45, 0.58, 0.45, 0.68);
    s.bezierCurveTo(0.45, 0.84, 0.32, 0.9, 0.2, 0.9);
    s.bezierCurveTo(0.07, 0.9, -0.03, 0.83, -0.03, 0.73);
    s.bezierCurveTo(-0.03, 0.65, 0.03, 0.62, 0.03, 0.56);
    s.lineTo(0.03, 0.0);
    return s;
  }
  var ARM_D = 1.04;
  var armGeo = new T.ExtrudeGeometry(armShape(), { depth: ARM_D, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 6, curveSegments: 40, steps: 4 });
  armGeo.translate(0, 0, -ARM_D / 2); armGeo.computeVertexNormals();
  var armUV = armGeo.attributes.uv; for (var ai = 0; ai < armUV.count; ai++) armUV.setXY(ai, armUV.getX(ai) * 4, armUV.getY(ai) * 4);
  var pipingPts = armShape().getSpacedPoints(160).map(function (p) { return new T.Vector3(p.x, p.y, ARM_D / 2 + 0.048); });
  var pipingGeo = new T.TubeGeometry(new T.CatmullRomCurve3(pipingPts, true), 180, 0.016, 8, true);
  var btnGeo = new T.SphereGeometry(0.022, 12, 8);
  var footGeo = new T.LatheGeometry([[0, 0], [0.05, 0], [0.065, 0.02], [0.07, 0.045], [0.06, 0.07], [0.045, 0.085], [0.05, 0.1], [0, 0.1]].map(function (p) { return new T.Vector2(p[0], p[1]); }), 24);

  function buildRun(run) {
    var L = run.seats * S, g = new T.Group(); g.position.set(run.x, 0, run.z); g.rotation.y = run.rot; sofa.add(g);
    run.L = L; run.group = g; run.cos = Math.cos(run.rot); run.sin = Math.sin(run.rot);
    var b0 = -run.backBefore, b1 = L + run.backAfter, bl = b1 - b0;
    var base = add(dropFaces(roundBox(L - b0 + 0.02, 0.34, 1.1, 0.07, Math.round((L - b0) * 10) + 8, 6, 10), function (n) { return n.y < -0.6 || n.z < -0.6; }), M.velvetDeep, g); base.position.set((b0 + L) / 2, 0.3, -0.08);
    var back = add(dropFaces(roundBox(bl, 0.96, 0.34, 0.14, Math.round(bl * 40) + 12, 36, 8, { front: tuft, pillow: 0.03 }), function (n) { return n.z < -0.6; }), M.velvet, g);
    back.position.set((b0 + b1) / 2, 0.95, -0.66); back.rotation.x = -0.07;
    TUFT.rows.forEach(function (by, r) {
      var off = (r % 2) * TUFT.s / 2;
      for (var bx = -Math.ceil(bl / 2 / TUFT.s) * TUFT.s + off; bx < bl / 2 - 0.1; bx += TUFT.s) {
        if (bx < -bl / 2 + 0.1) continue;
        var btn = add(btnGeo, M.velvetDeep, back, false); btn.scale.z = 0.6; btn.position.set(bx, by, 0.17 - 0.035);
      }
    });
    [[run.armStart, -0.02, -1], [run.armEnd, L + 0.02, 1]].forEach(function (a) {
      if (!a[0]) return;
      var ag = new T.Group(); ag.position.set(a[1], 0.1, -0.08); ag.scale.x = a[2]; g.add(ag);
      add(armGeo, M.velvet, ag); add(pipingGeo, M.velvetDeep, ag);
      var stud = add(btnGeo, M.velvetDeep, ag, false); stud.scale.setScalar(1.6); stud.scale.z = 0.8; stud.position.set(0.2, 0.71, ARM_D / 2 + 0.05);
      if (a[2] > 0) run.endArm = ag;
    });
    [[b0 + 0.08, -0.55], [b0 + 0.08, 0.4], [L + (run.armEnd ? 0.3 : -0.05), -0.55], [L + (run.armEnd ? 0.3 : -0.05), 0.4], [run.armStart ? -0.3 : 0.05, 0.4]].forEach(function (f) {
      var ft = add(footGeo, M.walnut, g); ft.position.set(f[0], 0, f[1]);
    });
    // The seat is one long bench whose top is a live surface the potatoes press into.
    run.seatGeo = dropFaces(roundBox(L, SEAT_H, SEAT_D, 0.1, Math.round(L * 80) + 10, 8, 36, { pillow: 0.035, uv: 4 }), function (n) { return n.y < -0.6; });
    // Stitch a seam between every seat, top and front, so twelve seats read as twelve cushions.
    (function () {
      var sp = run.seatGeo.attributes.position, hh = SEAT_H / 2, hd = SEAT_D / 2;
      for (var i = 0; i < sp.count; i++) {
        var x = sp.getX(i) + L / 2, y = sp.getY(i), z = sp.getZ(i), seam = Math.round(x / S);
        if (seam <= 0 || seam >= run.seats) continue;
        var d = x - seam * S, gr = Math.exp(-d * d / 0.00018) * 0.016;
        if (y > 0) sp.setY(i, y - gr * Math.min(1, y / hh * 1.6));
        if (z > hd * 0.7) sp.setZ(i, z - gr * 0.8 * Math.min(1, (z - hd * 0.7) / (hd * 0.3)));
      }
      run.seatGeo.computeVertexNormals();
    })();
    var seat = add(run.seatGeo, seatMaterial(run), g); seat.position.set(L / 2, SEAT_TOP - SEAT_H / 2 - 0.035, 0);
    run.seatMesh = seat;
    var hl = L / 2;
    add(new T.TubeGeometry(new T.CatmullRomCurve3([
      new T.Vector3(-hl + 0.01, 0.07, 0.35), new T.Vector3(-hl + 0.03, 0.085, 0.455), new T.Vector3(-hl + 0.12, 0.09, 0.478),
      new T.Vector3(hl - 0.12, 0.09, 0.478), new T.Vector3(hl - 0.03, 0.085, 0.455), new T.Vector3(hl - 0.01, 0.07, 0.35)
    ]), 200, 0.016, 8, false), M.velvetDeep, seat);
  }
  RUNS.forEach(buildRun);
  function runToRoom(run, lx, lz) { return { x: run.x + run.cos * lx + run.sin * lz, z: run.z - run.sin * lx + run.cos * lz }; }
  var SEAT_LIST = [];
  for (var sa = 0; sa < RUNS[0].seats; sa++) SEAT_LIST.push({ run: RUNS[0], lx: S * (sa + 0.5) });
  for (var sb = 0; sb < RUNS[1].seats; sb++) SEAT_LIST.push({ run: RUNS[1], lx: RUNS[1].L - S * (sb + 0.5) });
  // Fill order, best-seen seats first. Seats 0 and 7 meet in the corner, where potatoes hide
  // behind each other, seat 11 sits behind the near arm and seat 6 behind the join card.
  var FILL = [3, 9, 2, 10, 4, 8, 1, 5, 11, 0, 7, 6];

  // A chunky knit throw, tossed over the end arm. It is a real cloth: a grid of particles dropped onto
  // the arm once at load (verlet, with grip where it touches the velvet), so it folds where it lands
  // and hangs under its own weight. The settled shape is frozen into an ordinary static mesh.
  (function throwBlanket() {
    // The arm's scroll profile as a 2D distance field (arm-local x, y), extruded along z.
    var prof = armShape().getSpacedPoints(200), G = 150, X0 = -0.45, Y0 = -0.3, SZ = 1.5, sdf = new Float32Array(G * G);
    for (var gy = 0; gy < G; gy++) for (var gx = 0; gx < G; gx++) {
      var px = X0 + gx / (G - 1) * SZ, py = Y0 + gy / (G - 1) * SZ, best = 9, inside = false;
      for (var i = 0, j = prof.length - 1; i < prof.length; j = i++) {
        var A = prof[j], B = prof[i], ex = B.x - A.x, ey = B.y - A.y, t = clamp(((px - A.x) * ex + (py - A.y) * ey) / (ex * ex + ey * ey || 1), 0, 1);
        var dx = px - A.x - ex * t, dy = py - A.y - ey * t, dd = dx * dx + dy * dy; if (dd < best) best = dd;
        if ((B.y > py) !== (A.y > py) && px < (A.x - B.x) * (py - B.y) / (A.y - B.y) + B.x) inside = !inside;
      }
      sdf[gy * G + gx] = (inside ? -1 : 1) * Math.sqrt(best);
    }
    function sd2(x, y) {
      var fx = (x - X0) / SZ * (G - 1), fy = (y - Y0) / SZ * (G - 1);
      if (fx < 0 || fy < 0 || fx >= G - 1 || fy >= G - 1) return 1;
      var ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, k = iy * G + ix;
      return (sdf[k] * (1 - tx) + sdf[k + 1] * tx) * (1 - ty) + (sdf[k + G] * (1 - tx) + sdf[k + G + 1] * tx) * ty;
    }
    var ZH = ARM_D / 2, PAD = 0.04 + 0.016; // the bevel, plus half the knit's thickness
    function sd3(x, y, z) { var d = sd2(x, y), w = Math.abs(z) - ZH; return Math.min(Math.max(d, w), 0) + Math.hypot(Math.max(d, 0), Math.max(w, 0)) - PAD; }
    var SEAT_Y = SEAT_TOP - 0.1 + 0.02, FLOOR_Y = -0.1 + 0.016; // arm-local (the arm group sits 0.1 up)

    // A 1.4 x 0.7 sheet, held flat just above the arm, a little skewed, mostly hanging off the outside.
    var NU = 56, NV = 28, LEN = 1.4, WID = 0.7, n = NU * NV, P = new Float32Array(n * 3), O = new Float32Array(n * 3), r = rand(41);
    var cx = 0.3, cz = 0.2, rot = 0.16, cr = Math.cos(rot), sr = Math.sin(rot);
    for (var u = 0; u < NU; u++) for (var v = 0; v < NV; v++) {
      var lx = (u / (NU - 1) - 0.5) * LEN, lz = (v / (NV - 1) - 0.5) * WID, k = (u * NV + v) * 3;
      P[k] = cx + lx * cr - lz * sr; P[k + 1] = 1.02 + (r() - 0.5) * 0.004 + Math.sin(u * 0.7) * 0.003; P[k + 2] = cz + lx * sr + lz * cr;
      O[k] = P[k]; O[k + 1] = P[k + 1]; O[k + 2] = P[k + 2];
    }
    var C = []; // [a, b, rest, stiffness]
    function link(u0, v0, u1, v1, st) { if (u1 >= NU || v1 >= NV || v1 < 0) return; var a0 = (u0 * NV + v0) * 3, b0 = (u1 * NV + v1) * 3; C.push(a0, b0, Math.hypot(P[a0] - P[b0], P[a0 + 1] - P[b0 + 1], P[a0 + 2] - P[b0 + 2]), st); }
    for (u = 0; u < NU; u++) for (v = 0; v < NV; v++) {
      link(u, v, u + 1, v, 1); link(u, v, u, v + 1, 1);
      link(u, v, u + 1, v + 1, 0.7); link(u, v, u + 1, v - 1, 0.7);
      link(u, v, u + 2, v, 0.18); link(u, v, u, v + 2, 0.18);
    }
    var DT = 1 / 120, GRAV = -9.8 * DT * DT, STEPS = 640, ITER = 5, e = 0.004;
    function collide(k) {
      var x = P[k], y = P[k + 1], z = P[k + 2], hit = false, d = sd3(x, y, z);
      if (d < 0) {
        var gx = sd3(x + e, y, z) - sd3(x - e, y, z), gy = sd3(x, y + e, z) - sd3(x, y - e, z), gz = sd3(x, y, z + e) - sd3(x, y, z - e), gl = Math.hypot(gx, gy, gz) || 1;
        P[k] = x - gx / gl * d; P[k + 1] = y - gy / gl * d; P[k + 2] = z - gz / gl * d; hit = true;
      }
      if (P[k] < -0.03 && P[k + 1] < SEAT_Y && P[k + 2] < 0.5) { P[k + 1] = SEAT_Y; hit = true; }
      if (P[k + 1] < FLOOR_Y) { P[k + 1] = FLOOR_Y; hit = true; }
      if (hit) { O[k] = P[k] - (P[k] - O[k]) * 0.05; O[k + 1] = P[k + 1] - (P[k + 1] - O[k + 1]) * 0.05; O[k + 2] = P[k + 2] - (P[k + 2] - O[k + 2]) * 0.05; } // knit grips velvet
      return hit;
    }
    for (var step = 0; step < STEPS; step++) {
      for (k = 0; k < n * 3; k += 3) {
        var vx = (P[k] - O[k]) * 0.99, vy = (P[k + 1] - O[k + 1]) * 0.99, vz = (P[k + 2] - O[k + 2]) * 0.99;
        O[k] = P[k]; O[k + 1] = P[k + 1]; O[k + 2] = P[k + 2];
        P[k] += vx; P[k + 1] += vy + GRAV; P[k + 2] += vz;
      }
      for (var it = 0; it < ITER; it++) {
        for (var c = 0; c < C.length; c += 4) {
          var a0 = C[c], b0 = C[c + 1], dx = P[b0] - P[a0], dy = P[b0 + 1] - P[a0 + 1], dz = P[b0 + 2] - P[a0 + 2], dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          var f = (dl - C[c + 2]) / dl * 0.5 * C[c + 3];
          P[a0] += dx * f; P[a0 + 1] += dy * f; P[a0 + 2] += dz * f; P[b0] -= dx * f; P[b0 + 1] -= dy * f; P[b0 + 2] -= dz * f;
        }
        for (k = 0; k < n * 3; k += 3) collide(k);
      }
    }
    // A simulated sheet hangs a little too neatly, so give it the soft folds a heavy knit falls into:
    // gentle ripples where it lies on the arm, deeper folds growing towards the hanging edges.
    var fgeo = new T.BufferGeometry(), fidx = [];
    for (u = 0; u < NU - 1; u++) for (v = 0; v < NV - 1; v++) { var fq = u * NV + v; fidx.push(fq, fq + 1, fq + NV, fq + 1, fq + NV + 1, fq + NV); }
    fgeo.setAttribute('position', new T.BufferAttribute(P, 3)); fgeo.setIndex(fidx); fgeo.computeVertexNormals();
    var nrm = fgeo.attributes.normal.array;
    for (u = 0; u < NU; u++) for (v = 0; v < NV; v++) {
      k = (u * NV + v) * 3;
      var wz = v / (NV - 1) * WID, wu = u / (NU - 1), hang = smooth(0.9, 0.2, P[k + 1]);
      var amp = 0.004 + 0.03 * hang * hang, ph = wz * 34 + Math.sin(wu * 7) * 1.2 + (wu < 0.5 ? 1.7 : 0);
      var d = amp * (Math.sin(ph) + 0.35 * Math.sin(ph * 2.3 + 0.8));
      P[k] += nrm[k] * d; P[k + 1] += nrm[k + 1] * d; P[k + 2] += nrm[k + 2] * d;
    }
    for (k = 0; k < n * 3; k += 3) collide(k);
    var pos = new Float32Array(P), uv = new Float32Array(n * 2), idx = [];
    for (u = 0; u < NU; u++) for (v = 0; v < NV; v++) { k = u * NV + v; uv[k * 2] = v / (NV - 1) * WID * 1.8; uv[k * 2 + 1] = u / (NU - 1) * LEN * 1.8; }
    for (u = 0; u < NU - 1; u++) for (v = 0; v < NV - 1; v++) { var q = u * NV + v; idx.push(q, q + 1, q + NV, q + 1, q + NV + 1, q + NV); }
    var geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    var g = RUNS[0].endArm;
    add(geo, M.knit, g);
    function at(u, v) { var k = (u * NV + v) * 3; return new T.Vector3(P[k], P[k + 1], P[k + 2]); }
    // A rolled hem all the way round, so the edge reads as a thick knit, not a sheet of paper.
    var loop = [];
    for (u = 0; u < NU; u++) loop.push(at(u, 0));
    for (v = 1; v < NV; v++) loop.push(at(NU - 1, v));
    for (u = NU - 2; u >= 0; u--) loop.push(at(u, NV - 1));
    for (v = NV - 2; v > 0; v--) loop.push(at(0, v));
    add(new T.TubeGeometry(new T.CatmullRomCurve3(loop, true, 'centripetal'), loop.length * 3, 0.011, 7, true), M.knit, g);
    // Tassels on both short ends, hanging with gravity from wherever the edge ended up.
    var tg = new T.CylinderGeometry(0.007, 0.004, 0.075, 6); tg.translate(0, -0.0375, 0);
    var down = new T.Vector3(0, -1, 0), yUp = new T.Vector3(0, 1, 0);
    [[NU - 1, NU - 2], [0, 1]].forEach(function (end) {
      for (var v = 1; v < NV - 1; v += 2) {
        var p = at(end[0], v), out = p.clone().sub(at(end[1], v)).normalize(), dir = out.lerp(down, 0.75).normalize();
        if (p.y + dir.y * 0.075 < SEAT_Y && p.x < 0) dir.set(out.x, 0.15, out.z).normalize();
        var t = add(tg, M.knit, g); t.position.copy(p); t.quaternion.setFromUnitVectors(down, dir); t.scale.setScalar(0.9 + r() * 0.25);
      }
    });
  })();

  // ================= props =================
  // Rug with depth and a wool fringe.
  var rug = add(dropFaces(roundBox(2.6, 0.018, 1.9, 0.008, 24, 1, 18, { uv: 1 }), function (n) { return n.y < -0.6; }), M.rug, null, false, true);
  (function rugUV() { var p = rug.geometry.attributes.position, uv = rug.geometry.attributes.uv; for (var i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 2.6 + 0.5, p.getZ(i) / 1.9 + 0.5); })();
  rug.position.set(0.35, 0.009, -0.6); uv2(rug.geometry);
  (function fringe() {
    var geo = new T.CapsuleGeometry(0.006, 0.07, 2, 5), r = rand(21), n = 58;
    var inst = new T.InstancedMesh(geo, M.fringe, n * 2); inst.castShadow = false; inst.receiveShadow = true;
    var m = new T.Matrix4(), qn = new T.Quaternion(), e = new T.Euler();
    for (var s = 0; s < 2; s++) for (var i = 0; i < n; i++) {
      var x = s === 0 ? -0.95 : 1.65, z = -0.6 - 0.92 + i * 1.84 / (n - 1);
      e.set(0, 0, Math.PI / 2 + (r() - 0.5) * 0.5); qn.setFromEuler(e);
      m.compose(new T.Vector3(x + (s ? 0.05 : -0.05) + (r() - 0.5) * 0.02, 0.008, z + (r() - 0.5) * 0.01), qn, new T.Vector3(1, 0.8 + r() * 0.4, 1));
      inst.setMatrixAt(s * n + i, m);
    }
    world.add(inst);
  })();

  // Walnut coffee table with a turned edge, popcorn and the remote.
  var table = new T.Group(); table.position.set(0.35, 0, -0.65); world.add(table);
  var topProfile = [[0, 0.4], [0.44, 0.4], [0.47, 0.405], [0.49, 0.42], [0.49, 0.44], [0.475, 0.455], [0.45, 0.46], [0, 0.46]].map(function (p) { return new T.Vector2(p[0], p[1]); });
  add(new T.LatheGeometry(topProfile, 64), M.walnut, table);
  var legGeo = new T.LatheGeometry([[0, 0], [0.02, 0], [0.025, 0.02], [0.03, 0.2], [0.035, 0.38], [0.0, 0.4]].map(function (p) { return new T.Vector2(p[0], p[1]); }), 24);
  for (var li = 0; li < 3; li++) { var a = li * Math.PI * 2 / 3 + 0.4, tl = add(legGeo, M.walnut, table); tl.position.set(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3); tl.rotation.z = Math.cos(a) * 0.1; tl.rotation.x = -Math.sin(a) * 0.1; }
  var stripeTex = tex(paint(512, 64, function (c, w, h) { for (var i = 0; i < 16; i++) { c.fillStyle = i % 2 ? '#f6efe2' : '#d23a2a'; c.fillRect(i * w / 16, 0, w / 16, h); } }), true);
  var bowlMat = phys({ map: stripeTex, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, side: T.DoubleSide });
  var bowl = add(new T.LatheGeometry([[0, 0], [0.09, 0], [0.11, 0.01], [0.17, 0.09], [0.2, 0.16], [0.205, 0.165], [0.195, 0.165], [0.162, 0.095], [0.1, 0.02], [0, 0.02]].map(function (p) { return new T.Vector2(p[0], p[1]); }), 64), bowlMat, table);
  bowl.position.y = 0.46;
  var popGeo = (function () { var g = new T.IcosahedronGeometry(0.03, 2), p = g.attributes.position, r = rand(77); for (var i = 0; i < p.count; i++) { var v = new T.Vector3().fromBufferAttribute(p, i), b = 1 + 0.35 * Math.sin(v.x * 140) * Math.sin(v.y * 120 + 1) * Math.sin(v.z * 130 + 2); v.multiplyScalar(b); p.setXYZ(i, v.x, v.y, v.z); } g.computeVertexNormals(); return g; })();
  var popMat = phys({ color: '#fff1cc', roughness: 0.8, sheen: 0.4, sheenColor: new T.Color('#ffffff') });
  var pr = rand(3);
  for (var pi = 0; pi < 34; pi++) {
    var ang = pr() * Math.PI * 2, rad = Math.sqrt(pr()) * 0.15;
    var pop = add(popGeo, popMat, table); pop.position.set(Math.cos(ang) * rad, 0.6 + pr() * 0.05 - rad * 0.35, Math.sin(ang) * rad); pop.rotation.set(pr() * 6, pr() * 6, pr() * 6); pop.scale.setScalar(0.8 + pr() * 0.5);
  }
  var remote = add(roundBox(0.06, 0.022, 0.24, 0.01, 4, 2, 12), phys({ color: '#26211c', roughness: 0.35, clearcoat: 0.5 }), table); remote.position.set(0.2, 0.471, 0.18); remote.rotation.y = 0.5;
  [['#d6453a', 0.08], ['#f2e6d0', 0.03], ['#f2e6d0', -0.01], ['#f2e6d0', -0.05]].forEach(function (b) { var bt = add(new T.CylinderGeometry(0.009, 0.009, 0.008, 16), new T.MeshStandardMaterial({ color: b[0], roughness: 0.4 }), remote); bt.position.set(0, 0.012, b[1]); });

  // Floor lamp with a linen shade.
  var LAMP = { x: -1.62, z: 1.2, k: 0.8 };
  var lamp = new T.Group(); lamp.position.set(LAMP.x, 0, LAMP.z); lamp.scale.setScalar(LAMP.k); world.add(lamp);
  add(new T.LatheGeometry([[0, 0], [0.24, 0], [0.25, 0.012], [0.22, 0.04], [0.06, 0.06], [0.03, 0.09], [0, 0.09]].map(function (p) { return new T.Vector2(p[0], p[1]); }), 64), M.brass, lamp);
  var pole = add(new T.CylinderGeometry(0.016, 0.02, 1.8, 20), M.brass, lamp); pole.position.y = 0.97;
  var shade = add(new T.CylinderGeometry(0.24, 0.38, 0.44, 64, 1, true), M.shade, lamp, false); shade.position.y = 1.98;
  [0.24, 0.38].forEach(function (r, i) { var t = add(new T.TorusGeometry(r, 0.008, 8, 64), M.brass, lamp); t.rotation.x = Math.PI / 2; t.position.y = i ? 1.76 : 2.2; });
  var bulb = new T.Mesh(new T.SphereGeometry(0.06, 20, 14), new T.MeshBasicMaterial({ color: '#fff1cf', toneMapped: false })); bulb.position.y = 1.9; lamp.add(bulb);

  // Plant in a glazed pot, with proper leaves.
  var plant = new T.Group(); plant.position.set(2.12, 0, -2.5); world.add(plant);
  add(new T.LatheGeometry([[0, 0.0], [0.17, 0.0], [0.2, 0.03], [0.25, 0.32], [0.27, 0.36], [0.27, 0.4], [0.245, 0.4], [0.24, 0.37], [0, 0.37]].map(function (p) { return new T.Vector2(p[0], p[1]); }), 64), M.ceramic, plant);
  var soil = add(new T.CircleGeometry(0.24, 40), new T.MeshStandardMaterial({ color: '#3a2618', roughness: 1 }), plant); soil.rotation.x = -Math.PI / 2; soil.position.y = 0.37;
  // Each leaf is a dense grid, not a flat outline: it cups along a sunken midrib, arches over, and
  // ripples a little at the edge, with a paler rib and vein lines painted in vertex colour.
  var leafGeo = (function () {
    var NI = 12, NJ = 32, pos = [], col = [], idx = [];
    for (var j = 0; j <= NJ; j++) {
      var v = j / NJ, y = v * 0.44, w = 0.11 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + v * 0.98)), 0.7) * (1 - 0.2 * v);
      for (var i = 0; i <= NI; i++) {
        var u = i / NI * 2 - 1, x = u * w, rib = Math.exp(-u * u * 90);
        var z = -y * y * 0.85 + Math.abs(x) * 0.32 - rib * 0.005 + Math.sin(v * 15 + u * 2) * 0.007 * u * u;
        var vein = Math.pow(0.5 + 0.5 * Math.cos((v * 9 - Math.abs(u) * 2.2) * Math.PI * 2), 18) * (1 - rib) * smooth(1, 0.6, Math.abs(u));
        pos.push(x, y, z); var k = 0.86 + rib * 0.3 + vein * 0.12 + v * 0.06; col.push(k, k * 1.02 + rib * 0.04, k * 0.92);
      }
    }
    for (j = 0; j < NJ; j++) for (i = 0; i < NI; i++) { var a = j * (NI + 1) + i; idx.push(a, a + 1, a + NI + 1, a + 1, a + NI + 2, a + NI + 1); }
    var g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  })();
  M.leaf.vertexColors = true;
  var stemMat = new T.MeshStandardMaterial({ color: '#4c7a3a', roughness: 0.6 }), lr = rand(11);
  for (var lf = 0; lf < 14; lf++) {
    var la = lf / 14 * Math.PI * 2 + lr() * 0.4, tilt = 0.35 + lr() * 0.45, hgt = 0.35 + lr() * 0.4;
    var stem = new T.CatmullRomCurve3([new T.Vector3(0, 0.37, 0), new T.Vector3(Math.cos(la) * 0.05, 0.37 + hgt * 0.6, Math.sin(la) * 0.05), new T.Vector3(Math.cos(la) * 0.12 * (1 + tilt), 0.37 + hgt, Math.sin(la) * 0.12 * (1 + tilt))]);
    add(new T.TubeGeometry(stem, 16, 0.008, 6), stemMat, plant);
    var leaf = add(leafGeo, M.leaf, plant); var tip = stem.getPoint(1);
    leaf.position.copy(tip); leaf.rotation.set(0, -la + Math.PI / 2, 0); leaf.rotateX(-tilt); leaf.rotateY((lr() - 0.5) * 0.5); leaf.scale.setScalar(0.95 + lr() * 0.55);
  }

  // Wall clock with a printed face.
  var clockFace = tex(paint(512, 512, function (c, w, h) {
    c.fillStyle = '#f6eddc'; c.beginPath(); c.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#2a1a10'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '700 58px Manrope, sans-serif';
    for (var i = 1; i <= 12; i++) { var a = i / 12 * Math.PI * 2; if (i % 3 === 0) c.fillText(String(i), w / 2 + Math.sin(a) * 180, h / 2 - Math.cos(a) * 180); else { c.save(); c.translate(w / 2 + Math.sin(a) * 196, h / 2 - Math.cos(a) * 196); c.rotate(a); c.fillRect(-4, -14, 8, 28); c.restore(); } }
    c.font = '700 26px Manrope, sans-serif'; c.fillStyle = '#9a6a3a'; c.fillText('SPUD & CO.', w / 2, h / 2 + 80);
  }), true); clockFace.wrapS = clockFace.wrapT = T.ClampToEdgeWrapping;
  var clock = new T.Group(); clock.position.set(1.75, 2.25, -2.96); world.add(clock);
  var cf = add(new T.CircleGeometry(0.26, 64), new T.MeshStandardMaterial({ map: clockFace, roughness: 0.6 }), clock, false); cf.position.z = 0.03; cf.scale.x = -1;
  add(new T.TorusGeometry(0.27, 0.03, 20, 80), M.brass, clock).position.z = 0.03;
  var cback = add(new T.CylinderGeometry(0.27, 0.27, 0.05, 64), M.walnut, clock); cback.rotation.x = Math.PI / 2;
  var handMat = new T.MeshStandardMaterial({ color: '#2a1a10', roughness: 0.4 });
  var hourHand = add(roundBox(0.022, 0.13, 0.008, 0.004, 2, 6, 1), handMat, clock); hourHand.geometry.translate(0, 0.05, 0); hourHand.position.z = 0.04;
  var minHand = add(roundBox(0.016, 0.2, 0.008, 0.004, 2, 8, 1), handMat, clock); minHand.geometry.translate(0, 0.085, 0); minHand.position.z = 0.046;
  add(new T.SphereGeometry(0.014, 16, 12), M.brass, clock).position.z = 0.05;

  // Soft contact shadows to ground the furniture.
  var blobTex = tex(paint(128, 128, function (c, w, h) { var g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); }), true);
  function blob(x, z, sx, sz, o) { var m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: o })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.021, z); m.scale.set(sx, sz, 1); world.add(m); }

  // ================= candles and fairy lights =================
  var flameMat = new T.MeshBasicMaterial({ color: new T.Color(2.2, 1.45, 0.6), toneMapped: false });
  var flameCore = new T.MeshBasicMaterial({ color: new T.Color(2.6, 2.3, 1.7), toneMapped: false });
  var waxMat = phys({ color: '#f4e7cf', roughness: 0.55, sheen: 0.4, sheenColor: new T.Color('#fff4e0'), emissive: new T.Color('#ff9a4a'), emissiveIntensity: 0.06 });
  var flames = [];
  [[-0.27, -0.1, 0.17], [-0.17, -0.27, 0.12], [-0.36, 0.1, 0.085]].forEach(function (c, i) {
    var cg = new T.Group(); cg.position.set(c[0], 0.46, c[1]); table.add(cg);
    var wax = add(new T.CylinderGeometry(0.034, 0.036, c[2], 28, 1), waxMat, cg); wax.position.y = c[2] / 2;
    var lip = add(new T.TorusGeometry(0.03, 0.006, 6, 28), waxMat, cg, false); lip.rotation.x = Math.PI / 2; lip.position.y = c[2] - 0.002;
    var wick = add(new T.CylinderGeometry(0.0015, 0.0015, 0.02, 5), new T.MeshStandardMaterial({ color: '#1a120c' }), cg, false); wick.position.y = c[2] + 0.008;
    var f = new T.Group(); f.position.y = c[2] + 0.014; cg.add(f); f.userData.live = true;
    var outer = new T.Mesh(new T.SphereGeometry(0.011, 12, 10), flameMat); outer.geometry.translate(0, 0.011, 0); outer.scale.set(1, 2.6, 1); f.add(outer);
    var inner = new T.Mesh(new T.SphereGeometry(0.006, 10, 8), flameCore); inner.position.y = 0.008; inner.scale.set(1, 1.8, 1); f.add(inner);
    f.userData.seed = i * 1.7; flames.push(f);
  });

  // Warm fairy lights swagged across the window.
  var fairy = (function () {
    var x = WALL_X + 0.27, z0 = WIN.z - 1.0, z1 = WIN.z + 1.0, top = WIN.y - 0.06, n = 44, pts = [];
    for (var i = 0; i <= 120; i++) { var t = i / 120, k = (t * 3) % 1; pts.push(new T.Vector3(x + Math.sin(t * Math.PI * 3) * 0.02, top - Math.sin(k * Math.PI) * (0.14 + 0.04 * Math.floor(t * 3 % 3)) - 0.02, z0 + (z1 - z0) * t)); }
    var curve = new T.CatmullRomCurve3(pts);
    add(new T.TubeGeometry(curve, 240, 0.0028, 5, false), new T.MeshStandardMaterial({ color: '#2a2a1c', roughness: 0.6 }), null, false, false);
    var bulbMat = new T.MeshBasicMaterial({ color: new T.Color(2.3, 1.6, 0.75), toneMapped: false });
    var inst = new T.InstancedMesh(new T.SphereGeometry(0.016, 10, 8), bulbMat, n), m = new T.Matrix4(), base = [], r = rand(9);
    for (var b = 0; b < n; b++) {
      var q = curve.getPointAt((b + 0.5) / n); m.makeScale(1, 1.35, 1); m.setPosition(q.x, q.y - 0.016, q.z); inst.setMatrixAt(b, m);
      var c = new T.Color().setHSL(0.09 + r() * 0.04, 1, 0.55 + r() * 0.15); base.push(c); inst.setColorAt(b, c);
    }
    world.add(inst);
    return { mesh: inst, mat: bulbMat, base: base, phase: base.map(function () { return r() * 6.28; }) };
  })();

  // ================= lights =================
  // Warm pools from practical lights (floor lamp, candles, picture light, fairy lights) against cool
  // moonlight, with a warm fill so the shadows stay brown instead of going black.
  var hemi = new T.HemisphereLight('#ffcf9e', '#3a2418', 0.16); world.add(hemi);
  // Moon (or sun) light only enters through the window, so the frame and curtains cast a pane pattern.
  // Nothing it lights ever moves (potatoes are on their own layer), so its shadow map is drawn once.
  var moonLight = new T.SpotLight('#9db0e6', 1.1, 18, 0.34, 0.6, 1);
  moonLight.position.set(-5.5, 3.6, WIN.z); moonLight.target.position.set(0.8, 0, -0.9);
  moonLight.castShadow = true; moonLight.shadow.mapSize.set(2048, 2048); moonLight.shadow.autoUpdate = false;
  moonLight.shadow.bias = -0.0004; moonLight.shadow.normalBias = 0.01;
  world.add(moonLight); world.add(moonLight.target);
  var lampLight = new T.PointLight('#ffa95a', 2.6, 8, 1.6);
  lampLight.position.set(LAMP.x, 1.9 * LAMP.k, LAMP.z); world.add(lampLight);
  // A soft, warm overhead key, so the potatoes sit in proper contact shadows.
  var key = new T.SpotLight('#ffc890', 0.32, 14, 0.62, 1, 1.2);
  key.position.set(0.9, 5.4, 1.3); key.target.position.set(-0.4, 0.5, -1.6);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.01;
  key.shadow.autoUpdate = false; // static, like the moon: the potatoes ground themselves with soft blobs
  world.add(key); world.add(key.target);
  var candleLight = new T.PointLight('#ff9448', 0.9, 2.8, 2); candleLight.position.set(0.35 - 0.27, 0.78, -0.65 - 0.12); world.add(candleLight);
  camera.layers.enable(1);

  // Sunday: sun shafts through the window.
  var shaftTex = tex(paint(64, 256, function (c, w, h) { var g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,240,210,0.0)'); g.addColorStop(0.3, 'rgba(255,240,210,0.5)'); g.addColorStop(1, 'rgba(255,240,210,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); }), true);
  var shaft = new T.Mesh(new T.PlaneGeometry(1.5, 4.2), new T.MeshBasicMaterial({ map: shaftTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.0, side: T.DoubleSide }));
  shaft.position.set(WALL_X + 1.5, 1.5, WIN.z); shaft.rotation.set(0, Math.PI / 2, -0.9); world.add(shaft);

  var envMats = [];
  scene.traverse(function (o) { if (o.material && o.material !== glassMat && envMats.indexOf(o.material) < 0) envMats.push(o.material); });
  var LIGHTS = {
    // The app's four moods. Sofa colours follow the --sofa token of each mood in tokens.css.
    lamp: { sofa: '#1e7a48', cover: ['#155c36', '#0f4226', '#4aad72'], bg: '#0d0806', key: ['#ffc890', 0.4], hemi: ['#ffcf9e', '#3a2418', 0.16], moon: ['#9db0e6', 1.1], lamp: 3.2, pic: 1.4, shade: 1.0, candle: 0.9, fairy: 1, sky: skyNight, env: 0.08, exposure: 0.82, shaft: 0, wall: '#857a68', floor: '#a08a78', curtain: '#7f6a43' },
    velvet: { sofa: '#8e2f45', cover: ['#4e1220', '#360a15', '#a8566a'], bg: '#100807', key: ['#ffcaa8', 0.38], hemi: ['#ffd0b8', '#2e1a16', 0.15], moon: ['#c4a6ec', 0.9], lamp: 2.8, pic: 1.4, shade: 0.95, candle: 1.0, fairy: 1, sky: skyNight, env: 0.08, exposure: 0.82, shaft: 0, wall: '#8a7466', floor: '#9c8678', curtain: '#6e5a36' },
    midnight: { sofa: '#2b5da8', cover: ['#243656', '#18243c', '#7088b8'], bg: '#05080f', key: ['#a8c0ff', 0.3], hemi: ['#9fb8ff', '#141c2c', 0.14], moon: ['#9db6ff', 2.2], lamp: 1.6, pic: 0.9, shade: 0.6, candle: 0.7, fairy: 0.8, sky: skyNight, env: 0.08, exposure: 0.86, shaft: 0, wall: '#6f7c96', floor: '#7c8496', curtain: '#3f4a66' },
    sunday: { sofa: '#4f7a63', bg: '#f3e6d0', key: ['#fff2e0', 0.6], hemi: ['#fff0dc', '#7a5a40', 0.45], moon: ['#ffd9a6', 6.5], lamp: 0.25, pic: 0.5, shade: 0.12, candle: 0.35, fairy: 0.12, sky: skyDay, env: 0.85, exposure: 0.95, shaft: 0.22, wall: '#ffffff', floor: '#ffffff', curtain: '#c9a25a' }
  };
  var MOOD_ORDER = ['lamp', 'velvet', 'midnight', 'sunday'], MOOD_NAMES = { lamp: 'Lamp Light', velvet: 'Velvet', midnight: 'Midnight', sunday: 'Sunday' };
  var mood = 'lamp', candleBase = 0.9, fairyLevel = 1, rimMood = { lamp: ['#ffb070', 0.35], velvet: ['#ff9aa8', 0.35], midnight: ['#9ec0ff', 0.3], sunday: ['#fff2dc', 0.12] };
  var sofaC = new T.Color(), WHITE = new T.Color('#ffffff');
  function applyLights(name) {
    var L = LIGHTS[name]; mood = name;
    scene.background.set(L.bg); hemi.color.set(L.hemi[0]); hemi.groundColor.set(L.hemi[1]); hemi.intensity = L.hemi[2]; key.color.set(L.key[0]); key.intensity = L.key[1];
    moonLight.color.set(L.moon[0]); moonLight.intensity = L.moon[1];
    lampLight.intensity = L.lamp; pictureLight.intensity = L.pic; printMat.emissiveIntensity = L.pic * 0.03; M.shade.emissiveIntensity = L.shade;
    M.wall.color.set(L.wall); M.wallSide.color.set(L.wall); M.floor.color.set(L.floor); skyMat.map = L.sky; skyMat.needsUpdate = true; shaft.material.opacity = L.shaft;
    RIM.value.set(rimMood[name][0]).multiplyScalar(rimMood[name][1]); if (typeof steamMat !== 'undefined') steamMat.uniforms.a.value = name === 'sunday' ? 0.6 : 1;
    // Re-cover the sofa in the mood's colour: the velvet a shade darker than the token, the piping darker still.
    sofaC.set(L.sofa);
    // (A mood can also give hand-picked cover colours, as Lamp Light does.)
    var cv = L.cover;
    [M.velvet].concat(RUNS.map(function (r) { return r.seatMesh.material; })).forEach(function (m) {
      if (cv) { m.color.set(cv[0]); m.sheenColor.set(cv[2]); } else { m.color.copy(sofaC).multiplyScalar(0.72); m.sheenColor.copy(sofaC).lerp(WHITE, 0.3); }
    });
    if (cv) { M.velvetDeep.color.set(cv[1]); M.velvetDeep.sheenColor.set(cv[2]); } else { M.velvetDeep.color.copy(sofaC).multiplyScalar(0.58); M.velvetDeep.sheenColor.copy(sofaC).lerp(WHITE, 0.35); }
    M.curtain.color.set(L.curtain); candleBase = L.candle; fairyLevel = L.fairy; flames.forEach(function (f) { f.visible = L.candle > 0.5; }); fairy.mat.color.setRGB(2.3 * L.fairy, 1.6 * L.fairy, 0.75 * L.fairy);
    envMats.forEach(function (m) { if ('envMapIntensity' in m) m.envMapIntensity = L.env; });
    renderer.toneMappingExposure = L.exposure;
  }

  // ================= story props =================
  // A ginger cat asleep on the window sill, outlined against the moon.
  var cat = (function () {
    var fur = phys({ color: '#d9843a', roughness: 0.85, sheen: 1, sheenRoughness: 0.5, sheenColor: new T.Color('#ffd3a0'), normalMap: velvetN, normalScale: new T.Vector2(0.4, 0.4) });
    var furLight = phys({ color: '#f6e3c8', roughness: 0.85, sheen: 1, sheenRoughness: 0.5, sheenColor: new T.Color('#ffffff') });
    var c = new T.Group(); c.position.set(WALL_X + 0.24, WIN.y - 0.66, WIN.z + 0.3); c.rotation.y = Math.PI / 2 - 0.25; world.add(c);
    var body = new T.Group(); body.userData.live = true; c.add(body);
    var torso = add(new T.SphereGeometry(1, 28, 18), fur, body); torso.scale.set(0.17, 0.095, 0.12); torso.position.y = 0.08;
    var belly = add(new T.SphereGeometry(1, 20, 14), furLight, body, false); belly.scale.set(0.12, 0.07, 0.08); belly.position.set(0.04, 0.06, 0.055);
    var head = new T.Group(); head.position.set(0.15, 0.085, 0.07); head.rotation.set(0, 0.6, -0.25); c.add(head);
    var skull = add(new T.SphereGeometry(0.07, 22, 16), fur, head); skull.scale.set(1, 0.85, 0.95);
    var muzzle = add(new T.SphereGeometry(0.032, 14, 10), furLight, head, false); muzzle.position.set(0.0, -0.022, 0.055); muzzle.scale.set(1.3, 0.8, 0.8);
    [-1, 1].forEach(function (sd) {
      var ear = add(new T.ConeGeometry(0.026, 0.05, 10), fur, head); ear.position.set(sd * 0.038, 0.06, -0.005); ear.rotation.set(-0.2, 0, -sd * 0.35);
      var lid = add(new T.TorusGeometry(0.014, 0.0035, 6, 12, Math.PI), new T.MeshStandardMaterial({ color: '#2a170c', roughness: 0.6 }), head, false); lid.position.set(sd * 0.027, 0.005, 0.064); lid.rotation.z = Math.PI;
    });
    var nose = add(new T.SphereGeometry(0.008, 8, 6), new T.MeshStandardMaterial({ color: '#d77a7a', roughness: 0.4 }), head, false); nose.position.set(0, -0.012, 0.085);
    var paw = add(new T.CapsuleGeometry(0.022, 0.06, 4, 8), furLight, c, false); paw.rotation.z = Math.PI / 2; paw.rotation.y = 0.4; paw.position.set(0.14, 0.025, 0.11);
    var tail = new T.CatmullRomCurve3([[-0.15, 0.06, -0.02], [-0.18, 0.04, 0.08], [-0.1, 0.03, 0.15], [0.03, 0.025, 0.16], [0.12, 0.025, 0.14]].map(function (q) { return new T.Vector3(q[0], q[1], q[2]); }));
    var tailGeo = new T.TubeGeometry(tail, 40, 0.024, 10, false), tp = tailGeo.attributes.position;
    add(tailGeo, fur, c);
    return { body: body, head: head };
  })();

  // A mug of cocoa, still steaming, by the popcorn.
  var mugMat = phys({ color: '#f2e8d8', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 });
  var mug = new T.Group(); mug.position.set(0.27, 0.46, -0.14); table.add(mug);
  add(new T.LatheGeometry([[0, 0], [0.036, 0], [0.04, 0.006], [0.042, 0.095], [0.038, 0.095], [0.036, 0.012], [0, 0.012]].map(function (q) { return new T.Vector2(q[0], q[1]); }), 36), mugMat, mug);
  var handle = add(new T.TorusGeometry(0.024, 0.006, 8, 20, Math.PI * 1.2), mugMat, mug); handle.position.set(0.042, 0.05, 0); handle.rotation.z = -Math.PI * 0.6;
  var cocoa = add(new T.CircleGeometry(0.037, 28), phys({ color: '#4a2616', roughness: 0.25, clearcoat: 0.6 }), mug, false); cocoa.rotation.x = -Math.PI / 2; cocoa.position.y = 0.082;
  var steamMat = new T.ShaderMaterial({
    uniforms: { t: { value: 0 }, a: { value: 1 } }, transparent: true, depthWrite: false, side: T.DoubleSide,
    vertexShader: 'uniform float t; varying vec2 vUv; void main() { vUv = uv; vec3 p = position; p.x += sin(p.y * 22.0 - t * 1.6) * 0.012 * uv.y + sin(p.y * 9.0 + t) * 0.008 * uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
    fragmentShader: 'uniform float t; uniform float a; varying vec2 vUv; void main() { float w = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x); float h = smoothstep(0.0, 0.15, vUv.y) * (1.0 - vUv.y); float wisp = 0.5 + 0.5 * sin(vUv.y * 14.0 - t * 2.4 + vUv.x * 5.0); gl_FragColor = vec4(1.0, 0.97, 0.92, w * h * wisp * 0.22 * a); }'
  });
  var steam = [];
  [0, 1].forEach(function (i) { var m = new T.Mesh(new T.PlaneGeometry(0.06, 0.26, 1, 16), steamMat); m.geometry.translate(0, 0.13, 0); m.position.set(0.004 * i, 0.09, 0.004 * i); m.userData.live = true; mug.add(m); steam.push(m); });

  // A pair of slippers, kicked off by the table. (The foreground pouf is gone: it pulled the eye
  // away from the players.)
  var slipMat = phys({ color: '#7d9fd1', roughness: 0.95, sheen: 1, sheenRoughness: 0.35, sheenColor: new T.Color('#dbe8ff'), normalMap: woolN, normalScale: new T.Vector2(0.6, 0.6) });
  [[-0.12, 0.25, 0.5], [0.06, 0.12, -0.35]].forEach(function (sp) {
    var sg = new T.Group(); sg.position.set(sp[0], 0.018, sp[1]); sg.rotation.y = sp[2]; world.add(sg);
    var sole = add(roundBox(0.11, 0.03, 0.27, 0.014, 6, 2, 12), phys({ color: '#efe3cf', roughness: 0.8 }), sg); sole.position.y = 0.015;
    var top = add(new T.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), slipMat, sg); top.scale.set(0.058, 0.055, 0.085); top.position.set(0, 0.03, 0.06);
    var pom = add(new T.SphereGeometry(0.022, 12, 8), slipMat, sg); pom.position.set(0, 0.075, 0.11);
  });

  // Bake the static room into a few dozen draw calls (see mergeStatic).
  mergeStatic(world, function (o) { return o === hourHand || o === minHand || o.userData.live || RUNS.some(function (r) { return r.seatMesh === o; }); });

  // ================= potatoes =================
  // Eight kinds, each its own value and silhouette, so they read in greyscale from the sofa.
  // Bodies stay under 0.82 wide so twelve fit on twelve seats at SCALE.
  var KINDS = {
    mashed: { color: '#f7efdc', s: [0.82, 0.76, 0.8], bump: 0.03, peak: true, butter: true, coat: 0.2 }, // a white swirled scoop with butter
    boiled: { color: '#ecd08a', s: [0.78, 0.8, 0.76], bump: 0.04, coat: 0.35 },                        // small, round, pale gold
    fry: { color: '#f6c544', box: [0.6, 2.2, 0.6, 0.22], eyeY: 0.52, coat: 0.5 },        // tall butter-yellow stick (no salt: at TV size the grains read as white pixel noise)
    chip: { color: '#e4a94e', s: [0.8, 0.86, 0.3], bump: 0.03, wave: true, coat: 0.45 },              // thin wavy crisp
    hash: { color: '#c47f2c', box: [1.5, 1.25, 0.62, 0.26], eyeY: 0.06, coat: 0.45 },                // golden-brown block
    grilled: { color: '#a8622c', s: [0.82, 0.74, 0.8], bump: 0.04, flat: true, char: true, coat: 0.15 }, // seared flat top
    sweet: { color: '#7c3550', s: [0.64, 1.18, 0.62], bump: 0.03, spindle: true, coat: 0.3 },          // tall purple spindle
    jacket: { color: '#6a4126', s: [0.82, 0.92, 0.8], bump: 0.05, foil: true, split: true, coat: 0.1 } // russet in bright foil
  };

  var scleraMat = phys({ color: '#fbf8f2', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 });
  var irisMat = phys({ color: '#ffffff', vertexColors: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
  // Iris and pupil baked into one vertex-coloured mesh; both glints into one. Two fewer draws per eye.
  function tinted(geo, hex) { var c = new T.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3); for (var i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } geo.setAttribute('color', new T.BufferAttribute(a, 3)); return geo; }
  var irisGeo = T.BufferGeometryUtils.mergeBufferGeometries([
    tinted(new T.SphereGeometry(0.105, 18, 12).scale(1, 1.1, 0.5).translate(0, 0, 0.07), '#3a2412'),
    tinted(new T.SphereGeometry(0.06, 14, 10).scale(1, 1.1, 0.5).translate(0, 0, 0.105), '#0b0604')]);
  var glintGeo = T.BufferGeometryUtils.mergeBufferGeometries([new T.SphereGeometry(0.026, 12, 8).translate(0.04, 0.045, 0.125), new T.SphereGeometry(0.012, 8, 6).translate(-0.035, -0.04, 0.12)]);
  var glintMat = new T.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  var mouthMat = new T.MeshStandardMaterial({ color: '#3a1a10', roughness: 0.5 });
  var tongueMat = new T.MeshStandardMaterial({ color: '#e0605a', roughness: 0.5 });
  var browMat = new T.MeshStandardMaterial({ color: '#5a3418', roughness: 0.7 });
  var blushTex = tex(paint(64, 64, function (c, w, h) { var g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(255,110,95,0.75)'); g.addColorStop(1, 'rgba(255,110,95,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); }), true);
  var blushMat = new T.MeshBasicMaterial({ map: blushTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });

  // A character rim light: a warm fresnel edge baked into the skin shader, so potatoes read
  // against the dark velvet without paying for another light.
  var RIM = { value: new T.Color('#ffb070').multiplyScalar(0.35) };
  function rimmed(m) {
    m.customProgramCacheKey = function () { return 'potato-skin'; };
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uRim = RIM;
      // Fake subsurface scattering: light wraps past the shadow line and comes out warm and red,
      // the way it does through a real potato (or a Pixar character's skin).
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', T.ShaderChunk.lights_physical_pars_fragment.replace(
        'vec3 irradiance = dotNL * directLight.color;',
        'float wrapNL = saturate((dot(geometry.normal, directLight.direction) + 0.5) / 1.5); vec3 irradiance = (dotNL + (wrapNL - dotNL) * vec3(0.95, 0.5, 0.32)) * directLight.color;'));
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform vec3 uRim;\nvoid main() {')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uRim * diffuseColor.rgb * smoothstep(0.55, 0.95, 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0)) * 1.4;')
        // No mirror-bright fresnel at the silhouette: at grazing angles the room's reflection went
        // nearly white and lit single edge pixels, a sparkly white outline round every potato.
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nfloat skinGraze = smoothstep(0.0, 0.45, saturate(dot(geometry.normal, geometry.viewDir)));\nreflectedLight.indirectSpecular *= skinGraze; reflectedLight.directSpecular *= skinGraze;');
    };
    return m;
  }
  var lidGeo = new T.SphereGeometry(0.185, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  var footGeo2 = (function () {
    var a = new T.SphereGeometry(0.15, 14, 10); a.scale(1, 0.62, 1.45);
    var b = a.clone(); a.translate(-0.3, 0, 0); b.translate(0.3, 0, 0);
    return T.BufferGeometryUtils ? T.BufferGeometryUtils.mergeBufferGeometries([a, b]) : a;
  })();

  function potatoMesh(kindName, seed) {
    var k = KINDS[kindName], g = new T.Group(), geo, sx, sy, sz;
    if (k.box) {
      sx = k.box[0] / 2; sy = k.box[1] / 2; sz = k.box[2] / 2;
      geo = roundBox(k.box[0], k.box[1], k.box[2], k.box[3], 10, 24, 10, { uv: 1.2 });
    } else {
      sx = k.s[0]; sy = k.s[1]; sz = k.s[2];
      geo = new T.SphereGeometry(1, 64, 40); geo.rotateY(-Math.PI / 2);
      var p = geo.attributes.position, r = rand(seed), f = [r() * 6, r() * 6, r() * 6, r() * 6];
      for (var i = 0; i < p.count; i++) {
        var x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        var b = 1 + k.bump * (Math.sin(3 * x + f[0]) * Math.sin(2.5 * y + f[1]) + 0.6 * Math.sin(4 * z + f[2]) * Math.cos(3 * x + f[3]));
        if (y < -0.75) b *= 1 - (-0.75 - y) * 0.35; // a slightly flattened bottom to sit on
        var bx = b, by = b, bz = b;
        if (k.spindle) { var t = 1 - 0.45 * y * y; bx *= t; bz *= t; }                                  // tapers at both ends
        if (k.peak) { var q = Math.max(0, (y - 0.3) / 0.7), sw = 1 + 0.05 * Math.sin(Math.atan2(z, x) * 3 + y * 9) * Math.min(1, (y + 0.4) * 1.5); by *= 1 - q * q * 0.12; bx *= sw; bz *= sw; } // a swirled scoop with a soft peak
        if (k.flat && y > 0.55) by *= 1 - (y - 0.55) * 0.55;                                           // seared flat on top
        if (k.wave) { var cr = 1 + 0.07 * Math.sin(Math.atan2(y, x) * 14) * (1 - Math.abs(z)) * (1 - Math.abs(z)); bx *= cr; by *= cr; } // crinkle-cut rim, face left smooth
        p.setXYZ(i, x * bx * sx, y * by * sy, z * bz * sz);
      }
      geo.computeVertexNormals();
      var uv = geo.attributes.uv; for (var u = 0; u < uv.count; u++) uv.setXY(u, uv.getX(u) * 3, uv.getY(u) * 2);
    }
    var skinMat = rimmed(new T.MeshStandardMaterial({ color: k.color, map: skinC, normalMap: skinN, normalScale: new T.Vector2(k.char ? 0.6 : 0.28, k.char ? 0.6 : 0.28), roughness: k.char ? 0.78 : 0.62 - k.coat * 0.2 }));
    var body = add(geo, skinMat, g); body.position.y = sy;

    var faceY = sy + (k.eyeY != null ? k.eyeY * sy : 0.14 * sy);
    function surfZ(x, y) { if (k.box) return sz; var v = 1 - (x / sx) * (x / sx) - (y / sy) * (y / sy); return sz * Math.sqrt(Math.max(0.05, v)); }
    var eyeX = Math.min(0.3, sx * 0.34);
    var eyes = [], blushGeos = [], eyeParts = { scl: [], iris: [], glint: [] };
    [-1, 1].forEach(function (s) {
      var ez = surfZ(eyeX, faceY - sy);
      var eye = new T.Group(); eye.position.set(s * eyeX, faceY, ez - 0.06); g.add(eye);
      // Both eyes share one sclera, one iris and one glint mesh (see below); each eye keeps its own lid.
      var at = new T.Vector3(s * eyeX, faceY, ez - 0.06);
      eyeParts.scl.push(new T.SphereGeometry(0.17, 24, 16).scale(1, 1.18, 0.62).translate(at.x, at.y, at.z));
      eyeParts.iris.push(irisGeo.clone().translate(at.x + s * -0.01, at.y - 0.01, at.z));
      eyeParts.glint.push(glintGeo.clone().translate(at.x, at.y, at.z));
      var lid = add(lidGeo, skinMat, eye, false); lid.scale.set(1.04, 1.2, 0.84); lid.rotation.x = -0.62; eye.userData.lid = lid;
      eyes.push(eye);
      var brow = add(new T.CapsuleGeometry(0.022, 0.13, 6, 10), browMat, g, false); brow.rotation.z = Math.PI / 2 + s * 0.18; brow.position.set(s * eyeX * 1.02, faceY + 0.27, surfZ(eyeX, faceY - sy + 0.27) - 0.005);
      brow.userData.base = brow.rotation.z; brow.userData.side = s; (g.userData.brows = g.userData.brows || []).push(brow);
      var bx = Math.min(0.56, sx * 0.62), bz = surfZ(bx, faceY - sy - 0.13);
      var bg = new T.PlaneGeometry(0.3, 0.2); bg.rotateY(s * Math.min(0.9, Math.asin(Math.min(0.95, bx / sx)))); bg.translate(s * bx, faceY - 0.15, bz + 0.012); blushGeos.push(bg);
    });
    g.add(new T.Mesh(T.BufferGeometryUtils.mergeBufferGeometries(blushGeos), blushMat));
    var mz = surfZ(0, faceY - sy - 0.17);
    var smile = add(new T.TorusGeometry(0.12, 0.026, 12, 32, Math.PI), mouthMat, g, false); smile.rotation.z = Math.PI; smile.position.set(0, faceY - 0.13, mz - 0.01);
    var ouch = new T.Group(); ouch.position.set(0, faceY - 0.2, mz - 0.02); ouch.visible = false; g.add(ouch);
    var hole = add(new T.SphereGeometry(0.1, 24, 16), mouthMat, ouch, false); hole.scale.set(0.9, 1, 0.35);
    var tongue = add(new T.SphereGeometry(0.055, 16, 12), tongueMat, ouch, false); tongue.scale.set(1, 0.6, 0.4); tongue.position.set(0, -0.045, 0.02);
    var merge = T.BufferGeometryUtils.mergeBufferGeometries;
    add(merge(eyeParts.scl), scleraMat, g, false);
    g.userData.iris = add(merge(eyeParts.iris), irisMat, g, false);
    g.add(new T.Mesh(merge(eyeParts.glint), glintMat));
    g.userData.eyes = eyes; g.userData.smile = smile; g.userData.ouch = ouch;

    if (k.foil) {
      var fg = new T.CylinderGeometry(1, 0.9, 0.62, 56, 6, true), fp = fg.attributes.position, fr = rand(seed + 3);
      for (var fi = 0; fi < fp.count; fi++) { var cr = 1 + (fr() - 0.5) * 0.05; fp.setXYZ(fi, fp.getX(fi) * cr, fp.getY(fi) + (fp.getY(fi) > 0.3 ? Math.sin(fi * 0.7) * 0.03 : 0), fp.getZ(fi) * cr); }
      fg.computeVertexNormals();
      var foil = add(fg, new T.MeshStandardMaterial({ color: '#e9edf3', roughness: 0.32, metalness: 0.45, side: T.DoubleSide }), g); foil.scale.set(sx * 1.03, 1, sz * 1.03); foil.position.y = 0.36;
    }
    if (k.split) {
      var fluff = add(new T.SphereGeometry(1, 20, 12), phys({ color: '#fff3d2', roughness: 0.8, sheen: 0.6, sheenColor: new T.Color('#ffffff') }), g, false);
      fluff.scale.set(sx * 0.42, 0.16, sz * 0.36); fluff.position.set(0, sy * 2 - 0.06, -0.04);
    }
    if (k.butter) {
      var butter = add(roundBox(0.5, 0.2, 0.42, 0.05, 8, 4, 8), phys({ color: '#ffd84a', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 }), g); butter.position.set(0.02, sy * (k.peak ? 1.9 : 2) + 0.02, -0.02); butter.scale.setScalar(0.75); butter.rotation.set(0.12, 0.4, -0.08);
    }
    if (k.salt) {
      var sr = rand(seed + 9), saltMat = phys({ color: '#ffffff', roughness: 0.1, clearcoat: 1 });
      for (var si = 0; si < 26; si++) { var side = sr() > 0.5 ? 1 : -1, sy2 = sr() * sy * 1.8 + 0.1; var sc = add(new T.BoxGeometry(0.035, 0.035, 0.035), saltMat, g, false); sc.position.set((sr() - 0.5) * sx * 1.6, sy2, side > 0 ? sz + 0.005 : -sz - 0.005); sc.rotation.set(sr() * 3, sr() * 3, sr() * 3); }
    }
    if (k.salt) { var sg = new T.Group(); g.children.filter(function (o) { return o.material && o.material.color && o.material.color.getHexString() === 'ffffff' && o.geometry.type === 'BoxGeometry'; }).forEach(function (o) { sg.attach(o); }); mergeStatic(sg, function () { return false; }); g.add(sg); }
    if (k.char) {
      for (var c = -1; c <= 1; c++) {
        var stripe = add(new T.TorusGeometry(1, 0.03, 8, 64, 1.2), new T.MeshStandardMaterial({ color: '#3a2010', roughness: 0.9 }), g, false);
        stripe.scale.set(sx * 1.005, sy * 1.005, sz * 1.005); stripe.position.y = sy; stripe.rotation.set(Math.PI / 2 + 0.3, c * 0.5, -0.4 + c * 0.05);
      }
    }
    // Stubby feet, poking out over the seat edge. They swing while sitting and kick in the air.
    var feet = new T.Group(); feet.position.set(0, 0.12, sz * 0.55); g.add(feet);
    var footMat = skinMat.clone(); footMat.color.multiplyScalar(0.78); footMat.onBeforeCompile = skinMat.onBeforeCompile; footMat.customProgramCacheKey = skinMat.customProgramCacheKey;
    var foot = add(footGeo2, footMat, feet, false); foot.position.set(0, -0.04, 0.1); foot.scale.x = Math.min(1.2, sx / 0.9);
    g.userData.feet = feet;
    g.userData.top = sy * (k.peak ? 2.05 : k.flat ? 1.8 : 2); g.userData.halfW = sx;
    return g;
  }

  function crownMesh() {
    var c = new T.Group();
    var band = add(new T.CylinderGeometry(0.34, 0.37, 0.18, 40, 1, true), new T.MeshStandardMaterial({ color: '#e7b85a', roughness: 0.2, metalness: 1, side: T.DoubleSide }), c);
    var rimT = add(new T.TorusGeometry(0.37, 0.025, 8, 48), M.gold, c); rimT.rotation.x = Math.PI / 2; rimT.position.y = -0.09;
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * Math.PI * 2, spike = add(new T.ConeGeometry(0.075, 0.26, 14), M.gold, c);
      spike.position.set(Math.cos(a) * 0.335, 0.2, Math.sin(a) * 0.335);
      var ball = add(new T.SphereGeometry(0.038, 12, 8), M.gold, c); ball.position.set(Math.cos(a) * 0.335, 0.34, Math.sin(a) * 0.335);
    }
    var gem = add(new T.OctahedronGeometry(0.075, 0), phys({ color: '#d42f3a', roughness: 0.05, clearcoat: 1, metalness: 0.1 }), c); gem.position.set(0, 0, 0.375); gem.scale.set(1, 1.2, 0.6);
    c.rotation.z = 0.16;
    return c;
  }

  var SCALE = 0.25;
  var players = [];
  // The app calls the hash brown 'hashbrown'.
  function kindOf(k) { return k === 'hashbrown' ? 'hash' : KINDS[k] ? k : 'boiled'; }
  function setCrown(p, on) {
    if (on && !p.crown) {
      var cr = crownMesh(); mergeStatic(cr, function () { return false; }); cr.position.set(0.05, p.body.userData.top + 0.08, 0);
      cr.traverse(function (o) { o.layers.set(LAYER_SPUDS); }); p.body.add(cr); p.crown = cr;
    } else if (!on && p.crown) { p.body.remove(p.crown); p.crown = null; }
    p.head = on; p.tagUntil = on ? Infinity : Math.min(p.tagUntil, clockT + 2);
    p.tag.firstChild.textContent = (on ? '\u265b ' : '') + p.name; p.tagW = 0;
  }
  function addPlayer(info, delay) {
    var kind = kindOf(info.kind), seatIdx = FILL[((info.seat % SEATS) + SEATS) % SEATS], name = info.name, head = !!info.head;
    var g = potatoMesh(kind, seatIdx * 31 + 7);
    var holder = new T.Group(); holder.add(g); world.add(holder);
    holder.traverse(function (o) { o.layers.set(LAYER_SPUDS); });
    g.traverse(function (o) { if (o.material && 'envMapIntensity' in o.material) { o.material.envMapIntensity = LIGHTS[mood].env; if (envMats.indexOf(o.material) < 0) envMats.push(o.material); } });
    var tag = document.createElement('div'); tag.className = 'tag'; var pill = document.createElement('span'); pill.textContent = name; tag.appendChild(pill); tag.appendChild(document.createElement('i'));
    var key = 'abcd'[((info.colour % 4) + 4) % 4];
    tag.style.setProperty('--c', 'var(--tile-' + key + ')'); tag.style.setProperty('--ci', 'var(--tile-' + key + '-ink)'); tagsEl.appendChild(tag);
    var p = {
      id: info.id, name: name, kind: kind, seat: seatIdx, holder: holder, body: g, tag: tag, head: false, crown: null, away: false, leaving: 0,
      run: SEAT_LIST[seatIdx].run, lx: SEAT_LIST[seatIdx].lx, lz: 0.05, x: 0, z: 0, y: reduced ? SEAT_TOP : SEAT_TOP + 4 + Math.random() * 0.6, vy: 0,
      sq: 1, sqv: 0, tilt: 0, tiltv: 0, dent: 0, wait: reduced ? 0 : delay, landed: reduced, tagUntil: head ? Infinity : 0,
      hopIn: 5 + Math.random() * 7, moveIn: 6 + Math.random() * 10, move: null, squintUntil: 0, blinkIn: 1 + Math.random() * 4, ouchUntil: 0, look: Math.random() * 6,
      yaw: 0, lookAt: null, lookFrom: 0, lookUntil: 0, glanceAt: 3 + Math.random() * 6, sacAt: 0, sacX: 0, sacY: 0
    };
    var at = runToRoom(p.run, p.lx, p.lz); p.x = at.x; p.z = at.z;
    holder.position.set(p.x, p.y, p.z); holder.visible = p.wait <= 0;
    players.push(p); setCrown(p, head);
    return p;
  }
  // Off the sofa: a quick hop up and out, shrinking away, then everything it used is freed.
  function leave(p) { if (p.leaving) return; p.leaving = 1e-6; p.vy = Math.max(p.vy, 2.6); p.tag.classList.remove('in', 'on'); p.dent = 0; }
  function drop(p) {
    players.splice(players.indexOf(p), 1); world.remove(p.holder); p.tag.remove();
    var mats = new Set();
    p.holder.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) mats.add(o.material); });
    mats.forEach(function (m) { var i = envMats.indexOf(m); if (i >= 0) envMats.splice(i, 1); m.dispose(); });
  }

  // The app shows its own "Maya sat down" as each potato lands.
  function announce(p) { if (opts.onLand) opts.onLand(p.id); }

  // ================= contact shadows =================
  // One instanced soft blob under every potato: it grows on the seat just before a potato drops
  // (so everyone sees where the newcomer will land), shrinks as it falls in, then stays as the
  // contact shadow that grounds the potato on the velvet.
  var blobTex = tex(paint(64, 64, function (c, w, h) { var gr = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.38)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); }), true);
  var blobGeo = new T.PlaneGeometry(1, 1); blobGeo.rotateX(-Math.PI / 2);
  var blobs = new T.InstancedMesh(blobGeo, new T.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), SEATS);
  blobs.count = 0; blobs.frustumCulled = false; blobs.renderOrder = 1; world.add(blobs);
  var blobM = new T.Matrix4(), blobQ = new T.Quaternion(), blobP = new T.Vector3(), blobS = new T.Vector3();
  function placeBlob(p, i) {
    var w = p.body.userData.halfW * SCALE * 2.3, k;
    if (p.wait > 0) k = p.wait < 0.7 ? 1 - p.wait / 0.7 : 0;                     // the "someone's coming" marker
    else { var h = Math.max(0, p.y - SEAT_TOP); k = 1 / (1 + h * 1.6); }          // tightens as the potato falls in
    var rest = SEAT_TOP - p.dent * 0.85 + 0.006;
    blobP.set(p.x, rest, p.z); blobS.set(w * (0.6 + 0.4 * k) * k, 1, w * 0.7 * (0.6 + 0.4 * k) * k);
    blobQ.setFromAxisAngle(Y_AXIS, p.run.rot);
    blobs.setMatrixAt(i, blobM.compose(blobP, blobQ, blobS));
  }
  var Y_AXIS = new T.Vector3(0, 1, 0);

  // ================= dust =================
  var dustTex = tex(paint(64, 64, function (c, w, h) { var gr = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,240,220,0.9)'); gr.addColorStop(1, 'rgba(255,240,220,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); }), true);
  // One pooled point cloud for every puff: a single draw call, nothing allocated while playing.
  var DUST_MAX = 96, dust = [], dustPos = new Float32Array(DUST_MAX * 3), dustSA = new Float32Array(DUST_MAX * 2);
  var dustGeo = new T.BufferGeometry();
  dustGeo.setAttribute('position', new T.BufferAttribute(dustPos, 3).setUsage(T.DynamicDrawUsage));
  dustGeo.setAttribute('sa', new T.BufferAttribute(dustSA, 2).setUsage(T.DynamicDrawUsage));
  dustGeo.setDrawRange(0, 0);
  var dustMat = new T.ShaderMaterial({
    uniforms: { map: { value: dustTex }, uScale: { value: 540 } }, transparent: true, depthWrite: false,
    vertexShader: 'attribute vec2 sa; uniform float uScale; varying float vA; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = sa.x * projectionMatrix[1][1] * uScale / -mv.z; vA = sa.y; }',
    fragmentShader: 'uniform sampler2D map; varying float vA; void main() { vec4 c = texture2D(map, gl_PointCoord); gl_FragColor = vec4(c.rgb, c.a * vA); }'
  });
  var dustPts = new T.Points(dustGeo, dustMat); dustPts.frustumCulled = false; dustPts.layers.set(1); world.add(dustPts);
  function puff(x, y, z, power) {
    var n = Math.min(22, 8 + Math.round(power * 1.5), DUST_MAX - dust.length);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 0.5 + Math.random() * power * 0.1;
      dust.push({ x: x, y: y + 0.02, z: z, vx: Math.cos(a) * sp, vy: 0.25 + Math.random() * 0.5, vz: Math.sin(a) * sp * 0.6, life: 0, max: 0.6 + Math.random() * 0.6 });
    }
  }

  // ================= simulation =================
  var GRAV = -16, KSQ = 210, CSQ = 9;
  function step(p, dt, t) {
    if (p.leaving) { p.leaving += dt; p.vy += 9 * dt; p.y += p.vy * dt; return; }
    if (p.wait > 0) { p.wait -= dt; if (p.wait <= 0) p.holder.visible = true; return; }
    var rest = SEAT_TOP - p.dent * 0.85;
    if (p.y > rest + 1e-4 || p.vy > 0) {
      p.vy += GRAV * dt; p.y += p.vy * dt;
      if (p.y <= rest) {
        var impact = -p.vy; p.y = rest;
        if (impact > 1.4) {
          p.vy = impact * 0.38; p.sqv -= impact * 1.25; p.tiltv += (Math.random() - 0.5) * impact * 1.6;
          if (impact > 4) { var fr = runToRoom(p.run, p.lx, p.lz + 0.25); puff(fr.x, SEAT_TOP, fr.z, impact); p.ouchUntil = t + 0.5; }
          if (!p.landed) {
            p.landed = true; if (!p.head) p.tagUntil = t + 2.6; announce(p);
            // The welcome: the nearest neighbours on the same run give a little bounce and a grin.
            players.filter(function (q) { return q !== p && q.run === p.run && q.landed && q.wait <= 0 && Math.abs(q.lx - p.lx) < 0.95; }).forEach(function (q, i) {
              setTimeout(function () { if (alive) { hop(q, 1.8); q.squintUntil = clockT + 0.6; } }, reduced ? 0 : 260 + i * 120);
            });
          }
          if (impact > 2.5) {
            neighbours(p, 2.2).forEach(function (q) { q.lookAt = p; q.lookFrom = t + Math.random() * 0.15; q.lookUntil = t + 1 + Math.random() * 0.8; });
            // The bench is one cushion: a hard landing ripples out and lifts whoever sits close.
            players.forEach(function (q) {
              if (q === p || q.run !== p.run || q.wait > 0 || q.vy !== 0) return;
              var d = Math.abs(q.lx - p.lx); if (d > 1.0) return;
              var k = (1 - d / 1.0) * (impact - 2.5) * 0.28;
              if (k > 0.25) { q.vy = k; q.sqv -= k * 2.2; q.tiltv += (q.lx > p.lx ? 1 : -1) * k * 1.5; }
            });
          }
        } else { p.vy = 0; }
      }
    }
    var airborne = p.y > rest + 0.01;
    var target = airborne ? 1 + Math.min(0.22, Math.abs(p.vy) * 0.025) : 1;
    var a = -KSQ * (p.sq - target) - CSQ * p.sqv; p.sqv += a * dt; p.sq += p.sqv * dt;
    p.sq = clamp(p.sq, 0.55, 1.35);
    var ta = -90 * p.tilt - 6 * p.tiltv; p.tiltv += ta * dt; p.tilt += p.tiltv * dt;
    var wantDent = airborne ? Math.max(0, 0.045 - (p.y - rest) * 0.4) : 0.045 + Math.max(0, 1 - p.sq) * 0.32;
    p.dent += (wantDent - p.dent) * Math.min(1, dt * 30);
  }
  function pressSeat() {
    RUNS.forEach(function (run) {
      var n = 0;
      players.forEach(function (p) { if (p.run === run && p.dent > 0.001 && p.wait <= 0 && n < MAX_DENTS) run.dents[n++].set(p.lx, p.lz, p.dent, 0.12 + p.body.userData.halfW * 0.05); });
      for (; n < MAX_DENTS; n++) run.dents[n].z = 0;
    });
  }

  // ================= the plate =================
  // Almost nothing in the room moves: only the potatoes and a few small things (candle flames, fairy
  // lights, the cat's breathing, the clock hands, and the cushion right under each potato). So the room
  // is drawn once, supersampled (several jittered passes averaged), and kept with its depth buffer. Each
  // frame lays that picture down, depth and all, and draws only what moves on top. The room then costs
  // one textured quad, the candlelight flicker is a second texture added on top, and the potatoes get
  // MSAA, bloom, depth of field and the grade at full resolution.
  var LAYER = { room: 0, spuds: 1, live: 2, seats: 3 };
  var PLATE_SAMPLES = clamp(+(location.search.match(/[?&]samples=(\d+)/) || [0, 12])[1], 1, 32);
  var plate = null, plateDirty = true;
  var quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), quadGeo = new T.PlaneGeometry(2, 2);
  function quadScene(mat) { var sc = new T.Scene(), m = new T.Mesh(quadGeo, mat); m.frustumCulled = false; sc.add(m); return sc; }
  var quadV = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  var accScene = quadScene(new T.ShaderMaterial({ uniforms: { t: { value: null }, a: { value: 1 } }, vertexShader: quadV,
    fragmentShader: 'uniform sampler2D t; uniform float a; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(t, vUv).rgb, a); }',
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  var diffScene = quadScene(new T.ShaderMaterial({ uniforms: { a: { value: null }, b: { value: null } }, vertexShader: quadV,
    fragmentShader: 'uniform sampler2D a; uniform sampler2D b; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(a, vUv).rgb - texture2D(b, vUv).rgb, 1.0); }',
    depthTest: false, depthWrite: false, toneMapped: false }));
  var plateMat = new T.ShaderMaterial({ uniforms: { tColor: { value: null }, tDepth: { value: null }, tCandle: { value: null }, uFlick: { value: 0 } }, vertexShader: quadV,
    fragmentShader: 'uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tCandle; uniform float uFlick; varying vec2 vUv;\n' +
      'void main() { vec3 c = texture2D(tColor, vUv).rgb + uFlick * texture2D(tCandle, vUv).rgb; gl_FragColor = vec4(max(c, 0.0), 1.0); gl_FragDepthEXT = texture2D(tDepth, vUv).x; }',
    extensions: { fragDepth: true }, depthTest: true, depthFunc: T.AlwaysDepth, depthWrite: true, toneMapped: false });
  var plateScene = quadScene(plateMat);
  function halton(i, b) { var f = 1, x = 0; while (i > 0) { f /= b; x += f * (i % b); i = Math.floor(i / b); } return x; }
  function plateRT(w, h, o) { return new T.WebGLRenderTarget(w, h, Object.assign({ type: T.HalfFloatType, minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: true }, o || {})); }
  function setSeatsLive(on) { RUNS.forEach(function (r) { r.liveU.value = on ? 1 : 0; }); }
  var plateSize = new T.Vector2();
  function bakePlate() {
    renderer.getDrawingBufferSize(plateSize);
    var w = plateSize.x, h = plateSize.y, hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    if (!plate || plate.w !== w || plate.h !== h) {
      if (plate) ['color', 'tmp', 'sample', 'ca', 'cb', 'candle'].forEach(function (k) { plate[k].dispose(); });
      var lin = { minFilter: T.LinearFilter, magFilter: T.LinearFilter };
      plate = { w: w, h: h, color: plateRT(w, h, { depthBuffer: false }), tmp: plateRT(w, h, { depthBuffer: false }), sample: plateRT(w, h, { depthTexture: new T.DepthTexture(w, h, T.UnsignedIntType) }),
        ca: plateRT(hw, hh, lin), cb: plateRT(hw, hh, lin), candle: plateRT(hw, hh, Object.assign({ depthBuffer: false }, lin)) };
      plateMat.uniforms.tColor.value = plate.color.texture; plateMat.uniforms.tDepth.value = plate.sample.depthTexture; plateMat.uniforms.tCandle.value = plate.candle.texture;
    }
    var mask = camera.layers.mask, auto = renderer.autoClear, ci = candleLight.intensity, acc = accScene.children[0].material;
    candleLight.intensity = candleBase; setSeatsLive(false); renderer.autoClear = true;
    flames.forEach(function (fl) { fl.scale.set(0.8, 0.7, 0.8); });
    camera.layers.set(LAYER.room); camera.layers.enable(LAYER.seats);
    // The room, supersampled: sub-pixel jittered passes, averaged as they come in.
    for (var k = 0; k < PLATE_SAMPLES; k++) {
      if (PLATE_SAMPLES > 1) camera.setViewOffset(w, h, (halton(k + 1, 2) - 0.5) * 0.9, (halton(k + 1, 3) - 0.5) * 0.9, w, h);
      renderer.autoClear = true; renderer.setRenderTarget(plate.sample); renderer.render(scene, camera);
      acc.uniforms.t.value = plate.sample.texture; acc.uniforms.a.value = 1 / (k + 1);
      renderer.autoClear = false; renderer.setRenderTarget(plate.color); renderer.render(accScene, quadCam);
    }
    camera.clearViewOffset(); renderer.autoClear = true;
    // Bloom and depth of field never change for a still room, so they are baked in too: the glow
    // round the lamp, candles and fairy lights, and the soft wall and floor bands. A frame is then
    // just the plate, what moves, and the colour grade.
    if (bloom) bloom.render(renderer, null, plate.color, 0, false);
    if (dof) { dof[0].render(renderer, plate.tmp, plate.color); dof[1].render(renderer, plate.color, plate.tmp); }
    // What the candles add, at half resolution: the room lit by them, minus the room without them.
    renderer.setRenderTarget(plate.ca); renderer.render(scene, camera);
    candleLight.intensity = 0; renderer.setRenderTarget(plate.cb); renderer.render(scene, camera);
    var dm = diffScene.children[0].material; dm.uniforms.a.value = plate.ca.texture; dm.uniforms.b.value = plate.cb.texture;
    renderer.setRenderTarget(plate.candle); renderer.render(diffScene, quadCam);
    // The depth that potatoes are tested against: the room without its seat cushions (those are drawn
    // live, dented, under the potatoes).
    camera.layers.set(LAYER.room); renderer.setRenderTarget(plate.sample); renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    camera.layers.mask = mask; renderer.autoClear = auto; candleLight.intensity = ci; setSeatsLive(true);
    plateDirty = false;
  }
  // The composer's first pass: lay the plate down (colour and depth), then draw what moves.
  class PlatePass extends T.Pass {
    constructor() { super(); this.needsSwap = false; }
    render(r, writeBuffer, readBuffer) {
      var auto = r.autoClear, bg = scene.background, mask = camera.layers.mask;
      r.setRenderTarget(this.renderToScreen ? null : readBuffer);
      r.autoClear = true; r.render(plateScene, quadCam);
      r.autoClear = false; scene.background = null; // a colour background would clear the plate away
      camera.layers.set(LAYER.spuds); camera.layers.enable(LAYER.live); camera.layers.enable(LAYER.seats);
      r.render(scene, camera);
      camera.layers.mask = mask; scene.background = bg; r.autoClear = auto;
    }
  }

  // ================= post-processing (multisampled, so edges stay clean) =================
  var composer = null, bloom = null, grade = null, dof = null;
  if (T.EffectComposer && T.UnrealBloomPass && T.GammaCorrectionShader && renderer.capabilities.isWebGL2) {
    try {
      var rt = new T.WebGLRenderTarget(1280, 720, { samples: 4, type: T.HalfFloatType });
      composer = new T.EffectComposer(renderer, rt);
      composer.addPass(new PlatePass());
      var bloom = new T.UnrealBloomPass(new T.Vector2(1280, 720), 0.4, 0.55, 0.9); composer.addPass(bloom);
      // Final grade, in place of the plain sRGB pass: warm lifted blacks, a gentle S-curve, a touch of
      // colour, and fine moving grain that also dithers away banding in dark gradients on TV panels.
      grade = new T.ShaderPass({
        uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new T.Vector2(1280, 720) } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: [
          'uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;',
          'void main() {',
          '  vec4 t = LinearTosRGB(texture2D(tDiffuse, vUv)); vec3 c = t.rgb;',
          '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));',
          '  c += vec3(0.024, 0.012, 0.003) * pow(1.0 - l, 3.0);',
          '  c = mix(c, c * c * (3.0 - 2.0 * c), 0.14);',
          '  c = mix(vec3(l), c, 1.07);',
          '  float n = fract(sin(dot(floor(vUv * uRes) + fract(uTime) * 97.0, vec2(12.9898, 78.233))) * 43758.5453);',
          '  c += (n - 0.5) * (2.5 / 255.0 + 0.012 * (1.0 - l) * (1.0 - l));',
          '  gl_FragColor = vec4(c, t.a);',
          '}'].join('\n')
      });
      composer.addPass(grade);
      // Depth of field, the cheap way: the camera barely moves and the sofa sits in a fixed band of
      // the screen, so the blur follows a screen-space focus band instead of a depth buffer.
      dof = [new T.Vector2(1, 0), new T.Vector2(0, 1)].map(function (dir) {
        return new T.ShaderPass({
          uniforms: { tDiffuse: { value: null }, uDir: { value: dir.clone() }, uPx: { value: new T.Vector2(1 / 1280, 1 / 720) } },
          vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: [
            'uniform sampler2D tDiffuse; uniform vec2 uDir; uniform vec2 uPx; varying vec2 vUv;',
            'void main() {',
            '  float m = max(smoothstep(0.8, 1.0, vUv.y), smoothstep(0.26, 0.0, vUv.y));',
            '  vec2 d = uDir * uPx * m * 2.2;',
            '  vec4 c = texture2D(tDiffuse, vUv) * 0.2270270270;',
            '  c += (texture2D(tDiffuse, vUv + d * 1.3846153846) + texture2D(tDiffuse, vUv - d * 1.3846153846)) * 0.3162162162;',
            '  c += (texture2D(tDiffuse, vUv + d * 3.2307692308) + texture2D(tDiffuse, vUv - d * 3.2307692308)) * 0.0702702703;',
            '  gl_FragColor = c;',
            '}'].join('\n')
        });
      });
      // Blur before the grade, so the grain stays crisp.
      composer.insertPass(dof[0], composer.passes.length - 1); composer.insertPass(dof[1], composer.passes.length - 1);
    } catch (e) { composer = null; }
  }

  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(pixelRatio()); renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 1.4 ? 30 * Math.min(1.9, 1.6 / (w / h)) : 30;
    camera.updateProjectionMatrix();
    if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
    if (bloom) bloom.enabled = false; // baked into the plate
    if (composer) [composer.renderTarget1, composer.renderTarget2].forEach(function (rt) { var want = QUALITY[tier].msaa || 0; if (rt.samples !== want) { rt.samples = want; rt.dispose(); } });
    if (dof) dof.forEach(function (d) { d.enabled = false; d.uniforms.uPx.value.set(1 / (w * renderer.getPixelRatio()), 1 / (h * renderer.getPixelRatio())); });
    if (grade) grade.uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    if (typeof dustMat !== 'undefined') dustMat.uniforms.uScale.value = h * renderer.getPixelRatio() / 2;
    renderer.getDrawingBufferSize(plateSize); if (!plate || plateSize.x !== plate.w || plateSize.y !== plate.h) plateDirty = true;
  }
  listen(window, 'resize', resize); resize();

  // ================= behaviour =================
  var clockT = 0;
  var MOVES = {
    fry: { len: 1.4, start: function (p) { p.sqv += 9; p.squintUntil = clockT + 1.3; } },               // a long, satisfied stretch
    mashed: { len: 1.3, run: function (p, k, dt) { p.sqv += Math.sin(k * 40) * 260 * (1 - k) * dt; } }, // jelly wobble
    jacket: { len: 0.9, yaw: function (k) { return Math.PI * 2 * k * k * (3 - 2 * k); } },             // a twirl to show off the foil
    hash: { len: 0.75, start: function (p) { hop(p, 4.8); }, pitch: function (k) { return -Math.PI * 2 * Math.min(1, k * 1.4); } }, // pancake flip
    sweet: { len: 1.6, roll: function (k) { return Math.sin(k * 26) * 0.22 * (1 - k); }, start: function (p) { p.squintUntil = clockT + 1.4; } }, // shy rock
    chip: { len: 0.6, roll: function (k) { return Math.sin(k * 120) * 0.05 * (1 - k); }, start: function (p) { hop(p, 1.6); } },  // crunchy shiver
    grilled: { len: 0.8, roll: function (k) { return Math.sin(k * 90) * 0.04; }, start: function (p) { puff(p.x, p.y + p.body.userData.top * SCALE, p.z, 1); } }, // sizzle
    boiled: { len: 1.0, start: function (p) { puff(p.x, p.y + p.body.userData.top * SCALE, p.z, 1); p.sqv -= 4; p.squintUntil = clockT + 0.9; } } // lets off steam
  };
  var NO_MOVE = { yaw: 0, pitch: 0, roll: 0 };
  function signature(p, dt) {
    if (reduced || p.wait > 0 || !p.landed) return NO_MOVE;
    if (!p.move) {
      p.moveIn -= dt;
      if (p.moveIn <= 0 && p.vy === 0) { var M2 = MOVES[p.kind]; p.move = { m: M2, t: 0 }; if (M2.start) M2.start(p); p.moveIn = 10 + Math.random() * 14; }
      return NO_MOVE;
    }
    var m = p.move.m; p.move.t += dt; var k = Math.min(1, p.move.t / m.len);
    if (m.run) m.run(p, k, dt);
    var out = { yaw: m.yaw ? m.yaw(k) : 0, pitch: m.pitch ? m.pitch(k) : 0, roll: m.roll ? m.roll(k) : 0 };
    if (k >= 1) { p.move = null; out.pitch = 0; }
    return out;
  }
  // Name tags never overlap: place them front to back (lowest on screen first) and lift any tag
  // that would land on one already placed. Sizes are measured once; the active pill is 1.18x.
  var placed = [];
  function layoutTags(dt) {
    // Place in a fixed order (by where each head rests, then seat), so tags never swap places mid-hop.
    var list = players.filter(function (p) { return p.tagIn; }).sort(function (a, b) { return (b.ry - a.ry) || (a.seat - b.seat); });
    placed.length = 0;
    list.forEach(function (p) {
      var sp = p.tag.firstChild;
      if (!p.tagW) { p.tagW = sp.offsetWidth; p.tagH = sp.offsetHeight; }
      var k = p.tagOn ? 1.18 : 1, w = p.tagW * k, h = p.tagH * k, x = p.ax, y = p.ay, gap = 4;
      for (var tries = 0; tries < 12; tries++) {
        var hit = null;
        for (var i = 0; i < placed.length; i++) { var r = placed[i]; if (Math.abs(x - r.x) < (w + r.w) / 2 + gap && y > r.y - r.h - gap && y - h < r.y + gap) { hit = r; break; } }
        if (!hit) break;
        var need = (w + hit.w) / 2 + gap - Math.abs(x - hit.x), dir = x >= hit.x ? 1 : -1;
        if (need < w * 0.3 && Math.abs(x + dir * need - p.ax) < w * 0.3) x += dir * need; else y = hit.y - hit.h - gap;
      }
      placed.push({ x: x, y: y, w: w, h: h });
      // Glide to the solved spot instead of snapping, so a tag nudged aside eases over.
      if (p.gx === undefined || reduced) { p.gx = x; p.gy = y; } else { var e = 1 - Math.exp(-dt * 14); p.gx += (x - p.gx) * e; p.gy += (y - p.gy) * e; }
      var tx = Math.round(p.gx * 2) / 2, ty = Math.round(p.gy * 2) / 2, lift = Math.max(0, Math.round(p.ay - p.gy));
      if (tx !== p.tx || ty !== p.ty) { p.tx = tx; p.ty = ty; p.tag.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0)'; }
      if (lift !== p.lift) { p.lift = lift; p.tag.style.setProperty('--lift', (lift > 6 ? lift : 0) + 'px'); }
    });
  }
  function neighbours(p, r) { return players.filter(function (q) { return q !== p && q.wait <= 0 && q.landed && Math.hypot(q.x - p.x, q.z - p.z) < r; }); }
  function hop(p, v) { if (p.wait > 0) return; p.vy = v + Math.random() * 1.2; p.sqv += 4; p.tiltv += (Math.random() - 0.5) * 6; p.tagUntil = Math.max(p.tagUntil, clockT + 2); }
  applyLights(MOOD_ORDER.indexOf(opts.mood) >= 0 ? opts.mood : 'lamp');

  // ================= warm-up =================
  // Pre-compile every shader variant behind the loading screen so the first
  // real frames don't hitch. This builds a throwaway potato of each kind,
  // cycles through every mood (which changes lights/materials), and calls
  // renderer.compile to force the GPU to compile every program.
  (function warmUp() {
    // Sort the scene into layers: the room (baked into the plate), and what is drawn every frame.
    scene.traverse(function (o) { if (o.isLight) o.layers.enableAll(); });
    [hourHand, minHand, cat.body, fairy.mesh, blobs].concat(flames, steam).forEach(function (o) { o.traverse(function (c) { c.layers.set(LAYER.live); }); });
    // Flames and fairy bulbs are also in the plate, so their glow is baked; the live ones flicker on top.
    [fairy.mesh].concat(flames).forEach(function (o) { o.traverse(function (c) { c.layers.enable(LAYER.room); }); });
    RUNS.forEach(function (r) { r.seatMesh.layers.set(LAYER.seats); });
    camera.layers.enableAll();
    if (!composer) setSeatsLive(false);
    // 1. Build one temporary potato of each kind (plus a crown) so their
    //    shader programs are compiled.  Keep them invisible — they only
    //    exist long enough for compile() to see them.
    var kindNames = Object.keys(KINDS);
    var temps = kindNames.map(function (k, i) {
      var g = potatoMesh(k, i * 31);
      scene.add(g);
      return g;
    });
    var cr = crownMesh(); scene.add(cr);

    // 2. For each mood, apply its lights and compile the scene.
    //    This forces every mood-specific uniform / colour combination
    //    through the shader compiler.
    MOOD_ORDER.forEach(function (m) {
      applyLights(m);
      renderer.compile(scene, camera);
    });

    // 3. Restore the default mood and clean up the temps.
    applyLights('lamp');
    temps.forEach(function (g) { scene.remove(g); });
    scene.remove(cr);

    // 4. Both shadow maps are drawn once, now, before the first frame (drawn later, the moon's leaked
    //    through the corner of the sofa). Three tests shadow casters against the viewing camera's
    //    layers, so draw them with everything but the potatoes: the cat on the sill blocks the moon.
    camera.layers.enableAll(); camera.layers.disable(LAYER.spuds);
    moonLight.shadow.needsUpdate = key.shadow.needsUpdate = true; renderer.render(scene, camera);
    camera.layers.enableAll();
    // 5. The plate is baked on the first frame, still behind the loader.
    plateDirty = true;
  })();

  // ================= loop =================
  // Frame pacing: every second, if more than ~10% of frames missed 60fps, drop a quality tier
  // (resolution first, then bloom). After 8 calm seconds, try one tier up; if that tier fails
  // straight away, stay below it for good. Press S (or add ?stats) for a live readout.
  var pace = { frames: 0, time: 0, slow: 0, calm: 0, warm: 1500, minTier: 0, upAt: -99, fpsT: 0, fpsN: 0, fps: 0, sec: 0 };
  var statsEl = null, showStats = false;
  function toggleStats(on) {
    showStats = on; renderer.info.autoReset = !on;
    if (on && !statsEl) { statsEl = document.createElement('pre'); statsEl.className = 'stats'; document.body.appendChild(statsEl); }
    if (statsEl) statsEl.hidden = !on;
  }
  if (/[?&]stats\b/.test(location.search)) toggleStats(true);
  if (/[?&]fixed\b/.test(location.search)) pace.warm = Infinity; // hold tier 0, for comparisons
  listen(window, 'keydown', function (e) { if (e.key === 's' || e.key === 'S') toggleStats(!showStats); });
  function setTier(t) { tier = clamp(t, 0, QUALITY.length - 1); resize(); }
  // Judged on wall time (one window per second), so a slow screen settles in a few seconds rather
  // than a few minutes. A badly slow window skips two tiers at once.
  function pacing(ms) {
    if (ms > 250 || document.hidden) return;
    pace.fpsN++; pace.fpsT += ms; if (pace.fpsT >= 500) { pace.fps = pace.fpsN * 1000 / pace.fpsT; pace.fpsN = 0; pace.fpsT = 0; }
    if (pace.warm > 0) { pace.warm -= ms; return; }
    pace.frames++; pace.time += ms; if (ms > 20) pace.slow++;
    if (pace.time < 1000) return;
    var fps = pace.frames * 1000 / pace.time, bad = pace.slow > pace.frames * 0.1;
    pace.frames = 0; pace.slow = 0; pace.time = 0; pace.sec++;
    if (bad && tier < QUALITY.length - 1) {
      if (pace.sec - pace.upAt <= 3) pace.minTier = tier + 1;
      setTier(tier + (fps < 35 ? 2 : 1)); pace.calm = 0; pace.warm = 400;
    } else if (!bad && ++pace.calm >= 8 && tier > pace.minTier) { setTier(tier - 1); pace.calm = 0; pace.upAt = pace.sec; pace.warm = 400; }
  }

  var camRoom = new T.Vector3(), lookV = new T.Vector3(), yAxis = new T.Vector3(0, 1, 0);
  var last = performance.now(), v3 = new T.Vector3(), v2s = new T.Vector2(), first = true, twinkleC = new T.Color(), shadowFrames = 2; // warm-up already baked both shadow maps
  function frame(now) {
    pacing(now - last);
    if (showStats) renderer.info.reset();
    var dt = Math.min(0.05, (now - last) / 1000); last = now; clockT += dt;
    for (var s = 0; s < 4; s++) players.forEach(function (p) { step(p, dt / 4, clockT); });
    players.filter(function (p) { return p.leaving > 0.7; }).forEach(drop);
    pressSeat();

    // The camera holds still, like a TV lobby shot: the room behind the potatoes is a pre-drawn plate.
    camera.position.set(-camBase.x, camBase.y, camBase.z);
    camera.lookAt(-camTarget.x, camTarget.y, camTarget.z);

    players.forEach(function (p, i) { placeBlob(p, i); });
    blobs.count = players.length; blobs.instanceMatrix.needsUpdate = true;

    players.forEach(function (p) {
      var g = p.holder;
      g.position.set(p.x, p.y, p.z);
      var breath = reduced ? 1 : 1 + 0.014 * Math.sin(clockT * 2.1 + p.look * 3);
      var gone = p.leaving ? Math.max(0.001, 1 - p.leaving / 0.7) : 1;
      var sx = SCALE * gone / Math.sqrt(p.sq * breath);
      g.scale.set(sx, SCALE * gone * p.sq * breath, sx);
      // Attention: look at the TV (the camera) unless something more interesting just happened.
      var tgt = camRoom.set(-camera.position.x, camera.position.y, camera.position.z), turn = 0.7;
      if (p.lookAt && clockT < p.lookUntil && clockT > p.lookFrom) { tgt = lookV.set(p.lookAt.x, p.lookAt.y + 0.15, p.lookAt.z); turn = 1; }
      else if (!reduced && clockT > p.glanceAt) { // idle glance at a neighbour now and then
        var nb = neighbours(p, 1.4); if (nb.length) { var q = nb[Math.floor(Math.random() * nb.length)]; p.lookAt = q; p.lookFrom = clockT; p.lookUntil = clockT + 0.8 + Math.random() * 0.8; }
        p.glanceAt = clockT + 5 + Math.random() * 8;
      }
      var want = Math.atan2(tgt.x - p.x, tgt.z - p.z) * turn;
      p.yaw += (want - p.yaw) * Math.min(1, dt * 7);
      // Signature moves: every potato kind has its own idle show-off.
      var mv = signature(p, dt), ry = p.yaw + (reduced ? 0 : Math.sin(clockT * 0.5 + p.look) * 0.08) + mv.yaw;
      g.rotation.order = 'YXZ';
      g.rotation.set(mv.pitch, ry, p.tilt * 0.12 + mv.roll);
      if (mv.pitch) { var cy = p.body.userData.top * SCALE * p.sq * 0.5; g.position.y += cy - cy * Math.cos(mv.pitch); g.position.x -= cy * Math.sin(mv.pitch) * Math.sin(ry); g.position.z -= cy * Math.sin(mv.pitch) * Math.cos(ry); }
      // Eyes follow the target inside the head, with tiny saccades.
      if (!reduced && clockT > p.sacAt) { p.sacX = (Math.random() - 0.5) * 0.3; p.sacY = (Math.random() - 0.5) * 0.25; p.sacAt = clockT + 0.4 + Math.random() * 1.6; }
      lookV.set(tgt.x - p.x, tgt.y - (p.y + 0.18), tgt.z - p.z).applyAxisAngle(yAxis, -p.yaw).normalize();
      var ex = clamp(lookV.x * 1.6 + p.sacX, -1, 1), ey = clamp(lookV.y * 1.6 + p.sacY, -1, 1);
      p.body.userData.iris.position.set(ex * 0.047, ey * 0.042, 0);
      // Feet: a lazy swing on the seat, a quick kick in the air.
      var air = p.y > SEAT_TOP + 0.03;
      var fk = reduced ? 0 : air ? Math.sin(clockT * 22 + p.look) * 0.5 - 0.4 : Math.sin(clockT * 1.7 + p.look * 2) * 0.18;
      p.body.userData.feet.rotation.x += (fk - p.body.userData.feet.rotation.x) * Math.min(1, dt * 12);
      if (!reduced && p.landed && p.wait <= 0) { p.hopIn -= dt; if (p.hopIn <= 0) { hop(p, 2.4); p.hopIn = 6 + Math.random() * 9; } }
      p.blinkIn -= dt;
      var blinking = p.blinkIn < 0 && p.blinkIn > -0.13; if (p.blinkIn <= -0.13) p.blinkIn = 2 + Math.random() * 4;
      var hurt = clockT < p.ouchUntil;
      // Real eyelids: relaxed just over the top of the eye, sliding shut to blink, squeezed when hurt.
      var lidT = blinking || p.away ? Math.PI / 2 + 0.08 : hurt ? 0.95 : clockT < p.squintUntil ? 1.05 : -0.62 + (p.lookAt && clockT < p.lookUntil ? -0.15 : 0);
      p.body.userData.eyes.forEach(function (e) { var ld = e.userData.lid; ld.rotation.x += (lidT - ld.rotation.x) * (blinking ? 1 : Math.min(1, dt * 14)); });
      p.body.userData.brows.forEach(function (b) { b.rotation.z = b.userData.base + (hurt ? -b.userData.side * 0.5 : 0); b.position.y += 0; });
      p.body.userData.smile.visible = !hurt; p.body.userData.ouch.visible = hurt;
      // Tags hang from where the head sits at rest, plus any real height (a hop), but ignore squash,
      // breathing and show-off moves, so a name never jitters with the potato's idle wobble.
      var tagTop = p.body.userData.top * SCALE + (p.head ? 0.14 : 0.06);
      v3.set(-p.x, SEAT_TOP + tagTop, p.z).project(camera); p.ry = (1 - v3.y) / 2 * window.innerHeight;
      v3.set(-p.x, Math.max(SEAT_TOP, p.y) + tagTop, p.z).project(camera);
      p.ax = (v3.x + 1) / 2 * window.innerWidth; p.ay = (1 - v3.y) / 2 * window.innerHeight;
      var on = !p.leaving && p.wait <= 0 && clockT < p.tagUntil; if (on !== p.tagOn) { p.tagOn = on; p.tag.classList.toggle('on', on); }
      var shown = !p.leaving && p.wait <= 0 && (p.landed || on); if (shown !== p.tagIn) { p.tagIn = shown; p.tag.classList.toggle('in', shown); }
    });
    layoutTags(dt);

    for (var i = dust.length - 1; i >= 0; i--) {
      var u = dust[i]; u.life += dt;
      u.x += u.vx * dt; u.y += u.vy * dt; u.z += u.vz * dt; u.vx *= 0.94; u.vz *= 0.94; u.vy *= 0.96;
      if (u.life > u.max) dust.splice(i, 1);
    }
    if (dust.length || dustGeo.drawRange.count) {
      for (var di = 0; di < dust.length; di++) { var du = dust[di]; dustPos[di * 3] = du.x; dustPos[di * 3 + 1] = du.y; dustPos[di * 3 + 2] = du.z; dustSA[di * 2] = 0.06 + du.life * 0.45; dustSA[di * 2 + 1] = 0.55 * Math.max(0, 1 - du.life / du.max); }
      dustGeo.attributes.position.needsUpdate = true; dustGeo.attributes.sa.needsUpdate = true; dustGeo.setDrawRange(0, dust.length);
    }

    // The cat breathes, and twitches an ear in its sleep; the cocoa steams.
    if (!reduced) {
      var br = Math.sin(clockT * 1.5); cat.body.scale.set(1 + br * 0.015, 1 + br * 0.04, 1 + br * 0.02);
      cat.head.rotation.x = Math.sin(clockT * 1.5 - 0.6) * 0.03;
      steamMat.uniforms.t.value = clockT;
    }
    steam.forEach(function (m, i) { m.rotation.y = Math.atan2(-camera.position.x - 0.62, camera.position.z + 0.8) + i * 0.9; });

    // Candle flicker and a slow fairy-light twinkle.
    var fl = reduced ? 1 : 0.86 + 0.08 * Math.sin(clockT * 11.3) + 0.05 * Math.sin(clockT * 23.7 + 1.3) + 0.04 * Math.sin(clockT * 41.1 + 0.4);
    candleLight.intensity = candleBase * fl; plateMat.uniforms.uFlick.value = fl - 1;
    flames.forEach(function (f) { var w = reduced ? 0 : Math.sin(clockT * 9 + f.userData.seed) * 0.08; f.scale.set(1 - w * 0.5, fl + w, 1 - w * 0.5); f.rotation.z = reduced ? 0 : Math.sin(clockT * 3.1 + f.userData.seed) * 0.08; });
    if (!reduced && fairyLevel > 0.5) {
      for (var b = 0; b < fairy.base.length; b++) { var tw = 0.75 + 0.25 * Math.sin(clockT * 1.3 + fairy.phase[b]); fairy.mesh.setColorAt(b, twinkleC.copy(fairy.base[b]).multiplyScalar(tw)); }
      fairy.mesh.instanceColor.needsUpdate = true;
    }

    var date = new Date();
    minHand.rotation.z = -(date.getMinutes() + date.getSeconds() / 60) / 60 * Math.PI * 2;
    hourHand.rotation.z = -((date.getHours() % 12) + date.getMinutes() / 60) / 12 * Math.PI * 2;

    if (grade) grade.uniforms.uTime.value = reduced ? 0 : clockT;
    if (composer && plateDirty) { bakePlate(); pace.warm = Math.max(pace.warm, 500); }
    if (composer) composer.render(); else renderer.render(scene, camera);
    if (showStats && clockT - (pace.shown || 0) > 0.25) {
      pace.shown = clockT; var i2 = renderer.info, sz = renderer.getDrawingBufferSize(v2s);
      statsEl.textContent = Math.round(pace.fps) + ' fps\n' + i2.render.calls + ' draw calls · ' + Math.round(i2.render.triangles / 1000) + 'k triangles\n' + sz.x + '×' + sz.y + ' · tier ' + tier + '/' + (QUALITY.length - 1) + ' · msaa ' + QUALITY[tier].msaa + ' · plate ' + PLATE_SAMPLES + 'x' + '\n' + i2.programs.length + ' shaders · ' + i2.memory.geometries + ' geometries';
    }
    if (first) { first = false; if (opts.onReady) opts.onReady(); }
    if (shadowFrames < 2) { shadowFrames++; moonLight.shadow.needsUpdate = key.shadow.needsUpdate = true; }
    if (alive) rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  // ================= the lobby drives the room =================
  var byId = new Map();
  function setPlayers(list) {
    var seen = new Set(), fresh = 0;
    list.forEach(function (info) {
      seen.add(info.id);
      var p = byId.get(info.id), seat = FILL[((info.seat % SEATS) + SEATS) % SEATS];
      // A new potato, or one that changed kind or seat, drops in again.
      if (p && (p.kind !== kindOf(info.kind) || p.seat !== seat)) { drop(p); p = null; }
      if (!p) {
        p = addPlayer(info, first ? 0.6 + fresh * 0.4 : fresh * 0.25); fresh++;
        byId.set(info.id, p);
      }
      if (p.name !== info.name) { p.name = info.name; setCrown(p, p.head); }
      if (p.head !== !!info.head) setCrown(p, !!info.head);
      if (p.away !== !!info.away) { p.away = !!info.away; p.tag.classList.toggle('away', p.away); }
    });
    byId.forEach(function (p, id) { if (!seen.has(id)) { byId.delete(id); leave(p); } });
  }
  function setMood(name) {
    if (MOOD_ORDER.indexOf(name) < 0 || name === mood) return;
    applyLights(name); plateDirty = true;
  }
  function poke(id) { var p = byId.get(id); if (p && !p.leaving) hop(p, 4.2); }
  function dispose() {
    alive = false; cancelAnimationFrame(rafId);
    cleanups.forEach(function (fn) { fn(); });
    players.slice().forEach(drop);
    var mats = new Set(), texs = new Set();
    scene.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach(function (m) { mats.add(m); });
    });
    mats.forEach(function (m) { Object.keys(m).forEach(function (k) { if (m[k] && m[k].isTexture) texs.add(m[k]); }); m.dispose(); });
    texs.forEach(function (t) { t.dispose(); });
    if (scene.environment) scene.environment.dispose();
    if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); }
    if (plate) Object.keys(plate).forEach(function (k) { if (plate[k] && plate[k].dispose) plate[k].dispose(); });
    renderer.dispose(); renderer.forceContextLoss();
  }
  return { setPlayers: setPlayers, setMood: setMood, hop: poke, dispose: dispose };
}
