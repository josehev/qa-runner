const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling";
(async()=>{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type()==='error') consoleErrors.push(m.text()); });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(URL, {waitUntil:'networkidle', timeout:30000});

  const btns = page.locator('button[aria-label="search"], button[aria-label="Search"]');
  const cnt = await btns.count();
  console.log('search button count', cnt);
  for (let i=0;i<cnt;i++){
    const vis = await btns.nth(i).isVisible();
    console.log(i, 'visible:', vis);
  }
  // click the visible one
  for (let i=0;i<cnt;i++){
    if (await btns.nth(i).isVisible()) { await btns.nth(i).click(); break; }
  }
  await page.waitForTimeout(400);
  const input = page.locator('#searchId').first();
  const visible = await input.isVisible().catch(()=>false);
  console.log('search input visible:', visible);
  if (visible) {
    const testStrings = ['a'.repeat(300), '<script>alert(1)</script>', "' OR '1'='1", '😀🔥💧 emoji test'];
    for (const s of testStrings) {
      await input.fill('');
      await input.fill(s);
      const val = await input.inputValue();
      console.log('Input len', s.length, '-> stored len', val.length, 'matches:', val === s);
    }
  }
  console.log('consoleErrors:', JSON.stringify(consoleErrors));
  console.log('pageErrors:', JSON.stringify(pageErrors));
  await browser.close();
})();
