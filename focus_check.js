const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling";
(async()=>{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, {waitUntil:'networkidle', timeout:30000});
  // find the FAQ button and focus directly
  const btn = page.locator('button:has-text("Do I need to own the appliance")').first();
  await btn.scrollIntoViewIfNeeded();
  await btn.focus();
  const styles = await btn.evaluate(node => {
    const cs = window.getComputedStyle(node);
    return {
      outline: cs.outline, outlineStyle: cs.outlineStyle, outlineColor: cs.outlineColor, outlineWidth: cs.outlineWidth,
      boxShadow: cs.boxShadow, border: cs.border
    };
  });
  console.log('FAQ button focus style:', JSON.stringify(styles));
  await page.screenshot({ path: 'faq_focus.png', clip: { x: 0, y: 0, width: 800, height: 900 } }).catch(e=>console.log('shot err', e.message));
  await browser.close();
})();
