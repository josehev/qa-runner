const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/ny/residential/battery-program";
const { file: artifactPath } = require('./artifacts').createArtifactRun(URL);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);

  const selectors = [
    { label: 'Contact Us link', sel: 'a:has-text("Contact Us")' },
    { label: 'Account & Billing nav button', sel: 'button:has-text("Account & Billing")' },
  ];

  for (const s of selectors) {
    const el = await page.$(s.sel);
    if (!el) { console.log(s.label, 'NOT FOUND'); continue; }
    const before = await el.evaluate(e => {
      const cs = getComputedStyle(e);
      return { outline: cs.outline, outlineOffset: cs.outlineOffset, border: cs.border, background: cs.backgroundColor, boxShadow: cs.boxShadow };
    });
    await el.focus();
    await page.waitForTimeout(200);
    const after = await el.evaluate(e => {
      const cs = getComputedStyle(e);
      return { outline: cs.outline, outlineOffset: cs.outlineOffset, border: cs.border, background: cs.backgroundColor, boxShadow: cs.boxShadow };
    });
    console.log(s.label);
    console.log(' BEFORE:', JSON.stringify(before));
    console.log(' AFTER (focused):', JSON.stringify(after));
    console.log(' CHANGED:', JSON.stringify(before) !== JSON.stringify(after));
  }
  await page.screenshot({ path: artifactPath('focus_contact_test.png') });
  await browser.close();
})();
