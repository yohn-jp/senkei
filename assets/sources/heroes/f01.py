"""F01 revision 2: inspected Snow anatomical mesh + fitted original commander armor.
Adapted anatomy/hair: Blender Studio, CC-BY-4.0. Original additions: Apache-2.0.
"""
import bpy,math
from math import sin,cos,pi
from mathutils import Vector
from common import loft,plate,tube,material,mesh,PARTS
from snow_base import build as build_anatomy,JOINTS
SPEC={'heroId':'F01','appearanceKey':'hero.f01.aegis-marshal.v1','meshName':'F01 • Aegis Marshal • Snow adaptation'}

def color_palette():
 m={
 'silver':material('Steel • satin forged plate',(.38,.48,.56),.82,.29),
 'gold':material('Gold • brass officer trim',(.55,.30,.085),.78,.32),
 'blue':material('Azure • shield enamel',(.017,.065,.15),.35,.28),
 'cloth':material('Azure • heavy wool',(.018,.043,.10),0,.83),
 'leather':material('Leather • graphite straps',(.024,.018,.017),0,.66),
 'skin':material('Skin • warm tan',(.47,.245,.145),0,.51),
 'hair':material('Hair • silver ash',(.20,.25,.29),0,.48),
 'eyes':material('Eyes • painted iris',(.8,.82,.8),0,.26),
 }
 eye=m['eyes'];attr=eye.node_tree.nodes.new('ShaderNodeVertexColor');attr.layer_name='EyePigment';eye.node_tree.links.new(attr.outputs['Color'],eye.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
 im=bpy.data.images.new('Senkei wool weave',width=128,height=128);pixels=[]
 for y in range(128):
  for x in range(128):
   f=.85+.15*((x%4<2)^(y%4<2));pixels.extend((.065*f,.12*f,.21*f,1))
 im.pixels=pixels;im.pack();tex=m['cloth'].node_tree.nodes.new('ShaderNodeTexImage');tex.image=im;m['cloth'].node_tree.links.new(tex.outputs['Color'],m['cloth'].node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
 return m

def round_shell(name,rings,mat,bone,n=32):
 return loft(name,rings,mat,bone,n=n,smooth=True)

def drape(name,vertices,faces,mat,weights,thickness=.016):
 obj=mesh(name,vertices,faces,mat,None,True)
 for bone in sorted({b for ws in weights for b in ws}):
  vg=obj.vertex_groups.new(name=bone)
  for i,ws in enumerate(weights):
   if bone in ws:vg.add([i],ws[bone],'REPLACE')
 mod=obj.modifiers.new('Tailored hem thickness','SOLIDIFY');mod.thickness=thickness
 bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.modifier_apply(modifier=mod.name);obj.select_set(False)
 return obj

def build():
 m=color_palette();build_anatomy(m)
 steel,gold,blue,cloth,leather=[m[n] for n in ['silver','gold','blue','cloth','leather']]
 # Curved chest: neckline, collarbone sweep, expanded chest and narrow waist.
 round_shell('Cuirass • shaped breast and waist',[(1.76,0,.015,.30,.205),(1.9,0,.005,.32,.22),(2.12,0,0,.40,.255),(2.30,0,.015,.44,.255),(2.41,0,.025,.37,.205),(2.46,0,.03,.20,.16)],steel,'spine')
 round_shell('Plackart • flared abdominal edge',[(1.73,0,.005,.335,.225),(1.81,0,0,.32,.235),(1.96,0,-.005,.32,.235)],steel,'spine')
 # Cuirass rolled neckline follows exposed neck; no closed soup-bowl gorget.
 tube('Cuirass gold neckline',[(-.32,-.13,2.43),(-.2,-.20,2.40),(0,-.222,2.37),(.2,-.20,2.40),(.32,-.13,2.43)],.014,gold,'spine',n=10)
 # Enamel inset is fitted on the convex central chest, with restrained heraldry.
 plate('Breast • officer escutcheon',[(-.15,-.265,2.28),(0,-.282,2.33),(.15,-.265,2.28),(.13,-.276,2.12),(0,-.288,2.02),(-.13,-.276,2.12)],.018,blue,'spine',.015)
 for s in [-1,1]:
  tube('Breast • branching brass line',[(s*.33,-.18,2.30),(s*.23,-.245,2.21),(0,-.307,2.08)],.009,gold,'spine')
  # Visible straps and buckles connect pauldron, cuirass and mantle.
  tube('Shoulder leather suspension',[(s*.25,-.13,2.43),(s*.35,0,2.49),(s*.31,.24,2.43)],.032,leather,'spine',n=8)
  plate('Shoulder brass buckle',[(s*.27-.035,-.155,2.40),(s*.27+.035,-.155,2.40),(s*.27+.035,-.155,2.46),(s*.27-.035,-.155,2.46)],.023,gold,'spine',.006)
 # One articulated sculptural cap per shoulder, rather than three stacked bowls.
 for s,side in [(-1,'L'),(1,'R')]:
  upper,fore,hand='upper_arm.'+side,'forearm.'+side,'hand.'+side
  x=s*.53;big=side=='L';w=.29 if big else .235
  round_shell('Pauldron • command shell' if big else 'Pauldron • sword shell',[(2.23,x+s*.055,.015,w*.82,.225),(2.35,x+s*.035,.025,w,.255),(2.49,x,.03,w*.84,.23),(2.57,x-s*.025,.03,w*.55,.16),(2.61,x-s*.04,.03,.07,.07)],steel,upper,n=24)
  edge=[(x+s*.055+w*.82*cos(a),.015+.225*sin(a),2.235+.022*cos(a)) for a in [j*2*pi/40 for j in range(41)]]
  tube('Pauldron • fitted brass lip',edge,.013,gold,upper,n=10)
  if big:
   plate('Command • raised azure crest',[(x-.10,-.235,2.48),(x-.025,-.25,2.62),(x+.08,-.235,2.48),(x+.015,-.27,2.36)],.025,blue,upper,.012)
   tube('Command crest • brass spine',[(x-.01,-.28,2.40),(x-.02,-.27,2.57)],.012,gold,upper)
  # Sleeves remain source topology, steel upper-arm plates sit above cloth.
  plate('Rerebrace • curved exterior',[(s*.61,-.12,2.25),(s*.78,-.12,2.20),(s*.83,-.14,2.05),(s*.70,-.17,1.99)],.055,steel,upper,.03)
  round_shell('Couter • enclosed elbow',[(1.92,s*.76,-.015,.10,.12),(2.00,s*.75,-.015,.15,.155),(2.07,s*.73,0,.11,.12)],steel,fore,n=20)
  round_shell('Vambrace • tapered arm shell',[(1.64,s*.815,-.08,.10,.105),(1.73,s*.80,-.065,.105,.12),(1.88,s*.77,-.035,.13,.14),(1.94,s*.76,-.02,.115,.125)],steel,fore,n=24)
  tube('Vambrace • gold arris',[(s*.805,-.193,1.72),(s*.78,-.181,1.87)],.010,gold,fore)
  # A fitted glove covers the wrist, imported bent finger topology supplies grip.
  round_shell('Gauntlet • cuff',[(1.55,s*.83,-.09,.085,.09),(1.64,s*.815,-.085,.10,.105)],leather,hand,n=20)
 # Belt and split cloth panels drape around the imported pelvis and thighs.
 round_shell('Belt • fitted leather',[(1.69,0,0,.338,.23),(1.78,0,0,.335,.23)],leather,'pelvis')
 plate('Belt • commander buckle',[(-.067,-.255,1.70),(.067,-.255,1.70),(.067,-.255,1.78),(-.067,-.255,1.78)],.035,gold,'pelvis',.01)
 for s,side in [(-1,'L'),(1,'R')]:
  # A curved 2D grid gives tabard folds / thickness instead of a rigid flat card.
  vs=[];ws=[];cols=9;rows=10
  for i in range(rows):
   t=i/(rows-1)
   for j in range(cols):
    u=j/(cols-1);x=s*(.035+.27*u+.07*t*u)
    vs.append((x,-.245-.035*t-.028*sin(pi*u)*sin(pi*t),1.72-.60*t+.08*t*(u-.5)))
    ws.append({'pelvis':1-t*.9,'thigh.'+side:t*.9})
  fs=[(i*cols+j,i*cols+j+1,(i+1)*cols+j+1,(i+1)*cols+j)for i in range(rows-1)for j in range(cols-1)]
  drape('Tabard • tailored split panel',vs,fs,cloth,ws)
  tube('Tabard • embroidered hem',vs[-cols:],.009,gold,'thigh.'+side)
  # Compact lateral hip guard leaves room for leg articulation.
  plate('Hip • suspended tasset',[(s*.27,-.13,1.68),(s*.39,-.075,1.65),(s*.42,-.10,1.39),(s*.30,-.19,1.38)],.05,steel,'thigh.'+side,.025)
  x=s*.22
  plate('Cuisses • shaped thigh guard',[(x-.12,-.14,1.44),(x+.12,-.14,1.44),(x+.10,-.17,1.07),(x,-.20,1.00),(x-.10,-.17,1.07)],.08,steel,'thigh.'+side,.03)
  round_shell('Knee • articulated poleyn',[(.83,x,-.02,.095,.11),(.91,x,-.04,.14,.16),(.98,x,-.03,.10,.11)],steel,'shin.'+side,n=20)
  round_shell('Greave • tapered shin enclosure',[(.27,x,.02,.095,.11),(.38,x,.015,.105,.125),(.62,x,.005,.13,.15),(.80,x,-.005,.12,.135)],steel,'shin.'+side,n=24)
  tube('Greave • brass central ridge',[(x,-.105,.30),(x,-.155,.61),(x,-.145,.77)],.011,gold,'shin.'+side)
  # Source boots retain shaped toes and ankle transitions; armor caps cover toe.
  round_shell('Sabatons • forged toe cap',[(.05,x,-.15,.145,.23),(.11,x,-.155,.15,.235),(.19,x,-.14,.125,.19)],steel,'foot.'+side,n=24)
 # A three-dimensional mantle with shoulder yoke, sweeping volume and sculpted folds.
 cols,rows=33,25;vs=[];ws=[]
 for i in range(rows):
  t=i/(rows-1)
  for j in range(cols):
   u=j/(cols-1);a=2*u-1
   x=a*(.36+.43*t)
   y=.285+.34*t+.14*sin(pi*t)+(.035+.065*t)*sin(u*6*pi+.35*t)
   z=2.43-1.84*t+.06*abs(a)-.07*t*cos(u*2*pi)
   vs.append((x,y,z))
   if t<.2:ws.append({'spine':1-t/.2,'cape.upper':t/.2})
   elif t<.58:ws.append({'cape.upper':1-(t-.2)/.38,'cape.lower':(t-.2)/.38})
   else:ws.append({'cape.lower':1})
 fs=[(i*cols+j,i*cols+j+1,(i+1)*cols+j+1,(i+1)*cols+j)for i in range(rows-1)for j in range(cols-1)]
 drape('Mantle • sculpted flowing wool',vs,fs,cloth,ws)
 # Borders carry the same weights as cape vertices, so they cannot separate in motion.
 for indices in [[i*cols for i in range(rows)],[i*cols+cols-1 for i in range(rows)],list(range((rows-1)*cols,rows*cols))]:
  obj=tube('Mantle • gold woven selvage',[vs[i]for i in indices],.009,gold,None,n=6)
  for bone in ['spine','cape.upper','cape.lower']:
   vg=obj.vertex_groups.new(name=bone)
   for k,index in enumerate(indices):
    if bone in ws[index]:vg.add(list(range(k*6,(k+1)*6)),ws[index][bone],'REPLACE')
 # Shield: coherent silver / azure / brass kite silhouette, convex front and straps.
 cx,cy,cz=-.94,-.39,1.72
 outline=[(-.32,0,.35),(-.24,0,.49),(.24,0,.49),(.32,0,.35),(.27,0,-.13),(0,-.07,-.57),(-.27,0,-.13)]
 plate('Shield • forged kite rim',[(cx+x,cy+y,cz+z)for x,y,z in outline],.085,steel,'hand.L',.025)
 inset=[(cx+x*.88,cy+y-.027,cz+z*.90)for x,y,z in outline];mesh('Shield • convex azure field',inset+[(cx,cy-.13,cz+.06)],[(j,(j+1)%7,7)for j in range(7)],blue,'hand.L')
 tube('Shield • brass rolled border',inset+[inset[0]],.012,gold,'hand.L')
 for k in range(3):
  z=cz+.27-k*.17
  plate('Shield • command chevron',[(cx-.17,cy-.11,z-.055),(cx,cy-.16,z+.055),(cx+.17,cy-.11,z-.055),(cx+.16,cy-.11,z-.10),(cx,cy-.16,z),(cx-.16,cy-.11,z-.10)],.015,gold,'hand.L',.006)
 for z in [cz-.10,cz+.18]:tube('Shield • actual forearm strap',[(cx-.18,cy+.09,z),(cx-.12,cy+.20,z),(cx+.12,cy+.20,z),(cx+.18,cy+.09,z)],.028,leather,'hand.L')
 # Sword fits the adapted hand; diamond-section blade has modeled edges and fuller.
 sx,sy=.85,-.12
 blade=[(sx,sy-.025,.32),(sx-.075,sy,.53),(sx-.075,sy,1.35),(sx,sy-.045,1.40),(sx+.075,sy,1.35),(sx+.075,sy,.53)]
 plate('Sword • tempered diamond blade',blade,.045,steel,'hand.R',.008)
 tube('Sword • blue fuller',[(sx,sy-.049,.52),(sx,sy-.050,1.30)],.006,blue,'hand.R')
 plate('Sword • swept guard',[(sx-.19,sy-.01,1.35),(sx-.16,sy-.01,1.42),(sx+.16,sy-.01,1.42),(sx+.19,sy-.01,1.35),(sx+.13,sy-.01,1.38),(sx-.13,sy-.01,1.38)],.065,gold,'hand.R',.012)
 tube('Sword • wrapped leather grip',[(sx,sy,1.41),(sx,sy,1.68)],.033,leather,'hand.R',n=12)
 for k in range(6):tube('Sword • grip bands',[(sx+.034*cos(a),sy+.034*sin(a),1.43+k*.038)for a in [j*2*pi/12 for j in range(13)]],.004,gold,'hand.R',n=6)
 round_shell('Sword • faceted pommel',[(1.69,sx,sy,.045,.04),(1.75,sx,sy,.055,.045),(1.79,sx,sy,.02,.02)],gold,'hand.R',n=8)
 return {'height':3.4,'title':'Aegis Marshal (制作仮称)','palette':['azure','silver','gold']}
