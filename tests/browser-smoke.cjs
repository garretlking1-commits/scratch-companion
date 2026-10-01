// Run with Playwright installed, or PLAYWRIGHT_MODULE pointing to its package.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=process.env.SCRATCH_QA_DIR||path.join(require('node:os').tmpdir(),'scratch-qa');
fs.mkdirSync(out,{recursive:true});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'),relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html',file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/';
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
  await context.route('https://**/*',route=>route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-09-30T12:00:00-07:00')});
  await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#today-editor').open);assert.equal(await page.evaluate(()=>typeof jsQR),'function');
  await page.locator('#today-input').fill('Open the assignment');await page.locator('#today-fallback').fill('Find the first question');await page.locator('#today-form button').click();
  assert.equal(await page.locator('#today-action').innerText(),'Open the assignment');
  await page.locator('#today-small').click();assert.equal(await page.locator('#today-action').innerText(),'Find the first question');
  await page.locator('#today-start').click();assert.match(await page.locator('#today-timer').innerText(),/left/);
  await page.reload({waitUntil:'domcontentloaded'});assert.equal(await page.locator('#today-action').innerText(),'Find the first question');
  await page.locator('#today-editor summary').click();await page.locator('#today-input').fill('Draft should survive a timer tick');await page.clock.runFor(1200);assert.equal(await page.locator('#today-input').inputValue(),'Draft should survive a timer tick');assert.equal(await page.locator('#today-editor').getAttribute('open'),'');await page.locator('#today-editor summary').click();
  await page.locator('#today-minimum').click();assert.match(await page.locator('#today-state').innerText(),/Small step complete/);
  await page.locator('#today-reset').click();assert.equal(await page.locator('#today-action').innerText(),'Open the assignment');
  await page.locator('#today-rest').click();assert.match(await page.locator('#today-state').innerText(),/Rest chosen/);
  assert.equal(await page.locator('#more-view').getAttribute('open'),null);
  await page.locator('.accountability details summary').click();await page.locator('input[name="training-day"][value="3"]').check();await page.locator('#accountability-form button').click();
  await page.locator('input[name="training-day"][value="3"]').uncheck();await page.locator('#accountability-resume').fill('2026-10-05');await page.locator('#accountability-form button').click();
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('.accountability details summary').click();assert.equal(await page.locator('input[name="training-day"]:checked').count(),0);assert.equal(await page.locator('#accountability-resume').inputValue(),'2026-10-05');
  await page.screenshot({path:path.join(out,'today-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile width');
  await page.locator('#more-view>summary').click();await page.locator('#vault-settings>summary').click();
  await page.evaluate(()=>localStorage.setItem('scratch-gh-token','audit-placeholder'));
  const download=page.waitForEvent('download');await page.locator('#backup-download').click();const saved=await download;await saved.saveAs(path.join(out,'synthetic-backup.json'));
  const backup=fs.readFileSync(path.join(out,'synthetic-backup.json'),'utf8');assert.ok(backup.includes('scratch-today-v1'));assert.ok(!backup.includes('scratch-gh-token'));assert.ok(!backup.includes('audit-placeholder'));
  await page.locator('#token-disconnect').click();assert.equal(await page.evaluate(()=>localStorage.getItem('scratch-gh-token')),null);
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.reload({waitUntil:'domcontentloaded'});await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});assert.equal(await page.locator('#today-action').innerText(),'Open the assignment');assert.equal(await page.evaluate(()=>typeof jsQR),'function');await context.setOffline(false);
  await page.goto(url+'#SCRATCH1|p1/1|0930,ws,1,0,100,0,0,80,30,600',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('more-view').open);assert.equal(await page.locator('#qr-import').getAttribute('open'),'');
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(out,'dashboard-desktop.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  const broken=await browser.newContext();await broken.route('https://**/*',route=>route.abort());
  await broken.addInitScript(()=>localStorage.setItem('scratch-state-v1','{broken'));
  const bp=await broken.newPage();await bp.goto(url,{waitUntil:'domcontentloaded'});
  assert.match(await bp.locator('#savestate').innerText(),/read|stored|recover/i);
  assert.equal(await bp.evaluate(()=>localStorage.getItem('scratch-state-v1')),'{broken');
  await broken.close();await context.close();
  process.stdout.write(JSON.stringify({passed:true,checks:['Today save/start/smaller/reset/rest','timer edit preservation','dated pause reload','mobile overflow','backup','disconnect','offline reload','QR visibility'],screenshots:out}));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
