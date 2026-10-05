const { chromium } = require('playwright');
const URL = 'https://qa3-oru.vml.dev/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling';

function luminance([r,g,b]) {
  const a = [r,g,b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
  });
  return 0.2126*a[0] + 0.7152*a[1] + 0.0722*a[2];
}
function parseColor(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  return m[1].split(',').map(s => parseFloat(s.trim()));
}
function contrastRatio(c1, c2) {
  const l1 = luminance(c1), l2 = luminance(c2);
  const [lighter, darker] = l1 > l2 ? [l1,l2] : [l2,l1];
  return (lighter + 0.05) / (darker + 0.05);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

  const selectors = [
    'h1',
    '.article-header__cta-link', // Download participation form button
    'nav a', // breadcrumb
    '.primary-nav-item__btn',
    'p',
    'footer a',
    '.header__secondary-link',
  ];

  const data = [];
  for (const sel of selectors) {
    const els = await page.$$(sel);
    for (const el of els.slice(0,2)) {
      const info = await el.evaluate(node => {
        function getBgColor(n) {
          let cur = n;
          while (cur) {
            const bg = window.getComputedStyle(cur).backgroundColor;
            if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
            cur = cur.parentElement;
          }
          return 'rgb(255,255,255)';
        }
        const style = window.getComputedStyle(node);
        return {
          text: node.textContent.trim().slice(0,30),
          color: style.color,
          bg: getBgColor(node),
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
        };
      });
      data.push({ sel, ...info });
    }
  }

  for (const d of data) {
    const c1 = parseColor(d.color);
    const c2 = parseColor(d.bg);
    if (c1 && c2) {
      d.ratio = contrastRatio(c1, c2).toFixed(2);
    }
  }
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
