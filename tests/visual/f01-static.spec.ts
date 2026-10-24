import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const evidence='docs/evidence/f01-procedural';
const views=[['正面','front'],['側面','side'],['背面','back'],['斜め','oblique'],['顔','face'],['戦場距離','battle']] as const;

test('F01: actual WebGL rendering, six views, controls, deterministic regeneration', async ({ page }) => {
  mkdirSync(evidence,{recursive:true});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/f01-study/');
  const canvas=page.getByTestId('f01-canvas'),status=page.getByTestId('f01-status');
  await expect(canvas).toBeVisible();await expect(status).toContainText('triangles');
  const gl=await canvas.evaluate((c:HTMLCanvasElement)=>{
    const g=c.getContext('webgl2');if(!g)throw new Error('WebGL2 absent');
    return {version:g.getParameter(g.VERSION),renderer:g.getParameter(g.RENDERER)};
  });
  await page.screenshot({path:`${evidence}/desktop.png`});
  const hashes:Record<string,string>={};
  for(const [label,name] of views){
    await page.getByRole('button',{name:label,exact:true}).click();
    await expect(page.getByRole('button',{name:label,exact:true})).toHaveAttribute('aria-pressed','true');
    const png=await canvas.screenshot({path:`${evidence}/${name}.png`});
    hashes[name]=createHash('sha256').update(png).digest('hex');
  }
  expect(new Set(Object.values(hashes)).size).toBe(6);
  await page.getByRole('button',{name:'斜め',exact:true}).click();
  const before=await canvas.getAttribute('data-camera');
  await page.getByRole('button',{name:'右へ回転',exact:true}).click();
  await expect(canvas).not.toHaveAttribute('data-camera',before!);
  const rotated=await canvas.getAttribute('data-camera');
  await page.getByRole('button',{name:'拡大',exact:true}).click();
  await expect(canvas).not.toHaveAttribute('data-camera',rotated!);
  await page.getByRole('button',{name:'構図をリセット',exact:true}).click();
  const box=(await canvas.boundingBox())!;
  const preDrag=await canvas.getAttribute('data-camera');
  await page.mouse.move(box.x+box.width*.55,box.y+box.height*.55);
  await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.5,{steps:8});await page.mouse.up();
  await expect(canvas).not.toHaveAttribute('data-camera',preDrag!);
  for(const light of ['Daylight','Neutral','Studio']){
    await page.getByRole('button',{name:light,exact:true}).click();
    await expect(page.getByRole('button',{name:light,exact:true})).toHaveAttribute('aria-pressed','true');
  }
  await page.getByRole('button',{name:'斜め',exact:true}).click();
  await page.getByRole('button',{name:'ワイヤーフレーム',exact:true}).click();
  await canvas.screenshot({path:`${evidence}/wireframe.png`});
  await page.getByRole('button',{name:'面表示へ戻す',exact:true}).click();
  const fingerprint=await canvas.getAttribute('data-fingerprint');
  const sameBefore=createHash('sha256').update(await canvas.screenshot()).digest('hex');
  await page.getByRole('button',{name:'再生成',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-fingerprint',fingerprint!);
  expect(createHash('sha256').update(await canvas.screenshot()).digest('hex')).toBe(sameBefore);
  await page.getByLabel('seed',{exact:true}).fill('42');await page.getByRole('button',{name:'再生成',exact:true}).click();
  await expect(canvas).not.toHaveAttribute('data-fingerprint',fingerprint!);
  await page.getByLabel('seed',{exact:true}).fill('1042');await page.getByRole('button',{name:'再生成',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-fingerprint',fingerprint!);
  for(const width of [320,390,430]){
    await page.setViewportSize({width,height:844});
    await page.getByRole('button',{name:'斜め',exact:true}).click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`${evidence}/mobile-${width}.png`,fullPage:true});
  }
  expect(errors).toEqual([]);
  writeFileSync(`${evidence}/browser.json`,JSON.stringify({source:process.env.GITHUB_SHA??'local',webgl:gl,hashes,fingerprint,stats:await status.innerText(),errors,visualAcceptance:'requires human review; not inferred from these tests'},null,2));
});

test('F01: context loss is explicit and retry creates a working viewport',async({page})=>{
  await page.goto('/f01-study/');await expect(page.getByTestId('f01-status')).toContainText('triangles');
  await page.getByTestId('f01-canvas').evaluate((c:HTMLCanvasElement)=>c.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext());
  await expect(page.getByRole('alert')).toContainText('GPUコンテキスト');
  await page.getByRole('button',{name:'プレビュー再起動'}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByTestId('f01-canvas')).toHaveCount(1);
  await expect(page.getByTestId('f01-status')).toContainText('triangles');
});
