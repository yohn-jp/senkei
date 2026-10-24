import bpy,math,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
from mathutils import Vector
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/sources/vendor/snow-v4.2/snow_v4.2.blend'),use_scripts=False)
keep=['GEO-snow-head','GEO-snow-hair_base','GEO-snow-eyebrows','GEO-snow-eye_anim','GEO-snow-body','GEO-snow-shirt','GEO-snow-pants','GEO-snow-shoes_base','GEO-snow-shoes_bottom']
matcolors={'skin':(.53,.29,.19),'hair':(.05,.028,.02),'shirt':(.07,.13,.24),'pants':(.03,.04,.065),'shoes':(.06,.04,.028),'white':(.88,.88,.86),'iris':(.07,.16,.19),'pupil':(.005,.006,.008)}
mats={}
for n,c in matcolors.items():
 m=bpy.data.materials.new(n);m.diffuse_color=(*c,1);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*c,1);mats[n]=m
for o in bpy.data.objects:
 o.hide_render=o.name not in keep
 if o.name in keep:
  for c in o.users_collection: c.hide_render=False
  for m in o.modifiers:
   if m.type not in {'MIRROR','SUBSURF'} and not (o.name=='GEO-snow-body' and m.name=='Mask Body'):m.show_viewport=False;m.show_render=False
   if m.type=='SUBSURF':m.levels=1;m.render_levels=1
  if o.name=='GEO-snow-eye_anim':
   o.data.materials.clear()
   for n in ['white','iris','pupil']:o.data.materials.append(mats[n])
  else:
   n='skin' if o.name in ['GEO-snow-head','GEO-snow-body'] else 'hair' if any(x in o.name for x in ['hair','eyebrow']) else 'shirt' if 'shirt' in o.name else 'pants' if 'pants' in o.name else 'shoes'
   o.data.materials.clear();o.data.materials.append(mats[n])
   for p in o.data.polygons:p.material_index=0
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.world.color=(.12,.12,.12)
scene.render.resolution_x=900;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
for name,loc,energy,size in [('Key',(-3,-4,5),400,4),('Fill',(3,-2,3),200,3),('Rim',(1,3,4),500,3)]:
 d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.size=size;o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
d=bpy.data.cameras.new('Inspect');o=bpy.data.objects.new('Inspect',d);scene.collection.objects.link(o);scene.camera=o;d.type='ORTHO'
for name,loc,target,scale in [('source-snow-body',(3,-6,2.6),(0,0,.95),2.25),('source-snow-face',(2,-6,2.6),(0,-.02,1.57),.7)]:
 o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();d.ortho_scale=scale;scene.render.filepath=str(ROOT/'docs/evidence/f01/review'/f'{name}.png');bpy.ops.render.render(write_still=True)
