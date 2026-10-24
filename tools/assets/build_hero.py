"""Blender CLI production entry point. Sources, GLBs, manifest and evidence are separate."""
import bpy, sys, math, json, argparse, hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'assets/sources/heroes'))
import common, importlib, re
p=argparse.ArgumentParser(); p.add_argument('--render',action='store_true'); p.add_argument('--hero',default='f01'); p.add_argument('--views',default='all')
args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
HERO=args.hero
if not re.fullmatch(r'[fr]0[1-6]', HERO): raise ValueError('Expected hero key f01–f06 / r01–r06')
definition=importlib.import_module(HERO); spec=definition.SPEC
OUT=ROOT/'assets/generated'/HERO; OUT.mkdir(parents=True,exist_ok=True)
EVIDENCE=ROOT/'docs/evidence'/HERO; EVIDENCE.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene; scene.render.fps=30
meta=definition.build(); common.recalc_normals()
# Shared v2 skeleton fitted to the inspected anatomical base.
parents={'pelvis':'root','spine':'pelvis','head':'spine'}
for side in ['L','R']:
    parents.update({'upper_arm.'+side:'spine','forearm.'+side:'upper_arm.'+side,'hand.'+side:'forearm.'+side,'thigh.'+side:'pelvis','shin.'+side:'thigh.'+side,'foot.'+side:'shin.'+side})
bones=[('root',(0,0,0),(0,0,.35),None)]+[(name,head,tail,parents[name]) for name,(head,tail) in definition.JOINTS.items()]
bones += [('cape.upper',(0,.32,2.40),(0,.55,1.60),'spine'),('cape.lower',(0,.55,1.60),(0,.65,.60),'cape.upper')]
data=bpy.data.armatures.new('Senkei humanoid v2'); rig=bpy.data.objects.new('Senkei humanoid v2',data); scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig; rig.select_set(True); bpy.ops.object.mode_set(mode='EDIT')
for name,head,tail,parent in bones:
    b=data.edit_bones.new(name); b.head=head; b.tail=tail
    if parent: b.parent=data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT'); rig.select_set(False)
hero=common.bind_and_join(rig,spec['meshName'])
# Key every bone at every sample so exported clips cannot inherit another clip's pose.
clips=[('Idle',90,True),('Walk',30,True),('Attack',42,False),('Skill',60,False),('Death',66,False)]
for name,end,loop in clips:
    rig.animation_data_clear(); action=bpy.data.actions.new(name); rig.animation_data_create(); rig.animation_data.action=action
    for frame in sorted(set(list(range(1,end+1,3))+[end])):
        t=(frame-1)/(end-1); wave=math.sin(t*2*math.pi); pulse=math.sin(t*math.pi)
        for b in rig.pose.bones:
            b.rotation_mode='XYZ'; b.rotation_euler=(0,0,0); b.location=(0,0,0); b.scale=(1,1,1)
        pb=rig.pose.bones
        if name=='Idle':
            pb['spine'].rotation_euler.x=.018*wave; pb['head'].rotation_euler.z=.025*wave
            pb['upper_arm.R'].rotation_euler.x=.025*wave
        elif name=='Walk':
            pb['pelvis'].location.y=-.09*abs(wave)
            for s,side in [(-1,'L'),(1,'R')]:
                stride=wave*s
                pb['thigh.'+side].rotation_euler.x=.33*stride
                pb['shin.'+side].rotation_euler.x=-.48*max(0,stride)
                pb['foot.'+side].rotation_euler.x=.15*stride
                pb['upper_arm.'+side].rotation_euler.x=-.14*stride
            pb['spine'].rotation_euler.y=.025*wave
        elif name=='Attack':
            # Wind-up then descending cut, returning to the exact guard pose.
            if t<.38: swing=math.sin(t/.38*math.pi/2)
            elif t<.68: swing=1-1.3*((t-.38)/.3)
            else: swing=-.3*(1-(t-.68)/.32)
            pb['upper_arm.R'].rotation_euler.x=-1.65*swing
            pb['forearm.R'].rotation_euler.x=-.28*max(0,swing)
            pb['spine'].rotation_euler.y=.2*pulse
            pb['spine'].rotation_euler.z=-.15*swing
            pb['upper_arm.L'].rotation_euler.x=-.12*pulse
        elif name=='Skill':
            pb['upper_arm.R'].rotation_euler.x=-1.5*pulse
            pb['upper_arm.R'].rotation_euler.z=-.35*pulse
            pb['forearm.R'].rotation_euler.x=-.3*pulse
            pb['head'].rotation_euler.x=-.08*pulse
            pb['upper_arm.L'].rotation_euler.x=-.2*pulse
        elif name=='Death':
            fall=max(0,min(1,(t-.15)/.7)); fall=fall*fall*(3-2*fall)
            pb['root'].rotation_euler.x=-1.5*fall
            pb['root'].location.z=.24*fall
            pb['upper_arm.R'].rotation_euler.z=.4*fall
            pb['upper_arm.L'].rotation_euler.z=-.15*fall
            pb['head'].rotation_euler.x=.12*fall
        for b in pb:
            b.keyframe_insert('rotation_euler',frame=frame,group=b.name)
            b.keyframe_insert('location',frame=frame,group=b.name)
    action.use_fake_user=True
    # NLA tracks establish one glTF clip per action in Blender 4.4+ / 5.x.
    track=rig.animation_data.nla_tracks.new(); track.name=name
    strip=track.strips.new(name,1,action); strip.action_frame_start=1; strip.action_frame_end=end
    rig.animation_data.action=None
    # Keep prior tracks separately; stash below across animation_data_clear calls.
    if name=='Idle': actions=[]
    actions.append(action)
rig.animation_data_clear(); rig.animation_data_create()
for action in actions:
    track=rig.animation_data.nla_tracks.new(); track.name=action.name
    track.strips.new(action.name,1,action)
scene.frame_set(1)
# Save source with neutral pose and all actions, before setting up photographic stage.
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/f'{HERO}.blend'))
manifest={'schemaVersion':1,'appearanceKey':spec['appearanceKey'],'heroId':spec['heroId'],'displayName':meta['title'],'generator':{'entry':'tools/assets/build_hero.py','version':2,'blender':bpy.app.version_string},'coordinates':{'gltfUp':'Y','front':'+Z','unit':'metre'},'rig':'senkei.humanoid.v2','animations':[{'name':n,'loop':l,'duration':(e-1)/30,'start':'guard','end':'guard' if n!='Death' else 'fallen; clamp last frame'} for n,e,l in clips],'materials':[m.name for m in hero.data.materials],'license':'CC-BY-4.0 AND Apache-2.0','attribution':'Snow Rig (CC) Blender Foundation | studio.blender.org; adapted for Senkei','provenance':'assets/sources/vendor/snow-v4.2/provenance.json','sources':['assets/sources/heroes/common.py','assets/sources/heroes/snow_base.py',f'assets/sources/heroes/{HERO}.py','assets/sources/vendor/snow-v4.2/snow_v4.2.blend','assets/sources/vendor/snow-v4.2/provenance.json','tools/assets/build_hero.py'],'lods':[]}
manifest['sourceHashes']={path:hashlib.sha256((ROOT/path).read_bytes()).hexdigest() for path in manifest['sources']}
for lod,ratio in [('detail',1),('battle',.12)]:
    bpy.context.view_layer.objects.active=hero
    if lod=='battle':
        dec=hero.modifiers.new('Battle silhouette reduction','DECIMATE'); dec.ratio=ratio
        bpy.ops.object.modifier_apply(modifier=dec.name)
    bpy.ops.object.select_all(action='DESELECT'); hero.select_set(True); rig.select_set(True)
    path=OUT/f'{HERO}-{lod}.glb'
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_skins=True,export_yup=True,export_force_sampling=True,export_anim_slide_to_zero=True)
    hero.data.calc_loop_triangles()
    manifest['lods'].append({'level':lod,'url':f'/assets/heroes/{HERO}/{HERO}-{lod}.glb','file':str(path.relative_to(ROOT)),'triangles':len(hero.data.loop_triangles),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
(ROOT/f'assets/manifests/{HERO}.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
# Render the original detail model, rather than the destructively decimated LOD.
if args.render:
    bpy.ops.wm.open_mainfile(filepath=str(OUT/f'{HERO}.blend'))
    scene=bpy.context.scene; rig=bpy.data.objects['Senkei humanoid v2']
    for tr in rig.animation_data.nla_tracks: tr.mute=True
    rig.animation_data.action=bpy.data.actions['Idle']; scene.frame_set(1)
    scene.render.engine='CYCLES'; scene.cycles.samples=32; scene.cycles.use_denoising=True
    scene.render.resolution_x=1000; scene.render.resolution_y=1100; scene.render.resolution_percentage=100
    scene.world.color=(.15,.15,.15)
    scene.view_settings.view_transform='AgX'
    groundmat=common.material('Studio slate',(.018,.026,.039),.15,.55)
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,.01)); ground=bpy.context.object; ground.data.materials.append(groundmat)
    # Low podium, separate from exported character.
    bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=1.30,depth=.12,location=(0,0,-.045)); bpy.context.object.data.materials.append(common.material('Plinth',(.045,.065,.09),.4,.38))
    def aim(obj,target): obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    def light(name,loc,power,color,size):
        d=bpy.data.lights.new(name,'AREA'); d.energy=power; d.color=color; d.shape='DISK'; d.size=size
        o=bpy.data.objects.new(name,d); scene.collection.objects.link(o); o.location=loc; aim(o,(0,0,1.7))
    light('Warm key',(-3,-4,6),650,(1,.87,.72),4)
    light('Cool fill',(3,-2,3.5),420,(.55,.75,1),3)
    light('Silver rim',(1,3,5),900,(.65,.8,1),3)
    d=bpy.data.cameras.new('Evidence camera'); cam=bpy.data.objects.new('Evidence camera',d); scene.collection.objects.link(cam); scene.camera=cam
    views=[('front',(0,-7,2.9),(0,0,1.65),4.25),('side',(7,0,2.9),(0,0,1.65),4.25),('back',(0,7,2.9),(0,0,1.65),4.25),('three-quarter',(5,-7,4),(0,0,1.65),4.4),('close-up',(2.6,-6,3.3),(0,0,2.65),1.65),('hero-detail',(4.4,-8,3.5),(0,0,1.66),3.9),('battlefield',(7,-9,10),(0,0,1.2),13)]
    d.type='ORTHO'
    for name,loc,target,scale in views:
        if args.views!='all' and name not in args.views.split(','): continue
        cam.location=loc; aim(cam,target); d.ortho_scale=scale
        scene.render.filepath=str(EVIDENCE/f'blender-{name}.png'); bpy.ops.render.render(write_still=True)
    # Pose review, using maximum gesture / terminal death frames.
    for name,frame in [('Idle',23),('Walk',8),('Attack',16),('Skill',30),('Death',66)]:
        if args.views!='all' and name.lower() not in args.views.split(','): continue
        rig.animation_data.action=bpy.data.actions[name]; scene.frame_set(frame)
        cam.location=(4,-7,4); aim(cam,(0,0,1.5)); d.ortho_scale=4.8
        scene.render.filepath=str(EVIDENCE/f'blender-pose-{name.lower()}.png'); bpy.ops.render.render(write_still=True)
print(f'{HERO.upper()}_BUILD_OK',json.dumps(manifest['lods']))
