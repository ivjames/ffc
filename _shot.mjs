import { chromium } from 'playwright';
const OUT='/tmp/claude-0/-home-user-ffc/03783912-67f6-5472-be0b-7498b6075fe2/scratchpad/';
const b = await chromium.launch();
const errs=[];
for (const r of ['axe','skeeball','pusher','gallery']) {
  const p = await b.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:2 });
  p.on('pageerror', e=>errs.push(`${r}: ${e.message}`));
  await p.goto(`http://localhost:5199/arcade/${r}`, {waitUntil:'networkidle'});
  await p.waitForTimeout(1800);
  const btn = p.locator('button', { hasText:/^(start|play|throw)/i }).first();
  if (await btn.count()) { await btn.click().catch(()=>{}); await p.waitForTimeout(3500); }
  await p.screenshot({ path: OUT+'post-'+r+'.png' });
  await p.close();
}
console.log('errors:', errs.length?errs:'none'); await b.close();
