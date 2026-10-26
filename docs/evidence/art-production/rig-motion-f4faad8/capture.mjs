import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const require = createRequire(resolve(process.cwd(), 'package.json'));
const { chromium } = require('@playwright/test');
if (!process.env.SENKEI_CHROMIUM_EXECUTABLE) throw new Error('Set SENKEI_CHROMIUM_EXECUTABLE to the installed Chromium binary.');
const out=resolve('test-results/art-production/rig-motion-f4faad8');
const evidence=resolve('docs/evidence/art-production/rig-motion-f4faad8');
mkdirSync(out,{recursive:true}); mkdirSync(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.SENKEI_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1,reducedMotion:'no-preference'});
const errors=[],consoleErrors=[],httpErrors=[],failedRequests=[],requestUrls=[],captures=[];
const url=process.env.SENKEI_ART_LAB_URL??'http://127.0.0.1:4189/';
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>requestUrls.push(request.url()));
page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
page.on('response',response=>{if(response.status()>=400)httpErrors.push(`${response.status()} ${response.url()}`);});
page.on('requestfailed',request=>failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
const samples={idle:[0,0.924,1.848,2.772,3.696],move:[0,0.15625,0.3125,0.46875,0.625],attack:[0,0.3625,0.725,1.0875,1.45],hit:[0,0.2,0.4,0.6,0.8],death:[0,0.225,0.45,0.675,0.9,1.35,1.8]};
const manifest={schema:'senkei-art-rig-motion-evidence/v1',sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirtyWorktree:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),url,viewport:{width:1440,height:1000,deviceScaleFactor:1,canvas:'production Hero Detail preview'},browser:browser.version(),renderer:'Chromium/SwiftShader software GPU',reducedMotion:'no-preference',captureKind:'production Hero Detail preview using buildBattlefieldHero; not application integration or LOD override',sampling:'After each pose button reset, wait to requested elapsed seconds from setPose and two animation frames; capture the actual canvas and record renderer pose attributes.',poses:samples,captures,errors,consoleErrors,httpErrors,failedRequests,requestUrls,status:'running'};
try{
 await page.goto(url);
 const canvas=page.locator('#stage canvas'); await canvas.waitFor({state:'visible'});
 for(const hero of ['F01','R01']){
  await page.locator('#hero').selectOption(hero);
  await page.waitForFunction(id=>document.querySelector('#stage canvas')?.dataset.catalogId===id,hero);
  for(const [pose,times] of Object.entries(samples)){
   await page.locator(`button[data-pose="${pose}"]`).click(); let previous=0;
   for(const seconds of times){
    await page.waitForTimeout(Math.max(0,(seconds-previous)*1000)); previous=seconds;
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const image=`${hero}-${pose}-${String(Math.round(seconds*1000)).padStart(4,'0')}ms.png`;
    const bytes=await canvas.screenshot({path:join(out,image)});
    captures.push({hero,pose,requestedElapsedSeconds:seconds,image,sha256:createHash('sha256').update(bytes).digest('hex'),canvasAttributes:await canvas.evaluate(node=>Object.fromEntries(Array.from(node.attributes).filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value])))});
   }
  }
 }
 manifest.status=errors.length||consoleErrors.length||httpErrors.length||failedRequests.length?'runtime-errors':'captured-awaiting-independent-visual-review';
}catch(error){manifest.status='failed';manifest.failure=String(error);throw error;}
finally{
 manifest.errors=errors; manifest.consoleErrors=consoleErrors; manifest.httpErrors=httpErrors; manifest.failedRequests=failedRequests;
 writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 if(captures.length){
  await page.close();
  const sheetPage=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
  const sheetErrors=[]; sheetPage.on('pageerror',e=>sheetErrors.push(e.message));
  sheetPage.on('console',m=>{if(m.type()==='error')sheetErrors.push(m.text());});
  for(const hero of ['F01','R01']){
   const entries=captures.filter(c=>c.hero===hero);
   await sheetPage.setContent(`<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><style>*{box-sizing:border-box}body{margin:0;background:#182126;color:#eee;font:16px sans-serif}h1{margin:12px 20px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:3px}figure{margin:0;background:#202d34}img{width:100%;height:250px;object-fit:contain;display:block}figcaption{height:32px;padding:6px;font-size:13px}</style><h1>${hero} motion samples · production preview · ${browser.version()} SwiftShader</h1><pre id="metadata"></pre><main>${entries.map(c=>`<figure><img src="data:image/png;base64,${readFileSync(join(out,c.image)).toString('base64')}"><figcaption>${c.pose} ${c.requestedElapsedSeconds.toFixed(3)}s · ${c.sha256.slice(0,12)}</figcaption></figure>`).join('')}</main>`);
   await sheetPage.locator('img').evaluateAll(images=>Promise.all(images.map(img=>img.decode())));
   const sheet=await sheetPage.screenshot({path:join(evidence,`${hero}-motion-contact.jpg`),fullPage:true,type:'jpeg',quality:88});
   manifest.contactSheets??={}; manifest.contactSheets[hero]={image:`${hero}-motion-contact.jpg`,sha256:createHash('sha256').update(sheet).digest('hex')};
  }
  manifest.evidenceComposition={consoleErrors:sheetErrors};
  const rawHashes=captures.map(c=>`${c.hero}-${c.pose} ${c.requestedElapsedSeconds.toFixed(3)}s ${c.sha256}`).join('\n');
  const readme=`# ${manifest.sourceRevision.slice(0,12)} Hero motion capture\n\n- Source HEAD: \`${manifest.sourceRevision}\`; worktree was ${manifest.dirtyWorktree?'dirty at capture':'clean at capture'}.\n- URL: ${manifest.url}; viewport ${manifest.viewport.width} × ${manifest.viewport.height}, device scale ${manifest.viewport.deviceScaleFactor}.\n- Browser: Chromium ${manifest.browser}; WebGL rendered with SwiftShader software GPU.\n- Source: production \`createHeroModelPreview\` / \`buildBattlefieldHero\`; captured at full-detail camera distance. This lab has no control to force medium/far LOD and does not prove Battlefield integration or hardware performance.\n- Motion: \`prefers-reduced-motion: no-preference\`; ${captures.length} actual canvas screenshots across idle, move, attack, hit and death time samples for F01/R01. Exact per-image SHA-256 and pose attributes are in [manifest.json](manifest.json). Raw PNGs are in ignored \`test-results/art-production/rig-motion-f4faad8/\` in this workspace.\n- Runtime: ${errors.length} page errors, ${consoleErrors.length} console errors, ${httpErrors.length} HTTP errors, ${failedRequests.length} failed requests. See manifest for exact output.\n- Review sheets: [F01](F01-motion-contact.jpg), [R01](R01-motion-contact.jpg). Sheets are downscaled overviews; use original PNGs for detailed visual review. No artistic PASS is inferred here.\n- Visual LOD remains unverified. CPU geometry regression covers F01/R01 death samples at all 3 generated LODs in \`battlefield-unit-rig-motion.test.ts\`.\n\n## PNG SHA-256\n\n\`\`\`text\n${rawHashes}\n\`\`\`\n`;
  writeFileSync(join(evidence,'README.md'),readme);
  writeFileSync(join(evidence,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 }
 await browser.close();
}
console.log(JSON.stringify({out,evidence,sourceRevision:manifest.sourceRevision,browser:manifest.browser,count:captures.length,errors,consoleErrors,httpErrors,failedRequests,contactSheets:manifest.contactSheets},null,2));
