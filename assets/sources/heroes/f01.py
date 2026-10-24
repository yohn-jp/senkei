"""F01 original character definition. Run through tools/assets/build_hero.py."""
import bpy, math
from math import sin, cos, pi
from common import loft, plate, tube, ellipsoid, material, mesh

SPEC = {'heroId': 'F01', 'appearanceKey': 'hero.f01.aegis-marshal.v1', 'meshName': 'F01 • Aegis Marshal'}

def build():
    silver=material('Silver • tempered steel',(.48,.62,.72),.82,.28)
    edge=material('Silver • polished edges',(.78,.86,.9),.88,.22)
    gold=material('Gold • officer insignia',(.64,.36,.09),.78,.3)
    blue=material('Azure • enamel',(.018,.095,.25),.45,.28)
    cloth=material('Azure • woven wool',(.025,.075,.16),0,.88)
    leather=material('Leather • oxblood',(.065,.027,.018),0,.7)
    dark=material('Joint • graphite',(.025,.039,.052),.45,.5)
    skin=material('Skin • warm bronze',(.52,.28,.16),0,.55)
    hair=material('Hair • ash silver',(.13,.17,.20),.05,.7)
    shadow=material('Face • warm shadow',(.12,.047,.026),0,.72)
    white=material('Eyes • ivory',(.76,.81,.76),0,.35)
    iris=material('Eyes • slate blue',(.035,.19,.25),0,.25)
    # Original woven texture, embedded in GLBs. No downloaded images.
    im=bpy.data.images.new('Senkei original azure weave',width=128,height=128)
    pix=[]
    for y in range(128):
        for x in range(128):
            t=.8+.2*((x%4<2)^(y%4<2))+.04*sin(x*.31+y*.73)
            pix.extend((.11*t,.22*t,.37*t,1))
    im.pixels=pix; im.pack()
    nodes=cloth.node_tree.nodes; tex=nodes.new('ShaderNodeTexImage'); tex.image=im
    cloth.node_tree.links.new(tex.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
    # Anatomical silhouette: tapered waist, expanded ribcage, layered breastplate.
    loft('Quilted torso',[(1.65,0,.015,.29,.18),(1.9,0,0,.32,.21),(2.22,0,0,.44,.235),(2.44,0,0,.45,.2),(2.53,0,0,.24,.17)],dark,'spine')
    loft('Articulated cuirass',[(1.86,0,-.015,.31,.22),(2.02,0,-.015,.35,.255),(2.24,0,0,.47,.28),(2.4,0,.005,.45,.23),(2.46,0,0,.32,.19)],silver,'spine',n=12,smooth=False)
    # Central enamel shield and engraved branching gold lines on chest.
    plate('Heraldic breast inset',[(-.23,-.258,2.36),(0,-.304,2.42),(.23,-.258,2.36),(.18,-.29,2.16),(0,-.304,2.03),(-.18,-.29,2.16)],.018,blue,'spine',.012)
    for s in [-1,1]:
        tube('Cuirass inlay',[(s*.37,-.19,2.39),(s*.28,-.26,2.29),(s*.15,-.31,2.22),(0,-.32,2.13)],.012,gold,'spine')
    plate('Officer star',[(0,-.33,2.35),(.034,-.33,2.29),(.09,-.33,2.28),(.034,-.33,2.25),(0,-.33,2.18),(-.034,-.33,2.25),(-.09,-.33,2.28),(-.034,-.33,2.29)],.015,gold,'spine',.004)
    for z,rx in [(1.86,.325),(1.94,.34)]:
        loft('Abdominal articulated lame',[(z,0,0,rx,.225),(z+.07,0,0,rx+.02,.235)],edge,'spine',n=12,smooth=False)
    loft('Officer leather belt',[(1.73,0,0,.335,.225),(1.84,0,0,.34,.23)],leather,'pelvis',n=16)
    plate('Belt buckle',[(-.08,-.247,1.75),(.08,-.247,1.75),(.08,-.247,1.84),(-.08,-.247,1.84)],.04,gold,'pelvis',.008)
    loft('Pelvis padded layer',[(1.52,0,0,.34,.2),(1.75,0,0,.31,.2)],dark,'pelvis')
    # Split tabard in custom tapered cloth sheets, trimmed with gold.
    for s in [-1,1]:
        outline=[(s*.035,-.242,1.77),(s*.28,-.22,1.73),(s*.38,-.22,1.22),(s*.12,-.29,1.08),(s*.035,-.28,1.23)]
        plate('Split azure tabard',outline,.028,cloth,'thigh.'+('L' if s<0 else 'R'),.008)
        tube('Tabard embroidered border',[outline[1],outline[2],outline[3],outline[4]],.009,gold,'thigh.'+('L' if s<0 else 'R'))
        for k in range(3):
            x=s*(.27+k*.065)
            plate('Overlapping hip tasset',[(x,-.20+k*.022,1.73),(x+s*.09,-.16,1.7),(x+s*.14,-.14,1.44),(x+s*.045,-.23,1.4)],.06,silver,'pelvis',.014)
    # Swept, pleated cape. Cloth geometry has alternating folded ridges.
    vs=[]; rows=10; cols=17
    for i in range(rows):
        t=i/(rows-1)
        for j in range(cols):
            u=j/(cols-1); x=(u-.5)*(.72+.7*t)
            z=2.45-1.88*t+.10*t*cos(u*4*pi)
            y=.31+.34*t+.055*sin(u*8*pi)*(0.25+t)
            vs.append((x,y,z))
    fs=[(i*cols+j,i*cols+j+1,(i+1)*cols+j+1,(i+1)*cols+j) for i in range(rows-1) for j in range(cols-1)]
    cape=mesh('Marshal folded mantle',vs,fs,cloth,'spine',True)
    sol=cape.modifiers.new('Tailored cloth thickness','SOLIDIFY'); sol.thickness=.018
    bpy.context.view_layer.objects.active=cape; cape.select_set(True); bpy.ops.object.modifier_apply(modifier=sol.name); cape.select_set(False)
    for j in [0,cols-1]: tube('Cape gold selvage',[vs[i*cols+j] for i in range(rows)],.012,gold,'spine')
    tube('Cape scalloped hem',vs[-cols:],.012,gold,'spine')
    for s in [-1,1]:
        tube('Mantle shoulder fastening',[(s*.31,.10,2.48),(s*.34,.23,2.46),(s*.36,.31,2.45)],.021,gold,'spine')
    # Neck and shaped gorget leave the face clearly exposed.
    loft('Neck',[(2.46,0,0,.115,.12),(2.72,0,0,.12,.12)],skin,'head')
    loft('Raised gorget',[(2.43,0,0,.24,.18),(2.56,0,.015,.22,.17),(2.63,0,.015,.17,.145)],edge,'spine',n=12,smooth=False)
    # Head with deliberate jaw/chin, cheek planes and forehead, rather than sphere.
    loft('Sculpted face',[(2.68,0,-.015,.085,.085),(2.72,0,-.02,.14,.125),(2.82,0,0,.185,.15),(2.92,0,.01,.197,.162),(3.04,0,.018,.18,.15),(3.12,0,.025,.13,.12),(3.15,0,.025,.025,.03)],skin,'head',n=24)
    for s in [-1,1]:
        ellipsoid('Ear',(s*.19,.015,2.9),(.04,.035,.07),skin,'head',n=12)
        # Eye sockets, visible whites, irises and pupils with actual eyelids.
        ellipsoid('Recessed orbital plane',(s*.083,-.142,2.949),(.055,.015,.027),skin,'head')
        ellipsoid('Eye',(s*.084,-.16,2.949),(.036,.011,.014),white,'head')
        ellipsoid('Iris',(s*.083,-.172,2.949),(.012,.004,.012),iris,'head',n=12)
        ellipsoid('Pupil',(s*.083,-.176,2.949),(.005,.002,.009),dark,'head',n=12)
        tube('Upper sculpted eyelid',[(s*.048,-.163,2.957),(s*.083,-.175,2.965),(s*.119,-.151,2.957)],.011,skin,'head')
        tube('Stern eyebrow',[(s*.032,-.164,2.994),(s*.07,-.169,3.008),(s*.13,-.15,3.002)],.014,hair,'head')
    # Wedge nose with shaped nostrils, mouth and angular beard boundary.
    mesh('Carved nose',[(-.026,-.154,2.99),(.026,-.154,2.99),(-.038,-.19,2.872),(.038,-.19,2.872),(0,-.224,2.89),(0,-.185,2.99)],[(0,1,5),(0,5,4,2),(5,1,3,4),(2,4,3),(0,2,3,1)],skin,'head',True)
    for s in [-1,1]: ellipsoid('Nostril',(s*.026,-.193,2.876),(.012,.006,.006),shadow,'head',n=8)
    tube('Lower lip',[(-.047,-.148,2.804),(0,-.17,2.798),(.047,-.148,2.804)],.012,skin,'head')
    tube('Mouth line',[(-.053,-.15,2.82),(0,-.173,2.818),(.053,-.15,2.82)],.005,shadow,'head')
    # Short beard hugs the jaw surface; open upper edge follows chin beneath lip.
    vs=[]
    for z,rx,ry,cy in [(2.685,.075,.082,-.018),(2.72,.14,.125,-.02),(2.765,.16,.14,-.008)]:
        for j in range(13):
            a=pi+pi*j/12
            vs.append((rx*cos(a),cy+ry*sin(a)-.006,z+.026*abs(cos(a))))
    mesh('Close cropped chin beard',vs,[(i*13+j,i*13+j+1,(i+1)*13+j+1,(i+1)*13+j) for i in range(2) for j in range(12)],hair,'head',True)
    # Crown loft and curved, tapered locks swept across a diagonal side part.
    loft('Hair cap',[(3.045,0,.04,.181,.145),(3.12,0,.04,.181,.145),(3.19,0,.04,.14,.12),(3.22,0,.04,.04,.045)],hair,'head',n=24)
    from mathutils import Vector
    for i in range(7):
        x=-.16+i*.047; arch=sin((i+1)/8*pi)
        points=[(x,-.11,3.055+.02*arch),(x+.018,-.145,3.12+.035*arch),(x+.045,-.095,3.19+.04*arch),(x+.055,.015,3.20+.035*arch),(x+.04,.12,3.13),(x+.015,.17,3.06)]
        vs=[]; n=10
        for k,p in enumerate(points):
            tangent=Vector(points[min(k+1,5)])-Vector(points[max(k-1,0)])
            tangent.normalize(); u=tangent.cross(Vector((0,0,1))).normalized(); v=tangent.cross(u).normalized()
            r=[.024,.034,.039,.036,.025,.002][k]
            vs += [tuple(Vector(p)+r*(u*cos(j*2*pi/n)+.7*v*sin(j*2*pi/n))) for j in range(n)]
        fs=[tuple(reversed(range(n))),tuple(5*n+j for j in range(n))]+[(k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j) for k in range(5) for j in range(n)]
        mesh('Swept silver lock',vs,fs,hair,'head',True)
    tube('Veteran cheek scar',[(.12,-.147,2.94),(.10,-.16,2.904),(.092,-.153,2.87)],.004,shadow,'head',n=6)
    # Arms: asymmetric command pauldron with overlapping lames.
    for s,side in [(-1,'L'),(1,'R')]:
        upper='upper_arm.'+side; fore='forearm.'+side; hand='hand.'+side
        x=s*.55
        ellipsoid('Shoulder articulation',(x,0,2.4),(.17,.18,.17),dark,upper)
        loft('Arm underlayer',[(1.94,s*.79,0,.115,.12),(2.19,s*.7,0,.13,.13),(2.42,x,0,.15,.15)],cloth,upper)
        for k in range(3):
            z=2.43-k*.085; extent=.23+(.04 if side=='L' else 0)
            loft('Forged pauldron lame',[(z-.055,s*(.55+k*.055),.015,extent,.23),(z+.07,s*(.54+k*.055),.015,extent*.85,.2),(z+.13,s*(.53+k*.055),.015,extent*.44,.14)],silver,upper,n=12,smooth=False)
            tube('Pauldron rolled rim',[(s*(.55+k*.055)+extent*cos(a),.015+.23*sin(a),z-.045) for a in [2*pi*j/32 for j in range(33)]],.012,gold,upper)
        if side=='L':
            plate('Command crest',[(s*.43,-.2,2.53),(s*.56,-.23,2.7),(s*.69,-.2,2.53),(s*.56,-.25,2.43)],.04,blue,upper,.012)
            tube('Command crest gold ridge',[(s*.56,-.255,2.47),(s*.56,-.255,2.65)],.014,gold,upper)
        ellipsoid('Elbow couter',(s*.8,.0,1.99),(.14,.155,.13),edge,fore)
        loft('Leather forearm',[(1.59,s*.88,-.055,.095,.105),(1.83,s*.84,-.015,.13,.13),(1.99,s*.8,0,.11,.12)],leather,fore)
        plate('Fluted vambrace',[(s*.73,-.14,1.91),(s*.91,-.14,1.9),(s*.99,-.15,1.65),(s*.84,-.19,1.56),(s*.77,-.16,1.67)],.08,silver,fore,.025)
        tube('Vambrace gold spine',[(s*.82,-.17,1.89),(s*.88,-.20,1.63)],.012,gold,fore)
        ellipsoid('Gauntlet palm',(s*.89,-.04,1.52),(.11,.1,.14),dark,hand)
        for k in range(3):
            z=1.49+k*.055
            plate('Gauntlet overlapping plate',[(s*.81,-.142,z),(s*.97,-.142,z),(s*.97,-.14,z+.045),(s*.81,-.14,z+.045)],.04,edge,hand,.009)
        for k in range(4): ellipsoid('Finger armor',(s*(.825+k*.041),-.083,1.405),(.023,.055,.047),silver,hand,n=8,rows=6)
        # Legs: muscle-shaped underlayer, pointed kneecaps, raised greave ridges.
        lx=s*.23
        loft('Trouser thigh',[(1.0,lx,0,.125,.13),(1.28,lx,0,.18,.17),(1.59,lx,0,.18,.19)],leather,'thigh.'+side)
        plate('Thigh plate',[(lx-.14,-.15,1.5),(lx+.14,-.15,1.5),(lx+.12,-.18,1.14),(lx,-.22,1.06),(lx-.12,-.18,1.14)],.08,silver,'thigh.'+side,.025)
        loft('Shin padding',[(.32,lx,.025,.105,.12),(.69,lx,0,.14,.15),(1.06,lx,0,.12,.13)],dark,'shin.'+side)
        plate('Angular knee cop',[(lx,-.2,1.16),(lx+.16,-.18,1.05),(lx+.13,-.21,.93),(lx,-.26,.88),(lx-.13,-.21,.93),(lx-.16,-.18,1.05)],.10,edge,'shin.'+side,.024)
        plate('Greave shaped shell',[(lx-.12,-.14,.9),(lx+.12,-.14,.9),(lx+.095,-.16,.35),(lx,-.21,.29),(lx-.095,-.16,.35)],.12,silver,'shin.'+side,.025)
        tube('Greave raised keel',[(lx,-.205,.86),(lx,-.23,.60),(lx,-.215,.35)],.015,gold,'shin.'+side)
        loft('Boot upper',[(.11,lx,-.08,.15,.25),(.24,lx,-.1,.15,.25),(.4,lx,.015,.10,.12)],leather,'foot.'+side,n=12)
        loft('Sabatons',[(.08,lx,-.14,.16,.29),(.16,lx,-.16,.16,.29),(.24,lx,-.12,.13,.23)],silver,'foot.'+side,n=12,smooth=False)
        for k in range(3):
            y=-.18-k*.075
            tube('Sabatons lames',[(lx-.12,y,.19),(lx,y-.02,.235),(lx+.12,y,.19)],.012,edge,'foot.'+side)
    # Sword: diamond cross-section taper, fuller, swept quillons, wrapped grip.
    sx=.96; sy=-.10
    def swordpoly(name,outline,d,mat): return plate(name,[(sx+x,sy+y,z) for x,y,z in outline],d,mat,'hand.R',.008)
    swordpoly('Sword • diamond blade',[(0,-.03,.29),(-.09,0,.56),(-.09,0,1.36),(0,-.045,1.43),(.09,0,1.36),(.09,0,.56)],.045,edge)
    tube('Sword • dark central fuller',[(sx,sy-.047,.5),(sx,sy-.055,1.33)],.009,blue,'hand.R')
    swordpoly('Sword • swept crossguard',[(-.24,0,1.32),(-.2,-.015,1.4),(-.07,-.015,1.42),(.07,-.015,1.42),(.2,-.015,1.4),(.24,0,1.32),(.19,0,1.34),(.05,0,1.37),(-.05,0,1.37),(-.19,0,1.34)],.07,gold)
    tube('Sword • leather handle',[(sx,sy,1.4),(sx,sy,1.68)],.044,leather,'hand.R',n=12)
    for k in range(7): tube('Sword • grip binding',[(sx+.045*cos(t),sy+.045*sin(t),1.43+k*.032+.007*t/pi) for t in [j*2*pi/16 for j in range(17)]],.006,gold,'hand.R',n=6)
    ellipsoid('Sword • pommel',(sx,sy,1.72),(.068,.055,.075),gold,'hand.R',n=12)
    # Ridged kite shield, border follows original outline with inset heraldry.
    cx=-.96; cy=-.33; cz=1.69
    outline=[(-.37,.0,.37),(-.26,.0,.55),(.26,.0,.55),(.37,.0,.37),(.32,.0,-.15),(0,-.075,-.63),(-.32,.0,-.15)]
    plate('Shield • silver perimeter',[(cx+x,cy+y,cz+z) for x,y,z in outline],.10,edge,'hand.L',.024)
    inset=[(cx+x*.89,cy+y-.035,cz+z*.9) for x,y,z in outline]
    # Triangulated front converges at raised central boss, creating bevelled planes.
    vs=inset+[(cx,cy-.15,cz+.08)]
    mesh('Shield • azure ridged field',vs,[(j,(j+1)%7,7) for j in range(7)],blue,'hand.L')
    tube('Shield • gold inner border',inset+[inset[0]],.013,gold,'hand.L')
    tube('Shield • central keel',[(cx,cy-.06,cz+.48),(cx,cy-.17,cz+.08),(cx,cy-.11,cz-.54)],.02,gold,'hand.L')
    # Three rising chevrons: command / defense insignia readable from distance.
    for k in range(3):
        z=cz+.28-k*.18
        plate('Shield • command chevron',[(cx-.21,cy-.125,z-.07),(cx,cy-.19,z+.065),(cx+.21,cy-.125,z-.07),(cx+.19,cy-.13,z-.12),(cx,cy-.195,z),(cx-.19,cy-.13,z-.12)],.018,gold,'hand.L',.006)
    for x,y,z in outline:
        ellipsoid('Shield rivet',(cx+x*.94,cy+y-.028,cz+z*.95),(.022,.017,.022),gold,'hand.L',n=8,rows=6)
    return {'height':3.28,'palette':['azure','silver','gold'],'title':'Aegis Marshal (制作仮称)'}
