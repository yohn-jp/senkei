"""Adapt inspected Blender Studio Snow v4.2 mesh topology; CC-BY-4.0.
No upstream code, drivers, controls, shaders or textures are executed/used.
See ../vendor/snow-v4.2/{provenance.json,LICENSE-CC-BY-4.0.txt}.
"""
from pathlib import Path
import bpy, math, bmesh
from mathutils import Vector, Matrix
import common

SOURCE=Path(__file__).resolve().parents[1]/'vendor/snow-v4.2/snow_v4.2.blend'
SCALE=1.75
# Senkei convention preserves shield on -X. Upstream .L is +X.
JOINTS={
 'pelvis':((0,0,1.52),(0,0,1.8)),
 'spine':((0,0,1.8),(0,0,2.45)),
 'head':((0,0,2.55),(0,0,3.12)),
}
for s,side in [(-1,'L'),(1,'R')]:
 JOINTS.update({
  'upper_arm.'+side:((s*.49,0,2.42),(s*.75,-.015,1.98)),
  'forearm.'+side:((s*.75,-.015,1.98),(s*.82,-.09,1.61)),
  'hand.'+side:((s*.82,-.09,1.61),(s*.84,-.09,1.39)),
  'thigh.'+side:((s*.22,0,1.52),(s*.22,-.015,.90)),
  'shin.'+side:((s*.22,-.015,.90),(s*.22,.015,.20)),
  'foot.'+side:((s*.22,.015,.20),(s*.22,-.24,.09)),
 })

def target_group(name):
 if not name.startswith('DEF-'): return None
 if name.endswith(('.L','.R')):
  side='R' if name.endswith('.L') else 'L'
  if 'UpperArm' in name: return 'upper_arm.'+side
  if 'Forearm' in name:return 'forearm.'+side
  if any(x in name for x in ['Wrist','Finger']):return 'hand.'+side
  if 'Thigh' in name:return 'thigh.'+side
  if 'Knee' in name:return 'shin.'+side
  if any(x in name for x in ['Foot','Toes']):return 'foot.'+side
 if any(x in name for x in ['Hip','Spine','RibCage']):return 'pelvis' if 'Hip' in name else 'spine'
 if any(x in name for x in ['Chest','Shoulder']):return 'spine'
 return 'head'

def rest_transform(group, source_bones):
 if group=='head':return Matrix.Identity(4)
 if group in ('pelvis','spine'):return Matrix.Diagonal((1.23,1.10,1,1))
 name,side=group.split('.'); upstream='L' if side=='R' else 'R'
 names={'upper_arm':('DEF-UpperArm_1.','DEF-UpperArm_2.'),'forearm':('DEF-Forearm_1.','DEF-Forearm_2.'),'thigh':('DEF-Thigh_1.','DEF-Thigh_2.'),'shin':('DEF-Knee_1.','DEF-Knee_2.'),'foot':('DEF-Foot.','DEF-Foot.'),'hand':('DEF-Wrist.','DEF-Wrist.')}
 a,b=names[name]
 first,last=source_bones[a+upstream],source_bones[b+upstream]
 start=first.head_local*SCALE; end=last.tail_local*SCALE
 if name=='hand':end=start+Vector(((1 if side=='R' else -1)*.22,0,0))
 dst_start,dst_end=map(Vector,JOINTS[group]); src_dir=end-start; dst_dir=dst_end-dst_start
 rot=src_dir.rotation_difference(dst_dir).to_matrix().to_4x4()
 # Scale only along longitudinal direction; preserve credible limb cross-section.
 axis=src_dir.normalized(); factor=dst_dir.length/src_dir.length
 stretch=Matrix.Identity(3)
 for i in range(3):
  for j in range(3):stretch[i][j]+=(factor-1)*axis[i]*axis[j]
 return Matrix.Translation(dst_start)@rot@stretch.to_4x4()@Matrix.Translation(-start)

def build(materials):
 selected=['GEO-snow-head','GEO-snow-hair_base','GEO-snow-eyebrows','GEO-snow-eye_anim','GEO-snow-body','GEO-snow-shirt','GEO-snow-pants','GEO-snow-shoes_base','GEO-snow-shoes_bottom']
 with bpy.data.libraries.load(str(SOURCE),link=False) as (src,dst):dst.objects=selected
 rig=bpy.data.objects.get('RIG-Snow'); source_bones=rig.data.bones
 transforms={g:rest_transform(g,source_bones) for g in JOINTS}
 for obj in dst.objects:
  bpy.context.collection.objects.link(obj);obj.hide_set(False);obj.hide_render=False;obj.hide_viewport=False
  obj.parent=None;obj.matrix_world=Matrix.Identity(4);obj.animation_data_clear()
  if obj.data.shape_keys:obj.shape_key_clear()
  # Keep source topology and actual symmetry. No unknown modifiers or scripts.
  for mod in list(obj.modifiers):
   if mod.type=='MIRROR' or (obj.name=='GEO-snow-body' and mod.type=='MASK' and mod.name=='Mask Body'):
    bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.modifier_apply(modifier=mod.name);obj.select_set(False)
   else:obj.modifiers.remove(mod)
  if obj.name=='GEO-snow-shirt':
   # Retain anatomical sleeves; remove the T-shirt torso concealed by armor.
   bm=bmesh.new();bm.from_mesh(obj.data)
   bmesh.ops.delete(bm,geom=[v for v in bm.verts if abs(v.co.x)<.21],context='VERTS')
   bm.to_mesh(obj.data);bm.free()
  groups={g.index:target_group(g.name) for g in obj.vertex_groups}
  source_groups={g.index:g.name for g in obj.vertex_groups}
  allweights=[]
  for v in obj.data.vertices:
   weights={}
   for member in v.groups:
    group=groups.get(member.group)
    if group:weights[group]=weights.get(group,0)+member.weight
   # Head and hair are a single rigid unit; retain imported anatomical surfaces.
   if any(x in obj.name for x in ['head','hair','eyebrow','eye_']):weights={'head':1}
   total=sum(weights.values())
   weights={g:w/total for g,w in weights.items()} if total else {'pelvis':1}
   co=v.co*SCALE
   # Close the fingers around an oval grip in the anatomical hand frame.
   fingerweights=[(source_groups.get(m.group,''),m.weight) for m in v.groups if 'DEF-Finger_' in source_groups.get(m.group,'')]
   if fingerweights:
    dominant=max(fingerweights,key=lambda x:x[1])[0]
    if 'Thumb' not in dominant:
     side='L' if dominant.endswith('.L') else 'R'; s=1 if side=='L' else -1
     bend_start=.756*SCALE; distance=max(0,abs(co.x)-bend_start)
     angle=min(2.5,distance/.060)
     co.x=s*(bend_start+.060*math.sin(angle));co.z-=.060*(1-math.cos(angle))
   v.co=sum(((transforms[g]@co)*w for g,w in weights.items()),Vector((0,0,0)))
   allweights.append(weights)
  obj.vertex_groups.clear()
  for group in JOINTS:
   vg=obj.vertex_groups.new(name=group)
   for i,weights in enumerate(allweights):
    if group in weights:vg.add([i],weights[group],'REPLACE')
  # Replace shaders and UDIM dependencies with a small, glTF-native palette.
  eye=obj.name=='GEO-snow-eye_anim'
  if eye:
   color=obj.data.color_attributes.new(name='EyePigment',type='FLOAT_COLOR',domain='CORNER')
   colors=[(.82,.84,.81,1),(.045,.17,.23,1),(.004,.006,.009,1)]
   for poly in obj.data.polygons:
    for li in poly.loop_indices:color.data[li].color=colors[min(poly.material_index,2)]
  mat=materials['eyes'] if eye else materials['hair'] if any(x in obj.name for x in ['hair','eyebrow']) else materials['skin'] if 'head' in obj.name else materials['cloth'] if 'shirt' in obj.name else materials['leather']
  obj.data.materials.clear();obj.data.materials.append(mat)
  for poly in obj.data.polygons:poly.material_index=0;poly.use_smooth=True
  # Spend subdivisions on face and hair silhouettes, not hidden boots / trousers.
  if obj.name in ['GEO-snow-head','GEO-snow-hair_base']:
   mod=obj.modifiers.new('Source subdivision silhouette','SUBSURF');mod.levels=1
   bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.modifier_apply(modifier=mod.name);obj.select_set(False)
  obj.name='F01 adapted Snow • '+obj.name.removeprefix('GEO-snow-')
  common.PARTS.append(obj)
 # Drop upstream helper data and embedded text. Only adapted meshes enter output.
 keep=set(common.PARTS)
 for obj in list(bpy.data.objects):
  if obj not in keep:bpy.data.objects.remove(obj,do_unlink=True)
 for text in list(bpy.data.texts):bpy.data.texts.remove(text)
 return JOINTS
