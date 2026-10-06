const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/ny/residential/battery-program";
function luminance(r,g,b){const a=[r,g,b].map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2];}
function ratio(c1,c2){const l1=luminance(...c1),l2=luminance(...c2);const l=Math.max(l1,l2),d=Math.min(l1,l2);return (l+0.05)/(d+0.05);}
function parse(s){const m=s.match(/rgba?\(([^)]+)\)/);return m?m[1].split(',').slice(0,3).map(x=>parseFloat(x)):null;}
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);
  const btns = await page.$$eval('a,button', els => els.filter(e => /enroll now|learn more|find rewards|email us/i.test(e.innerText||'')).map(e => {
    const cs = getComputedStyle(e);
    return { text: e.innerText.trim(), color: cs.color, bg: cs.backgroundColor, fontSize: cs.fontSize };
  }));
  for (const b of btns) {
    const fg = parse(b.color), bg = parse(b.bg);
    if (fg && bg && bg[0]+bg[1]+bg[2] !== undefined) {
      const r = ratio(fg,bg);
      console.log(b.text, b.color, b.bg, 'ratio=', r.toFixed(2));
    } else {
      console.log(b.text, b.color, b.bg, '(transparent bg - needs ancestor check)');
    }
  }
  await browser.close();
})();
