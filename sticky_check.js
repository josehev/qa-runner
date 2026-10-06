const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/ny/residential/battery-program";
const { file: artifactPath } = require('./artifacts').createArtifactRun(URL);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);
  const info = await page.evaluate(() => {
    const skip = document.querySelector('a[href="#mainContent"]');
    const header = document.querySelector('header');
    function css(el) {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { position: cs.position, top: cs.top, zIndex: cs.zIndex, rect: {x:r.x,y:r.y,w:r.width,h:r.height}, visibility: cs.visibility, opacity: cs.opacity };
    }
    return { skip: css(skip), header: css(header) };
  });
  console.log(JSON.stringify(info, null, 2));
  // scroll down and screenshot viewport only (not fullpage) to see real overlap
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(500);
  await page.screenshot({ path: artifactPath('sticky_viewport_768.png') });
  await browser.close();
})();
