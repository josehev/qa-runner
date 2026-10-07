const { chromium } = require("playwright");

const URL = "https://qa3-oru.vml.dev/en/save-money/rebates-incentives-credits/nj/residential/income-qualified-weatherization";

const VIEWPORTS = [
  { name: "Desktop-1920", width: 1920, height: 1080 },
  { name: "Laptop-1366", width: 1366, height: 768 },
  { name: "Tablet-768", width: 768, height: 1024 },
  { name: "Mobile-375", width: 375, height: 812 },
];

function luminance(r, g, b) {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function contrastRatio(rgb1, rgb2) {
  const l1 = luminance(...rgb1) + 0.05;
  const l2 = luminance(...rgb2) + 0.05;
  return l1 > l2 ? l1 / l2 : l2 / l1;
}
function parseRgb(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
  return parts;
}

(async () => {
  const output = {};
  const browser = await chromium.launch();

  // ---------- Main load + console + network ----------
  {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    const consoleMessages = [];
    const pageErrors = [];
    const failedRequests = [];
    page.on("console", (msg) => consoleMessages.push({ type: msg.type(), text: msg.text() }));
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("requestfailed", (req) => failedRequests.push({ url: req.url(), failure: req.failure()?.errorText }));
    page.on("response", (res) => {
      if (res.status() >= 400) failedRequests.push({ url: res.url(), status: res.status() });
    });

    const resp = await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
    output.status = resp ? resp.status() : null;
    output.finalUrl = page.url();
    output.title = await page.title();

    output.metaDescription = await page.$eval('meta[name="description"]', (el) => el.content).catch(() => null);
    output.canonical = await page.$eval('link[rel="canonical"]', (el) => el.href).catch(() => null);
    output.ogTags = await page.$$eval('meta[property^="og:"]', (els) => els.map((e) => ({ p: e.getAttribute("property"), c: e.getAttribute("content") })));
    output.htmlLang = await page.$eval("html", (el) => el.getAttribute("lang")).catch(() => null);
    output.viewportMeta = await page.$eval('meta[name="viewport"]', (el) => el.content).catch(() => null);

    // Headings
    output.headings = await page.$$eval("h1,h2,h3,h4,h5,h6", (els) =>
      els.map((e) => ({ tag: e.tagName, text: e.textContent.trim().slice(0, 100) }))
    );

    // Semantic landmarks
    output.landmarks = await page.evaluate(() => {
      const sel = ["header", "nav", "main", "footer", "[role=main]", "[role=navigation]", "[role=banner]", "[role=contentinfo]"];
      const res = {};
      sel.forEach((s) => (res[s] = document.querySelectorAll(s).length));
      return res;
    });

    // Images
    output.images = await page.$$eval("img", (imgs) =>
      imgs.map((img) => ({
        src: img.currentSrc || img.src,
        alt: img.getAttribute("alt"),
        hasAlt: img.hasAttribute("alt"),
        loading: img.getAttribute("loading"),
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        complete: img.complete,
        displayWidth: img.clientWidth,
        displayHeight: img.clientHeight,
      }))
    );

    // Links
    output.links = await page.$$eval("a[href]", (as) =>
      as.map((a) => ({
        href: a.href,
        text: a.textContent.trim().slice(0, 60),
        target: a.getAttribute("target"),
        rel: a.getAttribute("rel"),
      }))
    );

    // Forms
    output.forms = await page.$$eval("form", (forms) =>
      forms.map((f) => ({
        id: f.id,
        action: f.action,
        inputs: Array.from(f.querySelectorAll("input,select,textarea")).map((i) => ({
          type: i.type,
          name: i.name,
          id: i.id,
          hasLabel: !!(i.id && document.querySelector(`label[for="${i.id}"]`)) || !!i.closest("label") || i.hasAttribute("aria-label") || i.hasAttribute("aria-labelledby"),
          required: i.required,
        })),
      }))
    );

    // Interactive elements: buttons, accordions, toggles
    output.buttons = await page.$$eval("button, [role=button], summary, [aria-expanded]", (els) =>
      els.map((e) => ({ tag: e.tagName, text: e.textContent.trim().slice(0, 60), ariaExpanded: e.getAttribute("aria-expanded"), id: e.id }))
    );

    // Body text sample for proofreading / placeholder detection
    output.bodyText = await page.evaluate(() => document.body.innerText);

    // Check for placeholder text
    const placeholderPatterns = ["lorem ipsum", "{{", "}}", "[todo", "TODO:", "{first_name}", "lorem_ipsum", "placeholder text"];
    output.placeholderHits = placeholderPatterns.filter((p) => output.bodyText.toLowerCase().includes(p.toLowerCase()));

    // Tab order / focusable elements + focus visibility
    const focusables = await page.$$eval(
      "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
      (els) => els.length
    );
    output.focusableCount = focusables;

    // Tab through first 15 elements and capture outline/box-shadow on focus
    await page.keyboard.press("Tab");
    const tabResults = [];
    for (let i = 0; i < 15; i++) {
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        return {
          tag: el.tagName,
          text: (el.textContent || el.value || "").trim().slice(0, 40),
          outline: style.outlineStyle + " " + style.outlineWidth + " " + style.outlineColor,
          boxShadow: style.boxShadow,
        };
      });
      tabResults.push(info);
      await page.keyboard.press("Tab");
    }
    output.tabResults = tabResults;

    // Color contrast sampling: sample text nodes
    output.contrastSamples = await page.evaluate(() => {
      function getBg(el) {
        let cur = el;
        while (cur) {
          const bg = getComputedStyle(cur).backgroundColor;
          if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
          cur = cur.parentElement;
        }
        return "rgb(255,255,255)";
      }
      const results = [];
      const all = document.querySelectorAll("p, h1, h2, h3, h4, a, span, li, button");
      let count = 0;
      for (const el of all) {
        if (count >= 40) break;
        const text = el.textContent.trim();
        if (!text || text.length < 2) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const style = getComputedStyle(el);
        results.push({
          tag: el.tagName,
          text: text.slice(0, 40),
          color: style.color,
          bg: getBg(el),
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
        });
        count++;
      }
      return results;
    });

    // Screenshot
    await page.screenshot({ path: "/tmp/qa_desktop.png", fullPage: true });

    output.consoleMessages = consoleMessages;
    output.pageErrors = pageErrors;
    output.failedRequests = failedRequests;

    await context.close();
  }

  // ---------- Viewport screenshots ----------
  output.viewportResults = [];
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    try {
      await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
      const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      await page.screenshot({ path: `/tmp/qa_${vp.name}.png`, fullPage: true });
      output.viewportResults.push({ name: vp.name, hasHorizontalScroll });
    } catch (e) {
      output.viewportResults.push({ name: vp.name, error: e.message });
    }
    await context.close();
  }

  await browser.close();

  // Compute contrast ratios
  output.contrastComputed = output.contrastSamples.map((s) => {
    const fg = parseRgb(s.color);
    const bg = parseRgb(s.bg);
    if (!fg || !bg) return { ...s, ratio: null };
    const ratio = contrastRatio(fg.slice(0, 3), bg.slice(0, 3));
    const fontSizePx = parseFloat(s.fontSize);
    const isBold = parseInt(s.fontWeight) >= 700;
    const isLarge = fontSizePx >= 24 || (fontSizePx >= 18.66 && isBold);
    const required = isLarge ? 3 : 4.5;
    return { ...s, ratio: Math.round(ratio * 100) / 100, required, passes: ratio >= required };
  });

  console.log(JSON.stringify(output, null, 2));
})();
