# S06 runtime skill context — producer evidence

The read-only helper consumes an already validated immutable Run and an exact
authorized attacker observation. It compares the current Draft slot with the
submitted slot before showing acquired skills at the selected Tick. A missing
owner observation, changed slot, missing exact frame or ambiguous identity yields
Unknown with an explicit reason. Acquisition is never inferred from level,
planned branch membership or future events.

The fixture preserves complete actual native owner frames at T0 and T85 from
the existing first-march input. Its provenance records the original native
reply and frozen Snapshot hashes. It is component evidence, not a new production
Enbu execution or completed S06 integration.

Standalone SSR component tests live outside the deployed journey test directory.
Run them from the same npm-prefix working directory used by CI:

```sh
SENKEI_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm --prefix tests/browser run test:e2e -- --config=playwright.skill-components.config.ts
```

Independent review reproduced the original spec's cwd failure through this npm
prefix invocation. Module-relative repository paths and the dedicated component
config fix the test integration boundary. Both 1440px/390px component tests and
all four focused helper/view tests pass after the correction. Ordinary production
journey collection succeeds and does not include the SSR component spec.

The HeroAtelier consumer accepts optional `skillRunContext` with the immutable
Run fields (`HeroAtelierRunContext`). It associates the selected Draft slot and
current Catalog Hero through the same helper and displays the result below the
editable branch canvas. An absent Run has an explicit unknown-acquisition state.
The parent must pass the actual Run authorization, owner replay, submitted Hero
configuration, Match/ruleset identities and selected Replay Tick; parent wiring
remains a separate task.

The mounted-component browser harness uses the actual Core Catalog and the two
unchanged native owner frames. At 390px and 1440px it verifies T85 acquisition,
T0 rewind, public-only Unknown, a changed Draft branch yielding Unknown, ordinary
Collection/Skill return, no Run mutation and no Draft write from observation-only
operations. Only the explicit branch choice writes the Draft. The dedicated
`skill-atelier.config.ts` keeps this component harness outside production journey
collection. TypeScript/build and 17 focused consumer/legacy/helper tests pass.

No physical-device, full main-CI or complete S06 product acceptance is asserted
before the Run-parent connection is implemented and exercised.
