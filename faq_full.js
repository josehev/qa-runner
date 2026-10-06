const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/ny/residential/battery-program";
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);
  const expandAll = await page.$('text=EXPAND ALL');
  if (expandAll) {
    await expandAll.click();
    await page.waitForTimeout(500);
  }
  const faqText = await page.evaluate(() => {
    const faqSection = [...document.querySelectorAll('h2')].find(h => h.innerText.trim() === 'FAQs');
    if (!faqSection) return 'FAQ section not found';
    let container = faqSection.closest('section') || faqSection.parentElement;
    return container.innerText;
  });
  console.log(faqText);
  await browser.close();
})();
