const { chromium } = require('playwright');
const URL = 'https://qa3-oru.vml.dev/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling';
function luminance([r,g,b]) {
  const a = [r,g,b].map(v => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);});
  return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2];
}
function parseColor(str){ const m = str.match(/rgba?\(([^)]+)\)/); if(!m) return null; return m[1].split(',').map(s=>parseFloat(s.trim())); }
function contrastRatio(c1,c2){ const l1=luminance(c1), l2=luminance(c2); const [a,b]=l1>l2?[l1,l2]:[l2,l1]; return (a+0.05)/(b+0.05); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  const texts = ['Search', 'Log in or Register', 'Clean Energy', 'EXPAND ALL'];
  for (const t of texts) {
    const loc = page.locator(`text="${t}"`).first();
    const count = await loc.count();
    if (!count) { console.log(t, 'NOT FOUND'); continue; }
    const info = await loc.evaluate(node => {
      function getBgColor(n){ let cur=n; while(cur){ const bg=window.getComputedStyle(cur).backgroundColor; if(bg && bg!=='rgba(0, 0, 0, 0)') return bg; cur=cur.parentElement;} return 'rgb(255,255,255)'; }
      const s = window.getComputedStyle(node);
      return { color: s.color, bg: getBgColor(node), fontSize: s.fontSize };
    });
    const c1 = parseColor(info.color), c2 = parseColor(info.bg);
    const ratio = (c1 && c2) ? contrastRatio(c1,c2).toFixed(2) : 'n/a';
    console.log(t, info, 'ratio=', ratio);
  }
  await browser.close();
})();
