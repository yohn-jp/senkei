import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import manifest from '../../assets/manifests/f01.json' with { type: 'json' };
const evidence = 'docs/evidence/f01';
test.use({ video: { mode: 'on', size: { width: 1440, height: 900 } } });
test('F01 loads both GLBs, renders five rigged motions and supports inspection controls', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  const glbs: string[] = [];
  page.on('response', r => { if (r.url().endsWith('.glb') && r.ok()) glbs.push(r.url()); });
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/hero/');
  const inspection = page.getByTestId('hero-inspection');
  await expect(inspection).toContainText('5 motions');
  await expect(inspection).toContainText(`${manifest.materials.length} skinned meshes`);
  const canvas = page.getByTestId('hero-viewport').locator('canvas');
  await expect.poll(async () => Number(await canvas.getAttribute('data-frame'))).toBeGreaterThan(5);
  const initial = Number(await canvas.getAttribute('data-time'));
  await expect.poll(async () => Number(await canvas.getAttribute('data-time'))).not.toBe(initial);
  await page.getByRole('button', { name: 'Ⅱ 一時停止', exact: true }).click();
  await page.getByRole('slider', { name: 'アニメーション位置' }).fill('0');
  await page.screenshot({ path: `${evidence}/browser-desktop-detail.png` });
  const motions: Record<string, string> = { Idle: '待機 Idle', Walk: '移動 Walk', Attack: '攻撃 Attack', Skill: '指揮 Skill', Death: '死亡 Death' };
  const frames: Record<string, { startBytes: number; posedBytes: number; time: string | null }> = {};
  for (const [clip, label] of Object.entries(motions)) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(canvas).toHaveAttribute('data-animation', clip);
    await page.getByRole('slider', { name: 'アニメーション位置' }).fill('0');
    await expect.poll(async () => Number(await canvas.getAttribute('data-time'))).toBeLessThan(.01);
    const start = await canvas.screenshot();
    await page.getByRole('slider', { name: 'アニメーション位置' }).fill(clip === 'Death' ? '100' : '35');
    await expect.poll(async () => Number(await canvas.getAttribute('data-time'))).toBeGreaterThan(.1);
    const posed = await canvas.screenshot({ path: `${evidence}/browser-motion-${clip.toLowerCase()}.png` });
    expect(start.equals(posed), `${clip} should visibly change rendered pose`).toBe(false);
    frames[clip] = { startBytes: start.length, posedBytes: posed.length, time: await canvas.getAttribute('data-time') };
  }
  // Death is held at its terminal pose; restart restores the guard stance.
  await page.getByRole('button', { name: '▶ 再生', exact: true }).click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-time'))).toBeCloseTo(manifest.animations.find(a => a.name === 'Death')!.duration, 3);
  await page.waitForTimeout(200);
  const held = await canvas.getAttribute('data-time');
  await page.waitForTimeout(200); expect(await canvas.getAttribute('data-time')).toBe(held);
  await page.getByRole('button', { name: motions.Idle, exact: true }).click();
  await page.getByRole('button', { name: 'Ⅱ 一時停止', exact: true }).click();
  await page.getByRole('button', { name: '近景', exact: true }).click();
  await page.screenshot({ path: `${evidence}/browser-portrait.png` });
  const beforeRotate = await canvas.screenshot();
  await page.getByRole('button', { name: '右へ45度回転', exact: true }).click();
  const afterRotate = await canvas.screenshot(); expect(beforeRotate.equals(afterRotate)).toBe(false);
  await page.getByRole('button', { name: 'ズームイン', exact: true }).click();
  const afterZoom = await canvas.screenshot(); expect(afterRotate.equals(afterZoom)).toBe(false);
  await page.getByRole('button', { name: 'カメラをリセット', exact: true }).click();
  await page.getByRole('button', { name: 'Daylight', exact: true }).click();
  await page.screenshot({ path: `${evidence}/browser-daylight.png` });
  await page.getByRole('button', { name: 'Rim', exact: true }).click();
  await page.screenshot({ path: `${evidence}/browser-rim.png` });
  await page.getByRole('button', { name: 'Studio', exact: true }).click();
  await page.getByRole('button', { name: '戦場', exact: true }).click();
  const detailStats = await inspection.textContent();
  await page.screenshot({ path: `${evidence}/browser-battle-detail.png` });
  await page.getByRole('button', { name: 'Battle LOD', exact: true }).click();
  await expect(inspection).toContainText('5 motions');
  await expect(inspection).toContainText(`${manifest.lods.find(l => l.level === 'battle')!.triangles.toLocaleString('en-US')} triangles`);
  const battleStats = await inspection.textContent(); expect(detailStats).not.toBe(battleStats);
  await page.screenshot({ path: `${evidence}/browser-battle-lod.png` });
  // Every clip is retained and can be posed after LOD replacement.
  for (const [clip,label] of Object.entries(motions)) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('slider', { name: 'アニメーション位置' }).fill('50');
    await expect(canvas).toHaveAttribute('data-animation', clip);
    await expect.poll(async () => Number(await canvas.getAttribute('data-time'))).toBeGreaterThan(.1);
  }
  await page.getByRole('button', { name: motions.Idle, exact: true }).click();
  await page.getByRole('button', { name: 'Detail', exact: true }).click();
  await expect(inspection).toContainText(detailStats!);
  await page.getByRole('button', { name: '全身', exact: true }).click();
  for (const [width,height] of [[1920,1080],[390,844],[430,932],[320,844]]) {
    await page.setViewportSize({ width,height });
    await page.screenshot({ path: `${evidence}/browser-${width}x${height}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(glbs.some(u => u.endsWith('f01-detail.glb'))).toBe(true);
  expect(glbs.some(u => u.endsWith('f01-battle.glb'))).toBe(true);
  expect(errors).toEqual([]);
  await writeFile(`${evidence}/browser-validation.json`, JSON.stringify({ viewport: '1440x900; 1920x1080; 390x844; 430x932; 320x844', detailStats, battleStats, frames, loadedGLBs: glbs, consoleErrors: errors, checks: ['five rendered pose changes','death clamp','rotation','zoom','lighting','LOD reload and five clips','no horizontal overflow'] },null,2)+'\n');
  await page.close();
  await page.video()?.saveAs(`${evidence}/browser-interaction.webm`);
});

test('F01 reports GLB load failure with recovery', async ({ page }) => {
  await page.route('**/*.glb', route => route.abort());
  await page.goto('/hero/');
  await expect(page.getByRole('alert')).toContainText('モデルを読み込めませんでした');
  await expect(page.getByRole('button', { name: '再読込', exact: true })).toBeVisible();
});

test('F01 starts paused with reduced motion and handles GPU failure', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/hero/');
  await expect(page.getByTestId('hero-inspection')).toContainText('5 motions');
  await expect(page.getByRole('button', { name: '▶ 再生', exact: true })).toHaveAttribute('aria-pressed','true');
  await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext; });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('WebGL2を開始できませんでした');
});
