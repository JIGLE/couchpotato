# Third pass, toward a Pixar look: a mouth sculpted into the face, chunky feet and mitten hands,
# happy-eye arcs as an alternate expression, and a properly made baseball cap.
# Run after potato_lib.py, kinds.py, realism.py.
import bpy, bmesh, math
from mathutils import Vector, Matrix, Euler


def ray_hit(obj, origin, direction):
    """World-space hit on an object's evaluated mesh (modifiers included)."""
    dg = bpy.context.evaluated_depsgraph_get(); ev = obj.evaluated_get(dg)
    mw = obj.matrix_world; inv = mw.inverted()
    ok, loc, nor, _ = ev.ray_cast(inv @ Vector(origin), (inv.to_3x3() @ Vector(direction)).normalized())
    if not ok: return None, None
    return mw @ loc, (mw.inverted().transposed().to_3x3() @ nor).normalized()


def _smile_outline(w, h, seg=28):
    """Crescent smile in the XZ plane: deep lower lip arc, upper edge curling up at the corners."""
    lower = [(math.cos(math.pi + math.pi * i / seg) * w, math.sin(math.pi + math.pi * i / seg) * h + 0.3 * h * math.cos(math.pi * i / seg) ** 4) for i in range(seg + 1)]
    upper = [(w * (1 - 2 * i / seg), 0.3 * h * (1 - 2 * i / seg) ** 4 + 0.08 * h * (1 - (1 - 2 * i / seg) ** 2)) for i in range(1, seg)]
    return lower + upper


def pixar_mouth(root, body, mz, w=0.17, h=0.12, skin_hex='#a05a2a', blush_x=0.3):
    """Cuts a real mouth cavity into the body, with teeth, tongue, soft lips and pushed-up cheeks."""
    ym, nm = surface_y(body, 0, mz)
    pitch = math.atan2(-nm.z, -nm.y) * 0.7
    # cheeks pushed up and out by the smile
    me = body.data
    for v in me.vertices:
        for s in (1, -1):
            c = Vector((s * w * 1.05, ym, mz + 0.05))
            d = (v.co - c).length
            if d < 0.3: v.co += v.normal * 0.03 * math.exp(-(d / 0.11) ** 2)
    me.update(); bpy.context.view_layer.update()
    ym, nm = surface_y(body, 0, mz)
    # the cutter: the smile outline pushed straight into the head
    outline = _smile_outline(w, h)
    bm = bmesh.new()
    front = [bm.verts.new((x, -0.12, z)) for x, z in outline]
    back = [bm.verts.new((x * 0.85, 0.16, z * 0.8 - 0.01)) for x, z in outline]
    bm.faces.new(front); bm.faces.new(list(reversed(back)))
    n = len(outline)
    for i in range(n):
        bm.faces.new((front[i], back[i], back[(i + 1) % n], front[(i + 1) % n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    cav = principled('MouthInside', '#4a1210', rough=0.45)
    cutter = mesh_obj('MouthCutter', bm, cav, None, smooth=False)
    cutter.location = (0, ym, mz); cutter.rotation_euler = (pitch, 0, 0)
    cutter.parent = root  # follows the body; removed after the boolean is applied at export
    cutter.hide_render = True; cutter.display_type = 'WIRE'
    bo = body.modifiers.new('Mouth', 'BOOLEAN'); bo.operation = 'DIFFERENCE'; bo.object = cutter; bo.solver = 'EXACT'
    try: bo.material_mode = 'TRANSFER'
    except Exception: pass
    mouth = bpy.data.objects.new('Smile', None); link(mouth, root)
    mouth.location = (0, ym, mz); mouth.rotation_euler = (pitch, 0, 0)
    # upper teeth: a soft white strip tucked just under the upper lip
    teeth = principled('Teeth', '#f3eee2', rough=0.45)
    up = [(x, z) for x, z in outline[len(outline) // 2 + 1:]]
    bm = bmesh.new(); prev = None
    for x, z in up[::2]:
        if abs(x) > w * 0.78: continue
        v = bm.verts.new((x, 0.035, z - 0.028))
        if prev: bm.edges.new((prev, v))
        prev = v
    t = mesh_obj('Teeth', bm, teeth, mouth); t.modifiers.new('Skin', 'SKIN')
    for sv in t.data.skin_vertices[0].data: sv.radius = (0.032, 0.022)
    t.modifiers.new('Subdivision', 'SUBSURF').levels = 2
    # tongue
    tong = principled('Tongue', '#d8605a', rough=0.62, sss=0.25)
    uv_sphere('Tongue', 1, 32, 16, tong, mouth, loc=(0, 0.07, -h * 0.62), scale=(w * 0.55, 0.09, h * 0.42))
    # lips: a soft rounded rim along the outline, pressed onto the face
    lipm = principled('Lips', '#8a4026', rough=0.5, sss=0.1)
    bm = bmesh.new()
    vs = [bm.verts.new((x, -0.002, z)) for x, z in outline]
    for i in range(n): bm.edges.new((vs[i], vs[(i + 1) % n]))
    lips = mesh_obj('Lips', bm, lipm, mouth)
    s_ = lips.modifiers.new('Hug', 'SHRINKWRAP'); s_.target = body; s_.wrap_method = 'NEAREST_SURFACEPOINT'; s_.wrap_mode = 'ON_SURFACE'
    lips.modifiers.new('Skin', 'SKIN')
    for i, sv in enumerate(lips.data.skin_vertices[0].data):
        x, z = outline[i]
        r = 0.016 * (0.6 + 0.4 * (1 - abs(x) / w))
        sv.radius = (r, r)
    lips.modifiers.new('Subdivision', 'SUBSURF').levels = 1
    paint_blush(body, [(s * blush_x, ym, mz + 0.06) for s in (1, -1)], radius=0.17, strength=0.6)
    return mouth


def happy_eyes(root, ex, er):
    """Closed, smiling arcs inside each Eye_ group; hidden by default, swapped in by the game."""
    m = principled('Bead', '#0d0605', rough=0.3, coat=0.25)
    for side, s in (('L', 1), ('R', -1)):
        eye = bpy.data.objects.get('Eye_' + side)
        a = torus('Happy_' + side, er * 0.8, er * 0.2, m, eye, loc=(0, -er * 0.25, -er * 0.15), rot=(math.pi / 2, 0, 0), arc=math.pi, seg=24, ring=10)
        a.hide_render = True; a.hide_set(True)


def _bean(bm, mat4):
    """A chubby cartoon foot: heel + ball of the foot + a little toe bump, flat sole."""
    for loc, sc in (((0, 0.02, 0), (0.09, 0.11, 0.072)), ((0, -0.06, 0.006), (0.1, 0.11, 0.074))):
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1.0, matrix=mat4 @ Matrix.Translation(loc) @ Matrix.Diagonal((*sc, 1)))


def _swell(body, point, normal_hint, radius=0.11, amount=0.03):
    """Push the body out a little around a point, so a limb grows out of a soft mound instead of a crease."""
    me = body.data
    for v in me.vertices:
        d = (v.co - point).length
        if d < radius * 2.5: v.co += v.normal * amount * math.exp(-(d / radius) ** 2)
    me.update()


def _tube(name, pts, radii, mat, parent):
    bm = bmesh.new(); vs = [bm.verts.new(p) for p in pts]
    for i in range(len(vs) - 1): bm.edges.new((vs[i], vs[i + 1]))
    o = mesh_obj(name, bm, mat, parent); o.modifiers.new('Skin', 'SKIN')
    for sv, r in zip(o.data.skin_vertices[0].data, radii): sv.radius = (r, r)
    o.modifiers.new('Subdivision', 'SUBSURF').levels = 2
    return o


def pixar_limbs(root, body, half_w, half_d, skin, foot_color=None, arm_z=0.62):
    """Stubby arms and legs in skin colour, rooted inside the body so they grow out of it."""
    for side, s in (('L', 1), ('R', -1)):
        # arm stub: starts inside the side of the body, hangs down and a little forward
        ax = half_width(body, arm_z)
        y0, _ = surface_y(body, s * ax * 0.6, arm_z)
        start = Vector((s * ax * 0.7, -half_d * 0.15, arm_z + 0.02))
        mid = Vector((s * (ax + 0.07), -half_d * 0.3, arm_z - 0.1))
        tip = Vector((s * (ax + 0.1), -half_d * 0.45, arm_z - 0.24))
        pts = [start.lerp(mid, t / 3) for t in range(3)] + [mid.lerp(tip, t / 3) for t in range(4)]
        _tube('Arm_' + side, pts, [0.075, 0.072, 0.068, 0.064, 0.06, 0.057, 0.055], skin, root)
        # leg stub: from inside the lower belly, poking forward over the seat edge
        lx = half_w * 0.36
        y_exit, _ = surface_y(body, s * lx, 0.2)
        _swell(body, Vector((s * lx, y_exit, 0.2)), None, radius=0.1, amount=0.025)
        a0 = Vector((s * lx * 0.9, y_exit + 0.12, 0.24)); a1 = Vector((s * lx, y_exit - 0.02, 0.19)); a2 = Vector((s * lx * 1.12, y_exit - 0.3, 0.1))
        pts = [a0.lerp(a1, t / 3) for t in range(3)] + [a1.lerp(a2, t / 3) for t in range(4)]
        _tube('Leg_' + side, pts, [0.1, 0.098, 0.094, 0.088, 0.082, 0.078, 0.076], skin, root)
    bpy.context.view_layer.update()


def pixar_cap(root, body, zb, navy_hex='#1d2f6b', front_hex='#f2f0ea', badge_hex='#3f6fd8'):
    navy = principled('Cap_navy', navy_hex, rough=0.75)
    white = principled('Cap_white', front_hex, rough=0.78)
    badge = principled('Cap_badge', badge_hex, rough=0.45)
    stitch = principled('Cap_stitch', '#121c45', rough=0.85)
    under = principled('Cap_under', '#16224e', rough=0.8)
    hat = bpy.data.objects.new('Hat', None); link(hat, root)
    hw = half_width(body, zb); hy, _ = surface_y(body, 0, zb); k = abs(hy) / hw
    hat.location = (0, 0.0, zb); hat.rotation_euler = (math.radians(-9), math.radians(5), math.radians(-6))
    CR = (hw * 0.98, hw * k * 0.98, 0.56)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=72, v_segments=36, radius=1.0, calc_uvs=True)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.12], context='VERTS')
    for f in bm.faces:
        c = f.calc_center_median()
        f.material_index = 1 if (c.y < 0 and abs(math.atan2(c.x, -c.y)) < 0.72 and c.z < 0.96) else 0
    # slightly puffy panels: push faces between the seams outward
    for v in bm.verts:
        a = math.atan2(v.co.y, v.co.x) - math.pi / 6
        puff = 0.035 * abs(math.sin(a * 3)) * max(0, 1 - v.co.z) * max(0, v.co.z + 0.1)
        v.co *= 1 + puff
    crown = mesh_obj('Cap_Crown', bm, navy, hat); crown.data.materials.append(white)
    crown.scale = CR
    hug(crown, body, offset=0.012, band=0.18)
    sm = crown.modifiers.new('Smooth', 'SMOOTH'); sm.iterations = 8; sm.factor = 0.6
    crown.modifiers.move(crown.modifiers.find('Smooth'), 2)
    solid(crown, 0.045, 1, 1)
    bpy.context.view_layer.update()
    # seams + top button, stitched onto the crown's real outer surface
    bm = bmesh.new()
    for i in range(6):
        a = i / 6 * 2 * math.pi + math.pi / 6
        prev = None
        for kk in range(25):
            t = kk / 24 * (math.pi / 2 - 0.08)
            v = bm.verts.new((math.cos(t) * math.cos(a) * 1.2, math.cos(t) * math.sin(a) * 1.2, math.sin(t) * 1.2 - 0.05))
            if prev: bm.edges.new((prev, v))
            prev = v
    seams = mesh_obj('Cap_Seams', bm, stitch, hat); seams.scale = CR
    sw = seams.modifiers.new('OnCrown', 'SHRINKWRAP'); sw.target = crown; sw.wrap_method = 'NEAREST_SURFACEPOINT'; sw.wrap_mode = 'ON_SURFACE'; sw.offset = 0.002
    seams.modifiers.new('Skin', 'SKIN')
    for sv in seams.data.skin_vertices[0].data: sv.radius = (0.008, 0.008)
    centre = hat.matrix_world @ Vector((0, 0, 0.15))
    top, tn = ray_hit(crown, centre + hat.matrix_world.to_3x3() @ Vector((0, 0, 2)), hat.matrix_world.to_3x3() @ Vector((0, 0, -1)))
    btn = uv_sphere('Cap_Button', 0.05, 24, 12, navy, root, scale=(1, 1, 0.5))
    if top:
        btn.matrix_world = Matrix.Translation(top) @ tn.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        btn.parent = hat; btn.matrix_parent_inverse = hat.matrix_world.inverted()
    # eyelets on four side panels
    ring = principled('Cap_eyelet', '#0e1638', rough=0.4)
    for i in (1, 2, 4, 5):
        a = i / 6 * 2 * math.pi
        d = hat.matrix_world.to_3x3() @ Vector((math.cos(a) * 0.62, math.sin(a) * 0.62, 0.78)).normalized()
        p, n = ray_hit(crown, centre + d * 3, -d)
        if p is None: continue
        e = torus('Cap_Eyelet%d' % i, 0.022, 0.007, ring, root, seg=20, ring=8)
        e.matrix_world = Matrix.Translation(p + n * 0.003) @ n.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        e.parent = hat; e.matrix_parent_inverse = hat.matrix_world.inverted()
    # embroidered badge on the front panel
    d = hat.matrix_world.to_3x3() @ Vector((0, -1, 0.75)).normalized()
    p, n = ray_hit(crown, centre + d * 3, -d)
    if p is not None:
        bmat = Matrix.Translation(p + n * 0.004) @ n.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        b = cylinder('Cap_Badge', 0.085, 0.012, badge, root, sub=1, bevel=0.004); b.matrix_world = bmat
        r = torus('Cap_BadgeRim', 0.085, 0.009, white, root, seg=40, ring=8); r.matrix_world = bmat
        for o in (b, r): o.parent = hat; o.matrix_parent_inverse = hat.matrix_world.inverted()
    # bill: grown out of the crown's actual bottom edge, so it can't float; arched, thick, stitched
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get(); ev = crown.evaluated_get(dg); em = ev.to_mesh()
    to_hat = hat.matrix_world.inverted() @ crown.matrix_world
    pts = [to_hat @ v.co for v in em.vertices]
    ev.to_mesh_clear()
    zmin = min(p.z for p in pts)
    rim = [p for p in pts if p.z < zmin + 0.07]
    segs, rings = 48, 10
    def rim_at(a):
        # the outermost bottom-edge point of the crown in the direction a
        d = Vector((math.cos(a), math.sin(a)))
        best = max(rim, key=lambda p: (p.x * d.x + p.y * d.y) - 3 * abs(p.x * d.y - p.y * d.x))
        return best
    base = [rim_at(math.pi + math.pi * j / segs) for j in range(segs + 1)]
    bill_len = CR[1] * 1.35
    def bill(i, j):
        a = math.pi + math.pi * j / segs
        p0 = base[min(segs, max(0, int(round(j))))]
        u = i / rings
        ext = bill_len * (0.05 + 0.95 * abs(math.sin(a)) ** 3) * u  # never zero: collapsed rows made NaNs in the bevel
        x = p0.x + math.cos(a) * ext
        y = p0.y + math.sin(a) * ext
        z = p0.z + 0.012 - 0.1 * (abs(math.cos(a)) ** 2) * u * abs(math.sin(a)) ** 2 - 0.06 * u * abs(math.sin(a)) ** 3
        return x, y, z
    bm = bmesh.new(); grid = []
    for i in range(rings + 1):
        grid.append([bm.verts.new(bill(i, j)) for j in range(segs + 1)])
    for i in range(rings):
        for j in range(segs):
            bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
    brim = mesh_obj('Cap_Brim', bm, navy, hat)
    brim.data.materials.append(under)
    so = brim.modifiers.new('Solidify', 'SOLIDIFY'); so.thickness = 0.045; so.offset = 1; so.material_offset = 1
    bv = brim.modifiers.new('Bevel', 'BEVEL'); bv.width = 0.018; bv.segments = 3
    brim.modifiers.new('Subdivision', 'SUBSURF').levels = 1
    bpy.context.view_layer.update()
    return hat
