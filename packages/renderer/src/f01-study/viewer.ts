import {
  Scene, Color, WebGLRenderer, OrthographicCamera, DirectionalLight, HemisphereLight, AmbientLight,
  Mesh, MeshStandardMaterial, ShadowMaterial, CylinderGeometry, PlaneGeometry, PCFSoftShadowMap, ACESFilmicToneMapping,
  SRGBColorSpace, PMREMGenerator, Vector3, type Material, type BufferGeometry,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildF01, DEFAULT_F01, type F01Definition } from './model';

export const VIEWS = {
  front: { label: '正面', position: [0, 1.4, 6], target: [0, 1.18, 0], span: 3.1 },
  side: { label: '側面', position: [-6, 1.5, 0], target: [0, 1.18, 0], span: 3.1 },
  back: { label: '背面', position: [0, 1.4, -6], target: [0, 1.18, 0], span: 3.1 },
  oblique: { label: '斜め', position: [3.5, 2.9, 6], target: [0, 1.17, 0], span: 3.1 },
  face: { label: '顔', position: [.8, 2.49, 4], target: [0, 2.23, .02], span: .85 },
  battle: { label: '戦場距離', position: [4, 6.2, 6], target: [0, 1.0, 0], span: 6.7 },
} as const;
export type View = keyof typeof VIEWS;
export type Light = 'studio' | 'daylight' | 'neutral';
export type StudyStats = { triangles: number; meshes: number; materials: number; drawCalls: number; fingerprint: string };

/** Static inspection viewport. Render only on user actions, resize and control changes. */
export class F01Viewer {
  readonly canvas: HTMLCanvasElement;
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-2, 2, 2, -2, .05, 100);
  readonly renderer: WebGLRenderer;
  readonly controls: OrbitControls;
  private hero = buildF01();
  private observer: ResizeObserver;
  private span = 3.1;
  private disposed = false;
  private lost = false;
  private key = new DirectionalLight(0xffecd3, 3.3);
  private fill = new DirectionalLight(0xc2d9ed, 1.5);
  private rim = new DirectionalLight(0xe2eefb, 3.0);
  private hemi = new HemisphereLight(0xc8d8e3, 0x615b4f, 1.5);
  private ambient = new AmbientLight(0xffffff, .2);
  private environment;
  private stage: Mesh[] = [];

  constructor(private host: HTMLElement, private fail: (message: string) => void, private report: (stats: StudyStats) => void) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.canvas = this.renderer.domElement;
    this.canvas.dataset.testid = 'f01-canvas';
    this.canvas.setAttribute('aria-label', 'F01 静的3Dモデル。ドラッグで回転、ホイールで拡大。代替操作ボタンも使用できます。');
    this.canvas.setAttribute('role', 'img');
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.scene.background = new Color('#e3e1da');
    const pmrem = new PMREMGenerator(this.renderer), room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, .04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = .45;
    room.dispose(); pmrem.dispose();
    this.key.position.set(-3.5, 6, 5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.left = -3; this.key.shadow.camera.right = 3;
    this.key.shadow.camera.top = 4; this.key.shadow.camera.bottom = -3;
    this.key.shadow.camera.near = .1; this.key.shadow.camera.far = 20;
    this.key.shadow.normalBias = .012; this.key.shadow.bias = -.00015;
    this.fill.position.set(4, 3, 2); this.rim.position.set(1, 4, -4);
    this.scene.add(this.key, this.fill, this.rim, this.hemi, this.ambient, this.hero.root);
    const ground = new Mesh(new PlaneGeometry(200,200), new ShadowMaterial({color:0x56616b,opacity:.18}));
    ground.rotation.x = -Math.PI/2; ground.position.y = -.045; ground.receiveShadow = true;
    const plinth = new Mesh(new CylinderGeometry(1.03,1.06,.065,64),new MeshStandardMaterial({color:'#bcbdb4',roughness:.85,metalness:0}));
    plinth.position.y = -.0125; plinth.receiveShadow = true;
    this.stage.push(ground,plinth);this.scene.add(ground,plinth);
    this.host.append(this.canvas);
    this.controls = new OrbitControls(this.camera,this.canvas);
    this.controls.enableDamping = false;this.controls.enablePan = false;
    this.controls.minZoom = .45;this.controls.maxZoom = 4;
    this.controls.minPolarAngle = .15;this.controls.maxPolarAngle = Math.PI*.52;
    this.controls.addEventListener('change',this.render);
    this.canvas.addEventListener('webglcontextlost',this.onLost);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.setView('oblique');this.resize();
  }
  private onLost = (event: Event) => {
    event.preventDefault();this.lost = true;
    this.fail('GPUコンテキストが失われました。プレビューを再起動してください。');
  };
  private resize = () => {
    if (this.disposed) return;
    const {width,height} = this.host.getBoundingClientRect();
    if (width<1 || height<1) return;
    this.renderer.setSize(width,height,false);
    const aspect=width/height;
    // Preserve the whole silhouette even on a narrow phone canvas.
    const vertical=Math.max(this.span,this.span*.76/aspect);
    this.camera.left=-vertical*aspect/2;this.camera.right=vertical*aspect/2;
    this.camera.top=vertical/2;this.camera.bottom=-vertical/2;
    this.camera.updateProjectionMatrix();this.render();
  };
  render = () => {
    if(this.disposed || this.lost) return;
    this.renderer.render(this.scene,this.camera);
    let meshes=0;const materials=new Set<Material>();
    this.hero.root.traverse(n=>{if(n instanceof Mesh){meshes++;(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>materials.add(m));}});
    this.canvas.dataset.camera = JSON.stringify([...this.camera.position.toArray(),this.camera.zoom]);
    this.canvas.dataset.fingerprint = this.hero.fingerprint;
    this.report({triangles:this.hero.triangles,meshes,materials:materials.size,drawCalls:this.renderer.info.render.calls,fingerprint:this.hero.fingerprint});
  };
  setView(view: View) {
    const v=VIEWS[view];this.span=v.span;this.camera.zoom=1;
    this.camera.position.set(v.position[0],v.position[1],v.position[2]);this.controls.target.set(v.target[0],v.target[1],v.target[2]);
    this.camera.lookAt(this.controls.target);this.controls.update();this.resize();
  }
  setLight(light: Light) {
    const values = {studio:[3.3,1.5,3,1.5,.45],daylight:[3.7,.6,1,2,.35],neutral:[1.5,1.5,0,2,.15]}[light];
    [this.key.intensity,this.fill.intensity,this.rim.intensity,this.hemi.intensity,this.scene.environmentIntensity]=values;
    this.key.color.set(light==='studio'?0xffecd3:0xffffff);this.fill.color.set(light==='studio'?0xc2d9ed:0xffffff);
    this.render();
  }
  setWireframe(wireframe:boolean) {
    this.hero.root.traverse(n=>{if(n instanceof Mesh)(n.material as MeshStandardMaterial).wireframe=wireframe;});this.render();
  }
  regenerate(definition: F01Definition = DEFAULT_F01) {
    if(this.lost)throw new Error('GPUコンテキストが失われています。プレビューを再起動してください。');
    const next=buildF01(definition);this.scene.remove(this.hero.root);this.hero.dispose();this.hero=next;this.scene.add(next.root);this.render();
  }
  rotate(angle:number) {
    const offset=this.camera.position.clone().sub(this.controls.target).applyAxisAngle(new Vector3(0,1,0),angle);
    this.camera.position.copy(this.controls.target).add(offset);this.controls.update();this.render();
  }
  zoom(factor:number) {this.camera.zoom=Math.max(.45,Math.min(4,this.camera.zoom*factor));this.camera.updateProjectionMatrix();this.render();}
  dispose() {
    if(this.disposed)return;this.disposed=true;this.observer.disconnect();
    this.controls.removeEventListener('change',this.render);this.controls.dispose();
    this.canvas.removeEventListener('webglcontextlost',this.onLost);
    this.hero.dispose();this.environment.dispose();this.key.shadow.dispose();
    for(const mesh of this.stage){(mesh.geometry as BufferGeometry).dispose();(mesh.material as Material).dispose();}
    this.scene.clear();this.renderer.dispose();this.renderer.forceContextLoss();this.canvas.remove();
  }
}
