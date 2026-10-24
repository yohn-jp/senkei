"""Original parametric hero mesh vocabulary. Z up, front -Y, metres.
Armor uses shaped lofts / bevelled polygon shells; all vertices carry rig weights.
"""
import bpy, math
from mathutils import Vector
from math import sin, cos, pi

PARTS = []
RIG = None

def mesh(name, vertices, faces, mat, bone, smooth=False, bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    uv = data.uv_layers.new(name='UVMap')
    # Deterministic planar UVs; lofts override these with cylindrical unwraps.
    for poly in data.polygons:
        poly.use_smooth = smooth
        for li in poly.loop_indices:
            v = data.vertices[data.loops[li].vertex_index].co
            uv.data[li].uv = (v.x * 2, v.z * 2)
    if bevel:
        mod = obj.modifiers.new('Forged edge radius', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        obj.select_set(False)
    if bone:
        obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    PARTS.append(obj)
    return obj

def loft(name, rings, mat, bone, n=16, smooth=True):
    # rings: z, center-x, center-y, half-width, half-depth
    vs = [(x+rx*cos(2*pi*j/n), y+ry*sin(2*pi*j/n), z)
          for z,x,y,rx,ry in rings for j in range(n)]
    fs = [tuple(reversed(range(n)))]
    fs += [(i*n+j, i*n+(j+1)%n, (i+1)*n+(j+1)%n, (i+1)*n+j)
           for i in range(len(rings)-1) for j in range(n)]
    fs.append(tuple((len(rings)-1)*n+j for j in range(n)))
    obj = mesh(name, vs, fs, mat, bone, smooth)
    uv = obj.data.uv_layers.active
    for poly in obj.data.polygons:
        for li in poly.loop_indices:
            vi = obj.data.loops[li].vertex_index
            uv.data[li].uv = ((vi % n)/n, (vi//n)/(len(rings)-1))
    return obj

def ellipsoid(name, center, radii, mat, bone, n=20, rows=12):
    # Lathed mesh with non-degenerate pole fans.
    x,y,z = center; a,b,c = radii
    vs = [(x,y,z-c)]
    for i in range(1,rows):
        t = -pi/2 + pi*i/rows
        vs += [(x+a*cos(t)*cos(j*2*pi/n),y+b*cos(t)*sin(j*2*pi/n),z+c*sin(t)) for j in range(n)]
    top = len(vs); vs.append((x,y,z+c))
    fs = [(0,1+(j+1)%n,1+j) for j in range(n)]
    for i in range(rows-2):
        fs += [(1+i*n+j,1+i*n+(j+1)%n,1+(i+1)*n+(j+1)%n,1+(i+1)*n+j) for j in range(n)]
    fs += [(1+(rows-2)*n+j,1+(rows-2)*n+(j+1)%n,top) for j in range(n)]
    return mesh(name,vs,fs,mat,bone,True)

def plate(name, outline, depth, mat, bone, bevel=.018):
    # Outline in 3D, extrusion toward +Y; front normal -Y after recalc.
    n=len(outline); vs=outline+[(x,y+depth,z) for x,y,z in outline]
    fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]
    fs += [(j,(j+1)%n,(j+1)%n+n,j+n) for j in range(n)]
    return mesh(name,vs,fs,mat,bone,False,bevel)

def tube(name, points, radius, mat, bone, n=8):
    vs=[]
    for i,p in enumerate(points):
        tangent = Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
        tangent.normalize()
        u=tangent.cross(Vector((0,1,0)))
        if u.length < .01: u=tangent.cross(Vector((1,0,0)))
        u.normalize(); v=tangent.cross(u).normalized()
        vs += [tuple(Vector(p)+radius*(u*cos(j*2*pi/n)+v*sin(j*2*pi/n))) for j in range(n)]
    fs=[tuple(reversed(range(n))),tuple((len(points)-1)*n+j for j in range(n))]
    fs += [(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(len(points)-1) for j in range(n)]
    return mesh(name,vs,fs,mat,bone,True)

def material(name, color, metallic=0, rough=.5):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Metallic'].default_value=metallic; bs.inputs['Roughness'].default_value=rough
    return m

def recalc_normals():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in PARTS:
        bpy.context.view_layer.objects.active=obj; obj.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
        obj.select_set(False)

def bind_and_join(rig, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in PARTS: o.select_set(True)
    bpy.context.view_layer.objects.active=PARTS[0]; bpy.ops.object.join()
    hero=bpy.context.object; hero.name=name
    mod=hero.modifiers.new('Senkei humanoid v1','ARMATURE'); mod.object=rig
    # Keep skinned mesh at scene root (glTF skinning transforms come from joints).
    return hero
