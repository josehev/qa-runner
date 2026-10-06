const { chromium } = require('playwright');
const fs = require('fs');

const URL = 'https://qa3-oru.vml.dev/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling';
const { file: artifactPath } = require('../artifacts').createArtifactRun(URL);

(async () => {
  const browser = await chromium.launch();
  const report = {};

  // ---------- Desktop pass: console, DOM, links, images, meta ----------
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const consoleMsgs = [];
  const pageErrors = [];
  page.on('console', msg => consoleMsgs.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => pageErrors.push(err.message));

  const resp = await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => { report.navError = e.message; return null; });
  report.status = resp ? resp.status() : null;
  report.finalUrl = page.url();
  report.title = await page.title();

  // meta tags
  report.meta = await page.evaluate(() => {
    const get = (sel, attr) => { const el = document.querySelector(sel); return el ? el.getAttribute(attr) : null; };
    return {
      description: get('meta[name="description"]', 'content'),
      ogTitle: get('meta[property="og:title"]', 'content'),
      ogDescription: get('meta[property="og:description"]', 'content'),
      ogImage: get('meta[property="og:image"]', 'content'),
      canonical: get('link[rel="canonical"]', 'href'),
      lang: document.documentElement.getAttribute('lang'),
    };
  });

  // semantic structure & headings
  report.structure = await page.evaluate(() => {
    const has = sel => !!document.querySelector(sel);
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(h => ({ tag: h.tagName, text: h.textContent.trim().slice(0, 80) }));
    return {
      header: has('header'),
      nav: has('nav'),
      main: has('main'),
      footer: has('footer'),
      h1Count: document.querySelectorAll('h1').length,
      headings,
    };
  });

  // images
  report.images = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.map(img => ({
      src: img.currentSrc || img.getAttribute('src'),
      alt: img.getAttribute('alt'),
      loading: img.getAttribute('loading'),
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      displayWidth: img.clientWidth,
      displayHeight: img.clientHeight,
    }));
  });

  // links
  report.links = await page.evaluate(() => {
    const as = Array.from(document.querySelectorAll('a[href]'));
    return as.map(a => ({
      href: a.href,
      text: a.textContent.trim().slice(0, 60),
      target: a.getAttribute('target'),
      rel: a.getAttribute('rel'),
    }));
  });

  // forms
  report.forms = await page.evaluate(() => {
    const forms = Array.from(document.querySelectorAll('form'));
    return forms.map(f => {
      const inputs = Array.from(f.querySelectorAll('input,select,textarea')).map(i => {
        const id = i.getAttribute('id');
        const label = id ? document.querySelector(`label[for="${id}"]`) : null;
        return {
          type: i.getAttribute('type') || i.tagName,
          name: i.getAttribute('name'),
          ariaLabel: i.getAttribute('aria-label'),
          hasLabel: !!label,
          placeholder: i.getAttribute('placeholder'),
        };
      });
      return { action: f.getAttribute('action'), inputs };
    });
  });

  // interactive widgets - accordions/tabs/dropdowns (buttons with aria-expanded)
  report.widgets = await page.evaluate(() => {
    const expandable = Array.from(document.querySelectorAll('[aria-expanded]'));
    return expandable.map(e => ({ tag: e.tagName, text: e.textContent.trim().slice(0, 50), expanded: e.getAttribute('aria-expanded') }));
  });

  // body text sample for proofreading + placeholder detection
  report.bodyTextSample = await page.evaluate(() => document.body.innerText.slice(0, 6000));
  report.placeholderHits = await page.evaluate(() => {
    const text = document.body.innerText;
    const patterns = ['Lorem ipsum', 'TODO', 'TBD', '{first_name}', '{{', 'XXX', 'placeholder text'];
    return patterns.filter(p => text.toLowerCase().includes(p.toLowerCase()));
  });

  report.consoleMsgs = consoleMsgs;
  report.pageErrors = pageErrors;

  // focus/keyboard nav - tab through first 15 elements
  report.tabSequence = [];
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const style = window.getComputedStyle(el);
      return {
        tag: el.tagName,
        text: (el.textContent || '').trim().slice(0, 40),
        outline: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
      };
    });
    report.tabSequence.push(info);
  }

  await context.close();

  // ---------- viewport screenshots ----------
  const viewports = [
    { name: '1920x1080', width: 1920, height: 1080 },
    { name: '1366x768', width: 1366, height: 768 },
    { name: '768x1024', width: 768, height: 1024 },
    { name: '375x812', width: 375, height: 812 },
  ];
  report.viewportShots = [];
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    const path = artifactPath(`shot_${vp.name}.png`);
    await p.screenshot({ path, fullPage: true }).catch(() => {});
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 5);
    report.viewportShots.push({ vp: vp.name, path, horizontalOverflow: overflow });
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(artifactPath('qa_audit_report.json'), JSON.stringify(report, null, 2));
  console.log('DONE');
})();
