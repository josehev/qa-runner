const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/ny/residential/battery-program";
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);
  await page.click('button[aria-label="Log in or Register"]');
  await page.waitForTimeout(800);
  await page.fill('#modal-login-email', 'test@test.com');
  await page.fill('#modal-login-password', 'wrongpassword123');
  const btn = await page.$('button:has-text("Log In")');
  await btn.click({ force: true });
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const errEl = [...document.querySelectorAll('*')].find(e => e.innerText && e.innerText.includes('Error: Please call us'));
    if (!errEl) return null;
    return {
      tag: errEl.tagName,
      role: errEl.getAttribute('role'),
      ariaLive: errEl.getAttribute('aria-live'),
      color: getComputedStyle(errEl).color,
      className: errEl.className,
      parentAriaLive: errEl.parentElement?.getAttribute('aria-live'),
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
