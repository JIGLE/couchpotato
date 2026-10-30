# Pixar pass of the seven kinds: realistic skin, glossy + happy eyes, sculpted mouth, chunky limbs,
# accessories hugging the head. Run after potato_lib.py, kinds.py, realism.py, kinds2.py, pixar.py.
import bpy, math


def build_kind3(name):
    K = KINDS[name]
    sc = new_scene('potato-' + name)
    root = link(bpy.data.objects.new('potato-' + name, None))
    SX, SY, SZ = K['size']
    skin = real_skin('Skin_' + name, K['color'], dark=K['dark'], net=NET[name], stripes=K.get('stripes'), mottle=K.get('mottle'))
    body = real_body('Body', (SX, SY, SZ), skin, root, seed=sum(map(ord, name)) % 13 + 1, deform=K.get('deform'),
                     base=K.get('base', 'sphere'), box=K.get('box'), lumps=LUMPS.get(name, 9), bump=K['bump'])
    bpy.context.view_layer.update()
    er = max(K.get('er', 0.1), 0.095)
    ez = SZ * K['eh']
    ex = K.get('ex', min(0.19, half_width(body, ez) * 0.34))
    centers = [(s * ex, surface_y(body, s * ex, ez)[0], ez) for s in (1, -1)]
    socket(body, centers, radius=0.12, depth=0.03)
    bpy.context.view_layer.update()
    eyes(root, body, 'bead', ex, ez, er, skin=skin, mouth_w=0)
    happy_eyes(root, ex, er)
    mw = min(0.2, half_width(body, ez - er * 2.7) * 0.42)
    pixar_mouth(root, body, ez - er * 2.7, w=mw, h=mw * (0.68 if K.get('mouth_open', True) else 0.45), blush_x=ex * 1.7)
    bpy.context.view_layer.update()
    pixar_limbs(root, body, half_width(body, SZ * 0.75), abs(surface_y(body, 0, SZ * 0.4)[0]), skin, arm_z=SZ * 0.78)
    c = dict(ex=ex, ez=ez, er=er, top=top_z(body), SX=SX, SY=SY, SZ=SZ)
    K['acc'](root, body, c)
    for o in root.children_recursive:
        if o.name in HUG:
            off, band = HUG[o.name]
            hug(o, body, offset=off, band=band)
    root.rotation_euler = (math.radians(-12), 0, 0)
    studio(sc, target_z=c['top'] * 0.55, dist=5.0 + max(0, c['top'] - 1.6) * 1.5)
    bpy.data.materials['StudioFloor'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = hex_rgba('#1f4a2c')
    sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = hex_rgba('#3a1e10')
    return root
