const {chromium}=require('/workspace/wt-main-verify/tests/browser/node_modules/playwright');
const fs=require('fs');
(async()=>{
 const out='/workspace/scratch/mobile-current'; fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:390,height:844}}); page.setDefaultTimeout(60000);
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4208/'); await page.getByTestId('nav-library').click();
 await page.getByLabel('Import Next experiment file',{exact:true}).setInputFiles('/workspace/wt-tactical-context/test-results/tactical-real-experiments.json');
 await page.getByRole('button',{name:'Open latest comparison',exact:true}).click();
 await page.getByRole('button',{name:'Battle Replayへ',exact:true}).click();
 const seek=page.getByRole('slider',{name:'Seek replay tick'}); await seek.focus(); await seek.press('Home'); await seek.press('PageUp');
 const result=[];
 for(const [width,height] of [[390,844],[320,740],[430,932],[1440,900],[1920,1080]]){
  await page.setViewportSize({width,height});
  await page.locator('#next-tab-battle').click();
  if(width<761) await page.getByRole('button',{name:'Battle view',exact:true}).click();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`${out}/01-battle-${width}.png`});
  result.push({width,height,tick:await seek.inputValue(),geometry:await page.locator('.next-canvas-wrap,canvas,.next-battle-mobile-tabs,.next-battle-header').evaluateAll(els=>els.filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,classes:e.className,box:JSON.parse(JSON.stringify(e.getBoundingClientRect()))}))),overflow:await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}))});
  if(width<761){
   const tick=await seek.inputValue(); await page.getByRole('button',{name:'Details view',exact:true}).click();
   await page.screenshot({path:`${out}/02-details-${width}.png`});
   await page.getByRole('button',{name:'Battle view',exact:true}).click();
   if(await seek.inputValue()!==tick) throw Error('Details changed Tick');
  }
 }
 fs.writeFileSync(`${out}/report.json`,JSON.stringify({source:'5c84c85e4a935dae4881af87eb2b8f607987c786',artifact:'19c1ebe2e7b8373a255a43310e0166ba1ff3ef250ce5c5425c7288bbe358063d',wasm:'8ec4c1b4dcb9b5acb6fa59322aa6e8398db72fdd4ed1632af6dcb122326f59ea',restoredGenuineEnbu:true,newEnbu:false,errors,result},null,2));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
