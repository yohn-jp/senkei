import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

async function openOwned(page: Page) {
  await page.getByTestId('nav-next').click();
  await page.getByText('Local ownership and runtime', { exact: true }).click();
  const enable = page.getByRole('button', { name: 'Enable test-only owned runtime', exact: true });
  if (await enable.isVisible()) await enable.click();
  await expect(page.getByRole('status').filter({ hasText: 'Test-only six-domain runtime enabled' })).toBeVisible({ timeout: 60_000 });
  const panel = page.getByRole('region', { name: 'Owned Heroes and local assets' });
  await expect(panel).toBeVisible();
  return panel;
}
for (const width of [1440, 390]) {
  test(`owned trial assets survive recovery and enter real preflight at ${width}px`, async ({ page }, info) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/');
    const panel = await openOwned(page);
    await panel.getByRole('button', { name: 'Obtain trial roster' }).click();
    const selected: string[] = [];
    for (let n = 1; n <= 5; n++) {
      const slot = panel.getByLabel(`Slot slot-0${n}`, { exact: true });
      await expect.poll(() => slot.locator('option').count()).toBeGreaterThan(5);
      const id = await slot.locator('option').nth(n).getAttribute('value');
      expect(id).toBeTruthy(); selected.push(id!); await slot.selectOption(id!);
    }
    expect(new Set(selected).size).toBe(5);
    const detail = panel.getByLabel('Hero', { exact: true }); await detail.selectOption(selected[0]);
    await panel.getByRole('button', { name: 'Obtain test.blade', exact: true }).click();
    const equipment = panel.locator('li').filter({ hasText: 'test.blade' });
    await equipment.getByRole('button', { name: 'Equip to selected Hero' }).click();
    await expect(equipment).toContainText(selected[0]);
    await panel.getByLabel('Target', { exact: true }).selectOption(selected[1]);
    await panel.getByLabel('Level', { exact: true }).fill('2');
    await panel.getByRole('button', { name: 'Record trial edit' }).click();
    await expect(panel.getByText(/Explicit local trial edit/).first()).toBeVisible();
    await detail.selectOption(selected[1]); await panel.getByLabel('Target', { exact: true }).selectOption(selected[0]);
    await panel.getByLabel('Level', { exact: true }).fill('3'); await panel.getByRole('button', { name: 'Record trial edit' }).click();
    const download = page.waitForEvent('download'); await panel.getByRole('button', { name: 'Export owned assets' }).click();
    const archivePath = info.outputPath('owned-assets.json'); await (await download).saveAs(archivePath);
    const archive = JSON.parse(readFileSync(archivePath, 'utf8'));
    expect(archive.heroes.instances.map((h: { instanceId: string }) => h.instanceId)).toEqual(expect.arrayContaining(selected));
    expect(archive.equipment.instances).toHaveLength(1);
    expect(archive.equipment.instances[0].heroId).toBe(selected[0]);
    expect(archive.relationships.events).toHaveLength(2);
    await panel.getByLabel('Recover owned assets').setInputFiles(archivePath);
    await expect(equipment).toContainText(selected[0]);
    await page.reload();
    const restored = await openOwned(page);
    for (let n = 1; n <= 5; n++) await expect(restored.getByLabel(`Slot slot-0${n}`, { exact: true })).toHaveValue(selected[n-1]);
    await restored.getByLabel('Hero', { exact: true }).selectOption(selected[0]);
    await expect(restored.locator('li').filter({ hasText: 'test.blade' })).toContainText(selected[0]);
    await page.getByLabel('Trial tick limit').fill('3');
    await page.getByRole('button', { name: '準備確認へ', exact: true }).click();
    await page.getByRole('button', { name: '検証・コンパイル', exact: true }).click();
    await expect(page.getByTestId('preflight-status')).toHaveText('開始可能', { timeout: 60_000 });
    const frozen = page.getByRole('region', { name: 'Frozen asset preview' }); await expect(frozen).toBeVisible(); await frozen.getByText('Frozen asset preview', { exact: true }).click();
    const frozenText = await frozen.innerText(); for (const id of selected) expect(frozenText).toContain(id);
    expect(frozenText).toContain('test.blade');
    if (width === 1440) {
      await page.getByRole('button', { name: '戦闘開始', exact: true }).click();
      await expect(page.getByText(/Confirmed result · (Attacker Victory|Defender Victory|Draw)/i)).toBeVisible({ timeout: 180_000 });
      await expect(page.getByRole('slider', { name: 'Seek replay tick' })).toBeVisible();
      await page.locator('#next-tab-analysis').click();
      await page.getByTestId('battle-analysis').getByRole('button', { name: '同条件で再戦 · Run Snapshot', exact: true }).click();
      await page.getByRole('button', { name: '検証・コンパイル', exact: true }).click();
      await expect(page.getByTestId('preflight-status')).toHaveText('開始可能', { timeout: 60_000 });
      const rerunPreview = page.getByRole('region', { name: 'Frozen asset preview' }); await expect(rerunPreview).toBeVisible(); await rerunPreview.getByText('Frozen asset preview', { exact: true }).click(); await expect(rerunPreview).toHaveText(frozenText);
    }
  });
}
