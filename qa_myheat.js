const { chromium } = require('playwright');
const fs = require('fs');

const URL = 'https://dev10.oru.com/en/save-money/rebates-incentives-credits/myheat';

(async () => {
  const results = {};
  const consoleMsgs = [];
  const pageErrors = [];
  const failedRequests = [];

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  page.on('console', msg => {
    consoleMsgs.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', err => {
    pageErrors.push(err.message);
  });
  page.on('requestfailed', req => {
    failedRequests.push({ url: req.url(), failure: req.failure() && req.failure().errorText });
  });

  const responses = [];
  page.on('response', res => {
    responses.push({ url: res.url(), status: res.status() });
  });

  let mainResponse;
  try {
    mainResponse = await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  } catch (e) {
    results.navError = e.message;
  }

  results.httpStatus = mainResponse ? mainResponse.status() : null;
  results.finalUrl = page.url();
  results.https = page.url().startsWith('https://');

  // Title & meta description
  results.title = await page.title();
  results.metaDescription = await page.$eval('meta[name="description"]', el => el.content).catch(() => null);

  // Headings
  results.headings = await page.$$eval('h1,h2,h3,h4,h5,h6', els => els.map(e => ({ tag: e.tagName, text: e.textContent.trim().slice(0, 150) })));

  // Landmarks
  results.landmarks = {
    header: await page.$$eval('header', els => els.length),
    nav: await page.$$eval('nav', els => els.length),
    main: await page.$$eval('main', els => els.length),
    footer: await page.$$eval('footer', els => els.length),
  };

  // Images
  results.images = await page.$$eval('img', imgs => imgs.map(img => ({
    src: img.getAttribute('src'),
    alt: img.getAttribute('alt'),
    loading: img.getAttribute('loading'),
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    displayWidth: img.clientWidth,
    displayHeight: img.clientHeight,
    complete: img.complete,
  })));

  // Links
  results.links = await page.$$eval('a[href]', as => as.map(a => ({
    href: a.getAttribute('href'),
    text: a.textContent.trim().slice(0, 100),
    target: a.getAttribute('target'),
    rel: a.getAttribute('rel'),
  })));

  // Forms
  results.forms = await page.$$eval('form', forms => forms.map(f => ({
    action: f.getAttribute('action'),
    method: f.getAttribute('method'),
    inputs: Array.from(f.querySelectorAll('input,textarea,select')).map(i => ({
      type: i.getAttribute('type'),
      name: i.getAttribute('name'),
      id: i.getAttribute('id'),
      ariaLabel: i.getAttribute('aria-label'),
    })),
  })));

  // Inputs outside forms too
  results.allInputs = await page.$$eval('input,textarea,select', els => els.map(i => ({
    type: i.getAttribute('type'),
    name: i.getAttribute('name'),
    id: i.getAttribute('id'),
    placeholder: i.getAttribute('placeholder'),
  })));

  // Interactive elements: buttons, accordions, toggles
  results.buttons = await page.$$eval('button', btns => btns.map(b => ({
    text: b.textContent.trim().slice(0, 80),
    ariaExpanded: b.getAttribute('aria-expanded'),
    ariaLabel: b.getAttribute('aria-label'),
  })));

  // Full HTML for manual grep
  const html = await page.content();
  fs.writeFileSync('./qa-reports/myheat_page.html', html);

  // Screenshot at 1920
  await page.screenshot({ path: './qa-reports/myheat_1920.png', fullPage: true });

  await context.close();

  // Other viewports
  for (const [name, vw] of [['1366', {width:1366,height:900}], ['768', {width:768,height:1024}], ['375', {width:375,height:812}]]) {
    const ctx = await browser.newContext({ viewport: vw });
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
    await p.screenshot({ path: `./qa-reports/myheat_${name}.png`, fullPage: true });
    await ctx.close();
  }

  results.consoleMsgs = consoleMsgs;
  results.pageErrors = pageErrors;
  results.failedRequests = failedRequests;
  results.responseStatuses = responses.filter(r => r.status >= 400);

  fs.writeFileSync('./qa-reports/myheat_results.json', JSON.stringify(results, null, 2));
  console.log('DONE');

  await browser.close();
})();
