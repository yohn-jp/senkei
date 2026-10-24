import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2, Vector3 } from 'three';
export type V2 = readonly [number, number];
export type V3 = readonly [number, number, number];
export type Face = readonly number[];

/** Explicit polygons, not a primitive pile. Each face owns its flat normal. */
export function polyhedron(vertices: readonly V3[], faces: readonly Face[]): BufferGeometry {
  const positions: number[] = [];
  for (const face of faces) for (let j = 1; j + 1 < face.length; j++) {
    for (const index of [face[0], face[j], face[j + 1]]) positions.push(...vertices[index]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/** Closed, matched polygonal cross-sections; rings may translate/taper independently. */
export function loft(rings: readonly (readonly V3[])[]): BufferGeometry {
  const n = rings[0].length, vertices = rings.flat() as V3[], faces: number[][] = [];
  // Ring convention: clockwise viewed from +Y; bottom cap therefore points down.
  for (let k = 0; k < rings.length - 1; k++) for (let j = 0; j < n; j++) {
    const a = k*n+j, b = k*n+(j+1)%n;
    faces.push([a,a+n,b+n,b]);
  }
  faces.push(Array.from({length:n},(_,i)=>i));
  faces.push(Array.from({length:n},(_,i)=>(rings.length-1)*n+n-1-i));
  return polyhedron(vertices, faces);
}

export type Section = readonly [y:number, x:number, z:number, width:number, depth:number];
// A chamfered, deliberately non-circular section with a broad front plane.
const OCTAGON: V2[] = [[1,.44],[.64,1],[-.64,1],[-1,.44],[-1,-.5],[-.6,-1],[.6,-1],[1,-.5]];
export function sections(rows: readonly Section[]): BufferGeometry {
  return loft(rows.map(([y,x,z,w,d])=>OCTAGON.map(([u,v])=>[x+u*w,y,z+v*d] as V3)));
}

/** Bevelled convex armour panel; front is +Z. Thickness is real, not double-sided. */
export function panel(points: readonly V2[], depth = .04, bevel = .09, ridge = 0): BufferGeometry {
  const contour = points.map(p=>new Vector2(...p));
  if (ShapeUtils.isClockWise(contour)) contour.reverse();
  const n=contour.length, cx=contour.reduce((s,p)=>s+p.x,0)/n, cy=contour.reduce((s,p)=>s+p.y,0)/n;
  const v: V3[] = contour.map(p=>[p.x,p.y,-depth*.4]);
  v.push(...contour.map(p=>[p.x,p.y,0] as V3));
  v.push(...contour.map(p=>[cx+(p.x-cx)*(1-bevel),cy+(p.y-cy)*(1-bevel),depth] as V3));
  const f: number[][]=[];
  for(let i=0;i<n;i++){
    const j=(i+1)%n;
    f.push([i,j,j+n,i+n],[i+n,j+n,j+2*n,i+2*n]);
  }
  for(const tri of ShapeUtils.triangulateShape(contour,[])) f.push([...tri].reverse());
  if(ridge) {
    v.push([cx,cy,depth+ridge]);
    for(let i=0;i<n;i++) f.push([2*n+i,2*n+(i+1)%n,3*n]);
  } else for(const tri of ShapeUtils.triangulateShape(contour,[])) f.push(tri.map(i=>i+2*n));
  return polyhedron(v,f);
}

/** A swept, chisel-shaped hair lock. Four-sided sections, with a solid tapered end. */
export function hairLock(rows: readonly (readonly [number,number,number,number,number])[]): BufferGeometry {
  const v: V3[]=[], f: number[][]=[];
  for(const [x,y,z,w,t] of rows) v.push([x-w,y,z],[x,y+t*.6,z+t],[x+w,y,z],[x,y-t*.45,z-t*.35]);
  for(let i=0;i<rows.length-1;i++) for(let j=0;j<4;j++){
    const a=i*4+j,b=i*4+(j+1)%4;f.push([a,b,b+4,a+4]);
  }
  f.push([3,2,1,0],[v.length-4,v.length-3,v.length-2,v.length-1]);
  // Locks are small convex-ish solids; keep their faces outward relative to the section path.
  const center = new Vector3();v.forEach(p=>center.add(new Vector3(...p)));center.divideScalar(v.length);
  const corrected=f.map(face=>{
    const a=new Vector3(...v[face[0]]), b=new Vector3(...v[face[1]]), c=new Vector3(...v[face[2]]);
    return b.sub(a).cross(c.sub(a)).dot(a.sub(center))<0?[...face].reverse():face;
  });
  return polyhedron(v,corrected);
}
