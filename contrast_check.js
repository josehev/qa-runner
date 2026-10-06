const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/ny/residential/battery-program";

function luminance(r, g, b) {
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function contrastRatio(rgb1, rgb2) {
  const l1 = luminance(...rgb1);
  const l2 = luminance(...rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
function parseRgb(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  return m[1].split(',').slice(0, 3).map(s => parseFloat(s.trim()));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);

  const selectors = [
    'h1', 'h2', 'h3', 'p', 'a', 'button',
    '.btn, [class*="button"]',
  ];

  const results = await page.evaluate(() => {
    function getBg(el) {
      let cur = el;
      while (cur) {
        const bg = getComputedStyle(cur).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
        cur = cur.parentElement;
      }
      return 'rgb(255,255,255)';
    }
    const sels = ['h1', 'h2', 'h3', 'p', 'a', 'button'];
    const out = [];
    sels.forEach(sel => {
      const els = [...document.querySelectorAll(sel)].slice(0, 5);
      els.forEach(el => {
        if (!el.innerText || !el.innerText.trim()) return;
        const cs = getComputedStyle(el);
        out.push({
          sel, text: el.innerText.trim().slice(0, 40),
          color: cs.color, bg: getBg(el), fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        });
      });
    });
    return out;
  });

  for (const r of results) {
    const fg = parseRgb(r.color);
    const bg = parseRgb(r.bg);
    if (!fg || !bg) continue;
    const ratio = contrastRatio(fg, bg);
    const size = parseFloat(r.fontSize);
    const weight = parseInt(r.fontWeight) || 400;
    const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
    const threshold = isLarge ? 3.0 : 4.5;
    const pass = ratio >= threshold;
    console.log(`${r.sel.padEnd(8)} "${r.text}" color=${r.color} bg=${r.bg} size=${r.fontSize} ratio=${ratio.toFixed(2)} threshold=${threshold} ${pass ? 'PASS' : 'FAIL'}`);
  }

  await browser.close();
})();
