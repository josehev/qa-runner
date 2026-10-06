const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/ny/residential/battery-program";
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const consoleMsgs = [];
  page.on('console', m => consoleMsgs.push(m.type() + ': ' + m.text()));
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);

  // Click FAQs section to find accordion
  const faqHeading = await page.$('text=FAQs');
  if (faqHeading) {
    await faqHeading.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  }

  // find accordion buttons within FAQ area (aria-expanded buttons with question text)
  const accordionButtons = await page.$$('[aria-expanded]');
  console.log('Total aria-expanded elements:', accordionButtons.length);

  // try clicking first one that looks like a FAQ question (has text length > 10, not nav)
  let tested = 0;
  for (const btn of accordionButtons) {
    const info = await btn.evaluate(e => ({ text: e.innerText?.trim().slice(0,60), tag: e.tagName, expandedBefore: e.getAttribute('aria-expanded') }));
    if (info.text && info.text.length > 15 && !['Account & Billing','Services & Outages','Save Energy & Money','Clean Energy'].includes(info.text)) {
      try {
        await btn.scrollIntoViewIfNeeded();
        await btn.click({ timeout: 5000 });
        await page.waitForTimeout(400);
        const expandedAfter = await btn.getAttribute('aria-expanded');
        console.log('CLICKED:', info.text, '| before:', info.expandedBefore, '| after:', expandedAfter);
        tested++;
        if (tested >= 3) break;
      } catch (e) {
        console.log('CLICK FAILED on', info.text, e.message.split('\n')[0]);
      }
    }
  }

  // Test search functionality
  try {
    const searchBtn = await page.$('button[aria-label="search" i], button[aria-label="Search"]');
    if (searchBtn) {
      await searchBtn.click();
      await page.waitForTimeout(500);
      const searchInput = await page.$('#searchId, input[name="search"]');
      if (searchInput) {
        await searchInput.fill('battery');
        await page.waitForTimeout(300);
        console.log('Search input filled with "battery"');
        // test edge case: SQL injection string
        await searchInput.fill("' OR 1=1 --");
        await page.waitForTimeout(300);
        const val = await searchInput.inputValue();
        console.log('Search field after SQLi string input, value=', JSON.stringify(val));
      } else {
        console.log('Search input not found after clicking search button');
      }
    } else {
      console.log('Search button not found');
    }
  } catch (e) {
    console.log('SEARCH TEST ERROR:', e.message.split('\n')[0]);
  }

  console.log('--- CONSOLE MESSAGES DURING INTERACTION ---');
  consoleMsgs.forEach(m => console.log(m));

  await page.screenshot({ path: 'interact_result.png', fullPage: true });
  await browser.close();
})();
