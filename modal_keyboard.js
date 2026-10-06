const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/ny/residential/battery-program";
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);
  await page.click('button[aria-label="Log in or Register"]');
  await page.waitForTimeout(600);
  console.log('Modal opened, testing Escape key...');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const stillOpen = await page.evaluate(() => {
    const el = document.querySelector('#modal-login-email');
    if (!el) return 'not found';
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  console.log('Login modal still visible after Escape:', stillOpen);
  await browser.close();
})();
