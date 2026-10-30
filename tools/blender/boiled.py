# Boiled potato, Pixar pass: glossy eyes (+ hidden happy arcs), sculpted mouth, chunky limbs, made cap.
import bpy, math
from mathutils import Vector

sc = new_scene('potato-boiled')
root = link(bpy.data.objects.new('potato-boiled', None))
SX, SY, SZ = 0.6, 0.55, 0.82


def egg(x, y, z, fx, fy, fz):
    k = 1 + 0.15 * (-z)
    return fx * k, fy * k, fz


skin = real_skin('Skin_boiled', '#a05a2a', dark='#4a2410', net='#c99560')
body = real_body('Body', (SX, SY, SZ), skin, root, seed=3, deform=egg)
bpy.context.view_layer.update()
EX, EZ, ER = 0.18, SZ * 1.1, 0.105
centers = [(s * EX, surface_y(body, s * EX, EZ)[0], EZ) for s in (1, -1)]
socket(body, centers, radius=0.12, depth=0.03)
bpy.context.view_layer.update()
eyes(root, body, 'bead', EX, EZ, ER, skin=skin, mouth_w=0)
happy_eyes(root, EX, ER)
pixar_mouth(root, body, EZ - ER * 2.7, w=0.2, h=0.135, blush_x=EX * 1.7)
bpy.context.view_layer.update()
pixar_limbs(root, body, half_width(body, SZ * 0.75), abs(surface_y(body, 0, SZ * 0.4)[0]), skin, arm_z=SZ * 0.78)
pixar_cap(root, body, SZ * 1.42)

root.rotation_euler = (math.radians(-12), 0, 0)
studio(sc, target_z=0.9, dist=5.0)
bpy.data.materials['StudioFloor'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = hex_rgba('#1f4a2c')
sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = hex_rgba('#3a1e10')
result = {'objects': len(sc.objects)}
