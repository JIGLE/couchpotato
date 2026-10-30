# Second pass: more realistic potato skin and shape, eyes set into sockets, accessories that hug the head.
# Run after potato_lib.py.
import bpy, bmesh, math, random
from mathutils import Vector, noise


def real_body(name, size, mat, parent, seed=1, deform=None, base='sphere', box=None, lumps=9, pits=7, bump=0.05):
    """A lumpy potato: irregular bulges, real 'potato eyes' (small dimples), flattened seat."""
    rnd = random.Random(seed)
    sx, sy, sz = size
    bm = bmesh.new()
    if base == 'box':
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=15, use_grid_fill=True)
        rr = box or 0.35
        for v in bm.verts:
            p = v.co * 2
            q = Vector([max(-1 + rr, min(1 - rr, c)) for c in p])
            d = p - q
            if d.length > 0: d = d.normalized() * rr
            v.co = q + d
    else:
        bmesh.ops.create_uvsphere(bm, u_segments=96, v_segments=64, radius=1.0, calc_uvs=True)
    bulges = [(Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.6, 1))).normalized(), rnd.uniform(-0.05, 0.08), rnd.uniform(3, 7)) for _ in range(lumps)]
    # keep pits off the face area (front, upper middle)
    pit_dirs = []
    while len(pit_dirs) < pits:
        d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.8, 1))).normalized()
        if d.y < -0.55 and d.z > -0.3: continue
        pit_dirs.append(d)
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    for v in bm.verts:
        p = v.co.copy(); n = p.normalized()
        f = 1 + bump * noise.noise(p * 1.4 + off) + 0.012 * noise.noise(p * 6 + off)
        for d, a, k in bulges:
            f += a * math.exp(-k * (1 - n.dot(d)) * 4)
        for d in pit_dirs:
            t = 1 - n.dot(d)
            f -= 0.035 * math.exp(-t * 900)
        if p.z < -0.72: f *= 1 - (-0.72 - p.z) * 0.4
        fx = fy = fz = f
        if deform: fx, fy, fz = deform(p.x, p.y, p.z, fx, fy, fz)
        v.co = Vector((p.x * fx * sx, p.y * fy * sy, p.z * fz * sz + sz))
    ob = mesh_obj(name, bm, mat, parent)
    sub = ob.modifiers.new('Subdivision', 'SUBSURF'); sub.levels = 1; sub.render_levels = 2
    # 'Pits' colour: darker skin in and around each potato eye
    me = ob.data
    ca = me.color_attributes.new('Pits', 'FLOAT_COLOR', 'POINT')
    c = Vector((0, 0, sz))
    for i, v in enumerate(me.vertices):
        n = Vector(((v.co.x) / sx, v.co.y / sy, (v.co.z - sz) / sz)).normalized()
        a = 0.0
        for d in pit_dirs:
            a = max(a, math.exp(-(1 - n.dot(d)) * 350))
        ca.data[i].color = (a, a, a, 1)
    return ob


def real_skin(name, color, dark, net='#c08a52', rough=0.72, blush='#e8606a', stripes=None, mottle=None):
    """Russet potato skin: mottled tone, fine lighter netting, dark speckles, darker eye pits, dirt in cavities."""
    m = bpy.data.materials.get(name)
    if m: bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name); m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    b = N['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    b.inputs['Subsurface Weight'].default_value = 0.12
    b.inputs['Subsurface Radius'].default_value = (1.0, 0.55, 0.3)
    b.inputs['Subsurface Scale'].default_value = 0.05
    tc = N.new('ShaderNodeTexCoord')
    def noise_tex(scale, detail=4, rough_=0.55, dist=0.0):
        n = N.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough_; n.inputs['Distortion'].default_value = dist
        L.new(tc.outputs['Object'], n.inputs['Vector']); return n
    def ramp(src, p0, c0, p1, c1):
        r = N.new('ShaderNodeValToRGB')
        r.color_ramp.elements[0].position = p0; r.color_ramp.elements[0].color = c0
        r.color_ramp.elements[1].position = p1; r.color_ramp.elements[1].color = c1
        L.new(src, r.inputs['Fac']); return r
    def mix(a, bsock, fac, blend='MIX', bcol=None):
        x = N.new('ShaderNodeMix'); x.data_type = 'RGBA'; x.blend_type = blend
        L.new(a, x.inputs['A'])
        if bsock is not None: L.new(bsock, x.inputs['B'])
        else: x.inputs['B'].default_value = hex_rgba(bcol)
        if isinstance(fac, float): x.inputs['Factor'].default_value = fac
        else: L.new(fac, x.inputs['Factor'])
        return x.outputs['Result']
    W, K = (1, 1, 1, 1), (0, 0, 0, 1)
    # tone: base colour pulled lighter/darker in broad soft patches
    tone = ramp(noise_tex(2.5, 6, 0.6, 0.3).outputs['Fac'], 0.3, hex_rgba(dark), 0.75, hex_rgba(color))
    lighter = ramp(noise_tex(5, 3).outputs['Fac'], 0.45, hex_rgba(color), 0.7, hex_rgba(net))
    col = mix(tone.outputs['Color'], lighter.outputs['Color'], 0.35)
    if mottle:
        mm = ramp(noise_tex(2.0, 4).outputs['Fac'], 0.45, K, 0.62, W)
        col = mix(col, None, mm.outputs['Color'], bcol=mottle)
    # russet netting: thin lighter cracks
    vor = N.new('ShaderNodeTexVoronoi'); vor.feature = 'DISTANCE_TO_EDGE'; vor.inputs['Scale'].default_value = 22
    vn = noise_tex(8, 2)
    vmap = N.new('ShaderNodeVectorMath'); vmap.operation = 'ADD'
    L.new(tc.outputs['Object'], vmap.inputs[0]); L.new(vn.outputs['Color'], vmap.inputs[1])
    vs = N.new('ShaderNodeVectorMath'); vs.operation = 'SCALE'; vs.inputs['Scale'].default_value = 1.0
    L.new(vmap.outputs['Vector'], vor.inputs['Vector'])
    netmask = ramp(vor.outputs['Distance'], 0.0, W, 0.06, K)
    netfade = ramp(noise_tex(3, 2).outputs['Fac'], 0.4, K, 0.6, W)  # netting only in patches
    nm = N.new('ShaderNodeMath'); nm.operation = 'MULTIPLY'
    L.new(netmask.outputs['Color'], nm.inputs[0]); L.new(netfade.outputs['Color'], nm.inputs[1])
    nm2 = N.new('ShaderNodeMath'); nm2.operation = 'MULTIPLY'; nm2.inputs[1].default_value = 0.55
    L.new(nm.outputs['Value'], nm2.inputs[0])
    col = mix(col, None, nm2.outputs['Value'], bcol=net)
    # dark speckles (lenticels)
    sp = ramp(noise_tex(45, 2, 0.5).outputs['Fac'], 0.66, K, 0.72, W)
    spm = N.new('ShaderNodeMath'); spm.operation = 'MULTIPLY'; spm.inputs[1].default_value = 0.7
    L.new(sp.outputs['Color'], spm.inputs[0])
    col = mix(col, None, spm.outputs['Value'], bcol=dark)
    if stripes:
        wv = N.new('ShaderNodeTexWave'); wv.wave_type = 'BANDS'; wv.bands_direction = 'DIAGONAL'; wv.wave_profile = 'SAW'
        wv.inputs['Scale'].default_value = 1.8; wv.inputs['Distortion'].default_value = 0.6; wv.inputs['Detail'].default_value = 2
        L.new(tc.outputs['Object'], wv.inputs['Vector'])
        wr = ramp(wv.outputs['Fac'], 0.0, W, 0.06, K)
        col = mix(col, None, wr.outputs['Color'], bcol=stripes)
    # potato eyes and the dirt around them
    pits = N.new('ShaderNodeVertexColor'); pits.layer_name = 'Pits'
    pm = N.new('ShaderNodeMath'); pm.operation = 'MULTIPLY'; pm.inputs[1].default_value = 0.85
    L.new(pits.outputs['Color'], pm.inputs[0])
    col = mix(col, None, pm.outputs['Value'], bcol='#2a1406')
    # cheeks
    bl = N.new('ShaderNodeVertexColor'); bl.layer_name = 'Blush'
    col = mix(col, None, bl.outputs['Color'], bcol=blush)
    L.new(col, b.inputs['Base Color'])
    # roughness: shinier on the bumps, matte in the netting
    rr = ramp(noise_tex(6, 3).outputs['Fac'], 0.3, (rough - 0.12,) * 3 + (1,), 0.8, (rough + 0.1,) * 3 + (1,))
    L.new(rr.outputs['Color'], b.inputs['Roughness'])
    # bump: netting cracks + fine grain + soft unevenness
    h = N.new('ShaderNodeMath'); h.operation = 'ADD'
    fine = noise_tex(60, 4, 0.6)
    L.new(fine.outputs['Fac'], h.inputs[0])
    hn = N.new('ShaderNodeMath'); hn.operation = 'MULTIPLY'; hn.inputs[1].default_value = -0.6
    L.new(nm.outputs['Value'], hn.inputs[0]); L.new(hn.outputs['Value'], h.inputs[1])
    bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.35; bump.inputs['Distance'].default_value = 0.01
    L.new(h.outputs['Value'], bump.inputs['Height'])
    mid = noise_tex(9, 6, 0.6)
    bump2 = N.new('ShaderNodeBump'); bump2.inputs['Strength'].default_value = 0.25; bump2.inputs['Distance'].default_value = 0.03
    L.new(mid.outputs['Fac'], bump2.inputs['Height']); L.new(bump2.outputs['Normal'], bump.inputs['Normal'])
    L.new(bump.outputs['Normal'], b.inputs['Normal'])
    return m


def socket(body, centers, radius=0.13, depth=0.035):
    """Press soft sockets into the body where the eyes go, so they sit in the face instead of on it."""
    me = body.data
    for v in me.vertices:
        for c in centers:
            d = (v.co - Vector(c)).length
            if d < radius * 2:
                n = v.normal
                v.co -= n * depth * math.exp(-(d / radius) ** 2 * 2)
    me.update()


def hug(o, body, offset=0.01, band=None):
    """Shrinkwrap a hat shell so it never cuts into the head; verts below `band` (local z) are pulled onto the head."""
    mods = []
    if band is not None:
        vg = o.vertex_groups.new(name='band')
        vg.add([v.index for v in o.data.vertices if v.co.z < band], 1.0, 'REPLACE')
        s = o.modifiers.new('HugBand', 'SHRINKWRAP'); s.target = body; s.wrap_method = 'NEAREST_SURFACEPOINT'
        s.wrap_mode = 'ON_SURFACE'; s.offset = offset; s.vertex_group = 'band'; mods.append(s)
    s = o.modifiers.new('Hug', 'SHRINKWRAP'); s.target = body; s.wrap_method = 'NEAREST_SURFACEPOINT'
    s.wrap_mode = 'OUTSIDE'; s.offset = offset; mods.append(s)
    for i, m in enumerate(mods):
        o.modifiers.move(o.modifiers.find(m.name), i)
    return o


# ---------------- eye styles ----------------

def eyes(root, body, style, ex, ez, er, skin=None, mouth_w=0.15, mouth_open=True):
    """style: 'bead' (mockup-like glossy black), 'pixar' (white, iris, lids), 'happy' (closed smiling arcs)."""
    M = {
        'bead': principled('Bead', '#0d0605', rough=0.3, coat=0.25),
        'glint': principled('Glint', '#ffffff', rough=0.3, emit=1.2),
        'sclera': principled('Sclera', '#f7f2ea', rough=0.12, coat=1.0, sss=0.1),
        'iris': principled('Iris', '#5a3416', rough=0.2, coat=1.0),
        'pupil': principled('Pupil', '#070302', rough=0.1, coat=1.0),
        'lash': principled('Lash', '#1a0c06', rough=0.6),
    }
    for side, s in (('L', 1), ('R', -1)):
        x = s * ex
        y, n = surface_y(body, x, ez)
        eye = bpy.data.objects.new('Eye_' + side, None); link(eye, root)
        yaw = math.atan2(n.x, -n.y) * 0.85
        pitch = math.atan2(n.z, -n.y) * 0.5
        eye.rotation_euler = (-pitch, 0, yaw)
        if style == 'bead':
            eye.location = (x, y + er * 0.3, ez)
            uv_sphere('Pupil_' + side, er, 32, 16, M['bead'], eye, scale=(0.8, 0.6, 1.08))
            uv_sphere('Glint_' + side, er * 0.24, 16, 8, M['glint'], eye, loc=(er * 0.26 * s * 0 + er * 0.22, -er * 0.5, er * 0.42), scale=(1, 0.4, 1.1))
            uv_sphere('Glint2_' + side, er * 0.12, 12, 6, M['glint'], eye, loc=(-er * 0.25, -er * 0.55, -er * 0.42), scale=(1, 0.4, 1))
            # skin lid fold over the top of the eye, and a thin lash line where it meets the eye
            if skin:
                lid = torus('Lid_' + side, er * 0.95, er * 0.16, skin, eye, loc=(0, -er * 0.05, er * 0.42), rot=(math.pi / 2 - 0.35, 0, 0), scale=(0.95, 1.2, 1), arc=math.pi, seg=32, ring=10)
            pass  # no lash line: it read as a stray speck
            if False: torus('Lash_' + side, er * 0.86, er * 0.055, M['lash'], eye, loc=(0, -er * 0.36, er * 0.3), rot=(math.pi / 2 - 0.35, 0, math.pi * 0.12), scale=(0.95, 1.15, 1), arc=math.pi * 0.76, seg=24, ring=8)
        elif style == 'pixar':
            r = er * 1.45
            eye.location = (x, y + r * 0.3, ez)
            uv_sphere('Sclera_' + side, r, 32, 16, M['sclera'], eye, scale=(0.9, 0.55, 1.12))
            uv_sphere('Iris_' + side, r * 0.5, 32, 16, M['iris'], eye, loc=(-s * r * 0.08, -r * 0.4, -r * 0.06), scale=(1, 0.36, 1.08))
            uv_sphere('Pupil_' + side, r * 0.27, 24, 12, M['pupil'], eye, loc=(-s * r * 0.08, -r * 0.52, -r * 0.06), scale=(1, 0.25, 1.08))
            uv_sphere('Glint_' + side, r * 0.13, 16, 8, M['glint'], eye, loc=(-s * r * 0.08 + r * 0.14, -r * 0.6, r * 0.14), scale=(1, 0.4, 1))
            uv_sphere('Glint2_' + side, r * 0.06, 12, 6, M['glint'], eye, loc=(-s * r * 0.08 - r * 0.12, -r * 0.6, -r * 0.2), scale=(1, 0.4, 1))
            if skin:
                bm = bmesh.new()
                bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=r * 1.06, calc_uvs=True)
                bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-4], context='VERTS')
                lid = mesh_obj('Lid_' + side, bm, skin, eye)
                lid.scale = (0.94, 0.6, 1.16); lid.rotation_euler = (-1.0, 0, 0)
                solid(lid, 0.012, 0, 1)
            torus('Lash_' + side, r * 0.92, r * 0.05, M['lash'], eye, loc=(0, -r * 0.2, r * 0.32), rot=(math.pi / 2 - 0.62, 0, 0), scale=(0.95, 1.0, 1), arc=math.pi * 0.8, seg=24, ring=8).rotation_euler.z = math.pi * 0.1
        elif style == 'happy':
            eye.location = (x, y + 0.01, ez)
            torus('Pupil_' + side, er * 0.8, er * 0.2, M['bead'], eye, rot=(math.pi / 2, 0, 0), arc=math.pi, seg=24, ring=10)
    # mouth (as before); mouth_w=0 skips it so pixar.py can sculpt its own
    if not mouth_w: return
    mz = ez - er * 2.4
    ym, nm = surface_y(body, 0, mz)
    mouth = bpy.data.objects.new('Smile', None); link(mouth, root)
    mouth.location = (0, ym + 0.015, mz)
    mouth.rotation_euler = (math.atan2(-nm.z, -nm.y) * 0.6 if nm else 0, 0, 0)
    bm = bmesh.new(); seg = 24
    hgt = mouth_w * (0.62 if mouth_open else 0.2)
    pts = [(math.cos(math.pi + math.pi * i / seg) * mouth_w, 0, math.sin(math.pi + math.pi * i / seg) * hgt + 0.035 * (math.cos(math.pi * i / seg) ** 2) * mouth_w / 0.12) for i in range(seg + 1)]
    pts += [(mouth_w * (1 - 2 * i / seg), 0, 0.035 * ((1 - 2 * i / seg) ** 2) * mouth_w / 0.12 * 0.8) for i in range(1, seg)]
    bm.faces.new([bm.verts.new(p) for p in pts])
    inside = mesh_obj('Mouth', bm, principled('MouthInside', '#3a0f0c', rough=0.5), mouth)
    so = inside.modifiers.new('Solidify', 'SOLIDIFY'); so.thickness = 0.03; so.offset = 0
    bv = inside.modifiers.new('Bevel', 'BEVEL'); bv.width = 0.01; bv.segments = 3
    if mouth_open:
        uv_sphere('Tongue', mouth_w * 0.42, 20, 10, principled('Tongue', '#e0605a', rough=0.45), mouth, loc=(0, -0.004, -hgt * 0.62), scale=(1.25, 0.3, 0.55))
    paint_blush(body, [(s * ex * 1.75, ym, mz + 0.03) for s in (1, -1)], radius=0.17, strength=0.6)
