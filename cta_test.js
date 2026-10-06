const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling";
(async()=>{
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(URL, {waitUntil:'networkidle', timeout:30000});
  const [popup] = await Promise.all([
    context.waitForEvent('page', { timeout: 5000 }).catch(() => null),
    page.locator('a:has-text("DOWNLOAD PARTICIPATION FORM")').first().click(),
  ]);
  await page.waitForTimeout(1000);
  if (popup) {
    await popup.waitForLoadState().catch(()=>{});
    console.log('popup url:', popup.url());
  } else {
    console.log('no popup opened; current url:', page.url());
  }
  await browser.close();
})();
