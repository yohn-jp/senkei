import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createServer } from "vite";

const root = resolve(import.meta.dirname, "../../..");
const scenarioIds = ["protect-the-core", "first-march"];
const fixtureManifestSchema = "senkei-native-campaign-fixtures/v1";
const fixtureArtifactSchema = "senkei-native-campaign-fixture/v1";

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(message) {
  throw new Error(message);
}

async function loadFixtureApi() {
  const server = await createServer({
    configFile: false,
    root,
    logLevel: "silent",
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    return await server.ssrLoadModule("/tests/browser/helpers/native-campaign-fixture.ts");
  } finally {
    await server.close();
  }
}

async function prepare(directory) {
  const dispatcherPath = process.env.SENKEI_NATIVE_DISPATCHER;
  if (!dispatcherPath) fail("SENKEI_NATIVE_DISPATCHER must point to the browser-build native dispatcher.");
  const dispatcherBytes = await readFile(dispatcherPath).catch(() => fail(`Native dispatcher does not exist: ${dispatcherPath}`));
  if (git("status", "--porcelain")) fail("Refusing to prepare fixtures from a dirty checkout; build evidence must match the committed source tree.");
  const outputDirectory = resolve(directory);
  const outputParent = dirname(outputDirectory);
  await mkdir(outputParent, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(outputParent, ".campaign-native-fixtures."));
  try {
    const { buildNativeCampaignFixture } = await loadFixtureApi();
    const sourceSha = git("rev-parse", "HEAD");
    const sourceTreeSha = git("rev-parse", `${sourceSha}^{tree}`);
    const fixtures = {};
    for (const scenarioId of scenarioIds) {
      const fixture = await buildNativeCampaignFixture(scenarioId);
      if (fixture.sourceSha !== sourceSha || fixture.scenarioId !== scenarioId) {
        fail(`Native Campaign fixture identity changed while generating ${scenarioId}.`);
      }
      const filename = `${scenarioId}.json`;
      const payload = Buffer.from(`${JSON.stringify({ schema: fixtureArtifactSchema, sourceSha, scenarioId, fixture })}\n`);
      await writeFile(join(temporaryDirectory, filename), payload, { flag: "wx" });
      fixtures[scenarioId] = {
        filename,
        bytes: payload.byteLength,
        sha256: sha256(payload),
        snapshotDigest: fixture.snapshotDigest,
      };
    }
    const manifest = {
      schema: fixtureManifestSchema,
      sourceSha,
      sourceTreeSha,
      generatedAt: new Date().toISOString(),
      dispatcher: { bytes: dispatcherBytes.byteLength, sha256: sha256(dispatcherBytes) },
      fixtures,
    };
    await writeFile(join(temporaryDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    try {
      await stat(outputDirectory);
      fail(`Refusing to replace an existing Native Campaign fixture directory: ${outputDirectory}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(temporaryDirectory, outputDirectory);
    process.stdout.write(`Prepared ${scenarioIds.length} Native Campaign fixtures for ${sourceSha} in ${outputDirectory}.\n`);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function verify(directory, expectedSourceSha) {
  const fixtureDirectory = resolve(directory);
  const { verifyNativeCampaignFixtureDirectory } = await loadFixtureApi();
  const fixtures = verifyNativeCampaignFixtureDirectory(fixtureDirectory, expectedSourceSha);
  if (fixtures.size !== scenarioIds.length || scenarioIds.some((scenarioId) => !fixtures.has(scenarioId))) {
    fail("Verified Native Campaign fixtures do not cover the supported scenario set.");
  }
  process.stdout.write(`Verified ${fixtures.size} Native Campaign fixtures for ${expectedSourceSha}.\n`);
}

const [mode, directory, expectedSourceSha] = process.argv.slice(2);
if (mode === "prepare" && directory) {
  await prepare(directory);
} else if (mode === "verify" && directory && expectedSourceSha) {
  await verify(directory, expectedSourceSha);
} else {
  process.stderr.write("Usage: node scripts/ci/browser/prepare-native-campaign-fixtures.mjs <prepare DIRECTORY | verify DIRECTORY SOURCE_SHA>\n");
  process.exitCode = 2;
}
