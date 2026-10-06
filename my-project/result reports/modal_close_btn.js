const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/ny/residential/battery-program";
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);
  const loginBtn = await page.$('button[aria-label="Log in or Register"]');
  await loginBtn.click();
  await page.waitForTimeout(600);
  console.log('aria-expanded after open:', await loginBtn.getAttribute('aria-expanded'));
  const closeBtn = await page.$('button[aria-label="Close"]');
  if (closeBtn) {
    await closeBtn.click();
    await page.waitForTimeout(500);
    console.log('aria-expanded after clicking Close btn:', await loginBtn.getAttribute('aria-expanded'));
  } else {
    console.log('No close button with aria-label Close found');
  }
  await browser.close();
})();
