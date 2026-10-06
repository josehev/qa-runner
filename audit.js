const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

  const data = await page.evaluate(() => {
    const out = {};
    out.title = document.title;
    out.metaDescription = document.querySelector('meta[name="description"]')?.content || null;
    out.canonical = document.querySelector('link[rel="canonical"]')?.href || null;
    out.ogTags = [...document.querySelectorAll('meta[property^="og:"]')].map(m => ({p: m.getAttribute('property'), c: m.getAttribute('content')}));
    out.twitterTags = [...document.querySelectorAll('meta[name^="twitter:"]')].map(m => ({p: m.getAttribute('name'), c: m.getAttribute('content')}));
    out.lang = document.documentElement.lang;
    out.headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => ({tag: h.tagName, text: h.innerText.trim().slice(0,100)}));
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
      width: img.naturalWidth,
      height: img.naturalHeight,
    }));
    out.links = [...document.querySelectorAll('a[href]')].map(a => ({
      href: a.href,
      text: a.innerText.trim().slice(0,60),
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
        required: i.required,
        placeholder: i.getAttribute('placeholder'),
      }))
    }));
    out.buttons = [...document.querySelectorAll('button, [role="button"]')].map(b => ({
      text: b.innerText.trim().slice(0,60),
      ariaExpanded: b.getAttribute('aria-expanded'),
      ariaLabel: b.getAttribute('aria-label'),
      ariaControls: b.getAttribute('aria-controls'),
    }));
    out.accordionLike = document.querySelectorAll('[aria-expanded]').length;
    out.bodyText = document.body.innerText.slice(0, 3000);
    return out;
  });
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
