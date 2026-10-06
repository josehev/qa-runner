const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/ny/residential/battery-program";
const { file: artifactPath } = require('./artifacts').createArtifactRun(URL);

(async () => {
  const browser = await chromium.launch();
  const consoleMsgs = [];
  const pageErrors = [];
  const failedRequests = [];

  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  page.on('console', msg => {
    consoleMsgs.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', err => {
    pageErrors.push(err.message);
  });
  page.on('requestfailed', req => {
    failedRequests.push({ url: req.url(), failure: req.failure()?.errorText });
  });

  const respStatuses = [];
  page.on('response', resp => {
    respStatuses.push({ url: resp.url(), status: resp.status() });
  });

  let gotoErr = null;
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  } catch (e) {
    gotoErr = e.message;
  }

  await page.waitForTimeout(2000);

  const data = await page.evaluate(() => {
    const out = {};
    out.title = document.title;
    out.metaDescription = document.querySelector('meta[name="description"]')?.content || null;
    out.canonical = document.querySelector('link[rel="canonical"]')?.href || null;
    out.ogTags = [...document.querySelectorAll('meta[property^="og:"]')].map(m => ({ p: m.getAttribute('property'), c: m.getAttribute('content') }));
    out.twitterTags = [...document.querySelectorAll('meta[name^="twitter:"]')].map(m => ({ p: m.getAttribute('name'), c: m.getAttribute('content') }));
    out.lang = document.documentElement.lang;
    out.headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => ({ tag: h.tagName, text: h.innerText.trim().slice(0, 150) }));
    out.landmarks = {
      header: document.querySelectorAll('header').length,
      nav: document.querySelectorAll('nav').length,
      main: document.querySelectorAll('main').length,
      footer: document.querySelectorAll('footer').length,
      banner: document.querySelectorAll('[role="banner"]').length,
      navigationRole: document.querySelectorAll('[role="navigation"]').length,
      mainRole: document.querySelectorAll('[role="main"]').length,
      contentinfo: document.querySelectorAll('[role="contentinfo"]').length,
    };
    out.images = [...document.querySelectorAll('img')].map(img => ({
      src: img.currentSrc || img.src,
      alt: img.getAttribute('alt'),
      loading: img.getAttribute('loading'),
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      displayWidth: img.width,
      displayHeight: img.height,
    }));
    out.links = [...document.querySelectorAll('a[href]')].map(a => ({
      href: a.href,
      text: a.innerText.trim().slice(0, 80),
      target: a.getAttribute('target'),
      rel: a.getAttribute('rel'),
    }));
    out.forms = [...document.querySelectorAll('form')].map(f => ({
      id: f.id,
      action: f.action,
      inputs: [...f.querySelectorAll('input,select,textarea')].map(i => ({
        type: i.type, name: i.name, id: i.id,
        hasLabel: !!(i.id && document.querySelector(`label[for="${i.id}"]`)) || !!i.closest('label'),
        ariaLabel: i.getAttribute('aria-label'),
        ariaLabelledby: i.getAttribute('aria-labelledby'),
        required: i.required,
        placeholder: i.getAttribute('placeholder'),
      }))
    }));
    out.buttons = [...document.querySelectorAll('button, [role="button"]')].map(b => ({
      text: b.innerText.trim().slice(0, 60),
      ariaLabel: b.getAttribute('aria-label'),
      ariaExpanded: b.getAttribute('aria-expanded'),
      disabled: b.disabled,
    }));
    out.bodyText = document.body.innerText.slice(0, 5000);
    out.htmlLength = document.documentElement.outerHTML.length;
    out.accordions = [...document.querySelectorAll('[aria-expanded]')].length;
    out.placeholderCheck = {
      loremIpsum: document.body.innerText.toLowerCase().includes('lorem ipsum'),
      todoMarkers: /\bTODO\b/.test(document.body.innerText),
      curlyBraces: /\{[a-zA-Z_]+\}/.test(document.body.innerText),
    };
    return out;
  });

  // Dark mode check
  const darkModeToggle = await page.$$('[class*="dark-mode"], [class*="theme-toggle"], [aria-label*="dark mode" i], [aria-label*="theme" i]');

  // Keyboard nav + focus check
  const focusResults = [];
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        text: el.innerText ? el.innerText.trim().slice(0, 40) : '',
        href: el.getAttribute && el.getAttribute('href'),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
        visible: rect.width > 0 && rect.height > 0,
      };
    });
    focusResults.push(focused);
  }

  await page.screenshot({ path: artifactPath('battery_1920.png'), fullPage: true });

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: artifactPath('battery_1366.png'), fullPage: true });

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: artifactPath('battery_768.png'), fullPage: true });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: artifactPath('battery_375.png'), fullPage: true });

  // check horizontal overflow at mobile
  const mobileOverflow = await page.evaluate(() => {
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflowingElements: [...document.querySelectorAll('*')].filter(el => el.scrollWidth > document.documentElement.clientWidth + 5).slice(0, 10).map(el => el.tagName + (el.className ? '.' + String(el.className).split(' ').join('.') : ''))
    };
  });

  await page.setViewportSize({ width: 1920, height: 1080 });

  console.log(JSON.stringify({
    url: URL,
    finalUrl: page.url(),
    gotoErr,
    data,
    darkModeToggleCount: darkModeToggle.length,
    focusResults,
    mobileOverflow,
    consoleMsgs,
    pageErrors,
    failedRequests,
    nonOkResponses: respStatuses.filter(r => r.status >= 400),
  }, null, 2));

  await browser.close();
})();
