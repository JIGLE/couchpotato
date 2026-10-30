# Shared helpers for building Couch Potato characters in Blender.
# Conventions: Z up, the face looks toward -Y (glTF exports this as +Z, which is what room.js faces),
# origin at the bottom centre, body about 1.6 units tall like room.js's procedural potatoes.
import bpy, bmesh, math
from mathutils import Vector, Matrix


def hex_rgba(h, a=1.0):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, a)


def new_scene(name):
    # Object names are global in Blender, so clear the other built potatoes first;
    # otherwise parts become "Eye_L.001" and room.js can't find them by name.
    for other in bpy.data.scenes:
        if other.name != name and (other.name.startswith('potato-') or other.name == 'glb-check'):
            for o in list(other.objects):
                bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.orphans_purge(do_recursive=True)
    sc = bpy.data.scenes.get(name)
    if sc:
        for o in list(sc.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.orphans_purge(do_recursive=True)
    else:
        sc = bpy.data.scenes.new(name)
    bpy.context.window.scene = sc
    sc.unit_settings.system = 'METRIC'
    return sc


def link(obj, parent=None):
    bpy.context.scene.collection.objects.link(obj)
    if parent:
        obj.parent = parent
    return obj


def mesh_obj(name, bm, mat=None, parent=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    if smooth:
        for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    if mat: me.materials.append(mat)
    return link(ob, parent)


def uv_sphere(name, r=1.0, seg=48, rings=24, mat=None, parent=None, loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r, calc_uvs=True)
    ob = mesh_obj(name, bm, mat, parent)
    ob.location = loc; ob.scale = scale; ob.rotation_euler = rot
    return ob


def principled(name, color, rough=0.5, sss=0.0, emit=0.0, coat=0.0, metal=0.0, sheen=0.0, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = hex_rgba(color)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Subsurface Weight'].default_value = sss
    if sss:
        b.inputs['Subsurface Radius'].default_value = (1.0, 0.8, 0.6)
        b.inputs['Subsurface Scale'].default_value = 0.08
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Sheen Weight'].default_value = sheen
    if emit:
        b.inputs['Emission Color'].default_value = hex_rgba(color)
        b.inputs['Emission Strength'].default_value = emit
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
    return m


def skin_material(name, color, freckle='#8a6a3a', blush='#ff7a6a', rough=0.62):
    """Potato skin: subsurface, freckled colour, bumpy normal, blush from the 'Blush' vertex colour."""
    m = principled(name, color, rough=rough, sss=0.15, sheen=0.05)
    nt = m.node_tree; N = nt.nodes; L = nt.links
    b = N['Principled BSDF']
    tc = N.new('ShaderNodeTexCoord'); tc.location = (-1200, 0)
    # freckles: high-contrast noise speckle mixed into the base colour
    fn = N.new('ShaderNodeTexNoise'); fn.location = (-1000, 300)
    fn.inputs['Scale'].default_value = 28; fn.inputs['Detail'].default_value = 2
    L.new(tc.outputs['Object'], fn.inputs['Vector'])
    fr = N.new('ShaderNodeValToRGB'); fr.location = (-800, 300)
    fr.color_ramp.elements[0].position = 0.62; fr.color_ramp.elements[0].color = (0, 0, 0, 1)
    fr.color_ramp.elements[1].position = 0.70; fr.color_ramp.elements[1].color = (1, 1, 1, 1)
    L.new(fn.outputs['Fac'], fr.inputs['Fac'])
    # broad tonal variation so the skin isn't flat
    vn = N.new('ShaderNodeTexNoise'); vn.location = (-1000, 550)
    vn.inputs['Scale'].default_value = 3; vn.inputs['Detail'].default_value = 3
    L.new(tc.outputs['Object'], vn.inputs['Vector'])
    vmix = N.new('ShaderNodeMix'); vmix.data_type = 'RGBA'; vmix.blend_type = 'MULTIPLY'; vmix.location = (-600, 550)
    vmix.inputs['Factor'].default_value = 0.35
    vmix.inputs['A'].default_value = hex_rgba(color)
    L.new(vn.outputs['Color'], vmix.inputs['B'])
    fmix = N.new('ShaderNodeMix'); fmix.data_type = 'RGBA'; fmix.location = (-400, 350)
    L.new(fr.outputs['Color'], fmix.inputs['Factor'])
    L.new(vmix.outputs['Result'], fmix.inputs['A'])
    fmix.inputs['B'].default_value = hex_rgba(freckle)
    fmix.inputs['Factor'].default_value = 0.5
    # the freckle mask should only be half strength
    fm = N.new('ShaderNodeMath'); fm.operation = 'MULTIPLY'; fm.inputs[1].default_value = 0.55; fm.location = (-600, 250)
    L.new(fr.outputs['Color'], fm.inputs[0]); L.new(fm.outputs['Value'], fmix.inputs['Factor'])
    # blush from vertex colour
    at = N.new('ShaderNodeVertexColor'); at.layer_name = 'Blush'; at.location = (-400, 100)
    bmix = N.new('ShaderNodeMix'); bmix.data_type = 'RGBA'; bmix.location = (-200, 300)
    L.new(at.outputs['Color'], bmix.inputs['Factor'])
    L.new(fmix.outputs['Result'], bmix.inputs['A'])
    bmix.inputs['B'].default_value = hex_rgba(blush)
    L.new(bmix.outputs['Result'], b.inputs['Base Color'])
    # bump
    bn = N.new('ShaderNodeTexNoise'); bn.location = (-800, -300)
    bn.inputs['Scale'].default_value = 12; bn.inputs['Detail'].default_value = 8; bn.inputs['Roughness'].default_value = 0.6
    L.new(tc.outputs['Object'], bn.inputs['Vector'])
    bump = N.new('ShaderNodeBump'); bump.location = (-400, -300)
    bump.inputs['Strength'].default_value = 0.25; bump.inputs['Distance'].default_value = 0.02
    L.new(bn.outputs['Fac'], bump.inputs['Height'])
    L.new(bump.outputs['Normal'], b.inputs['Normal'])
    return m


def potato_body(name, size, color, mat, parent=None, bump=0.04, seed=1, deform=None, base='sphere', box=None):
    """size = (half width X, half depth Y, half height Z). Returns the body object, origin at bottom centre."""
    sx, sy, sz = size
    bm = bmesh.new()
    if base == 'box':
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=11, use_grid_fill=True)
        # round the cube into a pillow: push every vertex toward a superellipsoid
        rr = box or 0.35
        for v in bm.verts:
            p = v.co * 2  # -1..1
            q = Vector([max(-1 + rr, min(1 - rr, c)) for c in p])
            d = p - q
            if d.length > 0: d = d.normalized() * rr
            v.co = q + d
    else:
        bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=40, radius=1.0, calc_uvs=True)
    for v in bm.verts:
        x, y, z = v.co
        f = 1 + bump * (math.sin(3 * x + seed) * math.sin(2.5 * z + seed * 1.7) + 0.6 * math.sin(4 * y + seed * 2.3) * math.cos(3 * x + seed * 0.4))
        if z < -0.75: f *= 1 - (-0.75 - z) * 0.35  # flattened bottom to sit on
        fx = fy = fz = f
        if deform: fx, fy, fz = deform(x, y, z, fx, fy, fz)
        v.co = Vector((x * fx * sx, y * fy * sy, z * fz * sz + sz))
    ob = mesh_obj(name, bm, mat, parent)
    sub = ob.modifiers.new('Subdivision', 'SUBSURF'); sub.levels = 1; sub.render_levels = 2
    return ob


def surface_y(body, x, z):
    """Front (-Y) surface depth of the body at (x, z), by ray cast."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    mw = body.matrix_world; inv = mw.inverted()
    o = inv @ Vector((x, -10, z)); d = (inv.to_3x3() @ Vector((0, 1, 0))).normalized()
    ok, loc, nor, idx = ev.ray_cast(o, d)
    if not ok: return None, None
    return (mw @ loc).y, (mw.to_3x3() @ nor).normalized()


def paint_blush(body, centers, radius=0.22, strength=0.55):
    me = body.data
    if 'Blush' not in me.color_attributes:
        me.color_attributes.new('Blush', 'FLOAT_COLOR', 'POINT')
    ca = me.color_attributes['Blush']
    mw = body.matrix_world
    for i, v in enumerate(me.vertices):
        p = mw @ v.co
        a = 0.0
        for c in centers:
            d = (p - Vector(c)).length / radius
            if d < 1: a = max(a, (1 - d * d) ** 2 * strength)
        ca.data[i].color = (a, a, a, 1)


def face(root, body, eye_x, eye_z, eye_r=0.17, mats=None, squint=1.0, eye_scale=1.0, mouth_w=0.12, mouth_z=None, brow=True, lid_angle=-0.62, skin=None):
    """Big Pixar eyes with lids, brows, a smile and blush. Names match what room.js animates."""
    M = mats
    r = eye_r * eye_scale
    parts = {}
    for side, s in (('L', 1), ('R', -1)):
        x = s * eye_x
        y, n = surface_y(body, x, eye_z)
        eye = bpy.data.objects.new('Eye_' + side, None); link(eye, root)
        eye.location = (x, y + 0.095, eye_z)
        # turn the eye so it sits along the surface normal (mostly forward, a little sideways)
        yaw = math.atan2(n.x, -n.y) * 0.6
        eye.rotation_euler = (0, 0, yaw)
        uv_sphere('Sclera_' + side, r, 32, 16, M['sclera'], eye, scale=(1, 0.62, 1.18 * squint))
        uv_sphere('Iris_' + side, 0.105 * eye_scale, 24, 12, M['iris'], eye, loc=(-s * 0.012, -0.07 * eye_scale, -0.012), scale=(1, 0.5, 1.1 * squint))
        uv_sphere('Pupil_' + side, 0.06 * eye_scale, 20, 10, M['pupil'], eye, loc=(-s * 0.012, -0.105 * eye_scale, -0.012), scale=(1, 0.5, 1.1 * squint))
        uv_sphere('Glint_' + side, 0.026 * eye_scale, 12, 8, M['glint'], eye, loc=(0.04 * eye_scale, -0.125 * eye_scale, 0.045 * eye_scale * squint))
        uv_sphere('Glint2_' + side, 0.012 * eye_scale, 10, 6, M['glint'], eye, loc=(-0.035 * eye_scale, -0.12 * eye_scale, -0.04 * eye_scale * squint))
        # upper lid: a skin hemisphere hugging the top of the eye
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=r * 1.09, calc_uvs=True)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-4], context='VERTS')
        lid = mesh_obj('Lid_' + side, bm, skin, eye)
        lid.scale = (1.04, 0.84 * 0.62 / 0.62, 1.2 * squint)
        lid.rotation_euler = (lid_angle, 0, 0)
        if brow:
            by = eye_z + r * 1.6 * squint
            yb, _ = surface_y(body, x * 1.02, by)
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=10, radius=1.0, calc_uvs=True)
            b = mesh_obj('Brow_' + side, bm, M['brow'], root)
            b.scale = (0.1 * eye_scale, 0.025, 0.026)
            b.location = (x * 1.02, yb + 0.004, by)
            b.rotation_euler = (0, s * 0.18, -yaw)
        parts[side] = eye
    # smile: half torus
    mz = mouth_z if mouth_z is not None else eye_z - r * 1.25
    ym, _ = surface_y(body, 0, mz)
    bm = bmesh.new()
    seg, ring = 32, 12
    R, rr = mouth_w, 0.026
    verts = []
    for i in range(seg + 1):
        a = math.pi + math.pi * i / seg
        row = []
        for j in range(ring):
            b = 2 * math.pi * j / ring
            cx, cz = math.cos(a) * R, math.sin(a) * R
            row.append(bm.verts.new((cx + math.cos(a) * math.cos(b) * rr, math.sin(b) * rr, cz + math.sin(a) * math.cos(b) * rr)))
        verts.append(row)
    for i in range(seg):
        for j in range(ring):
            bm.faces.new((verts[i][j], verts[i + 1][j], verts[i + 1][(j + 1) % ring], verts[i][(j + 1) % ring]))
    for row in (verts[0], verts[-1]):
        c = bm.verts.new(sum((v.co for v in row), Vector()) / ring)
        for j in range(ring): bm.faces.new((row[j], row[(j + 1) % ring], c))
    smile = mesh_obj('Smile', bm, M['mouth'], root)
    smile.location = (0, ym + 0.012, mz + R * 0.6)
    paint_blush(body, [(s * eye_x * 1.65, ym, mz + 0.02) for s in (1, -1)])
    return parts


def feet(root, body, half_w, half_d, mat):
    for side, s in (('L', 1), ('R', -1)):
        f = uv_sphere('Foot_' + side, 0.15, 24, 12, mat, root, loc=(s * min(0.34, half_w * 0.42), -half_d * 0.5, 0.07), scale=(1, 1.45, 0.62))
    return f


def face_mats():
    return {
        'sclera': principled('Sclera', '#fbf8f2', rough=0.15, coat=1.0, emit=0.08),
        'iris': principled('Iris', '#3a2412', rough=0.25, coat=1.0),
        'pupil': principled('Pupil', '#0b0604', rough=0.2, coat=1.0),
        'glint': principled('Glint', '#ffffff', rough=0.1, emit=3.0),
        'mouth': principled('Mouth', '#3a1a10', rough=0.5),
        'brow': principled('Brow', '#5a3418', rough=0.7),
    }


def studio(scene, target_z=0.9, dist=4.2, yaw=-25, pitch=8, res=1024):
    """Warm three-point studio with a soft backdrop, for review renders."""
    for o in [o for o in scene.objects if o.name.startswith('Studio_')]:
        bpy.data.objects.remove(o, do_unlink=True)
    w = bpy.data.worlds.get('StudioWorld') or bpy.data.worlds.new('StudioWorld')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = hex_rgba('#2b1f2e')
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    scene.world = w
    # floor curve
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=6)
    floor = mesh_obj('Studio_Floor', bm, principled('StudioFloor', '#6b4a5c', rough=0.8), None, smooth=False)
    def area(name, loc, energy, color, size):
        L = bpy.data.lights.new(name, 'AREA'); L.energy = energy; L.color = hex_rgba(color)[:3]; L.size = size
        o = link(bpy.data.objects.new(name, L))
        o.location = loc
        d = Vector((0, 0, target_z)) - Vector(loc)
        o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        return o
    area('Studio_Key', (-2.5, -3.0, 3.2), 600, '#fff1dc', 2.0)
    area('Studio_Fill', (3.0, -2.5, 1.6), 180, '#cfe0ff', 3.0)
    area('Studio_Rim', (1.2, 3.0, 2.8), 500, '#ffb070', 1.5)
    cam = bpy.data.cameras.new('Studio_Cam'); cam.lens = 70
    co = link(bpy.data.objects.new('Studio_Cam', cam))
    a, p = math.radians(yaw), math.radians(pitch)
    co.location = (math.sin(a) * dist * math.cos(p), -math.cos(a) * dist * math.cos(p), target_z + math.sin(p) * dist)
    co.rotation_euler = (Vector((0, 0, target_z)) - co.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = co
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = res; scene.render.resolution_y = res
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    try:
        scene.eevee.use_raytracing = True
        scene.eevee.taa_render_samples = 64
    except Exception:
        pass
    return co


# ---------------- mockup style (Jose's lobby mockup) ----------------
# Russet egg-shaped potatoes with small glossy bead eyes, open grins, pink cheeks,
# thin little arms and round pink feet.

def russet_material(name, color, dark='#5a2c12', light=None, rough=0.7, stripes=None, mottle=None):
    """Rough russet skin: speckles, dark eye-pits, mottled tone and a strong bump.
    stripes: a hex colour for diagonal grill marks; mottle: a hex colour blended in big patches."""
    m = skin_material(name, color, freckle=dark, blush='#e8606a', rough=rough)
    N = m.node_tree.nodes; L = m.node_tree.links
    b = N['Principled BSDF']
    if stripes or mottle:
        last = b.inputs['Base Color'].links[0].from_socket
        tc = [n for n in N if n.type == 'TEX_COORD'][0]
        if mottle:
            mn = N.new('ShaderNodeTexNoise'); mn.inputs['Scale'].default_value = 2.2; mn.inputs['Detail'].default_value = 4
            L.new(tc.outputs['Object'], mn.inputs['Vector'])
            mr = N.new('ShaderNodeValToRGB'); mr.label = 'keep'; mr.color_ramp.elements[0].position = 0.42; mr.color_ramp.elements[1].position = 0.62
            L.new(mn.outputs['Fac'], mr.inputs['Fac'])
            mm = N.new('ShaderNodeMix'); mm.data_type = 'RGBA'
            L.new(mr.outputs['Color'], mm.inputs['Factor']); L.new(last, mm.inputs['A']); mm.inputs['B'].default_value = hex_rgba(mottle)
            last = mm.outputs['Result']
        if stripes:
            wv = N.new('ShaderNodeTexWave'); wv.wave_type = 'BANDS'; wv.bands_direction = 'DIAGONAL'; wv.wave_profile = 'SAW'
            wv.inputs['Scale'].default_value = 1.8; wv.inputs['Distortion'].default_value = 0.6; wv.inputs['Detail'].default_value = 2
            L.new(tc.outputs['Object'], wv.inputs['Vector'])
            wr = N.new('ShaderNodeValToRGB'); wr.label = 'keep'; wr.color_ramp.elements[0].position = 0.0; wr.color_ramp.elements[0].color = (1, 1, 1, 1)
            wr.color_ramp.elements[1].position = 0.06; wr.color_ramp.elements[1].color = (0, 0, 0, 1)
            L.new(wv.outputs['Fac'], wr.inputs['Fac'])
            sm = N.new('ShaderNodeMix'); sm.data_type = 'RGBA'
            L.new(wr.outputs['Color'], sm.inputs['Factor']); L.new(last, sm.inputs['A']); sm.inputs['B'].default_value = hex_rgba(stripes)
            last = sm.outputs['Result']
        L.new(last, b.inputs['Base Color'])
    for n in N:
        if n.type == 'TEX_NOISE' and abs(n.inputs['Scale'].default_value - 28) < 1e-3:
            n.inputs['Scale'].default_value = 34
        if n.type == 'BUMP':
            n.inputs['Strength'].default_value = 0.45
    for n in N:
        if n.type == 'VALTORGB' and n.label != 'keep':
            n.color_ramp.elements[0].position = 0.6; n.color_ramp.elements[1].position = 0.68
        if n.type == 'MATH': n.inputs[1].default_value = 0.75
        if n.type == 'MIX' and n.blend_type == 'MULTIPLY': n.inputs['Factor'].default_value = 0.5
    return m


def bead_face(root, body, eye_x, eye_z, eye_r=0.085, mouth_w=0.13, mouth_open=True, tilt=0.0):
    """Glossy black bead eyes with a big glint, an open grin and blush. Part names match room.js."""
    M = {
        'bead': principled('Bead', '#120806', rough=0.08, coat=1.0),
        'glint': principled('Glint', '#ffffff', rough=0.1, emit=4.0),
        'mouth': principled('MouthInside', '#3a0f0c', rough=0.5),
        'tongue': principled('Tongue', '#e0605a', rough=0.45),
        'lip': principled('Lip', '#4a1a10', rough=0.5),
    }
    for side, s in (('L', 1), ('R', -1)):
        x = s * eye_x
        y, n = surface_y(body, x, eye_z)
        eye = bpy.data.objects.new('Eye_' + side, None); link(eye, root)
        eye.location = (x, y + eye_r * 0.35, eye_z)
        yaw = math.atan2(n.x, -n.y) * 0.8
        eye.rotation_euler = (0, s * tilt, yaw)
        uv_sphere('Pupil_' + side, eye_r, 32, 16, M['bead'], eye, scale=(0.82, 0.55, 1.12))
        uv_sphere('Glint_' + side, eye_r * 0.32, 16, 8, M['glint'], eye, loc=(s * -eye_r * 0.25 + eye_r * 0.22, -eye_r * 0.48, eye_r * 0.45), scale=(1, 0.5, 1))
        uv_sphere('Glint2_' + side, eye_r * 0.14, 12, 6, M['glint'], eye, loc=(-eye_r * 0.25, -eye_r * 0.5, -eye_r * 0.45), scale=(1, 0.5, 1))
    mz = eye_z - eye_r * 2.4
    ym, nm = surface_y(body, 0, mz)
    # mouth: a half-ellipse "D" cavity set into the face, with a tongue
    mouth = bpy.data.objects.new('Smile', None); link(mouth, root)
    mouth.location = (0, ym + 0.015, mz)
    mouth.rotation_euler = (math.atan2(-nm.z, -nm.y) * 0.6 if nm else 0, 0, 0)
    bm = bmesh.new()
    seg = 24
    # a wide crescent grin: deep lower arc, upper edge curling up at the corners
    hgt = mouth_w * (0.62 if mouth_open else 0.2)
    pts = [(math.cos(math.pi + math.pi * i / seg) * mouth_w, 0, math.sin(math.pi + math.pi * i / seg) * hgt + 0.035 * (math.cos(math.pi * i / seg) ** 2) * mouth_w / 0.12) for i in range(seg + 1)]
    pts += [(mouth_w * (1 - 2 * i / seg), 0, 0.035 * ((1 - 2 * i / seg) ** 2) * mouth_w / 0.12 * 0.8) for i in range(1, seg)]
    vs = [bm.verts.new(p) for p in pts]
    bm.faces.new(vs)
    inside = mesh_obj('Mouth', bm, M['mouth'], mouth)
    so = inside.modifiers.new('Solidify', 'SOLIDIFY'); so.thickness = 0.03; so.offset = 0
    bv = inside.modifiers.new('Bevel', 'BEVEL'); bv.width = 0.01; bv.segments = 3
    if mouth_open:
        uv_sphere('Tongue', mouth_w * 0.42, 20, 10, M['tongue'], mouth, loc=(0, -0.004, -hgt * 0.62), scale=(1.25, 0.3, 0.55))
    paint_blush(body, [(s * eye_x * 1.75, ym, mz + 0.03) for s in (1, -1)], radius=0.17, strength=0.75)


def limbs(root, body, half_w, half_d, skin, foot_color='#d2486e', arm_z=0.7, sit=True):
    """Thin noodle arms ending in little mitten hands, and round pink feet poking forward."""
    fm = principled('Feet_pink', foot_color, rough=0.45, sss=0.1, coat=0.3)
    for side, s in (('L', 1), ('R', -1)):
        # arm: a skin-modifier noodle from the body side, bending down and forward
        y0, _ = surface_y(body, s * half_w * 0.8, arm_z)
        start = Vector((s * half_w * 0.8, -half_d * 0.3, arm_z))
        mid = start + Vector((s * 0.14, -0.06, -0.16))
        end = mid + Vector((s * 0.02, -0.12, -0.16)) if sit else mid + Vector((s * -0.02, -0.12, -0.14))
        bm = bmesh.new()
        vs = [bm.verts.new(start.lerp(mid, t / 4) if t <= 4 else mid.lerp(end, (t - 4) / 4)) for t in range(9)]
        for i in range(8): bm.edges.new((vs[i], vs[i + 1]))
        arm = mesh_obj('Arm_' + side, bm, skin, root)
        arm.modifiers.new('Skin', 'SKIN')
        for i, v in enumerate(arm.data.skin_vertices[0].data):
            r = 0.038 if i < 8 else 0.058
            v.radius = (r, r)
        arm.modifiers.new('Subdivision', 'SUBSURF').levels = 2
        # feet: little pink balls at the front, slightly splayed
        fy, fz = (-half_d * 1.0, 0.1) if sit else (-half_d * 0.72, 0.08)
        # stubby leg joining the body to the foot
        a0 = Vector((s * half_w * 0.34, -half_d * 0.55, 0.16)); a1 = Vector((s * half_w * 0.36, fy + 0.06, fz + 0.01))
        bm = bmesh.new()
        lv = [bm.verts.new(a0.lerp(a1, t / 4)) for t in range(5)]
        for i in range(4): bm.edges.new((lv[i], lv[i + 1]))
        leg = mesh_obj('Leg_' + side, bm, skin, root)
        leg.modifiers.new('Skin', 'SKIN')
        for v in leg.data.skin_vertices[0].data: v.radius = (0.045, 0.045)
        leg.modifiers.new('Subdivision', 'SUBSURF').levels = 2
        uv_sphere('Foot_' + side, 0.1, 24, 12, fm, root, loc=(s * half_w * 0.36, fy, fz), scale=(1, 1.25, 0.85), rot=(math.radians(-15) if sit else 0, 0, s * 0.25))


def half_width(body, z):
    """Half width of the body along X at height z (ray cast from the side)."""
    dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg)
    mw = body.matrix_world; inv = mw.inverted()
    o = inv @ Vector((10, 0, z)); d = (inv.to_3x3() @ Vector((-1, 0, 0))).normalized()
    ok, loc, nor, idx = ev.ray_cast(o, d)
    return (mw @ loc).x if ok else 0.0


def top_z(body, x=0.0, y=0.0):
    dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg)
    mw = body.matrix_world; inv = mw.inverted()
    o = inv @ Vector((x, y, 10)); d = (inv.to_3x3() @ Vector((0, 0, -1))).normalized()
    ok, loc, nor, idx = ev.ray_cast(o, d)
    return (mw @ loc).z if ok else 0.0


def solid(o, t, off=0.0, sub=1, bevel=0):
    m = o.modifiers.new('Solidify', 'SOLIDIFY'); m.thickness = t; m.offset = off
    if bevel:
        bv = o.modifiers.new('Bevel', 'BEVEL'); bv.width = bevel; bv.segments = 2
    if sub: o.modifiers.new('Subdivision', 'SUBSURF').levels = sub
    return o


def cylinder(name, r, h, mat, parent, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), verts=48, r2=None, sub=1, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r, radius2=r2 if r2 is not None else r, depth=h)
    o = mesh_obj(name, bm, mat, parent)
    o.location = loc; o.rotation_euler = rot; o.scale = scale
    if bevel:
        bv = o.modifiers.new('Bevel', 'BEVEL'); bv.width = bevel; bv.segments = 3
    if sub: o.modifiers.new('Subdivision', 'SUBSURF').levels = sub
    return o


def torus(name, R, r, mat, parent, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), arc=2 * math.pi, seg=64, ring=16):
    bm = bmesh.new()
    closed = arc >= 2 * math.pi - 1e-6
    n = seg if closed else seg + 1
    rows = []
    for i in range(n):
        a = arc * i / seg
        row = []
        for j in range(ring):
            b = 2 * math.pi * j / ring
            row.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
        rows.append(row)
    for i in range(seg if closed else seg):
        i2 = (i + 1) % n
        for j in range(ring):
            bm.faces.new((rows[i][j], rows[i2][j], rows[i2][(j + 1) % ring], rows[i][(j + 1) % ring]))
    if not closed:
        for row in (rows[0], rows[-1]):
            c = bm.verts.new(sum((v.co for v in row), Vector()) / ring)
            for j in range(ring): bm.faces.new((row[j], row[(j + 1) % ring], c))
    o = mesh_obj(name, bm, mat, parent)
    o.location = loc; o.rotation_euler = rot; o.scale = scale
    return o
