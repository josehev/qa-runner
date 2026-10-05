const { chromium } = require('playwright');
const URL = 'https://qa3-oru.vml.dev/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

  const results = [];
  for (let i = 0; i < 13; i++) {
    await page.keyboard.press('Tab');
    const style = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const before = window.getComputedStyle(el);
      return {
        tag: el.tagName,
        text: (el.textContent || '').trim().slice(0, 30),
        outlineStyle: before.outlineStyle,
        outlineColor: before.outlineColor,
        outlineWidth: before.outlineWidth,
        boxShadow: before.boxShadow,
        border: before.border,
        backgroundColor: before.backgroundColor,
        className: el.className,
      };
    });
    results.push(style);
    await page.screenshot({ path: `/Users/jose.herrera/qa-runner/qa-runner/tmp_audit/focus_${i}.png` });
  }
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
