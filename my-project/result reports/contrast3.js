const { chromium } = require('playwright');
const URL = "https://dev10.oru.com/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling";
function luminance(r,g,b){const a=[r,g,b].map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2];}
function contrast(c1,c2){const l1=luminance(...c1)+0.05,l2=luminance(...c2)+0.05;return l1>l2?l1/l2:l2/l1;}
function parseColor(s){const m=s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);return m?[+m[1],+m[2],+m[3]]:null;}
(async()=>{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, {waitUntil:'networkidle', timeout:30000});
  const data = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a')].filter(a => /Upcoming Events|FAQs|Get Started|^About$/.test(a.innerText.trim()));
    return links.map(a => {
      const cs = window.getComputedStyle(a);
      let bgNode = a, bg = cs.backgroundColor;
      while (bgNode && (bg === 'rgba(0, 0, 0, 0)')) { bgNode = bgNode.parentElement; if (!bgNode) break; bg = window.getComputedStyle(bgNode).backgroundColor; }
      return { text: a.innerText.trim(), color: cs.color, backgroundColor: bg, parentBg: bgNode ? bgNode.tagName+'.'+bgNode.className : null };
    });
  });
  const out = data.map(d => {
    const fg = parseColor(d.color), bg = parseColor(d.backgroundColor);
    return { ...d, ratio: (fg && bg) ? contrast(fg, bg).toFixed(2) : null };
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
