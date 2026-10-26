# Incomplete Hero LOD capture at 549f05641912

- Status: **partial, not reviewable, no visual pass**. This is the preserved pre hit-cape-correction run.
- Source HEAD: `549f056419128566a97100ec75487292bfbbdea7`; the source worktree was clean before capture. The runner originally sampled status after creating its own evidence directory.
- URL: http://127.0.0.1:4188/; Chromium 156.0.8078.47 with SwiftShader; 1440×1000 viewport, 1200×661 canvas.
- Expected set: 180 PNGs. Preserved at stop: 136 raw and 135 portable PNGs; one raw-only frame was copied byte-for-byte into `images/` after space returned. No screenshot was edited.
- The capture ended with ENOSPC before it could write its manifest or contact sheets. The reconstructed [manifest](manifest.json) contains filenames, dimensions and SHA-256 hashes. Runtime errors, camera/pose/material attributes and the final aggregate checks were not preserved, so no zero-error or acceptance claim is made.
- The runner validated each frame's preview identity, pose and explicit LOD selection before saving its raw PNG. This partial artifact does not cover all Heroes/LODs/actions and cannot establish a gate.
