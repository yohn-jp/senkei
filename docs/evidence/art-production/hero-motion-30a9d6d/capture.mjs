import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const require = createRequire(resolve(process.cwd(), 'package.json'));
const { chromium } = require('@playwright/test');
if (!process.env.SENKEI_CHROMIUM_EXECUTABLE) throw new Error('Set SENKEI_CHROMIUM_EXECUTABLE to the installed Chromium binary.');
const suffix = '30a9d6d';
const output = resolve(`test-results/art-production/hero-motion-${suffix}`);
const evidence = resolve(`docs/evidence/art-production/hero-motion-${suffix}`);
mkdirSync(output, { recursive: true });
mkdirSync(evidence, { recursive: true });

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
const manifest = {
  schema: 'senkei-art-hero-motion-evidence/v2',
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirtyWorktree: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  url,
  viewport: { width: 1440, height: 1000, deviceScaleFactor: 1, captureTarget: 'production Hero Detail preview canvas' },
  browser: browser.version(),
  executable: process.env.SENKEI_CHROMIUM_EXECUTABLE,
  renderer: 'Chromium/SwiftShader software GPU',
  reducedMotion: 'no-preference',
  captureKind: 'production Hero Detail preview using buildBattlefieldHero; full automatic LOD at the default camera; not Battlefield integration',
  sampling: 'Each sample resets its pose button, waits the requested elapsed time, advances two animation frames, then screenshots the actual canvas. Actual pose/rootY/LOD dataset attributes are stored per image.',
  poses: samples,
  captures,
  errors,
  consoleErrors,
  httpErrors,
  failedRequests,
  status: 'running',
};

try {
  await page.goto(url);
  const canvas = page.locator('#stage canvas');
  await canvas.waitFor({ state: 'visible' });
  for (const hero of ['F01', 'R01']) {
    await page.locator('#hero').selectOption(hero);
    await page.waitForFunction(id => document.querySelector('#stage canvas')?.dataset.catalogId === id, hero);
    for (const [pose, times] of Object.entries(samples)) {
      for (const seconds of times) {
        await page.locator(`button[data-pose="${pose}"]`).click();
        if (seconds > 0) await page.waitForTimeout(seconds * 1000);
        await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
        const image = `${hero}-${pose}-${String(Math.round(seconds * 1000)).padStart(4, '0')}ms.png`;
        const bytes = await canvas.screenshot({ path: join(output, image) });
        const size = await canvas.evaluate(node => ({ width: node.width, height: node.height }));
        const attributes = await canvas.evaluate(node => Object.fromEntries(Array.from(node.attributes).filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value])));
        captures.push({ hero, pose, requestedElapsedSeconds: seconds, image, width: size.width, height: size.height, sha256: createHash('sha256').update(bytes).digest('hex'), canvasAttributes: attributes });
        if (attributes['data-catalog-id'] !== hero || attributes['data-pose'] !== pose || attributes['data-lod-level'] !== 'full' || attributes['data-lod-visible'] !== 'true,false,false') {
          throw new Error(`Unexpected hero/pose/LOD identity for ${image}: ${JSON.stringify(attributes)}`);
        }
      }
    }
  }
  manifest.status = errors.length || consoleErrors.length || httpErrors.length || failedRequests.length ? 'runtime-errors' : 'captured-awaiting-independent-visual-review';
} catch (error) {
  manifest.status = 'failed';
  manifest.failure = String(error);
  throw error;
} finally {
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (captures.length) {
    await page.close();
    const sheetPage = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const sheetErrors = [];
    sheetPage.on('pageerror', error => sheetErrors.push(error.message));
    sheetPage.on('console', message => { if (message.type() === 'error') sheetErrors.push(message.text()); });
    for (const hero of ['F01', 'R01']) {
      const entries = captures.filter(capture => capture.hero === hero);
      await sheetPage.setContent(`<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><style>*{box-sizing:border-box}body{margin:0;background:#182126;color:#eee;font:16px sans-serif}h1{margin:12px 20px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:3px}figure{margin:0;background:#202d34}img{width:100%;height:250px;object-fit:contain;display:block}figcaption{height:32px;padding:6px;font-size:13px}</style><h1>${hero} motion samples · production preview · ${browser.version()} SwiftShader</h1><main>${entries.map(capture => `<figure><img src="data:image/png;base64,${readFileSync(join(output, capture.image)).toString('base64')}"><figcaption>${capture.pose} ${capture.requestedElapsedSeconds.toFixed(3)}s · ${capture.sha256.slice(0, 12)}</figcaption></figure>`).join('')}</main>`);
      await sheetPage.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
      const bytes = await sheetPage.screenshot({ path: join(evidence, `${hero}-motion-contact.jpg`), fullPage: true, type: 'jpeg', quality: 88 });
      manifest.contactSheets ??= {};
      manifest.contactSheets[hero] = { image: `${hero}-motion-contact.jpg`, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
    manifest.evidenceComposition = { errors: sheetErrors };
    const rawHashes = captures.map(capture => `${capture.hero}-${capture.pose} ${capture.requestedElapsedSeconds.toFixed(3)}s ${capture.sha256}`).join('\n');
    const readme = `# Hero motion capture at ${manifest.sourceRevision.slice(0, 12)}\n\n- Source HEAD: \`${manifest.sourceRevision}\`; dirty worktree at capture: ${manifest.dirtyWorktree || 'none'}.\n- URL: ${url}; viewport 1440 × 1000, device scale 1.\n- Browser: Chromium ${manifest.browser}; SwiftShader software renderer.\n- Source: committed production \`createHeroModelPreview\` / \`buildBattlefieldHero\`; automatic LOD at default camera, verified as full in every capture. This does not prove Battlefield integration or physical GPU performance.\n- Motion: no reduced-motion preference. Captured ${captures.length} actual canvas PNGs across the five poses for F01 and R01; per-image SHA-256, elapsed request and pose/rootY/LOD attributes are in [manifest.json](manifest.json). Originals are in ignored \`test-results/art-production/hero-motion-${suffix}/\`.\n- Runtime: ${errors.length} page errors, ${consoleErrors.length} console errors, ${httpErrors.length} HTTP errors and ${failedRequests.length} failed requests. Exact values are in the manifest.\n- Review sheets: [F01](F01-motion-contact.jpg), [R01](R01-motion-contact.jpg). They are reduced overviews; independent visual review should use original PNGs. No visual acceptance is inferred here.\n- All-LOD geometry contact is covered by the focused CPU regression tests; visual medium/far LOD remains unverified.\n\n## PNG SHA-256\n\n\`\`\`text\n${rawHashes}\n\`\`\`\n`;
    writeFileSync(join(evidence, 'README.md'), readme);
    writeFileSync(join(evidence, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  await browser.close();
}
console.log(JSON.stringify({ output, evidence, sourceRevision: manifest.sourceRevision, dirtyWorktree: manifest.dirtyWorktree, browser: manifest.browser, count: captures.length, errors, consoleErrors, httpErrors, failedRequests, contactSheets: manifest.contactSheets }, null, 2));
