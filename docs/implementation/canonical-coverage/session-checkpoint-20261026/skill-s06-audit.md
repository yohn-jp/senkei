# S06 read-only boundary audit

Inspected PR40 `4d4ada7` and latest fetched main `f14b003`. HeroAtelier is identical between them; the relevant main call site still receives only Draft/Catalog/capability data. Browser capture used PR40 production build, Chromium, real imported Experiment from `campaign-exact-rematch-records.json`; no new simulation, fabricated result, or storage manipulation. No source files changed.

## Captured flow

1. Fresh Draft → Skill Tree: healthy planning view. `01-plan-desktop.png` shows selected/unselected branch, authored levels, prerequisites, capability information, and explicit planned≠acquired wording.
2. Import existing real native/WASM completed Experiment → Analysis: healthy provenance boundary. `02-run-analysis-desktop.png` says Public Replay, identifies the immutable Run roster separately from Draft, and reports Hero attribution not proven for this public-only artifact.
3. Analysis → Skillを変更: missing current-Run progression context. `03-post-run-skills-desktop.png` shows only the editable Draft plan, with no Match/Tick, acquired state, or explanation that actual slot attribution is unavailable.
4. Same S06 at390px: same missing context, functional stacked layout (`04-post-run-skills-mobile.png`). No visual horizontal clipping observed; no accessibility compliance claim from screenshots.

All screenshots captured and visually inspected this run, under `/workspace/scratch/skill-audit/`.

## Contract/status

| Contract | Authority | Existing exact symbols | Status / bounded action |
| --- | --- | --- | --- |
| Separate planned, current-Run acquired, prerequisite missing, other branch | UX-INTERACTION-CONTRACTS.md39 (C03); PRE-BATTLE-SCREENS.md37 (S06) | HeroAtelierProps15–29; HeroAtelier237–267; `planned = selected`253; node state258 | **DEFINED actionable missing leaf:** add a read-only Run progression summary/state input alongside Draft planning, with explicit Match/Tick and unknown/unavailable state. Never relabel Draft nodes acquired from Draft branch or Catalog unlock level alone. |
| Actual acquisition producer | UNITS.md137–140; actual bundled RulePackage | `NextRules.heroes[].skills`, `.skill_paths`; `SkillDefinition.unlock_level`, `.prerequisites`; Core `learn_path_skills` next_combat.rs848–891; runtime Hero `level` and `skills`; `next.level_up` and `next.skill_acquired` events | Producer exists. No new XP formula, costs, levels, SkillPoint rule, or acquisition mutation needed. Runtime `skills` is authoritative, not recomputation from level. |
| Bind progress to exact own Run slot and tick | C01 context preservation; existing owner/public observation contract | `BattleRun.snapshot`, `.sourceReplay`, `.response.owner_replays?.attacker`; NextWorkspace1221–1227 `selectedFrame`, `ownerReplay`, `ownerFrame`; BattleAnalysis `runHeroes`, `attributeOwnHeroes`; owner fields `slot_id`,`catalog_id`,`skill_path`,`skills`,`level` | **DEFINED:** derive from exact authorized owner frame/slot at displayed Tick. Match exact original slotID and submitted Hero/path; keep immutable Run separate from changed Draft. Public-only/missing frame/dead or unseen entity/ambiguous mapping means unknown, never empty/no skills. Existing attribution helper intentionally does not infer private slot identity from public Catalog identity. |
| Prerequisite display | C03/S06 + actual SkillDefinition | `skillPathIssues`, `pathSkills`, prerequisites254/260 | Catalog prerequisites and other branch already implemented. Once exact runtime skill IDs available, show actual missing prerequisites independently of planned branch. Keep no-Run state prospective. No additional game decision needed. |
| Permanent acquisition across matches or new acquisition controls | UNITS.md138 (automatic in-battle); PROGRESSION-UX.md7/85–86 | No producer for persistent skill ownership | **DECISION_REQUIRED/out of scope:** no persistent acquired-skill ledger, spend/unlock/claim controls, new numerical requirements, or invented reward acquisition. |

## Concrete data evidence and limits

The real imported public replay contains attacker F01 at T0 level1 with `skills:[]`, and an observed attacker F01 at T600 level4 with `f01_a_passive` + `f01_a_active`; acquisition events also exist. Public IDs change with visibility and this file has no owner slot_id, so this proves runtime producer content, not a safe mapping to the editable slot. The leaf must show unavailable attribution for this particular import instead of assigning these skills to Draft F01 by Catalog ID. An actual owner replay is needed for the positive exact-slot browser acceptance case.

Suggested exclusive leaf: NEW `skill-run-progress.ts`/tests + NEW read-only view/CSS. Later owner-authorized wiring in NextWorkspace and HeroAtelier is required for completion; none was edited during this audit. Suggested input is immutable Run identity, displayed Tick, exact submitted roster, and authorized frame; output is known level/skillIDs/missing-prerequisite IDs or explicit unavailable reason. Existing replay owner contract suffices, so a missing always-valid data producer is not a reason to mark all S06 progress UI decision-required.

Acceptance: no Run remains plan-only; known owner slot before/after real acquisition distinguishes acquired/planned; missing/public/ambiguous slot shows unknown; changed Draft never inherits older Run's acquisitions; Tick rewind updates status; desktop/mobile show Match/Tick and state in text. This audit did not run a new positive owner-view battle, physical-device checks, or CI.
