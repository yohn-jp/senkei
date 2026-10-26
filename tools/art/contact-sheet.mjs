import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const source = resolve(process.env.SENKEI_ART_OUTPUT ?? 'test-results/art-production/captures');
const destination = resolve(process.env.SENKEI_ART_EVIDENCE ?? source);
mkdirSync(destination, { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(source, 'manifest.json'), 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.SENKEI_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  for (const key of ['F01', 'R01', 'battlefield']) {
    const captures = manifest.captures.filter(c => c.label.startsWith(key));
    if (!captures.length) continue;
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#182126;color:#eee;font:16px sans-serif}h1,p{margin:12px 20px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:2px}figure{margin:0;background:#202d34}img{width:100%;height:245px;object-fit:contain;display:block}figcaption{height:32px;padding:6px;font-size:13px}</style><h1>${key} — captured production pixels</h1><p>${manifest.captureKind ?? 'Actual application'} · ${manifest.sourceRevision.slice(0,12)} · Chromium ${manifest.browser} · reduced motion · no artistic approval</p><main>${captures.map(c => `<figure><img src="data:image/png;base64,${readFileSync(resolve(source,c.image)).toString('base64')}"><figcaption>${c.label}</figcaption></figure>`).join('')}</main>`);
    await page.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
    await page.screenshot({ path: resolve(destination, `${key}-contact.jpg`), fullPage: true, type: 'jpeg', quality: 90 });
  }
  writeFileSync(resolve(destination, 'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
} finally { await browser.close(); }
