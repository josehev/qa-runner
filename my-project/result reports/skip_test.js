const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling";
(async()=>{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, {waitUntil:'networkidle', timeout:30000});
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => document.activeElement.outerHTML.slice(0,200));
  console.log('first focusable element:', first);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => ({
    scrollY: window.scrollY,
    activeId: document.activeElement.id,
    mainContentExists: !!document.getElementById('mainContent'),
  }));
  console.log(JSON.stringify(info));
  await browser.close();
})();
