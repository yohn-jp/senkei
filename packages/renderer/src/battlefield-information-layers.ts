import * as THREE from "three";
import type { BattlefieldFog } from "./battlefield-fog";

export interface BattlefieldInformationLayers {
  readonly vision: boolean;
  readonly lanes: boolean;
  readonly engagements: boolean;
}

export interface BattlefieldInformationLayerTargets {
  readonly fog: BattlefieldFog;
  readonly laneGuides: THREE.Group;
  readonly effects: THREE.Group;
  readonly laneLabels: Iterable<HTMLElement>;
  readonly entityLabels: Iterable<HTMLElement>;
  readonly engagementLabels: Iterable<HTMLElement>;
}

/** Applies display-only switches to Replay-derived layers without changing their data. */
export function applyBattlefieldInformationLayers(
  layers: BattlefieldInformationLayers,
  targets: BattlefieldInformationLayerTargets,
): void {
  targets.fog.setEnabled(layers.vision);
  targets.laneGuides.visible = layers.lanes;
  for (const label of targets.laneLabels) label.style.visibility = layers.lanes ? "visible" : "hidden";
  for (const label of targets.entityLabels) label.style.visibility = layers.engagements ? "visible" : "hidden";
  for (const label of targets.engagementLabels) label.style.visibility = layers.engagements ? "visible" : "hidden";
  targets.effects.visible = layers.engagements;
}
