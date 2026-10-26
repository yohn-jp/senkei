import type { MatchContext, SenkeiSnapshot, SimulationSnapshot } from "../../contracts";
import { canonicalInputKey } from "./run-comparison";
export interface CampaignAssociation { readonly scenarioId: string; readonly eligible: boolean; readonly reason: string; }
/** A scenario label is not proof that a frozen custom Run used Campaign conditions. */
export function campaignConditionMismatch(actual: Pick<SimulationSnapshot, "defender" | "context">, expectedNpc: SenkeiSnapshot, expectedContext: MatchContext): string | null {
  if (canonicalInputKey(actual.defender) !== canonicalInputKey(expectedNpc)) return "Frozen opponent differs from the authored Campaign NPC.";
  if (canonicalInputKey(actual.context) !== canonicalInputKey(expectedContext)) return "Frozen context differs from the same-Match default Campaign context.";
  return null;
}
