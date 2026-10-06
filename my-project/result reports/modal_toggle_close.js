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
  console.log('after open:', await loginBtn.getAttribute('aria-expanded'));
  await loginBtn.click();
  await page.waitForTimeout(600);
  console.log('after clicking toggle again:', await loginBtn.getAttribute('aria-expanded'));
  // click outside
  await loginBtn.click();
  await page.waitForTimeout(400);
  await page.mouse.click(50, 500);
  await page.waitForTimeout(500);
  console.log('after clicking outside the panel:', await loginBtn.getAttribute('aria-expanded'));
  await browser.close();
})();
