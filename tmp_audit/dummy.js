const { chromium } = require('playwright');
const URL = 'https://qa3-oru.vml.dev/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

  for (let i = 1; i <= 14; i++) {
    await page.keyboard.press('Tab');
  }
  // Now at element 14 (index 13 - "About" button-ish). Let's instead loop and screenshot each of first 13.
  await browser.close();
})();
