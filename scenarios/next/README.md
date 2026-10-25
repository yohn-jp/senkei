# Next local PvE progression

`campaign.ts` publishes six authored Next Senkei drafts in progression order.
Each NPC contains five valid catalog Heroes, a declared squad partition, and
an ordinary Jinrei program. `source-fixtures.json` is the exact source imported
by the browser factory and compiled by the Rust integration test against the
published Next RulePackage.

The scenario descriptions and criteria are learning prompts for Replay
inspection. Progression is gated only on the actual player victory recorded by
Enbu (`attacker_victory` with `base_destroyed`); a challenge never replaces
base destruction with a local objective check. `getNextCampaignRunFeedback`
formats the measured outcome, final tick, and termination reason, including a
clear draw message when the base condition was not met.

The authored sequence covers a first lane advance, central scouting and
visibility, split lane pressure, a neutral camp commitment, a quintet at a
bridge approach, and a dispersed formation regrouping for base defense. It is
content for the bundled `senkei.next` package and fails closed for another
ruleset or missing Hero skill paths.
