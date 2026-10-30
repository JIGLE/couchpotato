# Bake a potato's procedural skin into textures and export the character as a .glb.
import bpy, os


def _select_only(objs, active):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = active


def bake_body(body, flat_color, size=1024):
    """Apply modifiers, unwrap, bake base colour + normal from the procedural skin, swap in an image material."""
    sc = bpy.context.scene
    _select_only([body], body)
    bpy.ops.object.mode_set(mode='OBJECT')
    for m in list(body.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    me = body.data
    while me.uv_layers: me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name='UVMap')
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.01)
    bpy.ops.object.mode_set(mode='OBJECT')

    src = me.materials[0]
    nt = src.node_tree
    name = body.parent.name if body.parent else body.name
    imgs = {}
    for kind in ('color', 'normal'):
        img = bpy.data.images.get(f'{name}_{kind}')
        if img: bpy.data.images.remove(img)
        img = bpy.data.images.new(f'{name}_{kind}', size, size, alpha=False, float_buffer=False)
        if kind == 'normal': img.colorspace_settings.name = 'Non-Color'
        imgs[kind] = img
    node = nt.nodes.new('ShaderNodeTexImage'); node.name = '_bake'
    prev_engine = sc.render.engine
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 4
    sc.cycles.device = 'GPU' if bpy.context.preferences.addons.get('cycles') and bpy.context.preferences.addons['cycles'].preferences.has_active_device() else 'CPU'
    bk = sc.render.bake
    bk.margin = 8
    for kind, typ in (('color', 'DIFFUSE'), ('normal', 'NORMAL')):
        node.image = imgs[kind]; nt.nodes.active = node
        if typ == 'DIFFUSE':
            bk.use_pass_direct = False; bk.use_pass_indirect = False; bk.use_pass_color = True
        bpy.ops.object.bake(type=typ)
        imgs[kind].pack()
    nt.nodes.remove(node)
    sc.render.engine = prev_engine

    # the export material: image textures only, which glTF understands
    b = src.node_tree.nodes['Principled BSDF']
    rough = b.inputs['Roughness'].default_value
    m = bpy.data.materials.new(src.name + '_baked'); m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    pb = N['Principled BSDF']
    ci = N.new('ShaderNodeTexImage'); ci.image = imgs['color']
    ni = N.new('ShaderNodeTexImage'); ni.image = imgs['normal']
    nm = N.new('ShaderNodeNormalMap')
    L.new(ci.outputs['Color'], pb.inputs['Base Color'])
    L.new(ni.outputs['Color'], nm.inputs['Color']); L.new(nm.outputs['Normal'], pb.inputs['Normal'])
    pb.inputs['Roughness'].default_value = rough
    me.materials[0] = m
    return m


def flatten_procedural(objs, mapping):
    """Swap procedural materials on small parts (arms, legs) for plain colours."""
    from_names = set(mapping)
    for o in objs:
        if o.type != 'MESH': continue
        for i, m in enumerate(o.data.materials):
            if m and m.name in from_names:
                o.data.materials[i] = mapping[m.name]


def export_glb(root, path):
    objs = [root] + list(root.children_recursive)
    for o in objs:
        o.hide_set(False)
        if o.type == 'MESH': o.data.name = o.name  # clean mesh names in the glTF
    for sc in bpy.data.scenes:  # selection can leak in from other scenes
        for o in sc.objects:
            if o not in objs:
                try: o.select_set(False, view_layer=sc.view_layers[0])
                except Exception: pass
    _select_only(objs, root)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_image_format='JPEG', export_jpeg_quality=90, use_active_scene=True, export_texcoords=True,
                              export_normals=True, export_materials='EXPORT', export_cameras=False, export_lights=False)
    return os.path.getsize(path)
