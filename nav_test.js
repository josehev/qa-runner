const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/ny/residential/battery-program";
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(500);
  console.log('1. Loaded:', page.url());

  // click Rebates breadcrumb link
  await page.click('a:has-text("Rebates, Incentives & Credits")');
  await page.waitForTimeout(1500);
  console.log('2. After clicking breadcrumb:', page.url());

  await page.goBack();
  await page.waitForTimeout(1500);
  console.log('3. After goBack:', page.url());

  await page.goForward();
  await page.waitForTimeout(1500);
  console.log('4. After goForward:', page.url());

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  console.log('5. After reload:', page.url(), '| title:', await page.title());

  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(e.message));
  await page.waitForTimeout(1000);
  console.log('Page errors after reload:', consoleErrors);

  await browser.close();
})();
