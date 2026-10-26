# Recovery quota and Core retry probe

The browser regression used a fresh production build at source revision `088d96449e551d0cb6d12923b56fd3678fb63169` and WASM SHA-256 `ae2f786e671bc99b34dea4e97120179380c7bac6aadc1e9068b071f1e1454c2a`. It forced one Recovery localStorage write to fail with `QuotaExceededError`, then confirmed the edited in-memory Jinrei source and the previous persisted Recovery bytes remained intact. After retrying the same Core, it compiled the retained source successfully, with no page errors.

This probe does not execute Enbu and does not verify current Run preservation. The screenshots and report show only this Draft/Recovery operation. Chromium ran with SwiftShader; no physical device or hardware GPU is represented. Image SHA-256 values are recorded in `report.json`.
