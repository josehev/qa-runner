const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/ny/residential/battery-program";
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);
  try {
    const btns = await page.$$('button[aria-label="search" i]');
    await btns[1].click({ timeout: 5000 });
    await page.waitForTimeout(500);
    const searchInput = await page.$('#searchId');
    if (searchInput) {
      await searchInput.fill('battery');
      console.log('Filled with "battery", value=', await searchInput.inputValue());
      await searchInput.fill("' OR 1=1 --");
      console.log('Filled with SQLi string, value=', JSON.stringify(await searchInput.inputValue()));
      await searchInput.fill('<script>alert(1)</script>');
      console.log('Filled with script tag, value=', JSON.stringify(await searchInput.inputValue()));
      await searchInput.fill('😀🔋💰 emoji test');
      console.log('Filled with emoji, value=', JSON.stringify(await searchInput.inputValue()));
      const longStr = 'a'.repeat(2000);
      await searchInput.fill(longStr);
      const v = await searchInput.inputValue();
      console.log('Filled with 2000 char string, resulting length=', v.length);
      await searchInput.fill('battery program');
      await searchInput.press('Enter');
      await page.waitForTimeout(3000);
      console.log('URL after search submit:', page.url());
      console.log('Title after search:', await page.title());
    } else {
      console.log('Search input NOT found after click');
    }
  } catch (e) {
    console.log('ERROR:', e.message.split('\n')[0]);
  }
  await page.screenshot({ path: 'search_result2.png', fullPage: true });
  await browser.close();
})();
