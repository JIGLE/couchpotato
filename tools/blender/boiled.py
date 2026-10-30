import bpy, bmesh, math
from mathutils import Vector

sc = new_scene('potato-boiled')
root = link(bpy.data.objects.new('potato-boiled', None))
SX, SY, SZ = 0.6, 0.55, 0.82


def egg(x, y, z, fx, fy, fz):
    # wider at the bottom, narrower at the top, a slight lean and a lump on one shoulder
    k = 1 + 0.16 * (-z)
    lump = 1 + 0.06 * math.exp(-((x - 0.5) ** 2 + (z - 0.4) ** 2) * 6)
    return fx * k * lump, fy * k * lump, fz


skin = russet_material('Skin_boiled', '#9c5426', dark='#3e1a08')
body = potato_body('Body', (SX, SY, SZ), None, skin, root, bump=0.07, seed=2.1, deform=egg)
bpy.context.view_layer.update()
bead_face(root, body, eye_x=0.17, eye_z=SZ * 1.08, eye_r=0.088, mouth_w=0.165)
limbs(root, body, SX * 1.05, SY, skin, arm_z=0.62)

# --- two-tone baseball cap: navy with a white front panel, a round badge and a navy brim ---
navy = principled('Cap_navy', '#1d2f6b', rough=0.62)
white = principled('Cap_white', '#f2f0ea', rough=0.66)
badge = principled('Cap_badge', '#3f6fd8', rough=0.4)
hat = bpy.data.objects.new('Hat', None); link(hat, root)
hat.location = (0, 0.02, 1.13)
hat.rotation_euler = (math.radians(-11), math.radians(7), math.radians(-8))
CR = (SX * 0.96, SY * 0.97, 0.5)
# one dome shell; the front wedge faces get the white material
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=1.0, calc_uvs=True)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.05], context='VERTS')
for f in bm.faces:
    c = f.calc_center_median()
    f.material_index = 1 if (c.y < 0 and abs(math.atan2(c.x, -c.y)) < 0.72 and c.z < 0.97) else 0
crown = mesh_obj('Cap_Crown', bm, navy, hat)
crown.data.materials.append(white)
crown.scale = CR
so = crown.modifiers.new('Solidify', 'SOLIDIFY'); so.thickness = 0.05; so.offset = 1
crown.modifiers.new('Subdivision', 'SUBSURF').levels = 1
uv_sphere('Cap_Button', 0.045, 20, 10, navy, hat, loc=(0, 0, CR[2] + 0.04), scale=(1, 1, 0.55))
b = uv_sphere('Cap_Badge', 0.07, 24, 12, badge, hat, loc=(0, -CR[1] * 0.83 - 0.03, CR[2] * 0.5), scale=(1, 0.25, 1), rot=(math.radians(-30), 0, 0))
# brim
bm = bmesh.new()
segs, rings = 40, 8
grid = []
for i in range(rings + 1):
    rr = 0.6 + 0.4 * i / rings
    row = []
    for j in range(segs + 1):
        a = math.pi + math.pi * j / segs
        x, y = math.cos(a) * CR[0] * rr * 1.02, math.sin(a) * CR[1] * 1.75 * rr
        z = -0.07 * (abs(math.cos(a)) ** 2) * (i / rings) - 0.03 * (i / rings)
        row.append(bm.verts.new((x, y, z)))
    grid.append(row)
for i in range(rings):
    for j in range(segs):
        bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
brim = mesh_obj('Cap_Brim', bm, navy, hat)
brim.location = (0, 0, 0.03)
so = brim.modifiers.new('Solidify', 'SOLIDIFY'); so.thickness = 0.035; so.offset = 0
bv = brim.modifiers.new('Bevel', 'BEVEL'); bv.width = 0.012; bv.segments = 2
brim.modifiers.new('Subdivision', 'SUBSURF').levels = 1

root.rotation_euler = (math.radians(-12), 0, 0)  # leaning back, seated
studio(sc, target_z=0.9, dist=5.0)
# warmer, living-room-ish backdrop like the mockup
bpy.data.materials['StudioFloor'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = hex_rgba('#1f4a2c')
sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = hex_rgba('#3a1e10')
result = {'objects': len(sc.objects)}
