import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const output = resolve(process.env.SENKEI_ART_OUTPUT ?? 'test-results/art-production/lab');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.SENKEI_CHROMIUM_EXECUTABLE, args: ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
const captures = [], errors = [], consoleErrors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
const manifest = { schema: 'senkei-art-lab-evidence/v1', sourceRevision: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), dirtyWorktree: execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(), browser: browser.version(), renderer: 'Chromium/SwiftShader software GPU', captureKind: 'production-preview-isolated-lab-NOT-app-integration', acceptance: 'UNVERIFIED: inspect PNG evidence; capture completion is not visual acceptance', status: 'running', captures, errors, consoleErrors };
try {
  await page.goto(process.env.SENKEI_ART_LAB_URL ?? 'http://127.0.0.1:4187');
  const canvas = page.locator('#stage canvas');
  async function capture(label) {
    await canvas.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const image = `${label}.png`;
    const bytes = await canvas.screenshot({path:resolve(output,image)});
    captures.push({image,label,attributes:await canvas.evaluate(node=>Object.fromEntries(Array.from(node.attributes).filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]))),sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  for (const hero of ['F01','R01']) {
    await page.locator('#hero').selectOption(hero);
    await canvas.waitFor({state:'visible'});
    for (const [name,yaw] of [['front',0],['quarter',Math.PI/4],['side',Math.PI/2],['rear',Math.PI]]) {
      await page.locator('#reset').click();
      const camera=(await canvas.getAttribute('data-camera')).split(',').map(Number);
      const box=await canvas.boundingBox();
      const dx=(Math.atan2(camera[0]-camera[3],camera[2]-camera[5])-yaw)*box.height/(Math.PI*2*0.7);
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
      await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2,{steps:4}); await page.mouse.up();
      await capture(`${hero}-${name}-idle`);
    }
    await page.locator('#reset').click();
    for (const pose of ['move','attack','hit','death']) {await page.locator(`[data-pose=${pose}]`).click();await capture(`${hero}-default-${pose}`);}
    await page.locator('[data-pose=idle]').click();
    await canvas.hover(); await page.mouse.wheel(0,-1800); await capture(`${hero}-closest-available`);
    await page.locator('#reset').click();
    await page.setViewportSize({width:390,height:844});await capture(`${hero}-mobile`);await page.setViewportSize({width:1440,height:1000});
  }
  manifest.status = errors.length || consoleErrors.length ? 'runtime-errors' : 'captured-awaiting-visual-review';
} catch(error) {manifest.status='failed';manifest.failure=String(error);throw error;}
finally {writeFileSync(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');await browser.close();}
console.log(output);
