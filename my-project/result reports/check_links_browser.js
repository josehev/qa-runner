const { chromium } = require('playwright');
const urls = [
  "https://www.tesla.com/support/energy/powerwall/order/order-powerwall",
  "https://www.solaredge.com/us/installers/to-order",
  "https://www.lighthousesolarny.com/contact-us/",
  "https://tristatesolarservices.com/contact-us/",
  "http://phx.corporate-ir.net/phoenix.zhtml?c=61493&p=irol-stockQuote"
];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const u of urls) {
    try {
      const resp = await page.goto(u, { timeout: 20000, waitUntil: 'domcontentloaded' });
      console.log(resp.status(), u);
    } catch (e) {
      console.log('ERR:', e.message.split('\n')[0], u);
    }
  }
  await browser.close();
})();
