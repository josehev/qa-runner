const { chromium } = require('playwright');
const URL = 'https://qa3-oru.vml.dev/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleMsgs = [];
  page.on('console', m => consoleMsgs.push({type: m.type(), text: m.text()}));
  page.on('pageerror', e => consoleMsgs.push({type:'pageerror', text: e.message}));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Test FAQ accordion
  const faqBtn = page.locator('button:has-text("Q: Do I need to own the appliance?")').first();
  await faqBtn.scrollIntoViewIfNeeded();
  const beforeExpanded = await faqBtn.getAttribute('aria-expanded');
  await faqBtn.click();
  await page.waitForTimeout(500);
  const afterExpanded = await faqBtn.getAttribute('aria-expanded');
  console.log('FAQ accordion: before=', beforeExpanded, 'after=', afterExpanded);
  // check if answer text visible
  const answerVisible = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Do I need to own the appliance?'));
    if (!btn) return null;
    const panel = btn.closest('[class*="accordion"], [class*="faq"]')?.querySelector('[class*="answer"], [class*="content"], [class*="panel"]');
    return panel ? panel.textContent.trim().slice(0,100) : 'panel not found via selector';
  });
  console.log('answer content sample:', answerVisible);

  // close it again
  await faqBtn.click();
  await page.waitForTimeout(300);
  const closedExpanded = await faqBtn.getAttribute('aria-expanded');
  console.log('after re-click (should collapse):', closedExpanded);

  // Test "Expand all" button
  const expandAllBtn = page.locator('button', { hasText: 'Expand all' }).first();
  if (await expandAllBtn.count()) {
    await expandAllBtn.scrollIntoViewIfNeeded();
    await expandAllBtn.click();
    await page.waitForTimeout(500);
    const allExpanded = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim().startsWith('Q:'));
      return btns.map(b => b.getAttribute('aria-expanded'));
    });
    console.log('Expand all result (aria-expanded for each FAQ):', allExpanded);
  } else {
    console.log('Expand all button not found');
  }

  // Test search functionality
  const searchToggle = page.locator('button.js-nav-search, button:has-text("Search")').first();
  await searchToggle.click();
  await page.waitForTimeout(500);
  const searchInput = page.locator('input[name="search"]').first();
  const searchVisible = await searchInput.isVisible().catch(() => false);
  console.log('Search input visible after click:', searchVisible);
  if (searchVisible) {
    await searchInput.fill('<script>alert(1)</script> test rebate ' + 'a'.repeat(300));
    const val = await searchInput.inputValue();
    console.log('Search input accepted long/special string, length:', val.length);
  }

  // Mobile menu test at mobile viewport
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const hamburger = page.locator('button[class*="menu"], button[aria-label*="menu" i], .js-mobile-menu-toggle').first();
  const hamburgerCount = await hamburger.count();
  console.log('hamburger menu button found:', hamburgerCount);
  if (hamburgerCount) {
    await hamburger.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tmp_audit/mobile_menu_open.png' });
  }

  console.log('--- console messages during interaction ---');
  console.log(JSON.stringify(consoleMsgs, null, 2));

  await browser.close();
})();
