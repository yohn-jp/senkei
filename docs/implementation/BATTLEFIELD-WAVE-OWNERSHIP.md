# Battlefield redesign: fixed Wave boundaries

Authority: Issue #5 and PR #3 blocking comment 6385227700.
Baseline: c9fe67c0b28b2806dbfd70b5c6995ba4e3008acb.
Scope: battlefield presentation, observation cameras, battlefield UI, and verification.
No Hero Atelier, balance tuning, rules, Jinrei, or PR #4 changes.

| Owner | Writable scope |
| --- | --- |
| Luna A | `packages/renderer/src/world-presentation.ts` and new terrain-only modules. Real-match ground, natural perimeter, road/jungle regions, camps and static landforms. |
| Luna B | `packages/renderer/src/index.ts`: cameras, entities, cues, lights, labels and renderer lifecycle. Do not edit the legacy `terrain()` / `buildCamp()` bodies or A's modules. |
| Luna C | Battlefield sections/state/effects in `apps/web/src/features/next/NextWorkspace.tsx`, battlefield-only CSS in that feature directory. Do not change Atelier, persistence, or game rules. |
| Luna D | Battlefield browser tests, deterministic evidence scripts, `docs/evidence/battlefield/`, and battlefield verification report. No production edits. |
| Sol | Shared interfaces, contract/adapter if required, global app CSS, integration and final validation. |

Each owner uses a separate branch/worktree. Commits are integrated by Sol.
A and B do not share writable source files. The existing G1 sample scenery is
retained inside `index.ts`; actual maps with authored `scene.routes` use the
separate world-presentation builder. The preparatory extraction preserves the
baseline rendering so before captures remain comparable.

Shared renderer methods are fixed for this Wave:

- `setCameraMode("tactical" | "overview")`: standard observation versus whole-world inspection.
- `resetCamera()`: return to standard view (legacy sample retains its old reset).
- `setTracking(id: string | null)`: follow a visible entity.
- `setTrackingGroup(ids: readonly string[])`: follow explicitly supplied visible entities.
- `focusPoint({x, y})`: inspect an event location already supplied by Replay.
- Existing `zoom`, `select`, `setPixel`, `update`, `dispose` remain.

Only Replay positions, visible entities and confirmed cues may drive UI and
camera targets. Squad tracking may use the existing authorized owner replay;
public replay must not infer private membership. There is no synthetic Fog
mask if Replay has not supplied one. World geometry is presentation, never
collision, navigation or visibility logic.
