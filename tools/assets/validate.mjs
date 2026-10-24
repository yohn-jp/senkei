import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateBytes } from 'gltf-validator';
const root = new URL('../../', import.meta.url);
const hero = process.argv[2] ?? 'f01';
if (!/^[fr]0[1-6]$/.test(hero)) throw new Error('Invalid hero key');
const manifest = JSON.parse(await readFile(new URL(`assets/manifests/${hero}.json`, root)));
const sourceHashMatches = (await Promise.all(Object.entries(manifest.sourceHashes).map(async ([path, hash]) => createHash('sha256').update(await readFile(new URL(path,root))).digest('hex') === hash))).every(Boolean);
const reports = [];
for (const lod of manifest.lods) {
  const bytes = await readFile(new URL(lod.file, root));
  const report = await validateBytes(new Uint8Array(bytes), { uri: lod.file, maxIssues: 1000 });
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binOffset = 20 + jsonLength + 8;
  function accessorValues(index) {
    const a=gltf.accessors[index], v=gltf.bufferViews[a.bufferView];
    if (a.componentType !== 5126 || v.byteStride) throw new Error('Expected packed float animation data');
    const width = { SCALAR:1, VEC3:3, VEC4:4 }[a.type];
    const offset=binOffset+(v.byteOffset ?? 0)+(a.byteOffset ?? 0);
    return Array.from({length:a.count*width},(_,i)=>bytes.readFloatLE(offset+i*4));
  }
  const animationChecks=gltf.animations.map(a=>{
    const closed=a.samplers.every(s=>{
      const width={SCALAR:1,VEC3:3,VEC4:4}[gltf.accessors[s.output].type];
      const vs=accessorValues(s.output);
      const same = vs.slice(0,width).every((v,i)=>Math.abs(v-vs[vs.length-width+i])<1e-5);
      // q and -q encode the same orientation.
      const opposite = width === 4 && vs.slice(0,width).every((v,i)=>Math.abs(v+vs[vs.length-width+i])<1e-5);
      return same || opposite;
    });
    return {name:a.name,closedGuardPose:closed,duration:Math.max(...a.samplers.map(s=>accessorValues(s.input).at(-1)))};
  });
  const checks = {
    sourceHashMatches,
    guardEndpoints: animationChecks.filter(a=>a.name!=='Death').every(a=>a.closedGuardPose),
    deathHasDistinctEnd: animationChecks.find(a=>a.name==='Death')?.closedGuardPose === false,
    hashMatches: createHash('sha256').update(bytes).digest('hex') === lod.sha256,
    embeddedTexture: gltf.images?.every(i => i.bufferView !== undefined) && gltf.images.length > 0,
    rigPresent: gltf.skins?.length > 0,
    fiveNamedClips: ['Idle','Walk','Attack','Skill','Death'].every(n => gltf.animations?.filter(a => a.name === n).length === 1),
    materialCount: gltf.materials.length,
    noExternalBuffers: gltf.buffers.every(b => !b.uri),
  };
  reports.push({ level: lod.level, checks, animations: animationChecks, validator: report });
  if (report.issues.numErrors || report.issues.numWarnings || Object.values(checks).some(v => v === false)) process.exitCode = 1;
  console.log(lod.level, JSON.stringify({ errors: report.issues.numErrors, warnings: report.issues.numWarnings, checks }));
}
await writeFile(new URL(`docs/evidence/${hero}/gltf-validation.json`, root), JSON.stringify(reports, null, 2) + '\n');
