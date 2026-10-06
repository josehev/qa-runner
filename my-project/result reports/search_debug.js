const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/ny/residential/battery-program";
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);
  const btns = await page.$$('button[aria-label="search" i]');
  console.log('count:', btns.length);
  for (const b of btns) {
    const info = await b.evaluate(e => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return { rect: {x:r.x,y:r.y,w:r.width,h:r.height}, display: cs.display, visibility: cs.visibility, opacity: cs.opacity, parentClass: e.parentElement?.className };
    });
    console.log(info);
  }
  await browser.close();
})();
