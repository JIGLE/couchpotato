# Second pass of the seven kinds: realistic skin and shape, eye style, accessories hugging the head.
# Run after potato_lib.py, kinds.py and realism.py.
import bpy, math

NET = {'grilled': '#a0643a', 'chip': '#ecc27a', 'fry': '#f6d77a', 'mashed': '#fbf3dc',
       'jacket': '#9a6038', 'hashbrown': '#d89a4a', 'sweet': '#c8704e'}
LUMPS = {'chip': 4, 'fry': 4, 'hashbrown': 5}
# accessory parts that should sit on the head rather than cut into it or float above it: name -> (offset, band)
HUG = {'Beanie_Dome': (0.012, 0.2), 'Beanie_Band': (0.02, None), 'Toque_Band': (0.015, None),
       'Fedora_Crown': (0.015, None), 'Fedora_Band': (0.02, None), 'Sweatband': (0.03, None),
       'Crown_Vine': (0.03, None), 'Phones_Pad_L': (0.01, None), 'Phones_Pad_R': (0.01, None)}


def build_kind2(name, style='bead'):
    K = KINDS[name]
    sc = new_scene('potato-' + name)
    root = link(bpy.data.objects.new('potato-' + name, None))
    SX, SY, SZ = K['size']
    skin = real_skin('Skin_' + name, K['color'], dark=K['dark'], net=NET[name], stripes=K.get('stripes'), mottle=K.get('mottle'))
    body = real_body('Body', (SX, SY, SZ), skin, root, seed=sum(map(ord, name)) % 13 + 1, deform=K.get('deform'),
                     base=K.get('base', 'sphere'), box=K.get('box'), lumps=LUMPS.get(name, 9), bump=K['bump'])
    bpy.context.view_layer.update()
    er = K.get('er', 0.1) * (1.0 if style != 'pixar' else 0.95)
    er = max(er, 0.09)
    ez = SZ * K['eh']
    ex = K.get('ex', min(0.19, half_width(body, ez) * 0.34))
    centers = [(s * ex, surface_y(body, s * ex, ez)[0], ez) for s in (1, -1)]
    socket(body, centers, radius=0.12 if style != 'pixar' else 0.15, depth=0.03)
    bpy.context.view_layer.update()
    eyes(root, body, style, ex, ez, er, skin=skin, mouth_w=K.get('mw', 0.15), mouth_open=K.get('mouth_open', True))
    hw = half_width(body, SZ * 0.75)
    limbs(root, body, hw, abs(surface_y(body, 0, SZ * 0.4)[0]), skin, arm_z=SZ * 0.75)
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
