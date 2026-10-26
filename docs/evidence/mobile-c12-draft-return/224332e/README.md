# C12 Draft return probe

A production browser build from source `224332e70b26dd9e4f31c64dbad21631c6990158` loaded the confirmed main WASM (`ae2f786e671bc99b34dea4e97120179380c7bac6aadc1e9068b071f1e1454c2a`). At 390×844, the test edited Jinrei Text without compiling, navigated to Home, and entered Next. Before touching either editor tab, it confirmed that the Jinrei workspace tab and Jinrei Text tab were still selected, the same source remained, and compile state remained `COMPILE REQUIRED`.

The same retained edit survived viewport resizes through 844×390 and back to 390×844, with no horizontal overflow or page errors. This is an explicit Next workspace entry, not an app Back button or browser history traversal. The change in viewport dimensions emulates a layout resize; physical device orientation, touch, Safe Area and keyboard/IME remain unchecked.

Manual review found the 844×390 capture keeps the desktop sidebar and reduces the Jinrei workbench to 417 CSS pixels, with a 163.8 CSS pixel source editor. The [landscape screenshot](landscape-shaped.png) is a concrete landscape layout review case; the editor remained visible and retained its content, while visual usability is left unaccepted. `report.json` records exact dimensions and SHA-256 hashes for each capture.
