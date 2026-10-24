#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [beforeArgument, afterArgument, ...flags] = process.argv.slice(2);
if (!beforeArgument || !afterArgument) {
  process.stderr.write("Usage: node scripts/visual/compare-battlefield-captures.mjs <before-dir> <after-dir> [--require-identical-images]\n");
  process.exit(2);
}

const beforeDirectory = resolve(beforeArgument);
const afterDirectory = resolve(afterArgument);
const before = JSON.parse(readFileSync(join(beforeDirectory, "metadata.json"), "utf8"));
const after = JSON.parse(readFileSync(join(afterDirectory, "metadata.json"), "utf8"));
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const beforeImages = before.hashes.imageSha256 ?? {};
const afterImages = after.hashes.imageSha256 ?? {};
const normalizeExactTicks = (ticks) => ({
  tactical: ticks.tactical ?? null,
  overview: ticks.overview ?? null,
  follow: ticks.follow ?? null,
  advance: ticks.advance ?? null,
  clash: ticks.clash ?? null,
  tower_destroy: ticks.tower_destroy ?? null,
  base_destroy: ticks.base_destroy ?? null,
  hero_death: ticks.hero_death ?? null,
  hero_respawn: ticks.hero_respawn ?? ticks.respawn ?? null,
  neutral_monster_respawn: ticks.neutral_monster_respawn ?? ticks.monster_respawn ?? null,
  skill: ticks.skill ?? null,
  end: ticks.end ?? null,
});
const beforeExactTicks = normalizeExactTicks(before.exactTicks ?? {});
const afterExactTicks = normalizeExactTicks(after.exactTicks ?? {});
const beforePaths = Object.keys(beforeImages).sort();
const afterPaths = Object.keys(afterImages).sort();
const commonPaths = beforePaths.filter((path) => Object.hasOwn(afterImages, path));
const differentImages = commonPaths.filter((path) => beforeImages[path] !== afterImages[path]);
const report = {
  beforeCommit: before.appCommit,
  afterCommit: after.appCommit,
  identity: {
    sameInputSha256: before.input.sha256 === after.input.sha256,
    sameMatchId: before.input.matchId === after.input.matchId && before.replay.matchId === after.replay.matchId,
    sameOwnerReplayDigest: before.replay.presentationDigest === after.replay.presentationDigest,
    samePublicReplayDigest: before.replay.publicPresentationDigest === after.replay.publicPresentationDigest,
    sameFinalStateDigest: before.result.finalStateDigest === after.result.finalStateDigest,
    sameExactTicks: equal(beforeExactTicks, afterExactTicks),
    sameViewports: equal(before.viewports, after.viewports),
  },
  exactTicks: { before: beforeExactTicks, after: afterExactTicks },
  screenshots: {
    beforeCount: beforePaths.length,
    afterCount: afterPaths.length,
    commonCount: commonPaths.length,
    exactPixelFiles: commonPaths.length - differentImages.length,
    differentPixelFiles: differentImages,
    onlyBefore: beforePaths.filter((path) => !Object.hasOwn(afterImages, path)),
    onlyAfter: afterPaths.filter((path) => !Object.hasOwn(beforeImages, path)),
  },
  layout: {
    metricsEqual: equal(before.layoutByViewport ?? {}, after.layoutByViewport ?? {}),
    changedViewports: Object.keys(before.layoutByViewport ?? {}).filter((name) =>
      !equal(before.layoutByViewport?.[name], after.layoutByViewport?.[name]),
    ),
  },
};
const captureIdentityMatches = Object.values(report.identity).every(Boolean);
const screenshotSetMatches = report.screenshots.commonCount > 0 &&
  report.screenshots.onlyBefore.length === 0 && report.screenshots.onlyAfter.length === 0;
const imagesIdentical = screenshotSetMatches && report.screenshots.differentPixelFiles.length === 0;
report.captureIdentityMatches = captureIdentityMatches;
report.allScreenshotsIdentical = imagesIdentical;
const output = `${JSON.stringify(report, null, 2)}\n`;
const outputPath = process.env.BATTLEFIELD_COMPARISON_OUTPUT;
if (outputPath) writeFileSync(resolve(outputPath), output);
process.stdout.write(output);

if (!captureIdentityMatches || (flags.includes("--require-identical-images") && !imagesIdentical)) {
  process.exitCode = 1;
}
