# First-play UX browser evidence

Application source: `4b1e4b2` (including `3ea91d7`, `a2662bc` and `14f077f`). Quick viewport captures were made after the Mobile layout correction at `a2662bc`; the final failed-Preflight captures were repeated at `4b1e4b2` after the error-contrast and compiler-CU display changes. Actual production WASM, Chromium with SwiftShader; no fixture replaces the game runtime in these journey tests.

All five Quick matches produced the actual 600-tick upper-limit Draw. These are completion/replay records, not a balance or victory claim. See [viewport-run-report.json](viewport-run-report.json).

| Viewport | S01 Home | S02 Conditions | S03 Preset | S10 Ready | S12 actual Replay |
| --- | --- | --- | --- | --- | --- |
| mobile-320 | [Home](mobile-320-home.png) | [Conditions](mobile-320-conditions.png) | [Preset](mobile-320-preset.png) | [Ready](mobile-320-ready.png) | [Replay](mobile-320-confirmed-replay.png) |
| mobile-390 | [Home](mobile-390-home.png) | [Conditions](mobile-390-conditions.png) | [Preset](mobile-390-preset.png) | [Ready](mobile-390-ready.png) | [Replay](mobile-390-confirmed-replay.png) |
| mobile-430 | [Home](mobile-430-home.png) | [Conditions](mobile-430-conditions.png) | [Preset](mobile-430-preset.png) | [Ready](mobile-430-ready.png) | [Replay](mobile-430-confirmed-replay.png) |
| desktop-1440 | [Home](desktop-1440-home.png) | [Conditions](desktop-1440-conditions.png) | [Preset](desktop-1440-preset.png) | [Ready](desktop-1440-ready.png) | [Replay](desktop-1440-confirmed-replay.png) |
| desktop-1920 | [Home](desktop-1920-home.png) | [Conditions](desktop-1920-conditions.png) | [Preset](desktop-1920-preset.png) | [Ready](desktop-1920-ready.png) | [Replay](desktop-1920-confirmed-replay.png) |

| Scenario | Evidence |
| --- | --- |
| Source change invalidates Compile | [Stale compilation](custom-stale-compile.png) |
| Invalid Jinrei is rejected | [Compiler rejection](custom-invalid-jinrei-preflight.png) |
| Valid Jinrei with an invalid multi-node Squad is rejected by Enbu | [Real Enbu rejection](custom-invalid-enbu-preflight.png) |
| Repaired configuration starts actual Enbu | [S11 running](custom-enbu-running.png) |
| Continue exposes saved/recovery operations | [Continue](continue-resume-options.png) |
| Restoring the pinned setup preserves its distinction from unsaved recovery | [Restore Point](continue-restored-pinned-setup.png) |

The Playwright spec asserts the rejection, disabled Start, direct repair, revalidation, and completed real replay. Mobile also asserts its Hero pager, optional five-slot disclosure, no horizontal overflow, and mutual exclusion of the desktop review grid and mobile checklist.

Viewport widths 320/390/430/1440/1920 are browser emulation. Physical phone/keyboard/GPU testing remains outside this evidence.
