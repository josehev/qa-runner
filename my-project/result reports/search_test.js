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

  // Open search
  const searchBtn = page.locator('button[aria-label="search"], button[aria-label="Search"]').first();
  await searchBtn.click();
  await page.waitForTimeout(400);
  const input = page.locator('#searchId');
  const visible = await input.isVisible().catch(()=>false);
  console.log('search input visible:', visible);
  if (visible) {
    const testStrings = [
      'a'.repeat(300),
      '<script>alert(1)</script>',
      "' OR '1'='1",
      '😀🔥💧 emoji test',
    ];
    for (const s of testStrings) {
      await input.fill('');
      await input.fill(s);
      const val = await input.inputValue();
      console.log('Input len', s.length, '-> stored len', val.length, 'matches:', val === s);
    }
  }
  console.log('consoleErrors:', JSON.stringify(consoleErrors));
  console.log('pageErrors:', JSON.stringify(pageErrors));

  // skip link test
  await page.goto(URL, {waitUntil:'networkidle', timeout:30000});
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => document.activeElement.outerHTML.slice(0,150));
  console.log('first focusable element:', first);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const scrollY = await page.evaluate(() => window.scrollY);
  console.log('scrollY after skip-link activation:', scrollY);

  await browser.close();
})();
