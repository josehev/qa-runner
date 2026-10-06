const { chromium } = require('playwright');
const fs = require('fs');
const URL = 'https://dev10.oru.com/en/save-money/rebates-incentives-credits/myheat';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });

  const out = {};

  // 1. Keyboard navigation: tab through first 15 elements, capture focused element + outline style
  const tabResults = [];
  for (let i = 0; i < 15; i++) {
    await p.keyboard.press('Tab');
    const info = await p.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        tag: el.tagName,
        text: (el.textContent || '').trim().slice(0, 50),
        id: el.id,
        outline: style.outlineStyle + ' ' + style.outlineWidth + ' ' + style.outlineColor,
        boxShadow: style.boxShadow,
      };
    });
    tabResults.push(info);
  }
  out.tabResults = tabResults;

  // 2. FAQ accordion test
  await p.evaluate(() => {
    const faq = document.querySelector('h2, h3');
  });
  // scroll to FAQs and click first question
  const faqHeader = await p.$('text=How do I read my MyHEAT score?');
  if (faqHeader) {
    await faqHeader.scrollIntoViewIfNeeded();
    const beforeExpanded = await p.evaluate(el => el.closest('button') ? el.closest('button').getAttribute('aria-expanded') : el.getAttribute('aria-expanded'), faqHeader);
    await faqHeader.click();
    await p.waitForTimeout(500);
    const afterExpanded = await p.evaluate(el => el.closest('button') ? el.closest('button').getAttribute('aria-expanded') : el.getAttribute('aria-expanded'), faqHeader);
    out.faqTest = { beforeExpanded, afterExpanded };
    // click again to close
    await faqHeader.click();
    await p.waitForTimeout(500);
    const closedExpanded = await p.evaluate(el => el.closest('button') ? el.closest('button').getAttribute('aria-expanded') : el.getAttribute('aria-expanded'), faqHeader);
    out.faqTest.closedExpanded = closedExpanded;
  } else {
    out.faqTest = 'FAQ header not found';
  }

  // 3. Search box edge cases
  const searchResults = {};
  const testStrings = {
    long: 'a'.repeat(500),
    special: '!@#$%^&*()_+{}|:"<>?~`',
    emoji: '🔥🏠💡😀',
    sqlInjection: "' OR '1'='1",
  };
  for (const [key, val] of Object.entries(testStrings)) {
    try {
      await p.fill('#searchId', '');
      await p.fill('#searchId', val);
      const actualValue = await p.inputValue('#searchId');
      searchResults[key] = { input: val.slice(0,50), actualValue: actualValue.slice(0,100), length: actualValue.length };
    } catch (e) {
      searchResults[key] = { error: e.message };
    }
  }
  out.searchResults = searchResults;

  // try submitting search with sql injection string to see behavior
  try {
    await p.fill('#searchId', "' OR '1'='1");
    await Promise.all([
      p.waitForNavigation({ timeout: 10000 }).catch(() => null),
      p.press('#searchId', 'Enter'),
    ]);
    out.searchSubmitUrl = p.url();
    out.searchSubmitTitle = await p.title();
  } catch (e) {
    out.searchSubmitError = e.message;
  }

  await ctx.close();

  // 4. mobile menu toggle test (375 width)
  const ctx2 = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const p2 = await ctx2.newPage();
  await p2.goto(URL, { waitUntil: 'networkidle' });
  const toggleBtn = await p2.$('button[aria-label="toggle menu"]');
  if (toggleBtn) {
    await toggleBtn.click();
    await p2.waitForTimeout(500);
    const menuVisible = await p2.evaluate(() => {
      const nav = document.querySelector('nav');
      return nav ? getComputedStyle(nav).display !== 'none' : null;
    });
    out.mobileMenu = { clicked: true, menuVisibleAfterClick: menuVisible };
    await p2.screenshot({ path: './qa-reports/mobile_menu_open.png' });
  } else {
    out.mobileMenu = 'toggle button not found';
  }
  await ctx2.close();

  // 5. reload & back/forward test
  const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p3 = await ctx3.newPage();
  await p3.goto(URL, { waitUntil: 'networkidle' });
  await p3.goto('https://dev10.oru.com/en/', { waitUntil: 'networkidle' });
  await p3.goBack({ waitUntil: 'networkidle' });
  out.backNavUrl = p3.url();
  await p3.goForward({ waitUntil: 'networkidle' });
  out.forwardNavUrl = p3.url();
  await p3.reload({ waitUntil: 'networkidle' });
  out.reloadUrl = p3.url();
  await ctx3.close();

  fs.writeFileSync('./qa-reports/qa_interact_results.json', JSON.stringify(out, null, 2));
  console.log('DONE');
  await browser.close();
})();
