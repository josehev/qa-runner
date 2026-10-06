const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/ny/residential/battery-program";
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);
  await page.click('button[aria-label="Log in or Register"]');
  await page.waitForTimeout(800);
  const emailInput = await page.$('#modal-login-email');
  if (emailInput) {
    await emailInput.fill("' OR 1=1 --@test.com");
    console.log('Email field SQLi value:', await emailInput.inputValue());
    await emailInput.fill('😀<script>alert(1)</script>');
    console.log('Email field XSS/emoji value:', await emailInput.inputValue());
    const pwInput = await page.$('#modal-login-password');
    await pwInput.fill('a'.repeat(500));
    console.log('Password field 500-char value length:', (await pwInput.inputValue()).length);
    // try submit with invalid email to check validation message
    await emailInput.fill('notanemail');
    await pwInput.fill('x');
    const loginBtn = await page.$('button:has-text("Log In")');
    const disabled = await loginBtn.getAttribute('disabled');
    console.log('Log In button disabled attr with invalid email:', disabled);
    await loginBtn.click({ force: true }).catch(e => console.log('click err:', e.message.split('\n')[0]));
    await page.waitForTimeout(500);
    const validationMsg = await page.evaluate(() => {
      const el = document.querySelector('[id*="error"], .error, [role="alert"]');
      return el ? el.innerText : null;
    });
    console.log('Validation message found:', validationMsg);
  } else {
    console.log('Login modal email input not found');
  }
  console.log('Page errors:', errors);
  await page.screenshot({ path: 'login_modal_test.png' });
  await browser.close();
})();
