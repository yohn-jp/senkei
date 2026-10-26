# Mobile replay-control acceptance

The browser test at source revision `7522a23813632d0494f8bc2ef3c89f9d2364fc4b` launched a fresh, confirmed local Enbu match with WASM SHA-256 `ae2f786e671bc99b34dea4e97120179380c7bac6aadc1e9068b071f1e1454c2a` and exercised mode and information-layer controls at 320×844, 390×844, 430×932, 1440×900, and 1920×1080. All viewports remained within the page width, mode and layer toggles worked, and replay Tick 60 stayed fixed. The mobile touch targets measured 44 pixels high.

A manual review of the five full-page screenshots found the controls contained and readable at every tested size. Chromium used SwiftShader, so this evidence makes no physical-device or hardware-GPU claim. `report.json` records the viewport measurements, source and WASM identities, browser, visual review, and each image hash.
