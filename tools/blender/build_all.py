# Rebuilds every potato character and exports apps/web/public/models/potato-<kind>.glb.
# Run inside Blender (5.2+), e.g. from the Scripting tab or:
#   blender --background --python tools/blender/build_all.py
import bpy, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'apps', 'web', 'public', 'models'))

g = {}
for f in ('potato_lib.py', 'kinds.py', 'export_lib.py'):
    exec(open(os.path.join(HERE, f)).read(), g)


def bake_and_export(root, kind, flat_color):
    sc = bpy.context.scene
    g['bake_body'](sc.objects['Body'], None, 1024)
    flat = g['principled']('Skin_%s_flat' % kind, flat_color, rough=0.7)
    g['flatten_procedural'](root.children_recursive, {'Skin_' + kind: flat})
    return g['export_glb'](root, os.path.join(OUT, 'potato-%s.glb' % kind))


exec(open(os.path.join(HERE, 'boiled.py')).read(), g)
print('boiled', bake_and_export(bpy.data.objects['potato-boiled'], 'boiled', '#8f4a20'))
for kind in g['KINDS']:
    root = g['build_kind'](kind)
    print(kind, bake_and_export(root, kind, g['KINDS'][kind]['color']))
