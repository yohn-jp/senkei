import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const require = createRequire(resolve(process.cwd(), 'package.json'));
const { chromium } = require('@playwright/test');
if (!process.env.SENKEI_CHROMIUM_EXECUTABLE) throw new Error('Set SENKEI_CHROMIUM_EXECUTABLE to the installed Chromium binary.');

const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceShort = sourceRevision.slice(0, 12);
const suffix = `lod-visual-${sourceShort}`;
const output = resolve(`test-results/art-production/${suffix}`);
const evidence = resolve(`docs/evidence/art-production/${suffix}`);
const evidenceImages = join(evidence, 'images');
if (existsSync(output) || existsSync(evidence)) throw new Error(`Refusing to overwrite prior art evidence: ${suffix}`);
mkdirSync(output, { recursive: true });
mkdirSync(evidenceImages, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.SENKEI_CHROMIUM_EXECUTABLE, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
const errors = [], consoleErrors = [], httpErrors = [], failedRequests = [], captures = [];
const url = process.env.SENKEI_ART_LAB_URL ?? 'http://127.0.0.1:4188/';
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('response', response => { if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`); });
page.on('requestfailed', request => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));

const samples = {
  idle: [0, 0.924, 1.848, 2.772, 3.696],
  move: [0, 0.15625, 0.3125, 0.46875, 0.625],
  attack: [0, 0.3625, 0.725, 1.0875, 1.45],
  hit: [0, 0.2, 0.4, 0.6, 0.8],
  death: [0, 0.225, 0.45, 0.675, 0.9, 1.35, 1.8],
};
const lods = [
  { name: 'full', index: 0, visible: 'true,false,false' },
  { name: 'medium', index: 1, visible: 'false,true,false' },
  { name: 'far', index: 2, visible: 'false,false,true' },
];
const angles = [
  { name: 'front', yaw: 0 },
  { name: 'quarter', yaw: Math.PI / 4 },
  { name: 'rear', yaw: Math.PI },
];
const manifest = {
  schema: 'senkei-art-lod-visual-evidence/v1',
  sourceRevision,
  dirtyWorktreeAtCapture: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  url,
  viewport: { width: 1440, height: 1000, deviceScaleFactor: 1, captureTarget: 'production Hero Detail preview canvas' },
  browser: browser.version(),
  executable: process.env.SENKEI_CHROMIUM_EXECUTABLE,
  renderer: 'Chromium/SwiftShader software GPU',
  reducedMotion: 'no-preference',
  captureKind: 'production createHeroModelPreview / buildBattlefieldHero with its generated LOD child explicitly selected by the inspection-only lab override; not Battlefield integration',
  sampling: 'All action samples reset the pose button, wait the requested elapsed time and two animation frames, then capture the actual full canvas. Static front/quarter/rear views use the inspection-only deterministic azimuth control at the same radius and elevation. Each file records the selected LOD child, visibility vector, camera, inspection azimuth, pose, rootY, material profile, baked senkeiSurfaceResponse vertex count and unique vectors, dimensions and SHA-256.',
  poseSamples: samples,
  lods,
  staticAngles: angles.map(({ name, yaw }) => ({ name, yawRadians: yaw })),
  captures,
  errors,
  consoleErrors,
  httpErrors,
  failedRequests,
  status: 'running',
};

const canvas = page.locator('#stage canvas');
const cameraFor = async () => {
  const value = await canvas.getAttribute('data-camera');
  if (!value) throw new Error('Preview canvas did not report its camera.');
  return value.split(',').map(Number);
};
const waitForCameraStable = async () => {
  let previous = await cameraFor();
  let stableFrames = 0;
  for (let attempt = 0; attempt < 80 && stableFrames < 3; attempt++) {
    await page.waitForTimeout(40);
    const current = await cameraFor();
    if (current.every((value, index) => Math.abs(value - previous[index]) < 0.0002)) stableFrames++;
    else stableFrames = 0;
    previous = current;
  }
  if (stableFrames < 3) throw new Error('Camera did not settle after reset/orbit.');
  return previous;
};
const assertSameCamera = (expected, actual, label) => {
  if (expected.length !== actual.length || expected.some((value, index) => Math.abs(value - actual[index]) > 0.002))
    throw new Error(`Camera mismatch for ${label}: expected ${expected}; got ${actual}`);
};
const attributeNumbers = value => String(value ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
const maximumAttributeDelta = (left, right) => {
  const a = attributeNumbers(left), b = attributeNumbers(right);
  if (a.length !== b.length) return Infinity;
  return Math.max(0, ...a.map((value, index) => Math.abs(value - b[index])));
};

async function screenshot({ hero, lod, pose, elapsedSeconds, kind, angle }) {
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const attributes = await canvas.evaluate(node => Object.fromEntries(Array.from(node.attributes).filter(attribute => attribute.name.startsWith('data-')).map(attribute => [attribute.name, attribute.value])));
  if (attributes['data-preview-ready'] !== 'true' || attributes['data-catalog-id'] !== hero || attributes['data-pose'] !== pose)
    throw new Error(`Wrong preview identity/pose for ${hero}/${lod.name}/${pose}: ${JSON.stringify(attributes)}`);
  if (attributes['data-lod-override'] !== lod.name || Number(attributes['data-lod-index']) !== lod.index || attributes['data-lod-level'] !== lod.name || attributes['data-lod-visible'] !== lod.visible)
    throw new Error(`Wrong selected LOD for ${hero}/${lod.name}/${pose}: ${JSON.stringify(attributes)}`);
  const child = attributes['data-lod-child'];
  if (!child?.endsWith(`.${lod.name}`)) throw new Error(`Selected child does not identify ${lod.name}: ${child}`);
  const materialProfile = JSON.parse(attributes['data-lod-material-profile'] ?? '[]');
  if (!Array.isArray(materialProfile) || materialProfile.length === 0) throw new Error(`No material profile for ${hero}/${lod.name}.`);
  const surfaceResponseAttributes = JSON.parse(attributes['data-lod-surface-response'] ?? '[]');
  if (!Array.isArray(surfaceResponseAttributes) || (lod.name !== 'full' && surfaceResponseAttributes.length === 0))
    throw new Error(`No baked senkeiSurfaceResponse vectors for ${hero}/${lod.name}.`);
  const expectedAzimuth = angle ? angles.find(view => view.name === angle)?.yaw : undefined;
  const inspectionAzimuth = Number(attributes['data-inspection-azimuth']);
  if (kind === 'static' && (!Number.isFinite(expectedAzimuth) || !Number.isFinite(inspectionAzimuth) || Math.abs(expectedAzimuth - inspectionAzimuth) > 0.00001))
    throw new Error(`Inspection camera angle mismatch for ${hero}/${lod.name}/${angle}: expected ${expectedAzimuth}, got ${attributes['data-inspection-azimuth']}.`);
  const label = kind === 'motion'
    ? `${hero}-${lod.name}-${pose}-${String(Math.round(elapsedSeconds * 1000)).padStart(4, '0')}ms`
    : `${hero}-${lod.name}-static-${angle}`;
  const image = `${label}.png`;
  const bytes = await canvas.screenshot({ path: join(output, image) });
  writeFileSync(join(evidenceImages, image), bytes);
  captures.push({
    hero, lod: lod.name, lodIndex: lod.index, lodChild: child, lodVisible: attributes['data-lod-visible'],
    kind, pose, ...(Number.isFinite(elapsedSeconds) ? { requestedElapsedSeconds: elapsedSeconds } : {}), ...(angle ? { angle } : {}),
    image: `images/${image}`, rawImage: image, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
    camera: attributes['data-camera'], rootY: attributes['data-root-y'], bodyPoseSample: attributes['data-body-pose-sample'],
    poseSample: attributes['data-pose-sample'], materialProfile, surfaceResponseAttributes,
    ...(Number.isFinite(inspectionAzimuth) ? { inspectionAzimuth } : {}),
    canvasAttributes: attributes, sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

function cameraClose(left, right) {
  const a = left.split(',').map(Number), b = right.split(',').map(Number);
  return a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) <= 0.002);
}

try {
  await page.goto(url);
  await canvas.waitFor({ state: 'visible' });
  const crossLodSamples = new Map();
  const staticCameraSamples = new Map();
  let maxCrossLodPoseDelta = 0;
  for (const hero of ['F01', 'R01']) {
    for (const lod of lods) {
      await page.locator('#hero').selectOption(hero);
      await page.locator('#lod').selectOption(lod.name);
      await page.waitForFunction(({ id, level }) => {
        const canvas = document.querySelector('#stage canvas');
        return canvas?.dataset.catalogId === id && canvas.dataset.lodLevel === level && canvas.dataset.previewReady === 'true';
      }, { id: hero, level: lod.name });
      await page.locator('#reset').click();
      await page.locator('button[data-pose="idle"]').click();
      const defaultCamera = await waitForCameraStable();

      for (const [pose, times] of Object.entries(samples)) {
        for (const seconds of times) {
          await page.locator(`button[data-pose="${pose}"]`).click();
          if (seconds > 0) await page.waitForTimeout(seconds * 1000);
          await screenshot({ hero, lod, pose, elapsedSeconds: seconds, kind: 'motion' });
          const capture = captures.at(-1);
          assertSameCamera(defaultCamera, capture.camera.split(',').map(Number), `${hero}/${lod.name}/${pose}/${seconds}`);
          const key = `${hero}/${pose}/${seconds}`;
          const prior = crossLodSamples.get(key);
          if (prior) {
            const bodyDelta = maximumAttributeDelta(prior.bodyPoseSample, capture.bodyPoseSample);
            const jointDelta = maximumAttributeDelta(prior.poseSample, capture.poseSample);
            maxCrossLodPoseDelta = Math.max(maxCrossLodPoseDelta, bodyDelta, jointDelta);
            if (!cameraClose(prior.camera, capture.camera) || bodyDelta > 0.12 || jointDelta > 0.12)
              throw new Error(`Pose/camera changed across LOD for ${key}: ${prior.lod} vs ${lod.name}`);
          } else crossLodSamples.set(key, { lod: lod.name, camera: capture.camera, bodyPoseSample: capture.bodyPoseSample, poseSample: capture.poseSample });
        }
      }

      for (const angle of angles) {
        await page.locator('#reset').click();
        await page.locator('button[data-pose="idle"]').click();
        await page.locator('#angle').selectOption(angle.name);
        const settledCamera = await waitForCameraStable();
        const actualAzimuth = Number(await canvas.getAttribute('data-inspection-azimuth'));
        if (!Number.isFinite(actualAzimuth) || Math.abs(actualAzimuth - angle.yaw) > 0.00001)
          throw new Error(`Inspection camera angle was not applied for ${hero}/${lod.name}/${angle.name}: got ${actualAzimuth}.`);
        await screenshot({ hero, lod, pose: 'idle', elapsedSeconds: 0, kind: 'static', angle: angle.name });
        const capture = captures.at(-1);
        assertSameCamera(settledCamera, capture.camera.split(',').map(Number), `${hero}/${lod.name}/static/${angle.name}`);
        const key = `${hero}/${angle.name}`;
        const prior = staticCameraSamples.get(key);
        if (prior) assertSameCamera(prior, capture.camera.split(',').map(Number), `${key} camera across LOD`);
        else staticCameraSamples.set(key, capture.camera.split(',').map(Number));
      }
    }
  }

  manifest.expectedCaptureCount = 180;
  if (captures.length !== manifest.expectedCaptureCount) throw new Error(`Expected 180 PNGs; captured ${captures.length}.`);
  manifest.materialProfilesByHeroAndLod = Object.fromEntries(['F01', 'R01'].map(hero => [hero, Object.fromEntries(lods.map(lod => {
    const frame = captures.find(capture => capture.hero === hero && capture.lod === lod.name && capture.kind === 'static' && capture.angle === 'front');
    return [lod.name, frame?.materialProfile ?? []];
  }))]));
  manifest.surfaceResponseAttributesByHeroAndLod = Object.fromEntries(['F01', 'R01'].map(hero => [hero, Object.fromEntries(lods.map(lod => {
    const frame = captures.find(capture => capture.hero === hero && capture.lod === lod.name && capture.kind === 'static' && capture.angle === 'front');
    return [lod.name, frame?.surfaceResponseAttributes ?? []];
  }))]));
  manifest.crossLodPoseCheck = {
    requestedSampleKeys: crossLodSamples.size,
    sameDefaultCameraAcrossAllActionSamples: true,
    maxObservedJointOrRootDeltaRadians: maxCrossLodPoseDelta,
    toleratedDeltaRadians: 0.12,
  };
  manifest.r01ReducedLodMaterialComparison = {
    instruction: 'Compare full, medium and far original PNGs in front/rear static and move poses; inspect the tunic/cape cloth response against metal armor. Profiles are machine-readable hints only and do not constitute visual acceptance.',
    full: manifest.materialProfilesByHeroAndLod.R01.full,
    medium: manifest.materialProfilesByHeroAndLod.R01.medium,
    far: manifest.materialProfilesByHeroAndLod.R01.far,
    bakedSurfaceResponseVectors: manifest.surfaceResponseAttributesByHeroAndLod.R01,
  };
  manifest.status = errors.length || consoleErrors.length || httpErrors.length || failedRequests.length ? 'runtime-errors' : 'captured-awaiting-independent-visual-review';
} catch (error) {
  manifest.status = 'failed';
  manifest.failure = String(error);
  throw error;
} finally {
  manifest.errors = errors;
  manifest.consoleErrors = consoleErrors;
  manifest.httpErrors = httpErrors;
  manifest.failedRequests = failedRequests;
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(evidence, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (captures.length) {
    await page.close();
    const sheetPage = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1 });
    const sheetErrors = [];
    sheetPage.on('pageerror', error => sheetErrors.push(error.message));
    sheetPage.on('console', message => { if (message.type() === 'error') sheetErrors.push(message.text()); });
    for (const hero of ['F01', 'R01']) {
      for (const lod of lods) {
        const entries = captures.filter(capture => capture.hero === hero && capture.lod === lod.name);
        await sheetPage.setContent(`<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><style>*{box-sizing:border-box}body{margin:0;background:#182126;color:#eee;font:16px sans-serif}h1{margin:12px 20px}main{display:grid;grid-template-columns:repeat(5,1fr);gap:3px}figure{margin:0;background:#202d34}img{width:100%;height:205px;object-fit:contain;display:block}figcaption{height:33px;padding:5px;font-size:11px}</style><h1>${hero} ${lod.name} LOD · action time grid and static angles · ${browser.version()} SwiftShader</h1><main>${entries.map(capture => `<figure><img src="data:image/png;base64,${readFileSync(join(output, capture.rawImage)).toString('base64')}"><figcaption>${capture.kind === 'motion' ? `${capture.pose} ${capture.requestedElapsedSeconds.toFixed(3)}s` : capture.angle} · ${capture.sha256.slice(0, 12)}</figcaption></figure>`).join('')}</main>`);
        await sheetPage.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
        const image = `${hero}-${lod.name}-contact.jpg`;
        const bytes = await sheetPage.screenshot({ path: join(evidence, image), fullPage: true, type: 'jpeg', quality: 88 });
        manifest.contactSheets ??= {};
        manifest.contactSheets[`${hero}-${lod.name}`] = { image, sha256: createHash('sha256').update(bytes).digest('hex') };
      }
    }
    manifest.evidenceComposition = { errors: sheetErrors };
    const rawHashes = captures.map(capture => `${capture.hero}-${capture.lod}-${capture.kind === 'motion' ? `${capture.pose}-${capture.requestedElapsedSeconds.toFixed(3)}s` : capture.angle} ${capture.sha256}`).join('\n');
    const readme = `# Hero visual LOD capture at ${sourceShort}\n\n- Source HEAD: \`${sourceRevision}\`; dirty worktree at capture: ${manifest.dirtyWorktreeAtCapture || 'none'}.\n- URL: ${url}; fixed viewport 1440 × 1000, device scale 1; all same-action views assert a fixed camera across full/medium/far.\n- Browser: Chromium ${manifest.browser}; SwiftShader software renderer.\n- Source: production \`createHeroModelPreview\` and \`buildBattlefieldHero\`. The inspection control explicitly selects generated \`full\`, \`medium\`, or \`far\` child and records child name, index and visibility vector. This does not prove Battlefield integration or physical GPU performance.\n- Captures: ${captures.length} actual ${captures[0]?.width ?? 'unknown'}×${captures[0]?.height ?? 'unknown'} canvas PNGs; requested set is 54 action/time samples per LOD across F01/R01 plus 18 static front/quarter/rear angles (180 total). SHA-256, camera, inspection azimuth, pose, rootY, selected-child identity, material profile and baked \`senkeiSurfaceResponse\` vector counts/values are in [manifest.json](manifest.json). Portable originals are in [images/](images/); identical raw copies are in ignored \`test-results/art-production/${suffix}/\`.\n- R01 material comparison: use the full, medium and far contact sheets and original front/rear/move frames to compare cloth tunic/cape against armor. Baked response vectors are recorded without assigning surface labels. No visual pass is inferred.\n- Runtime: ${errors.length} page errors, ${consoleErrors.length} console errors, ${httpErrors.length} HTTP errors and ${failedRequests.length} failed requests. Exact values are in the manifest.\n- Contact sheets: ${Object.entries(manifest.contactSheets ?? {}).map(([key, value]) => `[${key}](${value.image})`).join(', ')}. They are overviews; independent review should use full-resolution originals.\n\n## PNG SHA-256\n\n\`\`\`text\n${rawHashes}\n\`\`\`\n`;
    writeFileSync(join(evidence, 'README.md'), readme);
    writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    writeFileSync(join(evidence, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  await browser.close();
}
console.log(JSON.stringify({ output, evidence, sourceRevision, browser: manifest.browser, count: captures.length, errors, consoleErrors, httpErrors, failedRequests }, null, 2));
