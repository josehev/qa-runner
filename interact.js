const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleMsgs = [];
  page.on('console', m => consoleMsgs.push({type: m.type(), text: m.text()}));
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Test FAQ accordion
  const faqResult = {};
  const firstFaq = page.locator('text=Q: Do I need to own the appliance?').first();
  await firstFaq.scrollIntoViewIfNeeded();
  const beforeExpanded = await firstFaq.locator('xpath=ancestor::*[@aria-expanded][1]').getAttribute('aria-expanded').catch(()=>null);
  await firstFaq.click();
  await page.waitForTimeout(500);
  const afterClickVisible = await page.locator('text=own the appliance').count();
  // Try to find answer text visibility
  const bodyTextAfter = await page.locator('body').innerText();
  faqResult.containsAnswerHint = bodyTextAfter.includes('own') ;

  // check aria-expanded toggle generically: click button with text Do I need to own
  const faqButton = page.locator('button:has-text("Do I need to own the appliance")').first();
  const hasFaqButton = await faqButton.count();
  let ariaBefore = null, ariaAfter = null;
  if (hasFaqButton) {
    ariaBefore = await faqButton.getAttribute('aria-expanded');
    await faqButton.click();
    await page.waitForTimeout(400);
    ariaAfter = await faqButton.getAttribute('aria-expanded');
  }

  // Keyboard navigation: tab through first 15 focusable elements, record tag/text/outline
  const tabResults = [];
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const style = window.getComputedStyle(el);
      return {
        tag: el.tagName,
        text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || '').trim().slice(0, 40),
        outline: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
      };
    });
    tabResults.push(info);
  }

  // Mobile menu test at 375 width
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(300);
  const hamburgerVisible = await page.locator('[aria-label="toggle menu"]').first().isVisible().catch(() => false);
  let menuOpenedOk = false;
  if (hamburgerVisible) {
    await page.locator('[aria-label="toggle menu"]').first().click();
    await page.waitForTimeout(400);
    menuOpenedOk = await page.locator('text=Account & Billing').first().isVisible().catch(()=>false);
  }

  await page.screenshot({ path: 'screenshot_375.png', fullPage: true });

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'screenshot_768.png', fullPage: true });

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'screenshot_1366.png', fullPage: true });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'screenshot_1920.png', fullPage: true });

  // check horizontal scroll at each width
  const hScrollCheck = async (w) => {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(200);
    return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  };
  const hscroll = {};
  for (const w of [1920, 1366, 768, 375]) {
    hscroll[w] = await hScrollCheck(w);
  }

  console.log(JSON.stringify({
    faqResult, ariaBefore, ariaAfter, hasFaqButton,
    tabResults, hamburgerVisible, menuOpenedOk, hscroll,
    consoleMsgs, pageErrors
  }, null, 2));

  await browser.close();
})();
