import type { DisplayEntity, DisplayState, Replay, WorldPoint } from "@senkei/replay-contract";

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const GOLDEN_FRACTION = (Math.sqrt(5) - 1) / 2;
const MAX_NODE_RADIUS = 2.1;
const EDGE_STRIDE = 0.65;
const MAX_EDGE_OFFSET = 1.3;

type NodeRecord = NonNullable<Replay["scene"]["nodes"]>[number];
type RouteRecord = NonNullable<Replay["scene"]["routes"]>[number];

interface EdgeUnit {
  entity: DisplayEntity;
  domain: string;
  coincidence: string;
  from: string;
  to: string;
  track: string;
  progress: number;
}

interface EdgeFrame {
  from: WorldPoint;
  to: WorldPoint;
  length: number;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stablePhase(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0x1_0000_0000) * TAU;
}

function circularOrder(count: number): number[] {
  const chosen: number[] = [];
  const remaining = new Set(Array.from({ length: count }, (_, index) => index));
  while (remaining.size) {
    let best = -1;
    let bestDistance = -1;
    for (const candidate of remaining) {
      const distance = chosen.length === 0
        ? 0
        : Math.min(...chosen.map((prior) => {
            const raw = Math.abs(candidate - prior);
            return Math.min(raw, count - raw);
          }));
      if (distance > bestDistance || (distance === bestDistance && candidate < best)) {
        best = candidate;
        bestDistance = distance;
      }
    }
    chosen.push(best);
    remaining.delete(best);
  }
  return chosen;
}

function linearOrder(count: number): number[] {
  const chosen: number[] = [];
  const remaining = new Set(Array.from({ length: count }, (_, index) => index));
  while (remaining.size) {
    let best = -1;
    let bestDistance = -1;
    for (const candidate of remaining) {
      const distance = chosen.length === 0
        ? 0
        : Math.min(...chosen.map((prior) => Math.abs(candidate - prior)));
      if (distance > bestDistance || (distance === bestDistance && candidate < best)) {
        best = candidate;
        bestDistance = distance;
      }
    }
    chosen.push(best);
    remaining.delete(best);
  }
  return chosen;
}

function ordinaryNodeSlots(node: NodeRecord, count: number): WorldPoint[] {
  const id = node.id.toUpperCase();
  let radii: number[];
  if (id === "N.MID.OBS") radii = [1.25, 1.7, 2.05];
  else if (/^[AB]\.BASE$/.test(id)) radii = [1.5, 1.85, 2.1];
  else if (/^[AB]\.(TOP|MID|BOT)\.T[12]$/.test(id)) radii = [2.0, 2.05, 2.1];
  else radii = [1.1, 1.55, 2.0, 2.1];

  const phase = stablePhase(node.id);
  const slots: WorldPoint[] = [];
  for (let ring = 0; ring < radii.length && slots.length < count; ring++) {
    const radius = Math.min(MAX_NODE_RADIUS, radii[ring]);
    const capacity = Math.max(8, Math.ceil(TAU * radius / 0.9));
    for (const index of circularOrder(capacity)) {
      const angle = phase + ring * GOLDEN_ANGLE + index * TAU / capacity;
      slots.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
      if (slots.length >= count) break;
    }
  }
  while (slots.length < count) {
    const overflow = slots.length;
    const angle = phase + overflow * GOLDEN_ANGLE;
    slots.push({ x: Math.cos(angle) * MAX_NODE_RADIUS, y: Math.sin(angle) * MAX_NODE_RADIUS });
  }
  return slots;
}

interface RiverFrame {
  outward: WorldPoint;
  tangent: WorldPoint;
}

function riverFrame(node: NodeRecord, replay: Replay): RiverFrame {
  const river = replay.scene.river;
  let nearest: WorldPoint | undefined;
  let segment: WorldPoint | undefined;
  let bestDistance = Infinity;
  if (river && river.length >= 2) {
    for (let index = 0; index < river.length - 1; index++) {
      const start = river[index], end = river[index + 1];
      const dx = end.x - start.x, dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared <= 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((node.position.x - start.x) * dx + (node.position.y - start.y) * dy) / lengthSquared));
      const point = { x: start.x + t * dx, y: start.y + t * dy };
      const distance = (node.position.x - point.x) ** 2 + (node.position.y - point.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = point;
        segment = { x: dx, y: dy };
      }
    }
  }

  let ox = nearest ? node.position.x - nearest.x : 0;
  let oy = nearest ? node.position.y - nearest.y : 0;
  let size = Math.hypot(ox, oy);
  if (size < 1e-8) {
    const dx = segment?.x ?? 1;
    const dy = segment?.y ?? 0;
    ox = -dy;
    oy = dx;
    const riverCenter = river?.length
      ? river.reduce((sum, point) => ({ x: sum.x + point.x / river.length, y: sum.y + point.y / river.length }), { x: 0, y: 0 })
      : { x: (replay.scene.bounds.min.x + replay.scene.bounds.max.x) / 2, y: (replay.scene.bounds.min.y + replay.scene.bounds.max.y) / 2 };
    const side = ox * (node.position.x - riverCenter.x) + oy * (node.position.y - riverCenter.y);
    if (side < 0 || (Math.abs(side) < 1e-8 && ox < 0)) {
      ox = -ox;
      oy = -oy;
    }
    size = Math.hypot(ox, oy);
  }
  if (size < 1e-8) {
    ox = 1;
    oy = 0;
    size = 1;
  }
  const outward = { x: ox / size, y: oy / size };
  return { outward, tangent: { x: -outward.y, y: outward.x } };
}

function bankNodeSlots(node: NodeRecord, replay: Replay, count: number): WorldPoint[] {
  const frame = riverFrame(node, replay);
  const radii = [0.45, 0.85, 1.25, 1.55, 1.8, 2.05];
  const capacities = [1, 3, 5, 9, 13, 17];
  const slots: WorldPoint[] = [];
  for (let ring = 0; ring < radii.length && slots.length < count; ring++) {
    const radius = radii[ring];
    const maxAngle = Math.acos(Math.min(1, 0.3 / radius));
    const capacity = capacities[ring];
    for (const index of linearOrder(capacity)) {
      const angle = capacity === 1 ? 0 : -maxAngle + (2 * maxAngle * index) / (capacity - 1);
      const normalPart = radius * Math.cos(angle);
      const tangentPart = radius * Math.sin(angle);
      slots.push({
        x: frame.outward.x * normalPart + frame.tangent.x * tangentPart,
        y: frame.outward.y * normalPart + frame.tangent.y * tangentPart,
      });
      if (slots.length >= count) break;
    }
  }
  while (slots.length < count) {
    const overflow = slots.length - capacities.reduce((sum, value) => sum + value, 0);
    const fraction = (0.5 + overflow * GOLDEN_FRACTION) % 1;
    const maxAngle = Math.acos(0.3 / MAX_NODE_RADIUS);
    const angle = (fraction * 2 - 1) * maxAngle;
    const normalPart = MAX_NODE_RADIUS * Math.cos(angle);
    const tangentPart = MAX_NODE_RADIUS * Math.sin(angle);
    slots.push({
      x: frame.outward.x * normalPart + frame.tangent.x * tangentPart,
      y: frame.outward.y * normalPart + frame.tangent.y * tangentPart,
    });
  }
  return slots;
}

function settledNode(entity: DisplayEntity): string | undefined {
  if (entity.kind !== "unit") return undefined;
  const position = entity.battlefield;
  if (!position?.node || position.edgeTo) return undefined;
  if (position.crossing && position.crossing !== "none") return undefined;
  return position.node;
}

function edgeUnit(entity: DisplayEntity): EdgeUnit | undefined {
  if (entity.kind !== "unit" || !entity.battlefield?.node || !entity.battlefield.edgeTo) return undefined;
  const position = entity.battlefield;
  if (!position.track || !Number.isInteger(position.progress)) return undefined;
  const from = position.node ?? "";
  const to = position.edgeTo ?? "";
  if (!from || !to) return undefined;
  const track = position.track;
  const progress = position.progress as number;
  const domain = `${from}\u0000${to}\u0000${track}`;
  return { entity, domain, coincidence: `${domain}\u0000${progress}`, from, to, track, progress };
}

function closestEdgeFrame(from: NodeRecord, to: NodeRecord, replay: Replay): EdgeFrame {
  const fromPoint = from.position;
  const toPoint = to.position;
  let best: EdgeFrame = {
    from: fromPoint,
    to: toPoint,
    length: Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y),
  };
  let bestError = Infinity;
  for (const route of replay.scene.routes ?? []) {
    const first = route.points[0], last = route.points[route.points.length - 1];
    const forward = Math.hypot(first.x - fromPoint.x, first.y - fromPoint.y) + Math.hypot(last.x - toPoint.x, last.y - toPoint.y);
    const reverse = Math.hypot(first.x - toPoint.x, first.y - toPoint.y) + Math.hypot(last.x - fromPoint.x, last.y - fromPoint.y);
    const error = Math.min(forward, reverse);
    if (error < bestError) {
      bestError = error;
      best = forward <= reverse
        ? { from: first, to: last, length: Math.hypot(last.x - first.x, last.y - first.y) }
        : { from: last, to: first, length: Math.hypot(last.x - first.x, last.y - first.y) };
    }
  }
  return bestError <= 1e-5 ? best : {
    from: fromPoint,
    to: toPoint,
    length: Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y),
  };
}

function edgeFraction(entity: DisplayEntity, frame: EdgeFrame): number {
  if (frame.length <= 1e-8) return 0.5;
  // The authorized public position is Enbu's rendering of logical edge progress;
  // projecting it onto the public route gives the physical endpoint clearance.
  const dx = frame.to.x - frame.from.x, dy = frame.to.y - frame.from.y;
  return Math.max(0, Math.min(1, ((entity.position.x - frame.from.x) * dx + (entity.position.y - frame.from.y) * dy) / (frame.length * frame.length)));
}

function signedEdgeOffset(slot: number): number {
  const initial = [0, -1, 1, -2, 2];
  if (slot < initial.length) return initial[slot] * EDGE_STRIDE;
  const extra = slot - initial.length;
  const magnitude = EDGE_STRIDE / 2 ** (Math.floor(extra / 2) + 1);
  return (extra % 2 === 0 ? -1 : 1) * magnitude;
}

/** Presentation-only offsets for units sharing a discrete node or visible edge progress. */
export class NodeDisplayLayout {
  private readonly nodeSlots = new Map<string, Map<string, number>>();
  private readonly edgeSlots = new Map<string, Map<string, number>>();

  update(state: DisplayState, replay: Replay): ReadonlyMap<string, WorldPoint> {
    const nodes = new Map((replay.scene.nodes ?? []).map((node) => [node.id, node]));
    const nodeOccupants = new Map<string, Set<string>>();
    const visibleEdges: EdgeUnit[] = [];

    for (const entity of Object.values(state.entities).sort((left, right) => compareIds(left.id, right.id))) {
      const node = settledNode(entity);
      if (node && nodes.has(node)) {
        const occupants = nodeOccupants.get(node) ?? new Set<string>();
        occupants.add(entity.id);
        nodeOccupants.set(node, occupants);
      }
      const edge = edgeUnit(entity);
      if (edge && nodes.has(edge.from) && nodes.has(edge.to)) visibleEdges.push(edge);
    }

    for (const [node, slots] of this.nodeSlots) {
      const visible = nodeOccupants.get(node) ?? new Set<string>();
      for (const id of slots.keys()) if (!visible.has(id)) slots.delete(id);
      if (slots.size === 0) this.nodeSlots.delete(node);
    }
    for (const [node, occupants] of nodeOccupants) {
      const slots = this.nodeSlots.get(node) ?? new Map<string, number>();
      const used = new Set(slots.values());
      for (const id of [...occupants].sort(compareIds)) {
        if (slots.has(id)) continue;
        let index = 0;
        while (used.has(index)) index++;
        slots.set(id, index);
        used.add(index);
      }
      this.nodeSlots.set(node, slots);
    }

    const edgesByDomain = new Map<string, EdgeUnit[]>();
    const coincidences = new Map<string, EdgeUnit[]>();
    for (const edge of visibleEdges) {
      const domain = edgesByDomain.get(edge.domain) ?? [];
      domain.push(edge);
      edgesByDomain.set(edge.domain, domain);
      const group = coincidences.get(edge.coincidence) ?? [];
      group.push(edge);
      coincidences.set(edge.coincidence, group);
    }
    const activeEdgeDomains = new Set<string>();
    for (const group of coincidences.values()) if (group.length > 1) activeEdgeDomains.add(group[0].domain);
    for (const [domain, slots] of this.edgeSlots) {
      const current = edgesByDomain.get(domain) ?? [];
      const visible = new Set(current.map(({ entity }) => entity.id));
      for (const id of slots.keys()) if (!visible.has(id)) slots.delete(id);
      if (slots.size === 0) this.edgeSlots.delete(domain);
      else activeEdgeDomains.add(domain);
    }
    for (const domain of activeEdgeDomains) {
      const occupants = edgesByDomain.get(domain) ?? [];
      if (occupants.length === 0) continue;
      const slots = this.edgeSlots.get(domain) ?? new Map<string, number>();
      const used = new Set(slots.values());
      for (const id of [...new Set(occupants.map(({ entity }) => entity.id))].sort(compareIds)) {
        if (slots.has(id)) continue;
        let index = 0;
        while (used.has(index)) index++;
        slots.set(id, index);
        used.add(index);
      }
      this.edgeSlots.set(domain, slots);
    }

    const offsets = new Map<string, WorldPoint>();
    for (const [nodeId, occupants] of nodeOccupants) {
      const node = nodes.get(nodeId)!;
      const ids = [...occupants].sort(compareIds);
      const slots = this.nodeSlots.get(nodeId)!;
      const positions = nodeId.toUpperCase().endsWith(".BANK")
        ? bankNodeSlots(node, replay, Math.max(...[...slots.values()], -1) + 1)
        : ordinaryNodeSlots(node, Math.max(...[...slots.values()], -1) + 1);
      for (const id of ids) {
        const entity = state.entities[id];
        const delta = positions[slots.get(id)!];
        offsets.set(id, { x: node.position.x + delta.x - entity.position.x, y: node.position.y + delta.y - entity.position.y });
      }
    }

    for (const group of coincidences.values()) {
      if (group.length < 2 || !activeEdgeDomains.has(group[0].domain)) continue;
      const domain = group[0].domain;
      const slots = this.edgeSlots.get(domain);
      if (!slots) continue;
      const from = nodes.get(group[0].from)!, to = nodes.get(group[0].to)!;
      const frame = closestEdgeFrame(from, to, replay);
      const directionX = frame.to.x - frame.from.x;
      const directionY = frame.to.y - frame.from.y;
      if (frame.length <= 1e-8) continue;
      const unitX = directionX / frame.length, unitY = directionY / frame.length;
      const maxAbs = Math.max(...group.map(({ entity }) => Math.abs(signedEdgeOffset(slots.get(entity.id)!))));
      const fraction = edgeFraction(group[0].entity, frame);
      const room = Math.min(fraction * frame.length, (1 - fraction) * frame.length);
      const compression = maxAbs > 0 ? Math.min(1, room / maxAbs) : 1;
      for (const { entity } of group) {
        const distance = signedEdgeOffset(slots.get(entity.id)!) * compression;
        offsets.set(entity.id, {
          x: distance === 0 || unitX === 0 ? 0 : unitX * distance,
          y: distance === 0 || unitY === 0 ? 0 : unitY * distance,
        });
      }
    }
    return offsets;
  }
}
