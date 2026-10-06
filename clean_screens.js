const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling";

const viewports = [
  { name: '1920', width: 1920, height: 1080 },
  { name: '1366', width: 1366, height: 900 },
  { name: '768', width: 768, height: 1024 },
  { name: '375', width: 375, height: 812 },
];

(async () => {
  const browser = await chromium.launch();
  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `clean_${vp.name}.png`, fullPage: true });
    const scrollInfo = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    console.log(vp.name, scrollInfo);
    await page.close();
  }
  await browser.close();
})();
