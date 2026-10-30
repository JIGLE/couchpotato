# The seven other potato kinds, in the mockup style set by build_boiled2.py.
# Run after potato_lib.py. build_kind(name) builds one into its own scene and returns its root.
import bpy, bmesh, math
from mathutils import Vector, Matrix, Euler


def _blob_into(bm, mat4, seg=16, rings=8):
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0, matrix=mat4, calc_uvs=True)


def _T(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    return Matrix.Translation(loc) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*scale, 1))


def eye_anchor(body, ex, ez, s):
    y, n = surface_y(body, s * ex, ez)
    yaw = math.atan2(n.x, -n.y) * 0.8
    return y, yaw


# ---------------- accessories ----------------

def acc_aviators(root, body, c):
    frame = principled('Aviator_frame', '#c9a24a', rough=0.25, metal=1.0)
    glass = principled('Aviator_glass', '#0c1612', rough=0.04, coat=1.0)
    g = bpy.data.objects.new('Glasses', None); link(g, root)
    ys = []
    for side, s in (('L', 1), ('R', -1)):
        y, yaw = eye_anchor(body, c['ex'], c['ez'], s)
        ys.append(y)
        e = bpy.data.objects.new('Lens_' + side, None); link(e, g)
        e.location = (s * c['ex'] * 1.05, y - 0.045, c['ez'] - 0.01); e.rotation_euler = (0, 0, yaw)
        # aviator teardrop: wider at the top outer corner
        uv_sphere('Glass_' + side, 0.13, 32, 16, glass, e, loc=(s * 0.01, 0, -0.01), scale=(1.12, 0.22, 0.88), rot=(0, s * 0.12, 0))
        torus('Frame_' + side, 0.135, 0.012, frame, e, rot=(math.pi / 2, s * 0.12, 0), scale=(1.12, 0.88, 1))
        # temple arm running back along the side of the head
        hw = half_width(body, c['ez'])
        a0 = Vector((s * (c['ex'] * 1.05 + 0.15), y - 0.02, c['ez'] + 0.05)); a1 = Vector((s * (hw + 0.012), 0.05, c['ez'] + 0.04))
        bmx = bmesh.new(); v0 = bmx.verts.new(a0); v1 = bmx.verts.new((a0 + a1) / 2 + Vector((s * 0.02, 0, 0))); v2 = bmx.verts.new(a1)
        bmx.edges.new((v0, v1)); bmx.edges.new((v1, v2))
        arm = mesh_obj('Temple_' + side, bmx, frame, g); arm.modifiers.new('Skin', 'SKIN')
        for v in arm.data.skin_vertices[0].data: v.radius = (0.01, 0.01)
        arm.modifiers.new('Subdivision', 'SUBSURF').levels = 1
    bridge = cylinder('Bridge', 0.011, c['ex'] * 2 * 0.62, frame, g, loc=(0, min(ys) - 0.07, c['ez'] + 0.06), rot=(0, math.pi / 2, 0), sub=0)


def acc_headphones(root, body, c):
    band_m = principled('Phones_band', '#2a2050', rough=0.45)
    cup_m = principled('Phones_cup', '#6b45c8', rough=0.35, coat=0.5)
    pad_m = principled('Phones_pad', '#1c1630', rough=0.8)
    g = bpy.data.objects.new('Headphones', None); link(g, root)
    ze = c['ez'] + 0.05
    hw = half_width(body, ze)
    R = hw + 0.075
    torus('Phones_Band', R, 0.035, band_m, g, loc=(0, 0.02, ze), rot=(math.pi / 2, 0, 0), scale=(1, 1, 0.95), arc=math.pi, seg=48, ring=12)
    for side, s in (('L', 1), ('R', -1)):
        cylinder('Phones_Cup_' + side, 0.18, 0.11, cup_m, g, loc=(s * (hw + 0.07), 0.02, ze), rot=(0, math.pi / 2, 0), bevel=0.03)
        torus('Phones_Pad_' + side, 0.14, 0.045, pad_m, g, loc=(s * (hw + 0.01), 0.02, ze), rot=(0, math.pi / 2, 0))
        uv_sphere('Phones_Logo_' + side, 0.06, 20, 10, band_m, g, loc=(s * (hw + 0.13), 0.02, ze), scale=(0.25, 1.2, 1.2))


def acc_sweatband(root, body, c):
    m = principled('Sweatband', '#11b8c8', rough=0.85)
    zb = c['top'] - 0.32
    hw = half_width(body, zb)
    sy, _ = surface_y(body, 0, zb)
    torus('Sweatband', hw + 0.01, 0.065, m, root, loc=(0, 0, zb), scale=(1, abs(sy) / hw + 0.05, 1.25), seg=48, ring=16)
    white = principled('Sweatband_logo', '#ffffff', rough=0.6)
    uv_sphere('Sweatband_Logo', 0.05, 16, 8, white, root, loc=(0, sy - 0.07, zb), scale=(1, 0.3, 0.6))


def acc_toque(root, body, c):
    m = principled('Toque', '#fafaf6', rough=0.85, sss=0.05)
    g = bpy.data.objects.new('Hat', None); link(g, root)
    zb = c['top'] - 0.16
    hw = half_width(body, zb); sy, _ = surface_y(body, 0, zb)
    k = abs(sy) / hw
    g.location = (0, 0, zb); g.rotation_euler = (math.radians(-6), math.radians(6), 0)
    cylinder('Toque_Band', hw + 0.03, 0.22, m, g, loc=(0, 0, 0.08), scale=(1, k, 1), bevel=0.03)
    bm = bmesh.new()
    for i in range(6):
        a = i / 6 * 2 * math.pi
        _blob_into(bm, _T((math.cos(a) * hw * 0.55, math.sin(a) * hw * 0.55 * k, 0.36), scale=(hw * 0.55, hw * 0.55 * k, 0.24)), 24, 12)
    _blob_into(bm, _T((0, 0, 0.48), scale=(hw * 0.6, hw * 0.6 * k, 0.26)), 24, 12)
    puff = mesh_obj('Toque_Puff', bm, m, g)
    rm = puff.modifiers.new('Remesh', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = 0.02
    puff.modifiers.new('Smooth', 'SMOOTH').iterations = 6
    # a pat of butter melting on the front of the scoop, like the in-game mashed potato
    bt = principled('Butter', '#ffd84a', rough=0.25, coat=1.0)


def acc_fedora(root, body, c):
    felt = principled('Fedora', '#8a5a2b', rough=0.75)
    ribbon = principled('Fedora_band', '#3a2214', rough=0.6)
    stache = principled('Mustache', '#3a1e0e', rough=0.7)
    g = bpy.data.objects.new('Hat', None); link(g, root)
    zb = c['top'] - 0.3
    hw = half_width(body, zb) + 0.04; sy, _ = surface_y(body, 0, zb); k = abs(sy) / (hw - 0.04)
    g.location = (0, 0.02, zb); g.rotation_euler = (math.radians(-6), math.radians(-9), math.radians(6))
    crown = cylinder('Fedora_Crown', hw + 0.04, 0.44, felt, g, loc=(0, 0, 0.22), scale=(1, k, 1), r2=(hw + 0.04) * 0.82, bevel=0.06, sub=2)
    # pinch the crown: a front-to-back crease and two front dents
    me = crown.data
    for v in me.vertices:
        if v.co.z > 0.1:
            v.co.z -= 0.07 * max(0, 1 - abs(v.co.x) / ((hw + 0.04) * 0.4))
            if v.co.y < 0: v.co.x *= 0.92
    brim = cylinder('Fedora_Brim', hw + 0.3, 0.035, felt, g, loc=(0, 0, 0.01), scale=(1, k * 1.05 + 0.08, 1), bevel=0.015, sub=2)
    for v in brim.data.vertices:  # curl the back and sides up a little
        r = math.hypot(v.co.x, v.co.y)
        if r > hw: v.co.z += (r - hw) * (0.25 + 0.35 * max(0, v.co.y) / (hw + 0.3))
    cylinder('Fedora_Band', hw + 0.045, 0.08, ribbon, g, loc=(0, 0, 0.06), scale=(1, k + 0.01, 1), r2=(hw + 0.045) * 0.97, sub=1)
    # handlebar mustache under the nose line
    zm = c['ez'] - c['er'] * 1.85
    ym, _ = surface_y(body, 0, zm)
    bm = bmesh.new()
    for s in (1, -1):
        _blob_into(bm, _T((s * 0.075, 0, 0), (0, s * 0.35, 0), (0.09, 0.045, 0.045)), 20, 10)
        _blob_into(bm, _T((s * 0.16, 0.0, 0.025), (0, s * -0.5, 0), (0.05, 0.03, 0.028)), 16, 8)
    m = mesh_obj('Mustache', bm, stache, root)
    m.location = (0, ym - 0.025, zm)
    rm = m.modifiers.new('Remesh', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = 0.008
    m.modifiers.new('Smooth', 'SMOOTH').iterations = 4


def acc_beanie(root, body, c):
    knit = principled('Beanie', '#2f6b45', rough=0.9)
    knit2 = principled('Beanie_rib', '#265a39', rough=0.9)
    g = bpy.data.objects.new('Hat', None); link(g, root)
    zb = c['top'] - 0.34
    hw = half_width(body, zb) + 0.08; sy, _ = surface_y(body, 0, zb); k = (abs(sy) + 0.08) / hw
    g.location = (0, 0.0, zb); g.rotation_euler = (math.radians(-4), math.radians(6), 0)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=1.0, calc_uvs=True)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.02], context='VERTS')
    dome = mesh_obj('Beanie_Dome', bm, knit, g)
    dome.scale = (hw + 0.06, (hw + 0.06) * k + 0.04, 0.62)
    solid(dome, 0.04, 1, 1)
    # folded rib band with vertical ridges
    bm = bmesh.new()
    seg = 64
    rows = []
    for zi, z in enumerate((-0.02, 0.06, 0.14, 0.16)):
        row = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            rr = (1.0 if i % 2 == 0 else 0.965) * (1 if zi in (1, 2) else 0.97)
            row.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, z)))
        rows.append(row)
    for r0, r1 in zip(rows, rows[1:]):
        for i in range(seg):
            bm.faces.new((r0[i], r0[(i + 1) % seg], r1[(i + 1) % seg], r1[i]))
    band = mesh_obj('Beanie_Band', bm, knit2, g)
    band.scale = (hw + 0.09, (hw + 0.09) * k + 0.04, 1)
    solid(band, 0.035, 1, 1)
    uv_sphere('Beanie_Knob', 0.07, 20, 10, knit2, g, loc=(0, 0, 0.66), scale=(1, 1, 0.8))


def acc_daisies(root, body, c):
    vine = principled('Vine', '#2d5a1b', rough=0.6)
    petal = principled('Petal', '#fafafa', rough=0.5, sss=0.05)
    center = principled('Daisy_center', '#f0c020', rough=0.5, emit=0.2)
    g = bpy.data.objects.new('Hat', None); link(g, root)
    zc = c['top'] - 0.46
    hw = half_width(body, zc); sy, _ = surface_y(body, 0, zc); k = abs(sy) / hw
    g.location = (0, 0, zc); g.rotation_euler = (math.radians(-12), 0, 0)
    R = hw + 0.02
    torus('Crown_Vine', R, 0.035, vine, g, scale=(1, k, 1), seg=64, ring=10)
    pb, cb, lb = bmesh.new(), bmesh.new(), bmesh.new()
    for d in range(5):
        a = -math.pi / 2 + d * 2 * math.pi / 5
        pos = Vector((math.cos(a) * R, math.sin(a) * R * k, 0.03))
        out = Vector((math.cos(a), math.sin(a) * k, 0.55)).normalized()
        q = out.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        base = Matrix.Translation(pos) @ q
        for p in range(8):
            ang = p * math.pi / 4
            _blob_into(pb, base @ _T((math.cos(ang) * 0.085, math.sin(ang) * 0.085, 0), (0, 0, ang + math.pi / 2), (0.03, 0.075, 0.014)), 12, 6)
        _blob_into(cb, base @ _T((0, 0, 0.008), scale=(0.04, 0.04, 0.022)), 16, 8)
        # a leaf between flowers
        a2 = a + math.pi / 5
        lpos = Vector((math.cos(a2) * R, math.sin(a2) * R * k, 0.02))
        _blob_into(lb, Matrix.Translation(lpos) @ Euler((0.4, 0, a2)).to_matrix().to_4x4() @ Matrix.Diagonal((0.025, 0.06, 0.008, 1)), 12, 6)
    mesh_obj('Crown_Petals', pb, petal, g)
    mesh_obj('Crown_Centers', cb, center, g)
    mesh_obj('Crown_Leaves', lb, vine, g)


# ---------------- kinds ----------------

def _egg(k=0.16, lump=0.06):
    def f(x, y, z, fx, fy, fz):
        kk = 1 + k * (-z)
        l = 1 + lump * math.exp(-((x - 0.5) ** 2 + (z - 0.4) ** 2) * 6)
        return fx * kk * l, fy * kk * l, fz
    return f


def _flat_top(x, y, z, fx, fy, fz):
    kk = 1 + 0.1 * (-z)
    if z > 0.55: fz *= 1 - (z - 0.55) * 0.5
    return fx * kk, fy * kk, fz


def _scoop(x, y, z, fx, fy, fz):
    q = max(0, (z - 0.3) / 0.7)
    sw = 1 + 0.06 * math.sin(math.atan2(y, x) * 3 + z * 9) * min(1, (z + 0.4) * 1.5)
    kk = 1 + 0.12 * (-z)
    return fx * sw * kk, fy * sw * kk, fz * (1 - q * q * 0.1)


def _spindle(x, y, z, fx, fy, fz):
    t = 1 - 0.42 * z * z
    return fx * t, fy * t, fz


def _wave(x, y, z, fx, fy, fz):
    cr = 1 + 0.06 * math.sin(math.atan2(z, x) * 12) * (1 - abs(y))
    return fx * cr, fy, fz * cr


KINDS = {
    'grilled': dict(size=(0.64, 0.6, 0.76), color='#7a3f1c', dark='#2a1006', stripes='#2a1208', deform=_flat_top, bump=0.06, eh=1.05, acc=acc_aviators),
    'chip': dict(size=(0.8, 0.24, 0.78), color='#d49a3a', dark='#8a5a18', deform=_wave, bump=0.03, eh=1.1, acc=acc_headphones, er=0.085),
    'fry': dict(size=(0.33, 0.31, 1.05), color='#e8b52a', dark='#b07a18', base='box', box=0.5, bump=0.02, eh=1.3, acc=acc_sweatband, er=0.075, ex=0.13, mw=0.11),
    'mashed': dict(size=(0.66, 0.62, 0.72), color='#efe2bf', dark='#c8ad7a', deform=_scoop, bump=0.03, eh=1.0, acc=acc_toque),
    'jacket': dict(size=(0.6, 0.56, 0.86), color='#6e3a1a', dark='#2e1408', deform=_egg(), bump=0.07, eh=1.08, acc=acc_fedora, mouth_open=False),
    'hashbrown': dict(size=(0.74, 0.34, 0.62), color='#b8742a', dark='#5a3008', mottle='#7e4a14', base='box', box=0.42, bump=0.05, eh=1.05, acc=acc_beanie),
    'sweet': dict(size=(0.52, 0.5, 0.95), color='#a8402e', dark='#4a1418', mottle='#7a2c4c', deform=_spindle, bump=0.05, eh=1.1, acc=acc_daisies, er=0.08),
}


def build_kind(name):
    K = KINDS[name]
    sc = new_scene('potato-' + name)
    root = link(bpy.data.objects.new('potato-' + name, None))
    SX, SY, SZ = K['size']
    skin = russet_material('Skin_' + name, K['color'], dark=K['dark'], stripes=K.get('stripes'), mottle=K.get('mottle'))
    body = potato_body('Body', (SX, SY, SZ), None, skin, root, bump=K['bump'], seed=hash(name) % 7 + 0.5,
                       deform=K.get('deform'), base=K.get('base', 'sphere'), box=K.get('box'))
    bpy.context.view_layer.update()
    er = K.get('er', 0.088)
    ez = SZ * K['eh']
    ex = K.get('ex', min(0.18, half_width(body, ez) * 0.33))
    bead_face(root, body, eye_x=ex, eye_z=ez, eye_r=er, mouth_w=K.get('mw', 0.15), mouth_open=K.get('mouth_open', True))
    hw = half_width(body, SZ * 0.75)
    limbs(root, body, hw, abs(surface_y(body, 0, SZ * 0.4)[0]), skin, arm_z=SZ * 0.75)
    c = dict(ex=ex, ez=ez, er=er, top=top_z(body), SX=SX, SY=SY, SZ=SZ)
    K['acc'](root, body, c)
    root.rotation_euler = (math.radians(-12), 0, 0)
    studio(sc, target_z=c['top'] * 0.55, dist=5.0 + max(0, c['top'] - 1.6) * 1.5)
    bpy.data.materials['StudioFloor'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = hex_rgba('#1f4a2c')
    sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = hex_rgba('#3a1e10')
    return root
