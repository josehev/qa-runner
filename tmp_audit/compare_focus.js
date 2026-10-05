const { chromium } = require('playwright');
const URL = 'https://qa3-oru.vml.dev/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 400 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.screenshot({ path: 'tmp_audit/no_focus.png' });
  await page.keyboard.press('Tab'); // skip link
  await page.keyboard.press('Tab'); // contact us
  await page.screenshot({ path: 'tmp_audit/focus_contactus.png' });
  await browser.close();
})();
