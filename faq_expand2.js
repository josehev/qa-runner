const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling";
(async()=>{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, {waitUntil:'networkidle', timeout:30000});
  await page.locator('text=EXPAND ALL').click();
  await page.waitForTimeout(500);
  const text = await page.evaluate(() => {
    const faqSection = [...document.querySelectorAll('section, div')].find(d => d.innerText && d.innerText.trim().startsWith('FAQs') && d.innerText.includes('Do I need to own'));
    return faqSection ? faqSection.innerText : 'NOT FOUND';
  });
  console.log(text);
  await browser.close();
})();
