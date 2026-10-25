import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { completePreflight } from "../helpers/preflight";

test.use({ video: "on" });

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const baselineSha = "c9fe67c0b28b2806dbfd70b5c6995ba4e3008acb";
const viewportCases = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "430x932", width: 430, height: 932 },
  { name: "390x844", width: 390, height: 844 },
  { name: "320x844", width: 320, height: 844 },
] as const;
type ViewportCase = (typeof viewportCases)[number];

function selectViewportCases(selection: string | undefined): ViewportCase[] {
  if (!selection) return [...viewportCases];
  const requested = selection.split(",").map((name) => name.trim()).filter(Boolean);
  const chosen = requested.map((name) => viewportCases.find((viewport) => viewport.name === name));
  if (!chosen.length || chosen.some((viewport) => !viewport)) {
    throw new Error(`Unknown BATTLEFIELD_VIEWPORTS value: ${selection}`);
  }
  return chosen as ViewportCase[];
}

type JsonRecord = Record<string, any>;
type BaseSiteLabelSnapshot = {
  siteId: string;
  siteState: string;
  side: "azure" | "vermilion" | null;
  text: string;
  datasetKeys: string[];
};
// Keep this tied to NEXT_WORLD_UNITS_PER_RENDER_UNIT from the replay adapter.
const nextWorldUnitsPerRenderUnit = 25;

function observedBaseSiteStateAt(replay: JsonRecord, tick: number, siteId: string): "unknown" | "visible" | "destroyed" {
  const frame = (replay.frames as JsonRecord[] | undefined)?.find((candidate) => candidate.tick === tick);
  const entities = frame?.visible_state?.entities as Record<string, JsonRecord> | undefined;
  const base = Object.values(entities ?? {}).find((entity) =>
    entity.entity_type === "base" && entity.fields?.node?.kind === "string" && entity.fields.node.value === siteId,
  );
  if (!base) return "unknown";
  return base.fields?.hp?.kind === "integer" && base.fields.hp.value === 0 ? "destroyed" : "visible";
}

function firstObservedBaseSiteTick(replay: JsonRecord, siteId: string): number | null {
  return (replay.frames as JsonRecord[] | undefined)?.find((frame) => {
    const entities = frame.visible_state?.entities as Record<string, JsonRecord> | undefined;
    return Object.values(entities ?? {}).some((entity) =>
      entity.entity_type === "base" && entity.fields?.node?.kind === "string" && entity.fields.node.value === siteId,
    );
  })?.tick ?? null;
}

function firstUnobservedBaseSiteTick(replay: JsonRecord, siteId: string, afterTick: number): number | null {
  return (replay.frames as JsonRecord[] | undefined)?.find((frame) => {
    if (frame.tick <= afterTick) return false;
    const entities = frame.visible_state?.entities as Record<string, JsonRecord> | undefined;
    return !Object.values(entities ?? {}).some((entity) =>
      entity.entity_type === "base" && entity.fields?.node?.kind === "string" && entity.fields.node.value === siteId,
    );
  })?.tick ?? null;
}

function baseSiteSideFromLabel(text: string, siteId: string): "azure" | "vermilion" | null {
  if (siteId === "A.BASE") return "azure";
  if (siteId === "B.BASE") return "vermilion";
  if (/^AZURE (?:BASE|FORTRESS)\b/.test(text)) return "azure";
  if (/^VERMILION (?:BASE|FORTRESS)\b/.test(text)) return "vermilion";
  return null;
}

async function assertBaseSiteLabelsAtTick(
  page: import("@playwright/test").Page,
  canvas: import("@playwright/test").Locator,
  replay: JsonRecord,
  tick: number,
): Promise<BaseSiteLabelSnapshot[]> {
  await expect(canvas).toHaveAttribute("data-tick", String(tick));
  const labels = (await page.locator(".base-site-label").evaluateAll((elements) => elements.map((element) => {
    const label = element as HTMLElement;
    const text = (label.textContent ?? "").replace(/\s+/g, " ").trim();
    return {
      siteId: label.dataset.siteId ?? "",
      siteState: label.dataset.siteState ?? "",
      text,
      datasetKeys: Object.keys(label.dataset).sort(),
    };
  }))).map((label) => ({ ...label, side: baseSiteSideFromLabel(label.text, label.siteId) }));
  expect(labels, "the map should annotate both public base sites").toHaveLength(2);
  expect(new Set(labels.map((label) => label.siteId)).size).toBe(2);
  for (const label of labels) {
    expect(label.siteId).not.toBe("");
    expect(label.datasetKeys).toContain("siteId");
    expect(label.datasetKeys).toContain("siteState");
    expect(label.datasetKeys.join(" ")).not.toMatch(/hp|max_hp|owner|slot|squad|cooldown|diagnostic|private|vision/i);
    expect(["unknown", "visible", "destroyed"]).toContain(label.siteState);
    expect(label.siteState).toBe(observedBaseSiteStateAt(replay, tick, label.siteId));
    expect(label.text).not.toMatch(/\b(?:hp|owner|private|slot|squad|cooldown|vision)\b|\b\d{2,}\b/i);
  }
  return labels;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function seekToTick(page: import("@playwright/test").Page, tick: number): Promise<void> {
  const slider = page.getByRole("slider", { name: "Seek replay tick" });
  await slider.evaluate((element, selectedTick) => {
    const input = element as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(input, String(selectedTick));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, tick);
  await expect(slider).toHaveValue(String(tick));
  await expect(page.locator(".next-renderer-host canvas")).toHaveAttribute("data-tick", String(tick));
}

async function clickCameraMode(page: import("@playwright/test").Page, mode: "tactical" | "overview"): Promise<boolean> {
  const candidates = mode === "tactical"
    ? [/^Tactical view$/i, /^Tactical$/i, /^Battle view$/i]
    : [/^Overview view$/i, /^Overview$/i];
  for (const name of candidates) {
    const button = page.getByRole("button", { name });
    if (await button.count()) {
      await button.first().click();
      return true;
    }
  }
  // c9fe67c has no explicit camera modes. Its default pose and Overview
  // control both reset to the same whole-world pose; record that limitation.
  return false;
}

type FollowTarget = { supported: boolean; target: string | null; id: string | null; catalogId: string | null };

async function clickFollow(page: import("@playwright/test").Page): Promise<FollowTarget> {
  const selector = page.getByRole("combobox", { name: /Observe visible entity/i });
  if (!(await selector.count())) return { supported: false, target: null, id: null, catalogId: null };
  const value = await selector.locator("option").evaluateAll((options) => {
    const hero = options.find((option) => /\b[FR]0[1-6]\b/.test(option.textContent ?? ""));
    const firstTarget = options.find((option) => Boolean(option.getAttribute("value")));
    return hero?.getAttribute("value") ?? firstTarget?.getAttribute("value") ?? null;
  });
  if (!value) return { supported: false, target: null, id: null, catalogId: null };
  await selector.selectOption(value);
  const target = await selector.locator("option:checked").innerText();
  const catalogId = target.match(/\b[FR]0[1-6]\b/)?.[0] ?? null;
  const followButton = page.getByRole("button", { name: /^(Follow selected unit|Follow|Follow view)$/i });
  if (!(await followButton.count())) return { supported: false, target, id: value, catalogId };
  await followButton.first().click();
  return { supported: true, target, id: value, catalogId };
}

async function clickFollowRole(
  page: import("@playwright/test").Page,
  role: "monster" | "minion",
): Promise<FollowTarget> {
  const selector = page.getByRole("combobox", { name: /Observe visible entity/i });
  if (!(await selector.count())) return { supported: false, target: null, id: null, catalogId: null };
  const value = await selector.locator("option").evaluateAll((options, selectedRole) => {
    const rolePattern = new RegExp(`\\b${selectedRole}\\b`, "i");
    const option = options.find((candidate) =>
      Boolean((candidate as HTMLOptionElement).value) && rolePattern.test(candidate.textContent ?? ""),
    ) as HTMLOptionElement | undefined;
    return option?.value ?? null;
  }, role);
  if (!value) return { supported: false, target: null, id: null, catalogId: null };
  await selector.selectOption(value);
  const target = await selector.locator("option:checked").innerText();
  const followButton = page.getByRole("button", { name: /^(Follow selected unit|Follow)$/i });
  if (!(await followButton.count())) return { supported: false, target, id: value, catalogId: null };
  await followButton.first().click();
  return { supported: true, target, id: value, catalogId: null };
}

async function selectVisibleHero(
  page: import("@playwright/test").Page,
  catalogId: string,
): Promise<FollowTarget> {
  const selector = page.getByRole("combobox", { name: /Observe visible entity/i });
  const option = await selector.locator("option").evaluateAll((options, requestedCatalogId) => {
    const pattern = new RegExp(`(?:^| · )${requestedCatalogId}(?: ·|\\s)`);
    const selected = options.find((candidate) => {
      const element = candidate as HTMLOptionElement;
      return Boolean(element.value) && pattern.test(element.textContent ?? "");
    }) as HTMLOptionElement | undefined;
    return selected ? { value: selected.value, label: (selected.textContent ?? "").trim() } : null;
  }, catalogId);
  if (!option) return { supported: false, target: null, id: null, catalogId: null };
  await selector.selectOption(option.value);
  return { supported: true, target: option.label, id: option.value, catalogId };
}

function replayHeroPosition(
  replay: JsonRecord,
  tick: number,
  target: FollowTarget,
  ruleset: JsonRecord,
): { id: string; x: number; z: number; sourceX: number; sourceY: number; laneTrackOffset: { x: number; z: number } } | null {
  const frame = (replay.frames ?? []).find((candidate: JsonRecord) => candidate.tick === tick);
  const entities = frame?.visible_state?.entities as Record<string, JsonRecord> | undefined;
  if (!entities) return null;
  const readInteger = (entity: JsonRecord | undefined, key: "x" | "y"): number | null => {
    const field = entity?.fields?.[key];
    return field?.kind === "integer" && Number.isFinite(field.value) ? field.value : null;
  };
  const direct = target.id ? entities[target.id] : undefined;
  const entity = direct?.entity_type === "hero" ? direct : Object.values(entities).find((candidate) =>
    candidate.entity_type === "hero" && candidate.fields?.catalog_id?.value === target.catalogId,
  );
  if (!entity) return null;
  const id = Object.entries(entities).find(([, candidate]) => candidate === entity)?.[0];
  const x = readInteger(entity, "x");
  const z = readInteger(entity, "y");
  if (!id || x === null || z === null) return null;

  // Moving entities are projected by the replay adapter onto the canonical
  // World presentation polyline using logical edge_progress/edge.length.
  // The renderer then offsets ordinary lane LEFT/RIGHT tracks along the
  // nearest segment tangent. Reproduce those two production steps from the
  // same World presentation payload and authorized fields.
  const rawField = (key: string): JsonRecord | undefined => entity.fields?.[key];
  const stringField = (key: string): string | null => {
    const field = rawField(key);
    return (field?.kind === "string" || field?.kind === "enum") && typeof field.value === "string"
      ? field.value
      : null;
  };
  const integerField = (key: string): number => {
    const field = rawField(key);
    return field?.kind === "integer" && Number.isSafeInteger(field.value) ? field.value : 0;
  };
  const node = stringField("node");
  const edgeTo = stringField("edge_to");
  const track = stringField("track");
  const crossingActive = integerField("cross_remaining") > 0 || integerField("ford_remaining") > 0 || integerField("ford_active") > 0;
  const next = ruleset.next as JsonRecord | undefined;
  const map = next?.map as JsonRecord | undefined;
  const parameters = next?.parameters as Record<string, number> | undefined;
  const projection = map?.world_projection as JsonRecord | undefined;
  const artifact = projection?.presentation_artifact as JsonRecord | undefined;
  const presentation = artifact?.content as JsonRecord | undefined;
  const nodePositions = presentation?.node_positions as Record<string, { position?: { x?: number; y?: number } }> | undefined;
  const edgePaths = presentation?.edge_paths as Record<string, { points?: { x: number; y: number }[] }> | undefined;
  const edges = map?.edges as { from?: string; to?: string; region?: string; bridge_site?: string }[] | undefined;
  let position = { x: x / nextWorldUnitsPerRenderUnit, y: z / nextWorldUnitsPerRenderUnit };
  let edge: { from?: string; to?: string; id?: string; length?: number; region?: string; bridge_site?: string } | undefined;
  let points: { x: number; y: number }[] | undefined;
  if (node && edgeTo) {
    edge = edges?.find((candidate) =>
      (candidate.from === node && candidate.to === edgeTo) ||
      (candidate.to === node && candidate.from === edgeTo),
    );
    if (!edge || typeof edge.from !== "string" || typeof edge.to !== "string") return null;
    const edgeId = edge.id || `${edge.from}-${edge.to}`;
    const sourcePoints = edgePaths?.[edgeId]?.points;
    const fromPosition = nodePositions?.[node]?.position;
    if (!sourcePoints || sourcePoints.length < 2 || !fromPosition ||
      !Number.isFinite(fromPosition.x) || !Number.isFinite(fromPosition.y)) return null;
    points = sourcePoints.map((point) => ({
      x: point.x / nextWorldUnitsPerRenderUnit,
      y: point.y / nextWorldUnitsPerRenderUnit,
    }));
    const first = points[0]!;
    const last = points.at(-1)!;
    const from = { x: fromPosition.x! / nextWorldUnitsPerRenderUnit, y: fromPosition.y! / nextWorldUnitsPerRenderUnit };
    const samePoint = (left: { x: number; y: number }, right: { x: number; y: number }) =>
      Math.hypot(left.x - right.x, left.y - right.y) <= 1e-5;
    if (samePoint(last, from)) points.reverse();
    else if (!samePoint(first, from)) return null;

    const edgeLength = edge.length;
    const progress = integerField("edge_progress");
    if (!Number.isFinite(edgeLength) || edgeLength! <= 0) return null;
    const fraction = Math.max(0, Math.min(1, progress / edgeLength!));
    const segmentLengths = points.slice(1).map((point, index) => Math.hypot(point.x - points![index]!.x, point.y - points![index]!.y));
    const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
    if (totalLength <= 0) return null;
    let remaining = fraction * totalLength;
    for (let index = 0; index < segmentLengths.length; index += 1) {
      const length = segmentLengths[index]!;
      if (remaining <= length || index === segmentLengths.length - 1) {
        const fromPoint = points[index]!;
        const toPoint = points[index + 1]!;
        const amount = length <= 0 ? 0 : Math.max(0, Math.min(1, remaining / length));
        position = {
          x: fromPoint.x + (toPoint.x - fromPoint.x) * amount,
          y: fromPoint.y + (toPoint.y - fromPoint.y) * amount,
        };
        break;
      }
      remaining -= length;
    }
  } else if (node) {
    const nodePosition = nodePositions?.[node]?.position;
    if (!nodePosition || !Number.isFinite(nodePosition.x) || !Number.isFinite(nodePosition.y)) return null;
    position = { x: nodePosition.x! / nextWorldUnitsPerRenderUnit, y: nodePosition.y! / nextWorldUnitsPerRenderUnit };
  }
  let laneTrackOffset = { x: 0, z: 0 };
  if (node && edgeTo && points && edge?.region === "lane" && !edge.bridge_site &&
    (track === "LEFT" || track === "RIGHT") && !crossingActive) {
    let bestDistance = Infinity;
    let tangent: { x: number; y: number } | undefined;
    for (let index = 0; index + 1 < points.length; index += 1) {
      const start = points[index]!;
      const end = points[index + 1]!;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared <= 1e-12) continue;
      const amount = Math.max(0, Math.min(1, ((position.x - start.x) * dx + (position.y - start.y) * dy) / lengthSquared));
      const distance = Math.hypot(position.x - (start.x + dx * amount), position.y - (start.y + dy * amount));
      if (distance < bestDistance) {
        bestDistance = distance;
        const length = Math.sqrt(lengthSquared);
        tangent = { x: dx / length, y: dy / length };
      }
    }
    if (tangent) {
      const side = track === "LEFT" ? -1 : 1;
      const offset = (parameters?.lane_track_offset_wu ?? 20) / nextWorldUnitsPerRenderUnit * side;
      laneTrackOffset = { x: tangent.y * offset, z: -tangent.x * offset };
    }
  }
  return {
    id,
    x: position.x + laneTrackOffset.x,
    z: position.y + laneTrackOffset.z,
    sourceX: x,
    sourceY: z,
    laneTrackOffset,
  };
}

function replayVisibleHeroesAt(replay: JsonRecord, tick: number): {
  id: string;
  catalogId: string;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  sourceX: number;
  sourceY: number;
}[] {
  const frame = (replay.frames ?? []).find((candidate: JsonRecord) => candidate.tick === tick);
  const entities = frame?.visible_state?.entities as Record<string, JsonRecord> | undefined;
  if (!entities) return [];
  const integerField = (entity: JsonRecord, name: string): number | null => {
    const field = entity.fields?.[name];
    return field?.kind === "integer" && Number.isFinite(field.value) ? field.value : null;
  };
  return Object.entries(entities).flatMap(([id, entity]) => {
    if (entity.entity_type !== "hero") return [];
    const catalogId = entity.fields?.catalog_id?.kind === "string" ? String(entity.fields.catalog_id.value) : null;
    const hp = integerField(entity, "hp");
    const maxHp = integerField(entity, "max_hp");
    const sourceX = integerField(entity, "x");
    const sourceY = integerField(entity, "y");
    if (!catalogId || hp === null || hp <= 0 || maxHp === null || sourceX === null || sourceY === null) return [];
    return [{
      id,
      catalogId,
      hp,
      maxHp,
      x: sourceX / nextWorldUnitsPerRenderUnit,
      z: sourceY / nextWorldUnitsPerRenderUnit,
      sourceX,
      sourceY,
    }];
  });
}

function replayOwnSquadMembersAt(replay: JsonRecord, tick: number, catalogId: string): {
  squadId: string;
  members: { id: string; catalogId: string; sourceX: number; sourceY: number }[];
} | null {
  const frame = (replay.frames ?? []).find((candidate: JsonRecord) => candidate.tick === tick);
  const entities = frame?.visible_state?.entities as Record<string, JsonRecord> | undefined;
  if (!entities) return null;
  const fieldString = (entity: JsonRecord | undefined, name: string): string | null => {
    const field = entity?.fields?.[name];
    return field?.kind === "string" && typeof field.value === "string" ? field.value : null;
  };
  const fieldInteger = (entity: JsonRecord | undefined, name: string): number | null => {
    const field = entity?.fields?.[name];
    return field?.kind === "integer" && Number.isFinite(field.value) ? field.value : null;
  };
  const selected = Object.values(entities).find((entity) =>
    entity.entity_type === "hero" && fieldString(entity, "catalog_id") === catalogId,
  );
  const squadId = fieldString(selected, "squad");
  if (!squadId) return null;
  const members = Object.entries(entities).flatMap(([id, entity]) => {
    if (entity.entity_type !== "hero" || fieldString(entity, "squad") !== squadId) return [];
    const hp = fieldInteger(entity, "hp");
    const memberCatalogId = fieldString(entity, "catalog_id");
    const sourceX = fieldInteger(entity, "x");
    const sourceY = fieldInteger(entity, "y");
    if (!memberCatalogId || hp === null || hp <= 0 || sourceX === null || sourceY === null) return [];
    return [{ id, catalogId: memberCatalogId, sourceX, sourceY }];
  });
  return members.length ? { squadId, members } : null;
}

async function assertActualHeroRows(
  cluster: import("@playwright/test").Locator,
  replay: JsonRecord,
  tick: number,
): Promise<JsonRecord[]> {
  const heroes = replayVisibleHeroesAt(replay, tick);
  expect(heroes, `the exact owner replay frame at T${tick} must contain five living visible Heroes`).toHaveLength(5);
  const rows = cluster.locator(".next-visible-cluster-entities > li");
  const summaries = await rows.evaluateAll((elements) => elements.map((element) => {
    const row = element as HTMLElement;
    return {
      text: (row.textContent ?? "").replace(/\s+/g, " ").trim(),
      identity: row.querySelector(".next-visible-entity-copy > strong")?.textContent?.trim() ?? "",
      categoryRoleSide: row.querySelector(".next-visible-entity-copy > span")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      hp: row.querySelector(".next-visible-entity-copy > div > b")?.textContent?.trim() ?? "",
      worldPosition: row.querySelector(".next-visible-entity-copy > div > small")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    };
  }));
  const heroRows = summaries.filter((row) => row.categoryRoleSide.startsWith("Hero ·"));
  expect(heroRows, "the selected nearby cluster must expose all five currently visible Heroes as separate rows").toHaveLength(5);
  const byCatalogId = new Map<string, { sourceId: string; displayId: string; label: string }>();
  for (const hero of heroes) {
    const expectedPosition = `X ${hero.sourceX} · Y ${hero.sourceY}`;
    const matches = heroRows.filter((row) =>
      row.identity.startsWith(`${hero.catalogId} · `) &&
      row.hp === `HP ${hero.hp}/${hero.maxHp}` &&
      row.worldPosition.includes(expectedPosition),
    );
    expect(matches, `${hero.catalogId} should appear once with its actual replay HP and World position`).toHaveLength(1);
    const matchingRow = matches[0]!;
    const identity = matchingRow.identity;
    const displayId = matchingRow.worldPosition.match(/\bID\s+([^\s·]+)/)?.[1] ?? "";
    expect(displayId).not.toBe("");
    byCatalogId.set(hero.catalogId, { sourceId: hero.id, displayId, label: identity });
    expect(identity.split(" · ")[1]?.trim()).not.toBe("");
    expect(matchingRow.categoryRoleSide).toContain("Hero ·");
    expect(matchingRow.text).not.toMatch(/slot-|squad|cooldown|private|owner id/i);
  }
  expect(heroRows.map((row) => row.identity).sort()).toEqual([...byCatalogId.values()].map((hero) => hero.label).sort());
  return heroes.map((hero) => ({
    sourceReplayEntityId: hero.id,
    catalogId: hero.catalogId,
    displayEntityId: byCatalogId.get(hero.catalogId)?.displayId,
    identity: byCatalogId.get(hero.catalogId)?.label,
    hp: hero.hp,
    maxHp: hero.maxHp,
    replayWorldPosition: { x: hero.sourceX, y: hero.sourceY },
    cameraRenderPosition: { x: hero.x, z: hero.z },
  }));
}

function replayVisibleRolePositions(
  replay: JsonRecord,
  tick: number,
  target: FollowTarget,
  role: "monster" | "minion",
): { id: string; x: number; z: number; sourceX: number; sourceY: number }[] {
  const frame = (replay.frames ?? []).find((candidate: JsonRecord) => candidate.tick === tick);
  const entities = frame?.visible_state?.entities as Record<string, JsonRecord> | undefined;
  if (!entities) return [];
  const direct = target.id ? entities[target.id] : undefined;
  const displayName = (value: unknown): string => typeof value === "string"
    ? value.split(/[_\s.:-]+/).filter(Boolean).map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`).join(" ")
    : "";
  const parts = target.target?.split(" · ") ?? [];
  const selectedIdentity = parts[1] ?? "";
  const selectedHp = target.target?.match(/\bHP\s+(\d+)\/(\d+)\b/i);
  const candidates = direct?.entity_type === role
    ? [[target.id!, direct] as [string, JsonRecord]]
    : Object.entries(entities).filter(([, entity]) => {
      if (entity.entity_type !== role || displayName(entity.fields?.catalog_id?.value) !== selectedIdentity) return false;
      if (!selectedHp) return true;
      const hp = entity.fields?.hp?.kind === "integer" ? String(entity.fields.hp.value) : null;
      const maxHp = entity.fields?.max_hp?.kind === "integer" ? String(entity.fields.max_hp.value) : null;
      return hp === selectedHp[1] && maxHp === selectedHp[2];
    });
  return candidates.flatMap(([id, entity]) => {
    const readCoordinate = (key: "x" | "y"): number | null => {
      const field = entity.fields?.[key];
      return field?.kind === "integer" && Number.isFinite(field.value) ? field.value : null;
    };
    const x = readCoordinate("x");
    const z = readCoordinate("y");
    return x !== null && z !== null
      ? [{ id, x: x / nextWorldUnitsPerRenderUnit, z: z / nextWorldUnitsPerRenderUnit, sourceX: x, sourceY: z }]
      : [];
  });
}

function parseCameraTarget(value: string | null): { x: number; y: number; z: number } | null {
  const coordinates = value?.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)?.map(Number);
  return coordinates && coordinates.length >= 3
    ? { x: coordinates[0], y: coordinates[1], z: coordinates[2] }
    : null;
}

async function waitForSettledCamera(page: import("@playwright/test").Page): Promise<void> {
  // The renderer interpolates entity movement and death/attack cues for 300 ms.
  // Let that transition finish before checking a rounded camera pose; three
  // matching strings alone can occur while the tracked camera is still easing.
  await page.waitForTimeout(350);
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".next-renderer-host canvas");
    const pose = canvas?.getAttribute("data-camera");
    if (!pose) return false;
    const tracker = window as typeof window & { __battlefieldLastCameraPose?: string; __battlefieldStableCameraFrames?: number };
    tracker.__battlefieldStableCameraFrames = tracker.__battlefieldLastCameraPose === pose
      ? (tracker.__battlefieldStableCameraFrames ?? 0) + 1
      : 0;
    tracker.__battlefieldLastCameraPose = pose;
    return (tracker.__battlefieldStableCameraFrames ?? 0) >= 12;
  }, null, { timeout: 8_000 });
}

function frameEvents(replay: JsonRecord): { tick: number; event: string; entity: string | null; entityType: string | null }[] {
  return (replay.frames ?? []).flatMap((frame: JsonRecord) =>
    (frame.events ?? []).map((event: JsonRecord) => ({
      tick: frame.tick as number,
      event: String(event.event),
      entity: typeof event.entity === "string" ? event.entity : null,
      entityType: typeof event.entity === "string"
        ? frame.visible_state?.entities?.[event.entity]?.entity_type ?? null
        : null,
    })),
  );
}

function firstTick(events: ReturnType<typeof frameEvents>, pattern: RegExp): number | null {
  return events.find((event) => pattern.test(event.event))?.tick ?? null;
}

function firstDestroyTick(events: ReturnType<typeof frameEvents>, entityType: string): number | null {
  return events.find((event) => event.entityType === entityType && /destroy|death|collapse/i.test(event.event))?.tick ?? null;
}

function firstTypedTick(events: ReturnType<typeof frameEvents>, pattern: RegExp, entityType: string): number | null {
  return events.find((event) => event.entityType === entityType && pattern.test(event.event))?.tick ?? null;
}

type SemanticCueExpectation = { type: "attack" | "skill" | "destroy"; fragments: string[]; sourceEvent: string };

function replayEntityCueFragment(entity: JsonRecord | undefined): string | null {
  if (!entity) return null;
  const catalogId = entity.fields?.catalog_id?.kind === "string"
    ? String(entity.fields.catalog_id.value).toUpperCase()
    : "";
  if (entity.entity_type === "hero") return catalogId ? `HERO · ${catalogId}` : "HERO";
  if (entity.entity_type === "monster") return "MONSTER";
  if (entity.entity_type === "tower") return "TOWER";
  if (entity.entity_type === "base") return "BASE";
  if (entity.entity_type === "minion") {
    const variant = catalogId.replace(/^MINION_?/, "");
    return variant ? `MINION · ${variant}` : "MINION";
  }
  return String(entity.entity_type ?? "").toUpperCase() || null;
}

function semanticCueExpectationAt(
  replay: JsonRecord,
  tick: number,
  cue: "attack" | "hero-death" | "tower-destroy" | "skill",
): SemanticCueExpectation | null {
  const frame = (replay.frames as JsonRecord[] | undefined)?.find((candidate) => candidate.tick === tick);
  if (!frame) return null;
  const entities = frame.visible_state?.entities as Record<string, JsonRecord> | undefined;
  const events = frame.events as JsonRecord[] | undefined;
  if (!entities || !events) return null;
  const reference = (value: JsonRecord | undefined): string | null =>
    value?.kind === "entity" && typeof value.value === "string" ? value.value : null;
  if (cue === "attack") {
    const event = events.find((candidate) => candidate.event === "next.attack");
    const sourceId = reference(event?.payload?.source);
    const targetId = reference(event?.payload?.target);
    const source = sourceId ? replayEntityCueFragment(entities[sourceId]) : null;
    const target = targetId ? replayEntityCueFragment(entities[targetId]) : null;
    return source && target
      ? { type: "attack", fragments: [source, `→ ${target}`], sourceEvent: "next.attack" }
      : null;
  }
  if (cue === "skill") {
    const event = events.find((candidate) => candidate.event === "next.skill");
    const sourceId = reference(event?.payload?.source);
    const targetId = reference(event?.payload?.target);
    const source = sourceId ? replayEntityCueFragment(entities[sourceId]) : null;
    const target = targetId ? replayEntityCueFragment(entities[targetId]) : null;
    const skill = event?.payload?.skill?.kind === "string" ? String(event.payload.skill.value).toUpperCase() : null;
    return source && target && skill
      ? { type: "skill", fragments: [`SKILL ${skill}`, source, `→ ${target}`], sourceEvent: "next.skill" }
      : null;
  }
  if (cue === "hero-death") {
    const event = events.find((candidate) =>
      candidate.event === "next.death" && candidate.entity && entities[candidate.entity]?.entity_type === "hero",
    );
    const entity = event?.entity ? entities[event.entity] : undefined;
    const entityFragment = replayEntityCueFragment(entity);
    return entityFragment
      ? { type: "destroy", fragments: ["HERO DEFEATED", entityFragment], sourceEvent: "next.death" }
      : null;
  }
  const event = events.find((candidate) =>
    candidate.event === "next.objective_destroyed" && candidate.payload?.kind?.value === "tower",
  );
  const entity = event?.entity ? entities[event.entity] : undefined;
  const entityFragment = replayEntityCueFragment(entity);
  return entityFragment === "TOWER"
    ? { type: "destroy", fragments: ["TOWER DESTROYED", entityFragment], sourceEvent: "next.objective_destroyed" }
    : null;
}

async function assertCueGlyphGeometry(
  page: import("@playwright/test").Page,
  tick: number,
): Promise<void> {
  const visibleCueLocators = await page.locator(`.cue-world-label[data-tick="${tick}"]`).all();
  const visibleCueBoxes = (await Promise.all(visibleCueLocators.map(async (cue) =>
    await cue.isVisible() ? cue.boundingBox() : null,
  ))).filter((box): box is NonNullable<typeof box> => box !== null);
  expect(visibleCueBoxes.length, `a semantic cue is visibly rendered for T${tick}`).toBeGreaterThan(0);
  for (const box of visibleCueBoxes) {
    expect(box.width, `the T${tick} cue remains a compact glyph`).toBeLessThanOrEqual(32);
    expect(box.height, `the T${tick} cue remains a compact glyph`).toBeLessThanOrEqual(32);
  }
  for (let left = 0; left < visibleCueBoxes.length; left += 1) {
    for (let right = left + 1; right < visibleCueBoxes.length; right += 1) {
      const a = visibleCueBoxes[left]!;
      const b = visibleCueBoxes[right]!;
      const overlaps = a.x < b.x + b.width && a.x + a.width > b.x
        && a.y < b.y + b.height && a.y + a.height > b.y;
      expect(overlaps, `visible T${tick} cue glyphs must not collide`).toBe(false);
    }
  }
}

async function assertEventInReplayTimelineAndDetails(
  page: import("@playwright/test").Page,
  tick: number,
  semantic: "attack" | "hero-death" | "tower-destroy" | "skill",
  sourceEvent: string,
): Promise<void> {
  const eventName = (sourceEvent.split(".").at(-1) ?? sourceEvent).replaceAll("_", " ");
  const timelineType = semantic === "attack" ? "attack" : semantic === "skill" ? "skill" : "destroy";
  const tickLabel = `T${String(tick).padStart(2, "0")}`;
  await page.locator("#next-tab-analysis").click();
  const analysisRow = page.locator("#next-panel-analysis .next-timeline li")
    .filter({ hasText: tickLabel })
    .filter({ hasText: new RegExp(timelineType, "i") });
  await expect(analysisRow, `${sourceEvent} is represented in the full Timeline at T${tick}`).not.toHaveCount(0);
  await page.locator("#next-tab-battle").click();

  const mobile = (page.viewportSize()?.width ?? Infinity) <= 700;
  if (mobile) {
    await page.getByRole("button", { name: "Timeline view" }).click();
    const timelineRow = page.locator(`.next-mobile-timeline [data-event-tick="${tick}"]`)
      .filter({ hasText: new RegExp(timelineType, "i") });
    await expect(timelineRow, `${sourceEvent} is represented in the mobile Timeline at T${tick}`).not.toHaveCount(0);
    await page.getByRole("button", { name: "Details view" }).click();
  } else {
    await page.getByRole("button", { name: "Battle situation details" }).click();
  }
  const eventCard = page.locator(".next-detail-card.next-event-card");
  await expect(eventCard, `${sourceEvent} details are available at T${tick}`).toBeVisible();
  const detailsRow = eventCard.locator(".next-event-list li").filter({ hasText: new RegExp(eventName, "i") });
  await expect(detailsRow, `${sourceEvent} details retain their event identity at T${tick}`).not.toHaveCount(0);
  if (mobile) await page.getByRole("button", { name: "Battle view" }).click();
  else await page.getByRole("button", { name: "Battle situation details" }).click();
}

async function assertSemanticCueAtTick(
  page: import("@playwright/test").Page,
  canvas: import("@playwright/test").Locator,
  replay: JsonRecord,
  tick: number,
  semantic: "attack" | "hero-death" | "tower-destroy" | "skill",
): Promise<SemanticCueExpectation> {
  const expected = semanticCueExpectationAt(replay, tick, semantic);
  expect(expected, `${semantic} must be derived from the actual replay event at T${tick}`).not.toBeNull();
  await expect(canvas).toHaveAttribute("data-tick", String(tick));
  // The player is paused after seeking; a cue must remain tied to the exact
  // frame after the transient animation window has elapsed.
  await expect(page.getByRole("button", { name: "Play replay" })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(canvas).toHaveAttribute("data-tick", String(tick));
  const cuesAtTick = (): import("@playwright/test").Locator =>
    page.locator(`.cue-world-label[data-tick="${tick}"][data-cue-type="${expected!.type}"]`);
  const findExpectedCue = async (): Promise<{ locator: import("@playwright/test").Locator; accessibleLabel: string; glyph: string } | null> => {
    const candidates = await cuesAtTick().all();
    for (const locator of candidates) {
      const accessibleLabel = (await locator.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
      if (expected!.fragments.every((fragment) => accessibleLabel.toLowerCase().includes(fragment.toLowerCase()))) {
        return { locator, accessibleLabel, glyph: (await locator.textContent() ?? "").trim() };
      }
    }
    return null;
  };
  const expectedCue = await findExpectedCue();
  expect(expectedCue, `${expected!.sourceEvent} must identify ${expected!.fragments.join(" / ")} at T${tick}`).not.toBeNull();
  await expect(
    expectedCue!.locator,
    `${expected!.sourceEvent} should render the expected ${expected!.type} cue visibly at T${tick}`,
  ).toBeVisible();
  await expect(expectedCue!.locator).toHaveAttribute("role", "note");
  expect(Array.from(expectedCue!.glyph).length, "the visible cue is a compact icon while its accessible label retains event meaning").toBeLessThanOrEqual(2);
  await assertCueGlyphGeometry(page, tick);
  await assertEventInReplayTimelineAndDetails(page, tick, semantic, expected!.sourceEvent);
  const accessibleLabels = await Promise.all((await cuesAtTick().all()).map((cue) => cue.getAttribute("aria-label")));
  const staleTickLabels = await page.locator(".cue-world-label").evaluateAll((elements, currentTick) =>
    elements.filter((element) => (element as HTMLElement).dataset.tick !== String(currentTick)).map((element) => ({
      tick: (element as HTMLElement).dataset.tick,
      text: (element as HTMLElement).textContent,
    })), tick,
  );
  expect(staleTickLabels, "cue labels from an adjacent replay frame must not linger").toEqual([]);
  const captured = { ...expected!, tick, accessibleLabels };

  const adjacentTick = tick < Number(replay.frames.at(-1)?.tick) ? tick + 1 : Math.max(0, tick - 1);
  await seekToTick(page, adjacentTick);
  await page.waitForTimeout(100);
  await expect(page.locator(`.cue-world-label[data-tick="${tick}"]`), "seeking away must remove the prior frame's cue labels").toHaveCount(0);
  const adjacentLabels = await page.locator(".cue-world-label").evaluateAll((elements, currentTick) =>
    elements.filter((element) => (element as HTMLElement).dataset.tick !== String(currentTick)).length, adjacentTick,
  );
  expect(adjacentLabels, "all surviving cue labels must match the currently displayed frame").toBe(0);
  await seekToTick(page, tick);
  const restoredCue = await findExpectedCue();
  expect(restoredCue, `${expected!.sourceEvent} must remain identifiable after returning to T${tick}`).not.toBeNull();
  await expect(restoredCue!.locator, `${expected!.sourceEvent} must be visible after returning to T${tick}`).toBeVisible();
  return captured;
}

function firstOwnerHeroRespawn(replay: JsonRecord): JsonRecord | null {
  const frames = replay.frames as JsonRecord[];
  const fieldInteger = (entity: JsonRecord | undefined, name: string): number | null => {
    const field = entity?.fields?.[name];
    return field?.kind === "integer" && Number.isFinite(field.value) ? field.value : null;
  };
  const fieldString = (entity: JsonRecord | undefined, name: string): string | null => {
    const field = entity?.fields?.[name];
    return field?.kind === "string" && typeof field.value === "string" ? field.value : null;
  };
  for (let index = 1; index < frames.length; index += 1) {
    const previous = Object.values(frames[index - 1]?.visible_state?.entities ?? {}) as JsonRecord[];
    const current = Object.entries(frames[index]?.visible_state?.entities ?? {}) as [string, JsonRecord][];
    for (const [respawnedId, respawned] of current) {
      if (respawned.entity_type !== "hero" || fieldInteger(respawned, "hp") === 0) continue;
      const slotId = fieldString(respawned, "slot_id");
      if (!slotId || fieldInteger(respawned, "hp") === null) continue;
      const dead = previous.find((entity) =>
        entity.entity_type === "hero" &&
        fieldString(entity, "slot_id") === slotId &&
        fieldInteger(entity, "hp") === 0 &&
        fieldInteger(entity, "respawn_at") === frames[index].tick,
      );
      if (!dead || fieldInteger(respawned, "respawn_at") !== 0) continue;
      const deadId = Object.entries(frames[index - 1]?.visible_state?.entities ?? {})
        .find(([, entity]) => entity === dead)?.[0] ?? null;
      return {
        tick: frames[index].tick,
        slotId,
        deadEntityId: deadId,
        respawnedEntityId: respawnedId,
        evidence: "owner-replay-same-slot-dead-to-alive-transition",
        privacy: "local-owner-only",
      };
    }
  }
  return null;
}

function firstMovementTick(replay: JsonRecord): number | null {
  const frames = replay.frames ?? [];
  const coordinate = (entity: JsonRecord | undefined, key: "x" | "y"): number | null => {
    const field = entity?.fields?.[key];
    return field?.kind === "integer" && Number.isFinite(field.value) ? field.value : null;
  };
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1]?.visible_state?.entities ?? {};
    const current = frames[index]?.visible_state?.entities ?? {};
    for (const [id, entity] of Object.entries(current) as [string, JsonRecord][]) {
      const old = previous[id] as JsonRecord | undefined;
      const oldX = coordinate(old, "x");
      const oldY = coordinate(old, "y");
      const newX = coordinate(entity, "x");
      const newY = coordinate(entity, "y");
      if (oldX !== null && oldY !== null && newX !== null && newY !== null && (oldX !== newX || oldY !== newY)) {
        return frames[index].tick as number;
      }
    }
  }
  return null;
}

function pngFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? pngFiles(path) : entry.isFile() && entry.name.endsWith(".png") ? [path] : [];
  });
}

function storeCanonicalJson(directory: string, name: string, json: string, privacy: string): JsonRecord {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  const compressed = gzipSync(Buffer.from(json), { level: 9 });
  if (existsSync(path)) {
    const existingJson = gunzipSync(readFileSync(path)).toString("utf8");
    if (existingJson !== json) {
      throw new Error(`Canonical replay artifact ${relative(repoRoot, path)} exists but differs from the captured real simulation.`);
    }
  } else {
    writeFileSync(path, compressed);
  }
  return {
    path: relative(repoRoot, path).replaceAll("\\", "/"),
    storage: "deterministic-gzip-json",
    privacy,
    sha256UncompressedJson: sha256(json),
    uncompressedBytes: Buffer.byteLength(json),
    compressedBytes: statSync(path).size,
  };
}

test("captures fixed-tick real Enbu replay and battlefield views", async ({ page, baseURL }) => {
  // Keep a full budget for each selected viewport after the CI split.
  test.setTimeout(180_000 + selectViewportCases(process.env.BATTLEFIELD_VIEWPORTS).length * 120_000);
  if (!baseURL) throw new Error("The browser runner must provide its local preview URL.");

  const outputDirectory = resolve(process.env.BATTLEFIELD_OUTPUT_DIR ?? join(repoRoot, "docs/evidence/battlefield/local-capture"));
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  const controlledScenario = process.env.BATTLEFIELD_CONTROLLED_SCENARIO;
  if (controlledScenario && controlledScenario !== "cue" && controlledScenario !== "farm") {
    throw new Error(`Unsupported BATTLEFIELD_CONTROLLED_SCENARIO: ${controlledScenario}`);
  }
  const controlledSnapshotPath = process.env.BATTLEFIELD_CONTROLLED_SNAPSHOT_PATH;
  const controlledSourcePath = process.env.BATTLEFIELD_CONTROLLED_SOURCE_PATH;
  const controlledExpectedPath = process.env.BATTLEFIELD_CONTROLLED_EXPECTED_RESULT_PATH;
  const skillFollowOnly = process.env.BATTLEFIELD_SKILL_FOLLOW_ONLY === "true";
  const expectCueSemantics = process.env.BATTLEFIELD_EXPECT_CUE_SEMANTICS === "true";
  const clusterInspectorOnly = process.env.BATTLEFIELD_CLUSTER_INSPECTOR_ONLY === "true";
  const requestedRoleFollows = [...new Set((process.env.BATTLEFIELD_ROLE_FOLLOW_ONLY ?? "")
    .split(",").map((role) => role.trim()).filter(Boolean))];
  if (requestedRoleFollows.some((role) => role !== "monster" && role !== "minion")) {
    throw new Error("BATTLEFIELD_ROLE_FOLLOW_ONLY accepts only monster and minion.");
  }
  const roleFollowOnly = requestedRoleFollows as ("monster" | "minion")[];
  const controlledSnapshot = controlledScenario && controlledSnapshotPath
    ? JSON.parse(readFileSync(resolve(controlledSnapshotPath), "utf8")) as JsonRecord
    : null;
  const controlledSource = controlledScenario && controlledSourcePath
    ? readFileSync(resolve(controlledSourcePath), "utf8")
    : null;
  const expectedScenarioResult = controlledScenario && controlledExpectedPath
    ? JSON.parse(readFileSync(resolve(controlledExpectedPath), "utf8")) as JsonRecord
    : null;
  if (controlledScenario && (!controlledSnapshot || !controlledSource || !expectedScenarioResult)) {
    throw new Error("A controlled WASM scenario requires its real input snapshot, compiled Jinrei source, and canonical WASM result.");
  }
  if (!controlledScenario && (controlledSnapshotPath || controlledSourcePath || controlledExpectedPath)) {
    throw new Error("Controlled scenario input, source, and expected result must be configured together.");
  }
  const tacticProfile = process.env.BATTLEFIELD_TACTIC_PROFILE ?? "default-ui-draft";
  if (tacticProfile !== "default-ui-draft" && tacticProfile !== "pursue-visible-tower") {
    throw new Error(`Unsupported BATTLEFIELD_TACTIC_PROFILE: ${tacticProfile}`);
  }
  if (controlledScenario && tacticProfile !== "default-ui-draft") {
    throw new Error("Controlled scenarios use their compiled snapshot and cannot be combined with a UI tactic transformation.");
  }
  if (skillFollowOnly && controlledScenario !== "farm") {
    throw new Error("Focused skill-follow capture requires the real farm scenario.");
  }
  if (roleFollowOnly.length && (controlledScenario !== "farm" || skillFollowOnly)) {
    throw new Error("Role-follow captures require the real farm scenario and cannot be combined with skill-follow-only mode.");
  }
  if (expectCueSemantics && controlledScenario !== "cue" && controlledScenario !== "farm") {
    throw new Error("Semantic cue checks require the real cue or farm snapshot scenario.");
  }
  if (expectCueSemantics && (skillFollowOnly || roleFollowOnly.length > 0)) {
    throw new Error("Semantic cue checks use the standard replay capture, not focused Follow-only mode.");
  }
  if (clusterInspectorOnly && (controlledScenario || skillFollowOnly || roleFollowOnly.length > 0 || expectCueSemantics)) {
    throw new Error("The visible-cluster capture uses the ordinary real Next match in its own focused run.");
  }
  const captureProfile = controlledScenario ? `controlled-${controlledScenario}-snapshot` : tacticProfile;
  const captureViewports = selectViewportCases(process.env.BATTLEFIELD_VIEWPORTS);
  if (clusterInspectorOnly && (
    captureViewports.length !== 2 ||
    !captureViewports.some((viewport) => viewport.name === "1440x900") ||
    !captureViewports.some((viewport) => viewport.name === "390x844")
  )) {
    throw new Error("The visible-cluster capture requires exactly the 1440x900 desktop and 390x844 mobile viewports.");
  }
  if (roleFollowOnly.length && (captureViewports.length !== 1 || captureViewports[0].width <= 700)) {
    throw new Error("Role-follow captures require exactly one desktop viewport.");
  }
  const appSha = process.env.BATTLEFIELD_APP_SHA ?? execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const wasmPath = join(repoRoot, "apps/web/public/wasm/senkei_wasm.wasm");
  const wasmSha = sha256(readFileSync(wasmPath));
  const wasmResponses: { status: number; fromServiceWorker: boolean; url: string }[] = [];
  page.context().on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/wasm/senkei_wasm.wasm")) {
      wasmResponses.push({ status: response.status(), fromServiceWorker: response.fromServiceWorker(), url: response.url() });
    }
  });

  // Capture the actual workbench worker request and reply. Controlled scenarios
  // replace only its simulation snapshot; the real Core Worker and WASM create
  // the result, and the renderer receives only the resulting presentation replay.
  const workerScenario = controlledScenario && controlledSnapshot
    ? { name: controlledScenario, snapshot: controlledSnapshot }
    : null;
  await page.addInitScript((injectedScenario: { name: string; snapshot: JsonRecord } | null) => {
    const NativeWorker = window.Worker;
    class CapturingWorker extends NativeWorker {
      postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
        const request = message as { operation?: unknown; request_id?: unknown; payload?: { snapshot?: unknown } } | null;
        let outgoing = message;
        if (request?.operation === "simulate") {
          const target = window as typeof window & {
            __battlefieldSimRequest?: unknown;
            __battlefieldOriginalSimRequest?: unknown;
            __battlefieldScenarioInjection?: unknown;
          };
          if (injectedScenario) {
            const transferCount = Array.isArray(transfer) ? transfer.length : transfer?.transfer?.length ?? 0;
            if (transferCount > 0) throw new Error("Controlled snapshot replacement does not support transferred simulation payloads.");
            const original = structuredClone(message);
            const modified = structuredClone(message) as { operation?: unknown; payload?: { snapshot?: unknown } };
            if (!modified.payload) throw new Error("Simulation request has no payload to receive the controlled snapshot.");
            modified.payload.snapshot = structuredClone(injectedScenario.snapshot);
            outgoing = modified;
            target.__battlefieldOriginalSimRequest = original;
            target.__battlefieldScenarioInjection = {
              name: injectedScenario.name,
              originalMatchId: (request.payload?.snapshot as JsonRecord | undefined)?.context?.match_id ?? null,
              injectedMatchId: injectedScenario.snapshot.context?.match_id ?? null,
              target: "real-Core-Worker-simulate-snapshot",
            };
          }
          target.__battlefieldSimRequest = structuredClone(outgoing);
        }
        if (transfer === undefined) super.postMessage(outgoing);
        else super.postMessage(outgoing, transfer as Transferable[]);
      }

      addEventListener<K extends keyof WorkerEventMap>(
        type: K,
        listener: (this: Worker, event: WorkerEventMap[K]) => unknown,
        options?: boolean | AddEventListenerOptions,
      ): void {
        if (type !== "message" || typeof listener !== "function") {
          super.addEventListener(type, listener as EventListener, options);
          return;
        }
        super.addEventListener(type, (event: Event) => {
          const data = (event as MessageEvent).data as { operation?: unknown; ok?: unknown } | null;
          if (data?.operation === "next_ruleset" && data.ok === true) {
            const target = window as typeof window & { __battlefieldRulesetResponse?: unknown };
            target.__battlefieldRulesetResponse = structuredClone(data);
          }
          if (data?.operation === "simulate") {
            const target = window as typeof window & { __battlefieldSimResponse?: unknown };
            target.__battlefieldSimResponse = structuredClone(data);
          }
          listener.call(this, event as WorkerEventMap[K]);
        }, options);
      }
    }
    Object.defineProperty(window, "Worker", { configurable: true, value: CapturingWorker });
  }, workerScenario);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  const revisionMeta = page.locator('meta[name="senkei-build-revision"]');
  const uiRevision = await revisionMeta.count() ? await revisionMeta.getAttribute("content") : null;
  if (process.env.BATTLEFIELD_EXPECT_BUILD_REVISION === "true") {
    expect(uiRevision).toBe(appSha);
  }
  await page.getByTestId("nav-next").click();
  await expect(page.getByRole("heading", { name: /Battle workbench|Battlefield console|Observe the battlefield/ })).toBeVisible();
  await expect(page.getByText(/REAL LOCAL SIMULATION|LOCAL ENBU REPLAY/i).first()).toBeVisible();

  await page.locator("#next-tab-jinrei").click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Jinrei source" });
  const defaultSource = await source.inputValue();
  let selectedTacticSource = defaultSource;
  if (tacticProfile === "pursue-visible-tower") {
    selectedTacticSource = defaultSource.replace(
      /do move\((argmin hero in filter hero in [a-z0-9_.]+ \{ hero\.[a-z0-9_]+ == "slot-\d+", \} by hero\.[a-z0-9_]+ then hero\.[a-z0-9_]+), "[^"]+"\),/g,
      "do pursue($1, argmin tower in enemies.visible_towers by tower.hp then tower.id),",
    );
    if (selectedTacticSource === defaultSource || (defaultSource.match(/do move\(/g) ?? []).length !== 5) {
      throw new Error("Could not construct the visible-tower pursuit profile from the real Next Jinrei draft.");
    }
    await source.fill(selectedTacticSource);
  }
  const compile = page.getByRole("button", { name: "Compile tactics" });
  await compile.click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible({ timeout: 60_000 });
  await page.locator("#next-tab-battle").click();
  if (process.env.BATTLEFIELD_EXPECT_BATTLEFIELD_CONSOLE === "true") {
    await expect(page.getByRole("heading", { name: "Battlefield console" })).toBeVisible();
  }
  // The new console decorates the accessible name with the play glyph, so
  // match the stable action wording without anchoring the complete name.
  await page.getByRole("button", { name: /Launch local battle|New local battle/i }).click();
  await completePreflight(page);
  await expect(page.getByText(/AUTHORITATIVE ENBU RESULT|Confirmed result/i).first()).toBeVisible({ timeout: 120_000 });
  const uiSignature = await page.getByRole("heading", { name: /Battlefield console|Observe the battlefield/ }).innerText();
  if (process.env.BATTLEFIELD_EXPECT_BATTLEFIELD_CONSOLE === "true") {
    expect(uiSignature).toBe("Battlefield console");
  }
  const canvas = page.locator(".next-renderer-host canvas");
  await expect(canvas).toHaveAttribute("data-rendered", "true", { timeout: 30_000 });
  await expect(canvas).toHaveAttribute("data-tick", "0");

  const captured = await page.evaluate(() => {
    const current = window as typeof window & {
      __battlefieldSimRequest?: JsonRecord;
      __battlefieldSimResponse?: JsonRecord;
      __battlefieldRulesetResponse?: JsonRecord;
      __battlefieldOriginalSimRequest?: JsonRecord;
      __battlefieldScenarioInjection?: JsonRecord;
    };
    return {
      request: current.__battlefieldSimRequest ?? null,
      response: current.__battlefieldSimResponse ?? null,
      rulesetResponse: current.__battlefieldRulesetResponse ?? null,
      originalRequest: current.__battlefieldOriginalSimRequest ?? null,
      scenarioInjection: current.__battlefieldScenarioInjection ?? null,
    };
  });
  expect(captured.request, "the UI must have submitted an actual local simulation request").not.toBeNull();
  expect(captured.response, "the real worker must have returned the local simulation result").not.toBeNull();
  expect(captured.request!.operation).toBe("simulate");
  expect(captured.response!.operation).toBe("simulate");
  expect(captured.response!.ok).toBe(true);
  expect(captured.response!.request_id).toBe(captured.request!.request_id);
  expect(captured.request!.payload.snapshot.context.match_id).toBeTruthy();
  if (controlledScenario) {
    expect(captured.scenarioInjection?.name).toBe(controlledScenario);
    expect(captured.scenarioInjection?.target).toBe("real-Core-Worker-simulate-snapshot");
    expect(captured.scenarioInjection?.originalMatchId).toBeTruthy();
    expect(captured.scenarioInjection?.injectedMatchId).toBe(captured.request!.payload.snapshot.context.match_id);
    expect(captured.originalRequest?.payload.snapshot.context.match_id).toBe(captured.scenarioInjection?.originalMatchId);
  } else {
    expect(captured.scenarioInjection).toBeNull();
  }
  expect(wasmResponses.length, "the browser must fetch the real WASM module").toBeGreaterThan(0);
  expect(wasmResponses.some((response) => response.status === 200)).toBe(true);

  const simulation = captured.response!.result as JsonRecord;
  const outcome = simulation.outcome as JsonRecord;
  const result = outcome.result as JsonRecord;
  const publicReplay = outcome.presentation_replay as JsonRecord;
  expect(simulation.authorized_side).toBe("attacker");
  expect(Object.keys(simulation.owner_replays)).toEqual(["attacker"]);
  const sourceReplay = simulation.owner_replays.attacker as JsonRecord;
  expect(sourceReplay.perspective).toBe("attacker");
  const requestSnapshot = captured.request!.payload.snapshot as JsonRecord;
  expect(captured.rulesetResponse, "the real WASM worker must return the static ruleset used by this battle").not.toBeNull();
  expect(captured.rulesetResponse!.operation).toBe("next_ruleset");
  expect(captured.rulesetResponse!.ok).toBe(true);
  expect(captured.rulesetResponse!.request_id).toBeTruthy();
  const renderedRuleset = captured.rulesetResponse!.result as JsonRecord;
  expect(renderedRuleset.ruleset?.digest).toBe(requestSnapshot.context.ruleset.digest);
  const expectBaseSites = process.env.BATTLEFIELD_EXPECT_BASE_SITES === "true";
  const baseSiteChecks: Record<string, JsonRecord> = {};
  let baseSiteIds: string[] = [];
  let firstEnemyBaseSiteId: string | null = null;
  let firstEnemyBaseVisibleTick: number | null = null;
  if (expectBaseSites) {
    expect(controlledScenario ?? null, "base-site checks use the ordinary real local match").toBeNull();
    expect(["attacker", "defender"]).toContain(sourceReplay.perspective);
  }
  expect(result.match_id).toBe(requestSnapshot.context.match_id);
  expect(sourceReplay.match_id).toBe(result.match_id);
  expect(publicReplay.match_id).toBe(result.match_id);
  expect(sourceReplay.frames.length).toBeGreaterThan(0);
  expect(sourceReplay.perspective ?? "public").toMatch(/^(attacker|defender|public)$/);
  if (controlledScenario && expectedScenarioResult) {
    expect(requestSnapshot.context.ruleset).toEqual(expectedScenarioResult.replay.ruleset);
    expect(result.final_tick).toBe(expectedScenarioResult.result.final_tick);
    expect(result.final_state_digest).toBe(expectedScenarioResult.result.final_state_digest);
    expect(sourceReplay.result_digest).toBe(expectedScenarioResult.owner_replays.attacker.result_digest);
    expect(publicReplay.result_digest).toBe(expectedScenarioResult.replay.result_digest);
  }

  const events = frameEvents(sourceReplay);
  const movementTick = firstMovementTick(sourceReplay);
  const clashTick = firstTick(events, /attack|damage|skill|hit/i);
  const skillTick = firstTypedTick(events, /^next\.skill$/i, "hero");
  const towerDestroyTick = firstDestroyTick(events, "tower");
  const baseDestroyTick = firstDestroyTick(events, "base");
  const heroDeathTick = firstDestroyTick(events, "hero");
  const heroRespawnProof = firstOwnerHeroRespawn(sourceReplay);
  const respawnTick = typeof heroRespawnProof?.tick === "number" ? heroRespawnProof.tick : null;
  const neutralRespawnTick = firstTypedTick(events, /respawn/i, "monster");
  const finalTick = result.final_tick as number;
  const followTick = Math.min(50, finalTick);
  const stateTicks = {
    tactical: 0,
    overview: 0,
    follow: followTick,
    advance: movementTick,
    clash: clashTick,
    tower_destroy: towerDestroyTick,
    base_destroy: baseDestroyTick,
    hero_death: heroDeathTick,
    hero_respawn: respawnTick,
    monster_respawn: neutralRespawnTick,
    skill: skillTick,
    end: finalTick,
  };

  if (expectBaseSites) {
    const initialBaseSites = await assertBaseSiteLabelsAtTick(page, canvas, sourceReplay, 0);
    baseSiteChecks["1440x900/t000"] = { tick: 0, labels: initialBaseSites };
    baseSiteIds = initialBaseSites.map((site) => site.siteId).sort();
    const ownSide = sourceReplay.perspective === "defender" ? "vermilion" : "azure";
    const enemySide = ownSide === "azure" ? "vermilion" : "azure";
    const enemySite = initialBaseSites.find((site) => site.side === enemySide);
    expect(enemySite, "the map must identify the opposing public base site").toBeDefined();
    expect(enemySite!.siteState, "an unobserved enemy base site must begin as unknown").toBe("unknown");
    firstEnemyBaseSiteId = enemySite!.siteId;

    const firstVisibleTick = firstObservedBaseSiteTick(sourceReplay, enemySite!.siteId);
    firstEnemyBaseVisibleTick = firstVisibleTick;
    if (firstVisibleTick !== null && firstVisibleTick > 0) {
      const beforeVisibleTick = firstVisibleTick - 1;
      await seekToTick(page, beforeVisibleTick);
      const beforeVisible = await assertBaseSiteLabelsAtTick(page, canvas, sourceReplay, beforeVisibleTick);
      const stillUnknown = beforeVisible.find((site) => site.siteId === enemySite!.siteId);
      expect(stillUnknown?.siteState, "site status must remain unknown until the current replay frame reveals it").toBe("unknown");
      baseSiteChecks[`1440x900/enemy-before-visible-t${String(beforeVisibleTick).padStart(3, "0")}`] = {
        tick: beforeVisibleTick,
        labels: beforeVisible,
      };

      await seekToTick(page, firstVisibleTick);
      const firstVisible = await assertBaseSiteLabelsAtTick(page, canvas, sourceReplay, firstVisibleTick);
      const nowVisible = firstVisible.find((site) => site.siteId === enemySite!.siteId);
      expect(nowVisible?.siteState).toBe(observedBaseSiteStateAt(sourceReplay, firstVisibleTick, enemySite!.siteId));
      expect(["visible", "destroyed"]).toContain(nowVisible?.siteState);
      baseSiteChecks[`1440x900/enemy-first-visible-t${String(firstVisibleTick).padStart(3, "0")}`] = {
        tick: firstVisibleTick,
        labels: firstVisible,
      };

      const firstUnseenTick = firstUnobservedBaseSiteTick(sourceReplay, enemySite!.siteId, firstVisibleTick);
      if (firstUnseenTick !== null) {
        await seekToTick(page, firstUnseenTick);
        const unseen = await assertBaseSiteLabelsAtTick(page, canvas, sourceReplay, firstUnseenTick);
        expect(unseen.find((site) => site.siteId === enemySite!.siteId)?.siteState,
          "an enemy base site returns to unknown when it is absent from the current replay frame").toBe("unknown");
        baseSiteChecks[`1440x900/enemy-unseen-t${String(firstUnseenTick).padStart(3, "0")}`] = {
          tick: firstUnseenTick,
          labels: unseen,
        };
      }
    }
    await seekToTick(page, 0);
  }

  const replayJson = `${JSON.stringify(sourceReplay, null, 2)}\n`;
  const publicReplayJson = `${JSON.stringify(publicReplay, null, 2)}\n`;
  const inputJson = `${JSON.stringify(captured.request!.payload.snapshot, null, 2)}\n`;
  const replayBundleDirectory = resolve(process.env.BATTLEFIELD_REPLAY_BUNDLE_DIR ?? outputDirectory);
  const ownerReplayArtifact = storeCanonicalJson(
    replayBundleDirectory,
    "actual-owner-presentation-replay.json.gz",
    replayJson,
    "local-owner-only",
  );
  const publicReplayArtifact = storeCanonicalJson(
    replayBundleDirectory,
    "actual-public-presentation-replay.json.gz",
    publicReplayJson,
    "public-presentation",
  );
  const inputArtifact = storeCanonicalJson(
    replayBundleDirectory,
    "actual-simulation-input.json.gz",
    inputJson,
    "controlled-local-simulation-input",
  );
  let controlledSourceArtifact: JsonRecord | null = null;
  if (controlledScenario && controlledSource) {
    const path = join(replayBundleDirectory, `${controlledScenario}-compiled-source.jinrei`);
    if (existsSync(path) && readFileSync(path, "utf8") !== controlledSource) {
      throw new Error(`Controlled source ${relative(repoRoot, path)} differs from the supplied compiled scenario.`);
    }
    if (!existsSync(path)) writeFileSync(path, controlledSource);
    controlledSourceArtifact = {
      path: relative(repoRoot, path).replaceAll("\\", "/"),
      privacy: "reproducible-local-tactic-source",
      sha256: sha256(controlledSource),
      bytes: Buffer.byteLength(controlledSource),
    };
  }

  const modeSupport: Record<string, boolean> = {};
  const followSupport: Record<string, boolean> = {};
  const mobileConsoleSupport: Record<string, Record<string, boolean>> = {};
  const layoutByViewport: Record<string, JsonRecord> = {};
  const cameraPosesByCapture: Record<string, string | null> = {};
  const cameraTargetsByCapture: Record<string, { x: number; y: number; z: number } | null> = {};
  const skillFollowCaptures: Record<string, JsonRecord> = {};
  const roleFollowCaptures: Record<string, JsonRecord> = {};
  const semanticCueAssertions: Record<string, JsonRecord> = {};
  const clusterInspection: Record<string, JsonRecord> = {};
  // A Hero may have died/respawned before the follow tick. Select only from
  // that current authorized frame, rather than retaining a tick-zero identity.
  await seekToTick(page, followTick);
  const followTarget = await clickFollow(page);
  followSupport.initial = followTarget.supported;
  const expectedFollowPosition = replayHeroPosition(sourceReplay, followTick, followTarget, renderedRuleset);
  if (process.env.BATTLEFIELD_EXPECT_BATTLEFIELD_CONSOLE === "true" && followTarget.supported) {
    expect(expectedFollowPosition, "the followed Hero must exist at the exact replay tick").not.toBeNull();
  }

  for (const viewport of captureViewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.locator(".next-renderer-host").scrollIntoViewIfNeeded();
    await expect(canvas).toHaveAttribute("data-rendered", "true");
    const directory = join(outputDirectory, viewport.name);
    mkdirSync(directory, { recursive: true });

    if (clusterInspectorOnly) {
      const tick = followTick;
      await seekToTick(page, tick);
      // Desktop exposes the entity selector; mobile intentionally exposes
      // only the Follow sheet. clickFollow above has already selected F03
      // while the selector was available at the initial desktop viewport.
      const clusterTarget = viewport.width > 700 ? await selectVisibleHero(page, "F03") : followTarget;
      expect(clusterTarget.supported, "the current exact replay frame should offer the actual F03 Hero").toBe(true);
      expect(clusterTarget.catalogId).toBe("F03");
      if (clusterTarget.catalogId === null) throw new Error("The selected F03 Hero is missing its authorized catalog identity.");
      expect(clusterTarget.id).toBeTruthy();
      const expectedFollow = replayHeroPosition(sourceReplay, tick, clusterTarget, renderedRuleset);
      expect(expectedFollow, "F03 should resolve to its owner-replay position at the selected tick").not.toBeNull();

      let container: import("@playwright/test").Locator;
      if (viewport.width > 700) {
        const rosterToggle = page.getByTestId("battle-visible-roster-toggle");
        if (await rosterToggle.getAttribute("aria-expanded") !== "true") await rosterToggle.click();
        container = page.getByTestId("battle-visible-roster");
      } else {
        const followView = page.getByRole("button", { name: "Follow view" });
        await expect(followView).toBeVisible();
        await followView.click();
        container = page.locator(".next-follow-sheet");
      }
      await expect(container).toBeVisible();
      await expect(canvas).toHaveAttribute("data-tick", String(tick));
      const selectedCluster = container.locator(".next-visible-cluster.is-expanded");
      await expect(selectedCluster, "opening Follow should show the cluster containing the actual selected Hero").toHaveCount(1);
      const selectedClusterLabel = await selectedCluster.locator(".next-visible-cluster-toggle").getAttribute("aria-label");
      expect(selectedClusterLabel).toMatch(/nearby visible entities|entities at the same replay position/i);
      const verifiedHeroes = await assertActualHeroRows(selectedCluster, sourceReplay, tick);
      const clusterScreenshot = "selected-visible-cluster-t050.png";
      const clusterCameraPose = await canvas.getAttribute("data-camera");
      const clusterCameraTarget = parseCameraTarget(await canvas.getAttribute("data-camera-target"));
      cameraPosesByCapture[`${viewport.name}/${clusterScreenshot}`] = clusterCameraPose;
      cameraTargetsByCapture[`${viewport.name}/${clusterScreenshot}`] = clusterCameraTarget;
      await page.screenshot({ path: join(directory, clusterScreenshot), animations: "disabled" });

      const followAction = selectedCluster.getByRole("button", {
        name: new RegExp(`^Follow ${clusterTarget.catalogId}.*replay entity ${clusterTarget.id}$`),
      });
      await expect(followAction, "the selected live entity row should offer a Follow action for this exact UI entity").toHaveCount(1);
      await followAction.click();
      await expect(canvas).toHaveAttribute("data-tick", String(tick));
      await waitForSettledCamera(page);
      const trackedIds = (await canvas.getAttribute("data-tracking"))?.split(",").filter(Boolean) ?? [];
      expect(trackedIds, "Follow must track the selected current visible entity ID").toContain(clusterTarget.id);
      const actualTarget = parseCameraTarget(await canvas.getAttribute("data-camera-target"));
      expect(actualTarget).not.toBeNull();
      expect(Math.abs(actualTarget!.x - expectedFollow!.x)).toBeLessThan(0.01);
      expect(Math.abs(actualTarget!.z - expectedFollow!.z)).toBeLessThan(0.01);
      await expect(canvas).toHaveAttribute("data-tick", String(tick));
      const followScreenshot = "follow-f03-same-tick.png";
      await page.screenshot({ path: join(directory, followScreenshot), animations: "disabled" });
      const followCaptureKey = `${viewport.name}/${followScreenshot}`;
      cameraPosesByCapture[followCaptureKey] = await canvas.getAttribute("data-camera");
      cameraTargetsByCapture[followCaptureKey] = actualTarget;

      const ownerSquad = replayOwnSquadMembersAt(sourceReplay, tick, clusterTarget.catalogId);
      expect(ownerSquad, "the selected current owner Hero must have a confirmed Squad in this Replay frame").not.toBeNull();
      expect(ownerSquad!.members, "the current owner Squad must have five living visible members at T50").toHaveLength(5);
      const verifiedHeroByReplayId = new Map(verifiedHeroes.map((hero) => [hero.sourceReplayEntityId, hero]));
      const squadMembers = ownerSquad!.members.map((member) => {
        const verifiedHero = verifiedHeroByReplayId.get(member.id);
        expect(verifiedHero, `${member.catalogId} Squad member must match a current visible Hero row`).toBeDefined();
        expect(verifiedHero!.catalogId).toBe(member.catalogId);
        expect(verifiedHero!.replayWorldPosition).toEqual({ x: member.sourceX, y: member.sourceY });
        const displayEntityId = verifiedHero!.displayEntityId;
        expect(displayEntityId, `${member.catalogId} must map to its exact visible renderer entity`).toBeTruthy();
        return {
          sourceReplayEntityId: member.id,
          catalogId: member.catalogId,
          displayEntityId,
          sourceWorldPosition: { x: member.sourceX, y: member.sourceY },
        };
      });
      const expectedSquadTarget = {
        x: ownerSquad!.members.reduce((sum, member) => sum + member.sourceX / nextWorldUnitsPerRenderUnit, 0) / ownerSquad!.members.length,
        z: ownerSquad!.members.reduce((sum, member) => sum + member.sourceY / nextWorldUnitsPerRenderUnit, 0) / ownerSquad!.members.length,
      };
      const expectedSquadLabel = ownerSquad!.squadId
        .replaceAll("_", " ")
        .replaceAll("-", " ")
        .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
      let squadFollowControl: string;
      if (viewport.width <= 700) {
        // Mobile presents owner Squads as buttons in the Follow sheet, while
        // desktop uses the actual Squad selector option.
        const expectedButtonText = `${expectedSquadLabel} · ${squadMembers.length} visible Heroes`;
        const followSquadButton = page.locator(".next-follow-sheet .next-follow-list > button")
          .filter({ hasText: expectedButtonText });
        await expect(followSquadButton, "mobile Follow should expose the current owner-replay Squad group").toHaveCount(1);
        await expect(followSquadButton).toContainText("Follow Squad");
        await followSquadButton.click();
        squadFollowControl = "owner-squad-follow-button";
      } else {
        const squadSelector = page.getByRole("combobox", { name: /Follow own visible Squad/i });
        await expect(squadSelector, "desktop owner view should expose the actual visible Squad selector").toBeVisible();
        const squadOptions = await squadSelector.locator("option").evaluateAll((elements) =>
          elements.map((element) => {
            const option = element as HTMLOptionElement;
            return { value: option.value, label: (option.textContent ?? "").trim() };
          }),
        );
        const ownSquadOption = squadOptions.find((option) => option.value === ownerSquad!.squadId);
        expect(ownSquadOption, "the selected Hero's actual owner-replay Squad must be an available selector option").toBeDefined();
        await squadSelector.selectOption(ownerSquad!.squadId);
        squadFollowControl = "owner-squad-selector-option";
      }
      await expect(canvas).toHaveAttribute("data-tick", String(tick));
      await waitForSettledCamera(page);
      if (viewport.width <= 700) await expect(page.locator(".next-follow-sheet")).toBeHidden();
      const squadTrackedIds = (await canvas.getAttribute("data-tracking"))?.split(",").filter(Boolean) ?? [];
      const expectedSquadDisplayIds = squadMembers.map((member) => member.displayEntityId).sort();
      expect([...squadTrackedIds].sort(), "Squad Follow must track exactly its current visible member IDs").toEqual(expectedSquadDisplayIds);
      const actualSquadTarget = parseCameraTarget(await canvas.getAttribute("data-camera-target"));
      expect(actualSquadTarget, "Squad Follow must expose its current-group camera target").not.toBeNull();
      expect(Math.abs(actualSquadTarget!.x - expectedSquadTarget.x)).toBeLessThan(0.01);
      expect(Math.abs(actualSquadTarget!.z - expectedSquadTarget.z)).toBeLessThan(0.01);
      await expect(canvas).toHaveAttribute("data-tick", String(tick));
      const squadFollowScreenshot = "squad-follow-same-tick.png";
      await page.screenshot({ path: join(directory, squadFollowScreenshot), animations: "disabled" });
      const squadFollowCaptureKey = `${viewport.name}/${squadFollowScreenshot}`;
      cameraPosesByCapture[squadFollowCaptureKey] = await canvas.getAttribute("data-camera");
      cameraTargetsByCapture[squadFollowCaptureKey] = actualSquadTarget;
      clusterInspection[viewport.name] = {
        tick,
        selectedCatalogId: clusterTarget.catalogId,
        selectedDisplayEntityId: clusterTarget.id,
        selectedOption: clusterTarget.target,
        clusterLabel: selectedClusterLabel,
        heroRows: verifiedHeroes,
        followTarget: expectedFollow,
        cameraTarget: actualTarget,
        trackedIds,
        squadFollow: {
          tick,
          verificationPrivacy: "local-owner-squad-membership-only",
          control: squadFollowControl,
          visibleMemberCount: squadMembers.length,
          members: squadMembers,
          trackedDisplayEntityIds: squadTrackedIds,
          expectedMeanRenderPosition: expectedSquadTarget,
          cameraTarget: actualSquadTarget,
          screenshot: squadFollowScreenshot,
        },
        screenshots: [clusterScreenshot, followScreenshot, squadFollowScreenshot],
      };
      continue;
    }

    if (roleFollowOnly.length) {
      if (viewport.width <= 700 || skillTick === null) {
        throw new Error("Focused role-follow capture requires a desktop viewport and an active-skill tick.");
      }
      await seekToTick(page, skillTick);
      for (const role of roleFollowOnly) {
        const target = await clickFollowRole(page, role);
        expect(target.supported, `the real replay selector must offer a visible ${role}`).toBe(true);
        const sourceCandidates = replayVisibleRolePositions(sourceReplay, skillTick, target, role);
        expect(sourceCandidates.length, `${role} Follow must resolve to a current visible owner-replay entity using its selected identity and HP`).toBeGreaterThan(0);
        await waitForSettledCamera(page);
        const actualCameraTarget = parseCameraTarget(await canvas.getAttribute("data-camera-target"));
        expect(actualCameraTarget, `${role} Follow must expose its camera target`).not.toBeNull();
        const expectedPosition = sourceCandidates.find((candidate) =>
          Math.abs(actualCameraTarget!.x - candidate.x) < 0.01 && Math.abs(actualCameraTarget!.z - candidate.z) < 0.01,
        );
        expect(expectedPosition, `${role} Follow camera target must match one of the selected current-replay entity's exact positions`).toBeDefined();
        const entityLabel = page.locator('.next-renderer-host .entity-world-label[data-focused="true"]');
        await expect(entityLabel).toBeVisible();
        await expect(entityLabel).toContainText(role === "monster" ? /MONSTER/i : /MINION/i);
        const fileName = `${role}-follow-t${String(skillTick).padStart(3, "0")}.png`;
        cameraPosesByCapture[`${viewport.name}/${fileName}`] = await canvas.getAttribute("data-camera");
        cameraTargetsByCapture[`${viewport.name}/${fileName}`] = actualCameraTarget;
        roleFollowCaptures[role] = {
          tick: skillTick,
          role,
          view: sourceReplay.perspective ?? "public",
          entityId: target.id,
          selectedVisibleEntity: target.target,
          sourceReplayEntityCandidates: sourceCandidates.map(({ id, sourceX, sourceY }) => ({ id, x: sourceX, y: sourceY })),
          replayPosition: expectedPosition,
          cameraTarget: actualCameraTarget,
          screenshot: fileName,
        };
        await page.screenshot({ path: join(directory, fileName), animations: "disabled" });
      }
      continue;
    }

    if (skillFollowOnly) {
      if (viewport.width <= 700 || skillTick === null) {
        throw new Error("Focused skill-follow capture requires a desktop viewport and an active skill tick.");
      }
      await seekToTick(page, skillTick);
      const skillFollowTarget = await clickFollow(page);
      expect(skillFollowTarget.catalogId).toBe("F03");
      const expectedSkillPosition = replayHeroPosition(sourceReplay, skillTick, skillFollowTarget, renderedRuleset);
      expect(expectedSkillPosition, "F03 must be visible at the active-skill tick").not.toBeNull();
      await waitForSettledCamera(page);
      const actualSkillCameraTarget = parseCameraTarget(await canvas.getAttribute("data-camera-target"));
      expect(actualSkillCameraTarget, "skill Follow must expose the actual target location").not.toBeNull();
      expect(Math.abs(actualSkillCameraTarget!.x - expectedSkillPosition!.x)).toBeLessThan(0.01);
      expect(Math.abs(actualSkillCameraTarget!.z - expectedSkillPosition!.z)).toBeLessThan(0.01);
      const fileName = `skill-follow-t${String(skillTick).padStart(3, "0")}.png`;
      cameraPosesByCapture[`${viewport.name}/${fileName}`] = await canvas.getAttribute("data-camera");
      cameraTargetsByCapture[`${viewport.name}/${fileName}`] = actualSkillCameraTarget;
      skillFollowCaptures[viewport.name] = {
        tick: skillTick,
        catalogId: skillFollowTarget.catalogId,
        selectedVisibleEntity: skillFollowTarget.target,
        replayPosition: expectedSkillPosition,
        cameraTarget: actualSkillCameraTarget,
      };
      await page.screenshot({ path: join(directory, fileName), animations: "disabled" });
      continue;
    }

    await seekToTick(page, stateTicks.tactical ?? 0);
    if (expectBaseSites) {
      const labels = await assertBaseSiteLabelsAtTick(page, canvas, sourceReplay, stateTicks.tactical ?? 0);
      baseSiteChecks[`${viewport.name}/t${String(stateTicks.tactical ?? 0).padStart(3, "0")}`] = {
        tick: stateTicks.tactical ?? 0,
        labels,
      };
    }
    modeSupport.tactical = await clickCameraMode(page, "tactical");
    await waitForSettledCamera(page);
    cameraPosesByCapture[`${viewport.name}/tactical-t000.png`] = await canvas.getAttribute("data-camera");
    await page.screenshot({ path: join(directory, "tactical-t000.png"), animations: "disabled" });

    await seekToTick(page, stateTicks.overview ?? 0);
    modeSupport.overview = await clickCameraMode(page, "overview");
    await waitForSettledCamera(page);
    cameraPosesByCapture[`${viewport.name}/overview-t000.png`] = await canvas.getAttribute("data-camera");
    await page.screenshot({ path: join(directory, "overview-t000.png"), animations: "disabled" });

    await seekToTick(page, followTick);
    if (followTarget.target && viewport.width <= 700) {
      const followView = page.getByRole("button", { name: "Follow view" });
      if (await followView.count()) {
        await followView.first().click();
        const followRow = page.getByRole("button").filter({ hasText: followTarget.catalogId ?? followTarget.target });
        if (await followRow.count()) {
          await followRow.first().click();
          followSupport[viewport.name] = true;
        } else {
          followSupport[viewport.name] = false;
        }
      } else {
        followSupport[viewport.name] = false;
      }
    } else if (followTarget.target) {
      if (followTarget.catalogId) {
        const currentTarget = await selectVisibleHero(page, followTarget.catalogId);
        expect(currentTarget.supported, "Follow uses a Hero visible at this exact tick after seeking").toBe(true);
      }
      const followControl = page.getByRole("button", { name: /^(Follow selected unit|Follow)$/i });
      if (await followControl.count()) {
        await expect(followControl.first()).toBeEnabled();
        await followControl.first().click();
        followSupport[viewport.name] = true;
      } else {
        followSupport[viewport.name] = false;
      }
    } else {
      followSupport[viewport.name] = false;
    }
    await waitForSettledCamera(page);
    cameraPosesByCapture[`${viewport.name}/follow-t${String(followTick).padStart(3, "0")}.png`] = await canvas.getAttribute("data-camera");
    const followCameraTarget = parseCameraTarget(await canvas.getAttribute("data-camera-target"));
    cameraTargetsByCapture[`${viewport.name}/follow-t${String(followTick).padStart(3, "0")}.png`] = followCameraTarget;
    if (process.env.BATTLEFIELD_EXPECT_BATTLEFIELD_CONSOLE === "true" && followSupport[viewport.name]) {
      expect(followCameraTarget, "Follow must expose its actual target location on the canvas").not.toBeNull();
      expect(Math.abs(followCameraTarget!.x - expectedFollowPosition!.x), "Follow centers the authoritative position plus its canonical lane-track display offset").toBeLessThan(0.01);
      expect(Math.abs(followCameraTarget!.z - expectedFollowPosition!.z), "Follow centers the authoritative position plus its canonical lane-track display offset").toBeLessThan(0.01);
    }
    await page.screenshot({ path: join(directory, `follow-t${String(followTick).padStart(3, "0")}.png`), animations: "disabled" });

    for (const [name, tick] of [
      ["advance", movementTick],
      ["clash", clashTick],
      ["tower-destroy", towerDestroyTick],
      ["base-destroy", baseDestroyTick],
      ["hero-death", heroDeathTick],
      ["hero-respawn", respawnTick],
      ["monster-respawn", neutralRespawnTick],
      ["skill", skillTick],
      ["end", finalTick],
    ] as const) {
      if (tick === null) continue;
      await seekToTick(page, tick);
      await clickCameraMode(page, "tactical");
      await waitForSettledCamera(page);
      const semanticCue = expectCueSemantics
        ? controlledScenario === "cue" && name === "clash" ? "attack"
          : controlledScenario === "cue" && name === "hero-death" ? "hero-death"
            : controlledScenario === "cue" && name === "tower-destroy" ? "tower-destroy"
              : controlledScenario === "farm" && name === "skill" ? "skill"
                : null
        : null;
      if (semanticCue) {
        semanticCueAssertions[`${viewport.name}/${name}-t${String(tick).padStart(3, "0")}`] = await assertSemanticCueAtTick(
          page, canvas, sourceReplay, tick, semanticCue,
        );
      }
      if (expectBaseSites && (name === "base-destroy" || tick === firstEnemyBaseVisibleTick)) {
        const labels = await assertBaseSiteLabelsAtTick(page, canvas, sourceReplay, tick);
        baseSiteChecks[`${viewport.name}/${name}-t${String(tick).padStart(3, "0")}`] = { tick, labels };
      }
      const fileName = `${name}-t${String(tick).padStart(3, "0")}.png`;
      cameraPosesByCapture[`${viewport.name}/${fileName}`] = await canvas.getAttribute("data-camera");
      await page.screenshot({ path: join(directory, fileName), animations: "disabled" });
    }

    if (viewport.width <= 700) {
      mobileConsoleSupport[viewport.name] = {};
      for (const view of ["Timeline view", "Details view"] as const) {
        const button = page.getByRole("button", { name: view });
        if (await button.count()) {
          await button.first().click();
          mobileConsoleSupport[viewport.name][view] = true;
          await page.screenshot({ path: join(directory, `${view.toLowerCase().replaceAll(" ", "-")}-t${String(clashTick ?? 0).padStart(3, "0")}.png`), animations: "disabled" });
        } else {
          mobileConsoleSupport[viewport.name][view] = false;
        }
      }
      const battleView = page.getByRole("button", { name: "Battle view" });
      if (await battleView.count()) await battleView.first().click();
    }

    const stageBox = await page.locator(".next-renderer-host").boundingBox();
    const controls = page.locator(".next-replay-controls");
    const controlsBox = await controls.count() ? await controls.boundingBox() : null;
    layoutByViewport[viewport.name] = {
      viewport: { width: viewport.width, height: viewport.height },
      document: await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      })),
      stageBox,
      controlsBox,
      camera: await canvas.evaluate((element) => ({
        pose: element.getAttribute("data-camera"),
        mode: element.getAttribute("data-camera-mode"),
        tick: element.getAttribute("data-tick"),
      })),
    };
  }

  const imageSha256 = Object.fromEntries(pngFiles(outputDirectory).map((path) => [
    path.slice(outputDirectory.length + 1).replaceAll("\\", "/"),
    sha256(readFileSync(path)),
  ]));
  const metadata = {
    captureType: "actual-real-wasm-enbu-presentation-replay",
    tacticProfile: captureProfile,
    uiSignature,
    uiRevision,
    baselineCommit: baselineSha,
    appCommit: appSha,
    wasmSha256: wasmSha,
    worker: {
      requestId: captured.request!.request_id,
      operation: captured.request!.operation,
      responseOk: captured.response!.ok,
      wasmResponses,
    },
    controlledScenario: controlledScenario ? {
      name: controlledScenario,
      injection: captured.scenarioInjection,
      source: controlledSourceArtifact,
      expected: {
        matchId: expectedScenarioResult?.result.match_id,
        finalTick: expectedScenarioResult?.result.final_tick,
        finalStateDigest: expectedScenarioResult?.result.final_state_digest,
        ownerPresentationDigest: expectedScenarioResult?.owner_replays.attacker.result_digest,
        publicPresentationDigest: expectedScenarioResult?.replay.result_digest,
      },
      policy: "snapshot-injected-into-real-worker; result-produced-by-real-WASM; renderer-receives-presentation-replay-only",
    } : null,
    input: {
      matchId: requestSnapshot.context.match_id,
      ruleset: requestSnapshot.context.ruleset,
      contextSchemaVersion: requestSnapshot.context.schema_version,
      sha256: sha256(inputJson),
    },
    replay: {
      matchId: sourceReplay.match_id,
      view: sourceReplay.perspective ?? "public-presentation",
      schemaVersion: sourceReplay.schema_version,
      presentationDigest: sourceReplay.result_digest,
      publicPresentationDigest: publicReplay.result_digest,
      sourceFrameCount: sourceReplay.frames.length,
      timelineEventCount: events.length,
      eventKinds: [...new Set(events.map((event) => event.event))].sort(),
      sha256: sha256(replayJson),
    },
    artifactBundle: {
      directory: relative(repoRoot, replayBundleDirectory).replaceAll("\\", "/"),
      ownerPresentationReplay: ownerReplayArtifact,
      publicPresentationReplay: publicReplayArtifact,
      simulationInput: inputArtifact,
      controlledSource: controlledSourceArtifact,
    },
    result: {
      outcome: result.outcome,
      terminationReason: result.termination_reason,
      finalTick,
      finalStateDigest: result.final_state_digest,
    },
    exactTicks: stateTicks,
    baseSiteAssertions: expectBaseSites ? {
      immutableSiteIds: baseSiteIds,
      enemySiteId: firstEnemyBaseSiteId,
      firstObservedEnemyTick: firstEnemyBaseVisibleTick,
      checks: baseSiteChecks,
    } : null,
    heroRespawnProof,
    availableCues: {
      advance: movementTick !== null,
      clash: clashTick !== null,
      towerDestroy: towerDestroyTick !== null,
      baseDestroy: baseDestroyTick !== null,
      heroDeath: heroDeathTick !== null,
      heroRespawn: respawnTick !== null,
      neutralMonsterRespawn: neutralRespawnTick !== null,
      activeSkill: skillTick !== null,
      end: true,
    },
    cameraControls: {
      explicitTacticalMode: Boolean(modeSupport.tactical),
      explicitOverviewMode: Boolean(modeSupport.overview),
      followTarget: followTarget.target,
      followAvailable: followSupport,
    },
    mobileConsole: mobileConsoleSupport,
    layoutByViewport,
    cameraPosesByCapture,
    followTargetPosition: expectedFollowPosition,
    skillFollowCaptures,
    cameraTargetsByCapture,
    roleFollowCaptures,
    clusterInspection: clusterInspectorOnly ? clusterInspection : null,
    semanticCueAssertions,
    viewports: captureViewports,
    screenshotNames: clusterInspectorOnly ? ["selected-visible-cluster", "follow-f03-same-tick", "squad-follow-same-tick"]
      : skillFollowOnly ? ["skill-follow"] : roleFollowOnly.length
        ? roleFollowOnly.map((role) => `${role}-follow`)
      : [
      "tactical", "overview", "follow", "advance", "clash", "tower-destroy", "base-destroy",
      "hero-death", "hero-respawn", "monster-respawn", "skill", "end",
    ].filter((name) => stateTicks[name.replaceAll("-", "_") as keyof typeof stateTicks] !== null),
    hashes: {
      ownerReplaySha256: sha256(replayJson),
      publicReplaySha256: sha256(publicReplayJson),
      inputSnapshotSha256: sha256(inputJson),
      imageSha256,
    },
  };
  writeFileSync(join(outputDirectory, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);

  expect(metadata.captureType).toBe("actual-real-wasm-enbu-presentation-replay");
  expect(metadata.input.matchId).toBe(metadata.replay.matchId);
  expect(metadata.replay.presentationDigest).toBe(sourceReplay.result_digest);
  expect(metadata.result.finalStateDigest).toBe(result.final_state_digest);
  expect(metadata.availableCues.end).toBe(true);

  const video = page.video();
  await page.close();
  if (video) await video.saveAs(join(outputDirectory, "battlefield-capture.webm"));
});
