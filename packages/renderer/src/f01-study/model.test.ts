import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Mesh, Vector3, Raycaster } from 'three';
import { buildF01, DEFAULT_F01, snapshotF01 } from './model';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
describe('F01 code-authored static model', () => {
  it('contains all independently authored parts, with no external asset', () => {
    const hero = buildF01();
    for (const part of ['head', 'face', 'hair', 'chest', 'shoulders', 'arms', 'legs', 'cape', 'shield', 'sword']) {
      expect(hero.root.getObjectByName(part), part).toBeDefined();
    }
    expect(hero.triangles).toBeGreaterThan(500);
    expect(hero.triangles).toBeLessThan(20000);
    hero.dispose();
  });
  it('reproduces exact geometry, normals, transforms and material values from the same definition', () => {
    const a = buildF01(), b = buildF01();
    expect(digest(snapshotF01(a.root))).toBe(digest(snapshotF01(b.root)));
    expect(a.fingerprint).toBe(b.fingerprint);
    a.dispose(); b.dispose();
  });
  it('keeps the exact input definition in model metadata without mutating it', () => {
    const definition=structuredClone(DEFAULT_F01), before=JSON.stringify(definition);
    const hero=buildF01(definition);
    expect(JSON.stringify(definition)).toBe(before);
    expect(hero.root.userData.definition).toEqual(definition);
    hero.dispose();
  });
  it('seed and proportions affect the actual mesh, not only metadata', () => {
    const a = buildF01(), b = buildF01({ ...DEFAULT_F01, seed: 42 });
    const c = buildF01({ ...DEFAULT_F01, shoulderWidth: 1.1 });
    expect(digest(snapshotF01(a.root))).not.toBe(digest(snapshotF01(b.root)));
    expect(digest(snapshotF01(a.root))).not.toBe(digest(snapshotF01(c.root)));
    for (const h of [a,b,c]) h.dispose();
  });
  it('has finite positions, unit normals and no degenerate triangles', () => {
    const hero = buildF01();
    hero.root.traverse(node => {
      if (!(node instanceof Mesh)) return;
      const g = node.geometry, p = g.getAttribute('position'), n = g.getAttribute('normal');
      expect(g.type).toBe('BufferGeometry');
      for (const value of p.array) expect(Number.isFinite(value), node.name).toBe(true);
      for (let i=0; i<n.count; i++) expect(new Vector3().fromBufferAttribute(n,i).length(), node.name).toBeCloseTo(1,4);
      const idx = g.index;
      for(let i=0; i<(idx?.count ?? p.count); i+=3) {
        const a=new Vector3().fromBufferAttribute(p,idx?idx.getX(i):i);
        const b=new Vector3().fromBufferAttribute(p,idx?idx.getX(i+1):i+1);
        const c=new Vector3().fromBufferAttribute(p,idx?idx.getX(i+2):i+2);
        expect(b.sub(a).cross(c.sub(a)).lengthSq(),node.name).toBeGreaterThan(1e-16);
      }
    });
    hero.dispose();
  });
  it('closed footwear and cape face outward, with positive signed volume', () => {
    const hero=buildF01();
    hero.root.traverse(node=>{if(node instanceof Mesh && /^(sole|sabatons|tailored-cape)-/.test(node.name)){
      const p=node.geometry.getAttribute('position');let volume=0;
      for(let i=0;i<p.count;i+=3){
        const a=new Vector3().fromBufferAttribute(p,i),b=new Vector3().fromBufferAttribute(p,i+1),c=new Vector3().fromBufferAttribute(p,i+2);
        volume+=a.dot(b.cross(c))/6;
      }
      expect(volume,node.name).toBeGreaterThan(0);
    }});hero.dispose();
  });
  it('keeps the shield enamel in front of its backing rim', () => {
    const hero=buildF01();hero.root.updateMatrixWorld(true);
    let rim:Mesh|undefined,field:Mesh|undefined;
    hero.root.traverse(n=>{if(n instanceof Mesh){if(n.name.startsWith('shield-rim-'))rim=n;if(n.name.startsWith('shield-field-'))field=n;}});
    expect(rim).toBeDefined();expect(field).toBeDefined();
    const shield=hero.root.getObjectByName('shield')!;
    const origin=shield.localToWorld(new Vector3(0,0,2));
    const direction=new Vector3(0,0,-1).transformDirection(shield.matrixWorld);
    const ray=new Raycaster(origin,direction);
    expect(ray.intersectObject(field!,false)[0].distance).toBeLessThan(ray.intersectObject(rim!,false)[0].distance);
    hero.dispose();
  });
  it('rejects nonfinite or unsupported shape parameters before allocating geometry', () => {
    expect(()=>buildF01({...DEFAULT_F01,seed:NaN})).toThrow();
    expect(()=>buildF01({...DEFAULT_F01,shoulderWidth:0})).toThrow();
  });
  it('releases every owned geometry/material exactly once, even on repeated disposal', () => {
    const hero=buildF01(); let geometry=0, material=0; const geometries=new Set(), materials=new Set();
    hero.root.traverse(n=>{if(n instanceof Mesh){
      geometries.add(n.geometry);n.geometry.addEventListener('dispose',()=>geometry++);
      for(const m of Array.isArray(n.material)?n.material:[n.material]) if(!materials.has(m)) {
        materials.add(m);m.addEventListener('dispose',()=>material++);
      }
    }});
    hero.dispose();hero.dispose();
    expect(geometry).toBe(geometries.size);expect(material).toBe(materials.size);
  });
});
