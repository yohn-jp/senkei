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

Live HeroAtelier and Run-parent wiring remains a separate consumer task. No
physical-device, full main-CI or complete S06 acceptance is asserted here.
