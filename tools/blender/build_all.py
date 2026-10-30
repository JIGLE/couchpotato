# Rebuilds every potato character and exports apps/web/public/models/potato-<kind>.glb.
# Run inside Blender (5.2+), e.g. from the Scripting tab or:
#   blender --background --python tools/blender/build_all.py
import bpy, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'apps', 'web', 'public', 'models'))

g = {}
for f in ('potato_lib.py', 'kinds.py', 'realism.py', 'kinds2.py', 'pixar.py', 'kinds3.py', 'export_lib.py'):
    exec(open(os.path.join(HERE, f)).read(), g)


def bake_and_export(root, kind):
    sc = bpy.context.scene
    g['bake_body'](sc.objects['Body'], None, 1024)
    # arms and legs get one flat colour: the average of the baked skin, so they match the body
    flat = g['principled']('Skin_%s_flat' % kind, '#8f4a20', rough=0.72)
    flat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = g['skin_average'](bpy.data.images['potato-%s_color' % kind])
    g['flatten_procedural'](root.children_recursive, {'Skin_' + kind: flat})
    return g['export_glb'](root, os.path.join(OUT, 'potato-%s.glb' % kind))


exec(open(os.path.join(HERE, 'boiled.py')).read(), g)
print('boiled', bake_and_export(bpy.data.objects['potato-boiled'], 'boiled'))
for kind in g['KINDS']:
    root = g['build_kind3'](kind)
    print(kind, bake_and_export(root, kind))
