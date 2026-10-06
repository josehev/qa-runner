const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('https://dev10.oru.com/en/save-money/rebates-incentives-credits/myheat', { waitUntil: 'networkidle' });
  const btns = await p.$$('button[aria-label="search"], button[aria-label="Search"]');
  for (const b of btns) {
    if (await b.isVisible()) { await b.click(); break; }
  }
  await p.waitForTimeout(800);
  const tests = {
    long: 'a'.repeat(500),
    special: '!@#$%^&*()_+{}|:"<>?~`',
    emoji: '🔥🏠💡😀',
    sql: "' OR '1'='1",
  };
  for (const [k,v] of Object.entries(tests)) {
    await p.fill('#searchId', v);
    const val = await p.inputValue('#searchId');
    console.log(k, '-> length:', val.length, 'value(trunc):', JSON.stringify(val.slice(0,60)));
  }
  await p.fill('#searchId', "' OR '1'='1");
  await p.press('#searchId', 'Enter');
  await p.waitForTimeout(3000);
  console.log('After enter, URL:', p.url());
  console.log('Title:', await p.title());
  const bodyText = await p.evaluate(() => document.body.innerText.slice(0, 500));
  console.log('Body snippet:', bodyText);
  await browser.close();
})();
