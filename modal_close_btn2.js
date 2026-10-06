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
  const closeBtns = await page.$$('button[aria-label="Close"], button[aria-label="close"]');
  console.log('Number of close buttons found:', closeBtns.length);
  for (let i = 0; i < closeBtns.length; i++) {
    const visible = await closeBtns[i].isVisible();
    console.log(i, 'visible:', visible);
  }
  for (const b of closeBtns) {
    if (await b.isVisible()) {
      await b.click();
      await page.waitForTimeout(500);
      console.log('Clicked visible close button. aria-expanded now:', await loginBtn.getAttribute('aria-expanded'));
      break;
    }
  }
  await browser.close();
})();
