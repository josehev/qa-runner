const { chromium } = require('playwright');
const URL = 'https://qa3-oru.vml.dev/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling';
const { file: artifactPath } = require('../artifacts').createArtifactRun(URL);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 400 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.keyboard.press('Tab'); // skip link
  await page.keyboard.press('Tab'); // contact us
  await page.keyboard.press('Tab'); // english
  await page.screenshot({ path: artifactPath('focus_english.png') });
  await page.keyboard.press('Tab'); // link with empty text (logo?)
  await page.screenshot({ path: artifactPath('focus_logo.png') });
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el.tagName, html: el.outerHTML.slice(0,300), rect: el.getBoundingClientRect() };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
