const { chromium } = require('playwright');
const URL = 'https://qa3-oru.vml.dev/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  console.log('initial load title:', await page.title());

  // click FAQ to open, then navigate to another page via breadcrumb, then back
  const faqBtn = page.locator('button:has-text("Q: Do I need to own the appliance?")').first();
  await faqBtn.click();
  await page.waitForTimeout(300);

  await page.locator('a:has-text("Rebates, Incentives & Credits")').first().click();
  await page.waitForLoadState('networkidle');
  console.log('navigated to:', page.url());

  await page.goBack({ waitUntil: 'networkidle' });
  console.log('after back, url:', page.url());
  const statusOk = page.url() === URL || page.url() === URL + '/';
  console.log('back returned to original URL:', statusOk);

  // test refresh
  await page.reload({ waitUntil: 'networkidle' });
  console.log('after reload, title:', await page.title(), 'status check via title non-empty:', !!(await page.title()));

  await browser.close();
})();
