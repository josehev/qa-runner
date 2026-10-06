const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling";
(async()=>{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, {waitUntil:'networkidle', timeout:30000});
  await page.locator('text=EXPAND ALL').click();
  await page.waitForTimeout(500);
  const text = await page.locator('body').innerText();
  const idx = text.indexOf('FAQs');
  console.log(text.slice(idx, idx+1500));
  await browser.close();
})();
