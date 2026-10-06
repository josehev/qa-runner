const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling";

function luminance(r, g, b) {
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function contrast(rgb1, rgb2) {
  const l1 = luminance(...rgb1) + 0.05;
  const l2 = luminance(...rgb2) + 0.05;
  return l1 > l2 ? l1 / l2 : l2 / l1;
}
function parseColor(str) {
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

  const selectors = [
    { name: 'H1 Get Rewarded for Recycling', sel: 'h1' },
    { name: 'Body paragraph (About)', sel: 'p' },
    { name: 'Download button text', sel: '.article-header__cta-text' },
    { name: 'Footer links', sel: 'footer a' },
    { name: 'Nav top links', sel: 'nav a' },
    { name: 'FAQ question text', sel: 'button:has-text("Do I need to own")' },
    { name: 'Breadcrumb link', sel: 'a[href*="rebates-incentives-credits"]' },
    { name: 'Orange tab (About active)', sel: 'text=About' },
  ];

  const results = [];
  for (const s of selectors) {
    try {
      const el = page.locator(s.sel).first();
      const count = await el.count();
      if (!count) { results.push({ ...s, error: 'not found' }); continue; }
      const style = await el.evaluate(node => {
        const cs = window.getComputedStyle(node);
        // find background by walking up until non-transparent
        let bgNode = node;
        let bg = cs.backgroundColor;
        while (bgNode && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
          bgNode = bgNode.parentElement;
          if (!bgNode) break;
          bg = window.getComputedStyle(bgNode).backgroundColor;
        }
        return { color: cs.color, backgroundColor: bg, fontSize: cs.fontSize, fontWeight: cs.fontWeight };
      });
      const fg = parseColor(style.color);
      const bg = parseColor(style.backgroundColor);
      let ratio = null;
      if (fg && bg) ratio = contrast(fg, bg);
      results.push({ ...s, style, ratio: ratio ? ratio.toFixed(2) : null });
    } catch (e) {
      results.push({ ...s, error: e.message });
    }
  }
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();
