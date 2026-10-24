import { Group, Mesh, MeshStandardMaterial, Color, type Object3D, type BufferGeometry } from 'three';
import { sections, panel, loft, polyhedron, hairLock, type V2, type V3 } from './geometry';

export interface F01Definition {
  seed: number; shoulderWidth: number; headScale: number; capeSpread: number;
  palette: Record<'steel'|'darkSteel'|'gold'|'cloth'|'lining'|'leather'|'skin'|'hair'|'eyes'|'ivory',string>;
}
export const DEFAULT_F01: Readonly<F01Definition> = Object.freeze({ seed: 1042, shoulderWidth: 1, headScale: 1, capeSpread: 1,
  palette: { steel:'#9aadb5', darkSteel:'#405364', gold:'#c3a36b', cloth:'#284e69', lining:'#172c40',
    leather:'#463c37', skin:'#b98b6d', hair:'#c2c7c2', eyes:'#202e33', ivory:'#e1d8c1' } });
export const F01_PARTS = ['head','face','hair','chest','shoulders','arms','legs','cape','shield','sword'] as const;
export const F01_GENERATOR = 'senkei.f01.parametric.v1';
type MaterialKey=keyof F01Definition['palette'];

export function snapshotF01(root: Object3D) {
  root.updateMatrixWorld(true);
  const meshes: unknown[]=[];
  root.traverse(node=>{if(node instanceof Mesh){
    const m=node.material as MeshStandardMaterial;
    meshes.push({name:node.name, matrix:node.matrixWorld.toArray(), positions:Array.from(node.geometry.getAttribute('position').array),
      normals:Array.from(node.geometry.getAttribute('normal').array), color:m.color.toArray(), metalness:m.metalness, roughness:m.roughness});
  }});
  return meshes;
}

export function buildF01(definition: F01Definition = DEFAULT_F01) {
  const d=structuredClone(definition);
  if(!Number.isSafeInteger(d.seed)||d.seed<0||d.seed>0xffffffff) throw new Error('seed must be uint32');
  for(const key of ['headScale','shoulderWidth','capeSpread'] as const)
    if(!Number.isFinite(d[key])||d[key]<.85||d[key]>1.15) throw new Error(`${key} must be 0.85–1.15`);
  for(const color of Object.values(d.palette)) if(!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Palette requires six-digit hex colors');
  const root=new Group(); root.name='F01-static-study';
  root.userData={generator:F01_GENERATOR,definition:d,appearanceKey:'hero.f01.procedural-study.v1',static:true};
  const parts=Object.fromEntries(F01_PARTS.map(name=>{const g=new Group();g.name=name;root.add(g);return [name,g]})) as Record<typeof F01_PARTS[number],Group>;
  const materials={} as Record<MaterialKey,MeshStandardMaterial>;
  for(const [key,color] of Object.entries(d.palette)) {
    const metal=['steel','darkSteel','gold'].includes(key);
    materials[key as MaterialKey]=new MeshStandardMaterial({color:new Color(color),metalness:metal?.62:0,roughness:metal?.38:.9,flatShading:true});
    materials[key as MaterialKey].name=key;
  }
  let triangles=0, serial=0;
  function add(parent:Object3D,name:string,geometry:BufferGeometry,mat:MaterialKey,position:V3=[0,0,0],rotation:V3=[0,0,0]) {
    const m=new Mesh(geometry,materials[mat]);m.name=`${name}-${serial++}`;m.position.set(...position);m.rotation.set(...rotation);
    m.castShadow=true;m.receiveShadow=true;parent.add(m);triangles+=geometry.getAttribute('position').count/3;return m;
  }
  const plate=(parent:Object3D,name:string,outline:readonly V2[],mat:MaterialKey,pos:V3,depth=.03,bevel=.1,ridge=0,rotation:V3=[0,0,0]) =>
    add(parent,name,panel(outline,depth,bevel,ridge),mat,pos,rotation);
  const diamond:V2[]=[[0,.07],[-.047,0],[0,-.07],[.047,0]];
  let randomState=d.seed;
  const random=()=>{let x=randomState+=0x6d2b79f5;x=Math.imul(x^(x>>>15),x|1);x^=x+Math.imul(x^(x>>>7),x|61);return ((x^(x>>>14))>>>0)/4294967296;};

  // Under-armour silhouette: narrowed waist, broad clavicles, no cylindrical torso.
  add(parts.chest,'gambeson',sections([[1.05,0,0,.27,.17],[1.23,0,0,.245,.16],[1.52,0,-.015,.31,.19],[1.77,0,-.025,.35,.19],[1.88,0,-.015,.24,.15]]),'lining');
  add(parts.chest,'neck-seal',sections([[1.85,0,0,.12,.115],[1.99,0,0,.105,.105]]),'darkSteel');
  add(parts.head,'neck',sections([[1.93,0,.005,.084,.08],[2.07,0,.012,.087,.083]]),'skin');
  const breast:V2[]=[[-.32,.14],[-.22,.23],[-.11,.18],[.11,.18],[.22,.23],[.32,.14],[.27,-.12],[.1,-.23],[-.1,-.23],[-.27,-.12]];
  plate(parts.chest,'cuirass-edge',breast,'gold',[0,1.62,.16],.055,.045,.045);
  plate(parts.chest,'cuirass',breast.map(([x,y])=>[x*.95,y*.94]),'steel',[0,1.62,.178],.052,.11,.052);
  // Raised gorget wraps the neck, rather than floating as a flat collar.
  add(parts.chest,'gorget',sections([[1.83,0,-.015,.22,.16],[1.90,0,-.015,.19,.145],[1.95,0,-.005,.135,.12]]),'steel');
  for(let i=0;i<3;i++){
    const w=.246-i*.009;
    plate(parts.chest,'waist-lame',[[-w,.055],[w,.055],[w*.98,-.04],[0,-.085],[-w*.98,-.04]],'darkSteel',[0,1.38-i*.083,.16+i*.008],.035,.12,.018);
  }
  // Leather baldric, bounded by the torso surface; original three-ridge heraldry.
  plate(parts.chest,'baldric',[[-.29,.20],[-.245,.235],[.235,-.20],[.18,-.24]],'leather',[0,1.61,.295],.018,.06);
  plate(parts.chest,'baldric-buckle',[[-.047,.055],[.047,.055],[.047,-.055],[-.047,-.055]],'gold',[-.08,1.67,.326],.012,.10,0,[0,0,-.7]);
  plate(parts.chest,'buckle-inset',[[-.025,.032],[.025,.032],[.025,-.032],[-.025,-.032]],'leather',[-.08,1.67,.341],.005,.03,0,[0,0,-.7]);
  add(parts.chest,'belt',sections([[1.10,0,.005,.28,.19],[1.17,0,.005,.275,.188]]),'leather');
  plate(parts.chest,'belt-buckle',[[-.065,.05],[.065,.05],[.065,-.05],[-.065,-.05]],'gold',[0,1.133,.2],.025,.12);
  plate(parts.chest,'buckle-field',[[-.035,.025],[.035,.025],[.035,-.025],[-.035,-.025]],'darkSteel',[0,1.133,.23],.006,.02);

  // Head: authored jaw / cheek / temple / brow sections, fixed front feature landmarks.
  const headGroup=new Group();parts.head.add(headGroup);headGroup.position.set(0,2.0,0);headGroup.scale.setScalar(d.headScale);
  const headRows=[
    [.015,.090,.115,.07],[.065,.143,.161,.11],[.16,.18,.17,.135],[.25,.176,.159,.147],[.345,.17,.15,.15],[.41,.122,.105,.11]
  ];
  const headRings=headRows.map(([y,w,front,back])=>([
    [w,y,.04],[w*.68,y,front*.96],[0,y,front],[-w*.68,y,front*.96],[-w,y,.04],[-w*.92,y,-back*.62],[-w*.5,y,-back],[w*.5,y,-back],[w*.92,y,-back*.62]
  ] as V3[]));
  add(headGroup,'facial-volume',loft(headRings),'skin');
  const faceGroup=new Group();parts.face.add(faceGroup);faceGroup.position.copy(headGroup.position);faceGroup.scale.copy(headGroup.scale);
  for(const s of [-1,1]){
    plate(faceGroup,'ear',[[-.025,.045],[.02,.035],[.026,-.022],[-.015,-.05]],'skin',[s*.181,.19,-.002],.027,.16,0,[0,s*.45,0]);
    // Eye sockets, sclera and iris are recessed slivers, not protruding eyeballs.
    plate(faceGroup,'eye-socket',[[-.043,.012],[.034,.018],[.044,-.008],[-.032,-.014]],'leather',[s*.084,.251,.155],.006,.02,0,[0,s*.06,s*-.07]);
    plate(faceGroup,'eye',[[-.029,.006],[.028,.008],[.026,-.008],[-.025,-.008]],'ivory',[s*.084,.249,.164],.002,0);
    plate(faceGroup,'iris',[[-.008,.007],[.008,.007],[.008,-.008],[-.008,-.008]],'eyes',[s*.083,.249,.168],.001,0);
    plate(faceGroup,'brow',[[-.047,.008],[.045,.011],[.035,-.01],[-.043,-.012]],'hair',[s*.088,.282,.168],.012,.1,0,[0,0,s*-.14]);
  }
  add(faceGroup,'nose',polyhedron([[-.025,.268,.166],[.025,.268,.166],[.029,.171,.182],[0,.166,.235],[-.029,.171,.182],[0,.255,.195]],
    [[0,5,1],[0,4,3,5],[5,3,2,1],[4,2,3],[0,1,2,4]]),'skin');
  plate(faceGroup,'mouth',[[-.053,.002],[0,-.003],[.053,.002],[.042,-.007],[0,-.01],[-.042,-.007]],'leather',[0,.113,.163],.002,0);
  // Short beard consists of a single sculpted jaw band, not separate spikes.
  add(faceGroup,'jaw-stubble',loft([
    [[.083,.023,.085],[.066,.024,.119],[0,.019,.129],[-.066,.024,.119],[-.083,.023,.085],[-.083,.023,.078],[-.05,.023,.065],[.05,.023,.065],[.083,.023,.078]],
    [[.14,.083,.10],[.102,.079,.157],[0,.073,.168],[-.102,.079,.157],[-.14,.083,.10],[-.14,.083,.09],[-.07,.083,.07],[.07,.083,.07],[.14,.083,.09]]
  ]),'hair');
  // Hair cap and deliberately asymmetrical swept locks.
  const hairGroup=new Group();parts.hair.add(hairGroup);hairGroup.position.copy(headGroup.position);hairGroup.scale.copy(headGroup.scale);
  add(hairGroup,'hair-cap',loft([
    [[.181,.24,.048],[.148,.334,.133],[0,.345,.158],[-.148,.33,.133],[-.182,.235,.045],[-.173,.17,-.105],[-.08,.14,-.166],[.08,.14,-.166],[.173,.17,-.105]],
    [[.155,.40,.02],[.11,.433,.10],[0,.45,.119],[-.11,.43,.1],[-.155,.39,.02],[-.14,.36,-.12],[-.07,.36,-.15],[.07,.36,-.15],[.14,.36,-.12]]
  ]),'hair');
  for(let i=0;i<5;i++){
    const x=-.135+i*.057, jitter=(random()-.5)*.015;
    add(hairGroup,'swept-lock',hairLock([[x,.365,.095,.041,.035],[x+.025,.475+jitter,.073,.046,.041],[x+.065,.47+jitter,-.005,.034,.03],[x+.10,.395,-.103,.008,.012]]),'hair');
  }
  add(hairGroup,'forelock',hairLock([[-.11,.405,.1,.065,.04],[-.056,.385,.16,.055,.035],[.015,.326,.179,.012,.008]]),'hair');

  // Arms, with compact shoulder articulation and leather closures under each plate.
  for(const s of [-1,1]) {
    const sx=s*.40*d.shoulderWidth, elbow=s*.52*d.shoulderWidth, wrist=s*.58*d.shoulderWidth;
    add(parts.arms,'sleeve',sections([[1.26,wrist,.02,.085,.085],[1.48,elbow,-.005,.105,.10],[1.80,sx,-.035,.13,.13]]),'lining');
    add(parts.shoulders,'pauldron-rim',sections([[1.73,sx,-.02,.215,.22],[1.83,sx,-.02,.235,.245],[1.94,sx,-.02,.18,.18],[1.985,sx,-.02,.095,.085]]),'gold');
    add(parts.shoulders,'pauldron-shell',sections([[1.76,sx,-.015,.211,.215],[1.84,sx,-.015,.228,.24],[1.955,sx,-.015,.165,.16],[1.999,sx,-.015,.08,.065]]),'steel');
    plate(parts.shoulders,'shoulder-lame',[[-.14,.075],[.14,.075],[.12,-.06],[0,-.095],[-.12,-.06]],'darkSteel',[sx+s*.03,1.73,.135],.045,.13,.02,[0,s*.25,s*.12]);
    plate(parts.shoulders,'cape-clasp',diamond,'gold',[s*.245,1.852,.18],.03,.13,.014);
    plate(parts.arms,'upper-arm',[[-.095,.12],[.095,.12],[.088,-.10],[0,-.15],[-.088,-.1]],'steel',[s*.49*d.shoulderWidth,1.585,.10],.04,.17,.018,[0,s*.15,s*.20]);
    plate(parts.arms,'elbow-cop',[[-.10,.035],[-.05,.09],[.06,.09],[.11,.015],[.05,-.07],[-.07,-.07]],'darkSteel',[elbow,1.43,.105],.045,.13,.025);
    add(parts.arms,'gauntlet-cuff',sections([[1.19,wrist,.03,.107,.105],[1.23,wrist,.03,.102,.10],[1.39,elbow,.005,.12,.115]]),'steel');
    add(parts.arms,'cuff-trim',sections([[1.188,wrist,.03,.111,.11],[1.22,wrist,.03,.111,.11]]),'gold');
    add(parts.arms,'glove',sections([[1.08,wrist,.065,.075,.08],[1.13,wrist,.072,.092,.095],[1.23,wrist,.04,.075,.077]]),'leather');
    for(let i=0;i<4;i++) plate(parts.arms,'knuckle',[[-.019,.027],[.019,.027],[.017,-.027],[-.017,-.027]],'darkSteel',[wrist-.065+i*.043,1.145,.161],.022,.23);
    add(parts.arms,'thumb',sections([[1.105,wrist-s*.061,.13,.025,.032],[1.18,wrist-s*.088,.108,.032,.04]]),'leather');
  }

  // Split cloth skirt and thigh tassets leave a leg gap and a readable stance.
  for(const s of [-1,1]){
    plate(parts.chest,'tabard-border',[[-.13,.13],[.12,.13],[.155,-.27],[-.11,-.31]],'gold',[s*.16,.99,.17],.014,.02,0,[0,s*.1,s*.06]);
    plate(parts.chest,'tabard',[[-.116,.12],[.107,.12],[.139,-.252],[-.10,-.285]],'cloth',[s*.16,.99,.19],.012,.025,0,[0,s*.1,s*.06]);
    plate(parts.chest,'hip-tasset',[[-.11,.13],[.11,.13],[.14,-.12],[.04,-.18],[-.13,-.13]],'steel',[s*.306,1.02,.07],.05,.16,.02,[0,s*.72,s*-.20]);
    const leg=new Group();leg.position.set(s*.205,0,s===-1?.03:-.05);leg.rotation.y=s*.12;parts.legs.add(leg);
    add(leg,'trousers',sections([[.50,0,0,.092,.092],[.75,0,-.015,.12,.12],[1.06,-s*.023,-.015,.135,.145]]),'lining');
    plate(leg,'thigh-plate',[[-.09,.13],[.09,.13],[.085,-.13],[0,-.17],[-.08,-.13]],'darkSteel',[0,.84,.11],.03,.15,.018);
    plate(leg,'knee-cop',[[-.096,.035],[-.07,.10],[.07,.10],[.096,.035],[.065,-.07],[0,-.095],[-.065,-.07]],'steel',[0,.61,.10],.05,.16,.025);
    add(leg,'boot-shaft',sections([[.12,0,0,.105,.11],[.28,0,-.01,.09,.095],[.53,0,-.015,.105,.11]]),'leather');
    plate(leg,'greave-edge',[[-.10,.17],[.09,.17],[.075,-.15],[.03,-.21],[-.085,-.17]],'gold',[0,.355,.10],.032,.05,.018);
    plate(leg,'greave',[[-.086,.158],[.078,.158],[.064,-.144],[.025,-.19],[-.072,-.155]],'steel',[0,.355,.118],.035,.1,.032);
    // Toe is a chamfered footprint, wider at the ball and tapering to a squared tip.
    const footprint:V2[]=[[-.10,-.12],[.10,-.12],[.122,.12],[.098,.29],[-.094,.29],[-.124,.14]];
    const ring=(y:number,scale:number,zOffset=0)=>[...footprint].reverse().map(([x,z])=>[x*scale,y,z*scale+zOffset] as V3);
    add(leg,'sole',loft([ring(.025,1.04),ring(.065,1.04)]),'darkSteel');
    add(leg,'sabatons',loft([ring(.067,1),ring(.125,.96),ring(.205,.64,-.035)]),'steel');
    for(let i=0;i<2;i++) plate(leg,'toe-lame',[[-.10,.025],[.10,.025],[.095,-.025],[-.095,-.025]],'darkSteel',[0,.14-i*.02,.18+i*.05],.009,.02,0,[-.6,0,0]);
  }

  // Heavy cape: a closed double surface, hand-authored folds and an uneven tailored hem.
  const capeRows=[{y:1.9,w:.285,z:-.19},{y:1.74,w:.37,z:-.26},{y:1.43,w:.415,z:-.30},{y:1.10,w:.45,z:-.35},{y:.78,w:.49,z:-.41},{y:.48,w:.52,z:-.46}];
  const columns=[-1,-.78,-.42,0,.36,.74,1],cv:V3[]=[],cf:number[][]=[];
  for(let r=0;r<capeRows.length;r++) for(let c=0;c<columns.length;c++) {
    const row=capeRows[r],u=columns[c],fold=[.0,-.045,.025,-.055,.022,-.048,.005][c]*(.4+r*.15);
    cv.push([u*row.w*d.capeSpread,row.y+(r===5?Math.abs(u)*.06+(c%2)*.02:0),row.z+fold]);
  }
  const cn=cv.length;cv.push(...cv.map(([x,y,z])=>[x,y,z+.018] as V3));
  for(let r=0;r<5;r++)for(let c=0;c<6;c++){
    const a=r*7+c,b=a+1,k=a+7;cf.push([a,k,k+1,b],[a+cn,b+cn,k+1+cn,k+cn]);
  }
  const border=[...Array.from({length:7},(_,i)=>i),...Array.from({length:5},(_,i)=>(i+1)*7+6),...Array.from({length:6},(_,i)=>40-i),...Array.from({length:4},(_,i)=>(4-i)*7)];
  for(let i=0;i<border.length;i++){const a=border[i],b=border[(i+1)%border.length];cf.push([a,b,b+cn,a+cn]);}
  add(parts.cape,'tailored-cape',polyhedron(cv,cf),'cloth');
  for(let c=0;c<6;c++){
    const a=cv[35+c],b=cv[36+c];
    add(parts.cape,'cape-hem',polyhedron([[a[0],a[1]+.035,a[2]-.003],[a[0],a[1]+.008,a[2]-.004],[b[0],b[1]+.008,b[2]-.004],[b[0],b[1]+.035,b[2]-.003]],[[0,1,2,3]]),'gold');
  }
  // Back insignia is positioned on the cape, not a floating front badge copied to the back.
  plate(parts.cape,'cape-insignia',[[0,.115],[-.085,.01],[0,-.11],[.085,.01]],'gold',[0,1.35,-.354],.008,.05,0,[0,Math.PI,0]);

  // Shield has a convex wooden back, metal rim, enamel field and original chevron device.
  const shield=parts.shield;shield.position.set(.66*d.shoulderWidth,1.12,.22);shield.rotation.set(.03,-.25,-.08);
  const shieldOutline:V2[]=[[-.27,.37],[-.18,.46],[.18,.46],[.27,.37],[.245,-.17],[0,-.48],[-.245,-.17]];
  plate(shield,'shield-back',shieldOutline,'leather',[0,0,0],.055,.045,.045);
  plate(shield,'shield-rim',shieldOutline,'gold',[0,0,.035],.055,.055,.035);
  plate(shield,'shield-field',shieldOutline.map(([x,y])=>[x*.87,y*.9]),'cloth',[0,0,.084],.026,.06,.045);
  const chev:V2[]=[[-.15,.035],[0,.145],[.15,.035],[.15,-.018],[0,.084],[-.15,-.018]];
  for(let i=0;i<3;i++)plate(shield,'command-chevron',chev,'ivory',[0,.16-i*.135,.16],.009,.02);
  for(const [x,y] of [[-.215,.33],[.215,.33],[-.19,-.14],[.19,-.14],[0,-.39]])plate(shield,'shield-rivet',[[0,.015],[-.015,0],[0,-.015],[.015,0]],'steel',[x,y,.12],.013,.12,.005);
  // Two straps physically connect the rear of the shield to the left glove/forearm.
  for(const y of [-.045,.14])plate(shield,'shield-grip',[[-.12,.025],[.12,.025],[.12,-.025],[-.12,-.025]],'leather',[0,y,-.068],.04,.05);

  const sword=parts.sword;sword.position.set(-.585*d.shoulderWidth,1.12,.12);sword.rotation.z=-.09;
  // Diamond cross-section blade, fuller and bevels are actual geometry.
  add(sword,'blade',polyhedron([[-.054,-.10,0],[0,-.10,.028],[.054,-.10,0],[0,-.10,-.025],[-.043,-.88,0],[0,-.88,.02],[.043,-.88,0],[0,-.88,-.018],[0,-1.02,0]],
    [[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0],[4,8,5],[5,8,6],[6,8,7],[7,8,4],[0,1,2,3]]),'steel');
  plate(sword,'fuller',[[-.008,.01],[.008,.01],[.007,-.58],[0,-.64],[-.007,-.58]],'darkSteel',[0,-.19,.029],.002,0);
  plate(sword,'crossguard',[[-.20,-.04],[-.18,.01],[-.075,.035],[.075,.035],[.18,.01],[.20,-.04],[.17,-.075],[.07,-.035],[-.07,-.035],[-.17,-.075]],'gold',[0,-.075,0],.045,.12);
  add(sword,'grip',sections([[-.08,0,0,.032,.034],[.12,0,0,.029,.032]]),'leather');
  add(sword,'pommel',sections([[.12,0,0,.032,.032],[.15,0,0,.052,.045],[.20,0,0,.032,.03]]),'gold');

  // Non-cryptographic UI identity; report/tests separately hash the full canonical snapshot.
  const text=JSON.stringify(snapshotF01(root));let hash=0x811c9dc5;
  for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),0x01000193);
  let disposed=false;
  return {root,triangles,fingerprint:(hash>>>0).toString(16).padStart(8,'0'),definition:structuredClone(definition),dispose(){
    if(disposed)return;disposed=true;
    root.traverse(n=>{if(n instanceof Mesh)n.geometry.dispose()});
    Object.values(materials).forEach(m=>m.dispose());
  }};
}
