const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const { createArtifactRun } = require("./artifacts");
const { prepareTarget, resolveTarget } = require("./targets");
const { VERSION, CHECKLIST, VIEWPORTS, completeChecks } = require("./smoke-contract");

const COLLECTOR = "qa-runner/smoke-check";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceHash = () => hash(fs.readFileSync(__filename) + fs.readFileSync(path.join(__dirname, "smoke-contract.js")));
const message = (error) => String(error.message || error).split("\n")[0];
const reference = (pointer) => `audit.json#/${pointer}`;
const unsafeLink = /(?:logout|log-out|signout|sign-out|delete|remove|unsubscribe|purchase|checkout|confirm|activate|revoke|reset|terminate)/i;
const LIMITS = Object.freeze({ links: 80, linkConcurrency: 1, confirmations: 8, keyboard: 40, scrollSteps: 100, settleMs: 350 });
const menuScreenshot = (viewport) => viewport.name === "mobile375" ? "shot-mobile-menu.png" : `shot-${viewport.name}-menu.png`;
const artifactNames = () => ["page.html", "headers.txt", "link-sweep.txt", "shot-focus.png", "shot-dark.png", "shot-desktop-viewport.png",
  "shot-first-tab.png", "collector-source.js", "contract-source.js",
  ...VIEWPORTS.flatMap((viewport) => [viewport.screenshot, menuScreenshot(viewport)])];

// Installed before any target script. Session windows, not an all-time shift sum.
function installObservers() {
  const state = window.__qaSmoke = {
    startedAt: performance.now(), clsSupported: false, shifts: [], resources: [],
  };
  if (typeof PerformanceObserver !== "function") return;
  state.clsSupported = PerformanceObserver.supportedEntryTypes?.includes("layout-shift") === true;
  if (state.clsSupported) {
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        state.shifts.push({
          value: entry.value, startTime: entry.startTime, hadRecentInput: entry.hadRecentInput,
          sources: (entry.sources || []).map((source) => ({
            node: source.node?.tagName || null,
            previousRect: source.previousRect?.toJSON?.() || null,
            currentRect: source.currentRect?.toJSON?.() || null,
          })),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  }
}

function inspectDOM() {
  const visible = (element) => {
    const style = getComputedStyle(element);
    return element.getClientRects().length > 0 && style.display !== "none" &&
      style.visibility !== "hidden" && style.visibility !== "collapse" &&
      !element.closest("[hidden],[inert],[aria-hidden='true']");
  };
  const describe = (element) => ({
    tag: element.tagName.toLowerCase(), id: element.id, role: element.getAttribute("role"),
    text: (element.textContent || "").trim().slice(0, 160), visible: visible(element),
    selector: element.id ? `#${CSS.escape(element.id)}` : `${element.tagName.toLowerCase()}:nth-of-type(${[...(element.parentElement?.children || [])].filter((sibling) => sibling.tagName === element.tagName).indexOf(element) + 1})`,
  });
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]")].map((element) => ({
    ...describe(element), level: element.getAttribute("aria-level") || Number(element.tagName.slice(1)),
  }));
  const images = [...document.images].map((element) => ({
    ...describe(element), src: element.currentSrc || element.src, alt: element.getAttribute("alt"),
    complete: element.complete, naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight,
    loading: element.loading, width: element.width, height: element.height,
    widthAttribute: element.getAttribute("width"), heightAttribute: element.getAttribute("height"),
    srcset: element.srcset, sizes: element.sizes, srcAttribute: element.getAttribute("src"),
    format: (element.currentSrc || element.src).match(/\.(avif|webp|jpe?g|png|gif|svg)(?:[?#]|$)/i)?.[1] || "unknown",
    intrinsicAspect: element.naturalHeight ? element.naturalWidth / element.naturalHeight : null,
    renderedAspect: element.height ? element.width / element.height : null,
    linked: !!element.closest("a,button"), role: element.getAttribute("role"),
  }));
  const controls = [...document.querySelectorAll("input,select,textarea,button")].map((element) => ({
    ...describe(element), type: element.type, disabled: element.disabled,
    name: element.name, required: element.required,
    title: element.title,
    autocomplete: element.autocomplete, labels: [...(element.labels || [])].map((label) => label.textContent.trim()),
    ariaLabel: element.getAttribute("aria-label"), ariaLabelledby: element.getAttribute("aria-labelledby"),
    ariaPressed: element.getAttribute("aria-pressed"), ariaChecked: element.getAttribute("aria-checked"),
    form: element.form?.getAttribute("action") || null,
  }));
  const widgets = ["[role=dialog],dialog", "[aria-expanded]", "[role=tab]", "details", "select",
    "input[type=search],[role=search]", "form", "[role=menu]"].map((selector) => ({
    selector, elements: [...document.querySelectorAll(selector)].map((element) => ({
      ...describe(element), disabled: element.disabled === true || element.getAttribute("aria-disabled") === "true",
      expanded: element.getAttribute("aria-expanded"),
    })),
  }));
  const overflow = [...document.body.querySelectorAll("*")].filter((element) => {
    if (!visible(element) || getComputedStyle(element).position === "fixed") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && (rect.right > innerWidth + 2 || rect.left < -2);
  }).slice(0, 40).map(describe);
  const aria = [...document.querySelectorAll("[role],[aria-label],[aria-labelledby],[aria-describedby],[aria-controls],[aria-expanded],[aria-hidden],[aria-pressed],[aria-checked],[aria-haspopup]")].map((element) => ({
    ...describe(element),
    attributes: [...element.attributes].filter((attribute) => attribute.name === "role" || attribute.name.startsWith("aria-")).map((attribute) => ({ name: attribute.name, value: attribute.value })),
    missingReferences: ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns"].flatMap((attribute) =>
      (element.getAttribute(attribute) || "").split(/\s+/).filter(Boolean).filter((id) => !document.getElementById(id)).map((id) => ({ attribute, id }))),
  }));
  const text = document.body.innerText;
  const idGroups = new Map();
  for (const element of document.querySelectorAll("[id]")) {
    if (!idGroups.has(element.id)) idGroups.set(element.id, []);
    idGroups.get(element.id).push(describe(element));
  }
  const nameSources = (element) => {
    const labelledby = (element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
    return { ariaLabel: element.getAttribute("aria-label"), labelledby, title: element.title,
      text: element.textContent.trim().slice(0, 200),
      imageAlts: [...element.querySelectorAll("img[alt]")].map((image) => image.alt),
      value: element.value || null };
  };
  const components = {
    modal: [...document.querySelectorAll("dialog,[role=dialog],[role=alertdialog]")],
    megaMenu: [...new Set([...document.querySelectorAll("[role=menu],[role=menubar],nav [aria-expanded],[aria-haspopup=menu]"),
      ...[...document.querySelectorAll("button[aria-expanded][aria-controls]")].filter((button) => {
        const target = document.getElementById(button.getAttribute("aria-controls"));
        return target && (target.tagName === "NAV" || ["menu", "navigation"].includes(target.getAttribute("role")));
      })])],
    faq: [...document.querySelectorAll("details,[id*=faq i],[class*=faq i]")],
    expandAll: [...document.querySelectorAll("button")].filter((element) => /expand all|collapse all/i.test(element.textContent)),
    language: [...document.querySelectorAll("select,[aria-haspopup=listbox],[id*=language i],[class*=language i]")],
    search: [...document.querySelectorAll("[role=search],input[type=search],[id*=search i]")],
    login: [...document.querySelectorAll("input[type=password],[id*=login i],[class*=login i]")],
    validation: [...document.querySelectorAll("form")],
    loading: [...document.querySelectorAll("[aria-busy],[role=status],[role=alert],progress")],
  };
  const outsideLandmarks = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const element = walker.currentNode.parentElement;
    const content = walker.currentNode.textContent.trim();
    if (content && element && visible(element) && !element.closest("script,style,noscript,template,header,nav,main,footer,aside,[role=banner],[role=navigation],[role=main],[role=contentinfo],[role=complementary],[role=dialog],[role=alertdialog]")) {
      outsideLandmarks.push({ ...describe(element), text: content.slice(0, 160) });
    }
  }
  return {
    title: document.title, lang: document.documentElement.lang,
    metadata: [...document.querySelectorAll("meta")].map((element) => ({
      name: element.name || element.httpEquiv || element.getAttribute("property"), content: element.content,
    })),
    canonical: document.querySelector("link[rel=canonical]")?.href || null,
    headings, landmarks: [...document.querySelectorAll("header,nav,main,footer,aside,[role=main],[role=navigation]")].map(describe),
    images, controls, widgets, aria,
    positiveTabindex: [...document.querySelectorAll("[tabindex]")].filter((element) => element.tabIndex > 0).map((element) => ({ ...describe(element), tabindex: element.tabIndex })),
    duplicateIds: [...idGroups].filter(([, elements]) => elements.length > 1).map(([id, elements]) => ({ id, count: elements.length, elements })),
    invalidLists: [...document.querySelectorAll("ul,ol")].flatMap((list) => [...list.children]
      .filter((element) => !["LI", "SCRIPT", "TEMPLATE"].includes(element.tagName)).map((element) => ({ list: describe(list), child: describe(element) }))),
    outsideLandmarks: { count: outsideLandmarks.length, samples: outsideLandmarks.slice(0, 100) },
    buttons: [...document.querySelectorAll("button,input[type=button],input[type=submit],input[type=reset],[role=button]")].map((element) => ({ ...describe(element), names: nameSources(element) })),
    frames: [...document.querySelectorAll("iframe,frame")].map((element) => ({ ...describe(element), title: element.title, src: element.src })),
    liveRegions: [...document.querySelectorAll("[aria-live],[role=status],[role=alert]")].map((element) => ({ ...describe(element), live: element.getAttribute("aria-live"), atomic: element.getAttribute("aria-atomic"), busy: element.getAttribute("aria-busy") })),
    components: Object.fromEntries(Object.entries(components).map(([name, elements]) => [name, elements.map((element) => ({
      ...describe(element), disabled: element.disabled === true || element.getAttribute("aria-disabled") === "true",
    }))])),
    activeLinks: [...document.querySelectorAll("a[aria-current],nav a.active")].map((element) => ({
      ...describe(element), href: element.href, current: element.getAttribute("aria-current"),
      matchesInitialLocation: element.href === location.href,
    })),
    copy: { length: text.length, text: text.slice(0, 100000), truncated: text.length > 100000,
      placeholders: text.match(/.{0,60}(?:lorem ipsum|\bTODO\b|\bTBD\b|FIXME|placeholder|coming soon|under construction|\bundefined\b|\[object Object\]).{0,60}/gi) || [],
      doubleSpaceCandidates: text.match(/.{0,30}\S {2,}\S.{0,30}/g)?.slice(0, 50) || [],
      repeatedLines: [...new Set(text.split("\n").map((line) => line.trim()).filter((line, index, lines) => line.length > 15 && lines.indexOf(line) < index))].slice(0, 50),
      headingCapitalization: headings.filter((heading) => heading.visible).map((heading) => ({ text: heading.text, uppercase: heading.text === heading.text.toUpperCase() })),
      copyright: text.match(/.{0,60}(?:©|copyright).{0,100}/gi) || [] },
    footers: [...document.querySelectorAll("footer,[role=contentinfo]")].map((element) => ({
      ...describe(element), text: element.innerText.slice(0, 10000),
      links: [...element.querySelectorAll("a[href]")].map((link) => ({ text: link.innerText, href: link.href })),
    })),
    forms: [...document.forms].map((form) => ({
      action: form.action, method: form.method, autocomplete: form.autocomplete,
      inputs: [...form.elements].map((element) => ({ tag: element.tagName, type: element.type, name: element.name, required: element.required })),
    })),
    links: [...document.querySelectorAll("a[href]")].map((element) => ({
      raw: element.getAttribute("href"), resolved: element.href, text: element.textContent.trim().slice(0, 160),
      target: element.target, rel: element.rel, download: element.hasAttribute("download"),
      fragmentTargetExists: (() => {
        try {
          const fragment = decodeURIComponent(new URL(element.href).hash.slice(1));
          return !!fragment && (!!document.getElementById(fragment) || [...document.getElementsByName(fragment)].some((entry) => entry.tagName === "A"));
        } catch { return false; }
      })(),
    })),
    media: [...document.querySelectorAll("audio,video,source,iframe,object,embed")].map((element) => ({
      ...describe(element), src: element.currentSrc || element.src || element.data || null,
      readyState: element.readyState ?? null, networkState: element.networkState ?? null,
      error: element.error ? { code: element.error.code, message: element.error.message } : null,
      autoplay: element.autoplay ?? null, muted: element.muted ?? null,
    })),
    viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
    overflow,
    mixedContent: [...document.querySelectorAll("[src],link[href]")].map((element) => element.src || element.href)
      .filter((url) => location.protocol === "https:" && /^http:/.test(url)),
    insecureOutboundLinks: [...document.querySelectorAll("a[href]")].filter((element) => /^http:/.test(element.href)).map((element) => ({ ...describe(element), href: element.href })),
    secureContext: isSecureContext, protocol: location.protocol,
    fonts: document.fonts ? { status: document.fonts.status, entries: [...document.fonts].map((font) => ({ family: font.family, status: font.status })) } : null,
    navigation: performance.getEntriesByType("navigation").map((entry) => entry.toJSON()),
    resources: performance.getEntriesByType("resource").map((entry) => entry.toJSON()),
  };
}

async function safeUI(page, run, timeout, viewport) {
  const inventory = await page.evaluate(() => {
    const visible = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
    const menus = [...document.querySelectorAll("button[aria-expanded][aria-controls]")].map((button, index) => {
      const target = document.getElementById(button.getAttribute("aria-controls"));
      return {
        index, id: button.id, text: button.getAttribute("aria-label") || button.textContent.trim(),
        disabled: button.disabled || button.getAttribute("aria-disabled") === "true", visible: visible(button),
        inForm: !!button.form,
        target: target ? { id: target.id, tag: target.tagName, role: target.getAttribute("role"), visible: visible(target) } : null,
      };
    });
    const skips = [...document.querySelectorAll("a[href^='#']")].map((anchor, index) => ({
      index, raw: anchor.getAttribute("href"), text: anchor.innerText || anchor.getAttribute("aria-label") || "",
      inlineHandler: !!anchor.getAttribute("onclick"),
      exists: !!document.getElementById(anchor.getAttribute("href").slice(1)),
    })).filter((link) => /skip/i.test(link.text));
    return { menus, skips };
  });
  const result = { inventory, menu: null, skip: null, theme: null };
  const candidate = inventory.menus.find((entry) => !entry.disabled && entry.visible && !entry.inForm && entry.target &&
    (entry.target.tag === "NAV" || ["menu", "navigation"].includes(entry.target.role)) && !unsafeLink.test(entry.text));
  if (candidate) {
    const button = page.locator("button[aria-expanded][aria-controls]").nth(candidate.index);
    const before = await button.getAttribute("aria-expanded");
    try {
      await button.click({ timeout });
      const after = await button.getAttribute("aria-expanded");
      const target = page.locator(`[id=${JSON.stringify(candidate.target.id)}]`);
      const targetVisible = await target.isVisible();
      const screenshot = menuScreenshot(viewport);
      await page.screenshot({ path: run.file(screenshot), timeout });
      result.menu = { id: candidate.id, target: candidate.target, before, after, targetVisible, screenshot, restored: false };
    } catch (error) {
      result.menu = { error: message(error), before };
    } finally {
      if (await button.count() && await button.getAttribute("aria-expanded") !== before) {
        await button.click({ timeout }).catch(() => {});
      }
      if (result.menu) result.menu.restored = await button.getAttribute("aria-expanded").catch(() => null) === before;
    }
  }
  const skip = viewport.name === VIEWPORTS[0].name && inventory.skips.find((entry) => entry.exists && !entry.inlineHandler && entry.raw.length > 1);
  if (skip) {
    try {
      const anchor = page.locator("a[href^='#']").nth(skip.index);
      await anchor.focus();
      await page.keyboard.press("Enter");
      result.skip = { ...skip, observed: await page.evaluate(() => ({
        hash: location.hash, activeTag: document.activeElement.tagName, activeId: document.activeElement.id, scrollY,
      })) };
    } catch (error) {
      result.skip = { ...skip, error: message(error) };
    }
  }
  if (viewport.name !== VIEWPORTS[0].name) return result;
  try {
    await page.evaluate(() => scrollTo(0, 0));
    const colors = () => ({ preference: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      body: { color: getComputedStyle(document.body).color, background: getComputedStyle(document.body).backgroundColor },
      root: { color: getComputedStyle(document.documentElement).color, background: getComputedStyle(document.documentElement).backgroundColor } });
    await page.emulateMedia({ colorScheme: "light" });
    const light = await page.evaluate(colors);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(100);
    const dark = await page.evaluate(colors);
    await page.screenshot({ path: run.file("shot-dark.png"), fullPage: true, timeout });
    result.theme = { light, dark, screenshot: "shot-dark.png", changed: JSON.stringify(light.body) !== JSON.stringify(dark.body) };
  } catch (error) {
    result.theme = { error: message(error) };
  } finally {
    await page.emulateMedia({ colorScheme: "light" });
  }
  return result;
}

function clsMeasurement(state) {
  if (!state?.clsSupported) return { supported: false, value: null, shifts: state?.shifts || [], reason: "layout-shift PerformanceObserver unsupported" };
  let max = 0, value = 0, first = null, previous = null;
  for (const entry of state.shifts.filter((entry) => !entry.hadRecentInput)) {
    if (first === null || entry.startTime - previous >= 1000 || entry.startTime - first >= 5000) {
      first = entry.startTime;
      value = 0;
    }
    value += entry.value;
    previous = entry.startTime;
    max = Math.max(max, value);
  }
  return { supported: true, value: max, shifts: state.shifts, scope: "Early navigation through bounded scroll; session windows <5s, gap <1s; excludes recent input" };
}

async function recordKeyboard(page, run, timeout) {
  const steps = [];
  let navigationFocusScreenshot = null;
  for (let index = 0; index < LIMITS.keyboard; index++) {
    await page.keyboard.press("Tab");
    steps.push(await page.evaluate((index) => {
      const element = document.activeElement;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        step: index + 1, key: "Tab", tag: element.tagName, id: element.id, role: element.getAttribute("role"),
        text: (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 120),
        href: element.getAttribute("href"), type: element.type || null,
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth,
        inNavigation: !!element.closest("nav,[role=navigation],[role=menubar]"),
        tabindex: element.tabIndex,
        outline: { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor, offset: style.outlineOffset },
        boxShadow: style.boxShadow, focusVisible: element.matches(":focus-visible"),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        url: location.href,
      };
    }, index));
    if (index === 0) await page.screenshot({ path: run.file("shot-first-tab.png"), timeout });
    if (!navigationFocusScreenshot && steps[index].inNavigation && ["A", "BUTTON", "INPUT", "SELECT"].includes(steps[index].tag)) {
      await page.screenshot({ path: run.file("shot-focus.png"), timeout });
      navigationFocusScreenshot = { step: index + 1, screenshot: "shot-focus.png" };
    }
  }
  await page.keyboard.press("Shift+Tab");
  const reverse = await page.evaluate(() => ({ tag: document.activeElement.tagName, id: document.activeElement.id }));
  if (!navigationFocusScreenshot) await page.screenshot({ path: run.file("shot-focus.png"), timeout });
  return { steps, firstTab: steps[0], firstTabScreenshot: "shot-first-tab.png", navigationFocusScreenshot,
    reverse, screenshot: "shot-focus.png", activated: false, reason: "Tab and Shift+Tab only; never submits forms or activates application actions" };
}

async function sweepLinks(context, links, baseUrl, timeout, onProgress) {
  const records = [];
  const seen = new Set();
  let confirmations = 0;
  for (const link of links) {
    if (!link.raw?.trim()) {
      if (!seen.has("empty:")) records.push({ raw: link.raw, status: "REVIEW", reason: "Empty href resolves to the current document; intent needs review" });
      seen.add("empty:");
      continue;
    }
    let parsed;
    try {
      // URL('http://', base) must remain a syntax failure, not an excluded scheme.
      parsed = new URL(link.raw, baseUrl);
    } catch {
      if (!seen.has(`invalid:${link.raw}`)) records.push({ raw: link.raw, status: "FAIL", reason: "Malformed URL" });
      seen.add(`invalid:${link.raw}`);
      continue;
    }
    if (seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      records.push({ url: parsed.href, status: "NOT APPLICABLE", reason: "Non-HTTP link; no external application launched" });
      continue;
    }
    if (parsed.origin === new URL(baseUrl).origin && parsed.pathname === new URL(baseUrl).pathname && parsed.search === new URL(baseUrl).search && parsed.hash) {
      records.push({ url: parsed.href, status: link.fragmentTargetExists ? "PASS" : "FAIL",
        reason: link.fragmentTargetExists ? "Same-page anchor target exists" : "Same-page anchor target missing", fragment: parsed.hash });
      continue;
    }
    if (unsafeLink.test(parsed.pathname + parsed.search) || parsed.username || parsed.password || link.download || parsed.search) {
      records.push({ url: parsed.href, status: "NOT TESTED", reason: "Potential action, credentials, download or query URL; skipped to avoid state changes" });
      continue;
    }
    if (records.filter((record) => record.method).length >= LIMITS.links) {
      records.push({ url: parsed.href, status: "NOT TESTED", reason: `Bounded sweep limit ${LIMITS.links}` });
      continue;
    }
    const record = { url: parsed.href, method: "HEAD", status: "REVIEW" };
    onProgress(`Checking link ${parsed.href}`);
    try {
      let destination = parsed.href;
      record.redirects = [];
      for (let hop = 0; hop <= 5; hop++) {
        const response = await context.request.head(destination, { timeout: Math.min(timeout, 5000), maxRedirects: 0 });
        const status = response.status();
        record.httpStatus = status;
        record.finalUrl = response.url();
        const location = response.headers().location;
        await response.dispose();
        if ([301, 302, 303, 307, 308].includes(status) && location) {
          const next = new URL(location, destination);
          record.redirects.push({ from: destination, status, to: next.href });
          if (!["http:", "https:"].includes(next.protocol) || next.username || next.password || next.search || unsafeLink.test(next.pathname) || hop === 5) {
            record.reason = "Redirect outside safe read-only scope or redirect bound reached";
            record.skipConfirmation = true;
            break;
          }
          destination = next.href;
          continue;
        }
        if (status < 300) record.status = "PASS";
        else if (status < 400) record.reason = "Redirect or conditional response without a followed destination";
        else if ([401, 403, 405, 429].includes(status)) record.reason = "Access restriction, bot protection, rate limit or HEAD unsupported; not a proven broken link";
        else if (status >= 500) record.reason = "Server error requires browser confirmation";
        else record.reason = "HTTP error requires browser confirmation";
        break;
      }
    } catch (error) {
      record.error = message(error);
      record.reason = "Request failure requires bounded browser confirmation";
    }
    if (record.status !== "PASS" && !record.skipConfirmation && confirmations < LIMITS.confirmations) {
      confirmations++;
      const confirmation = await context.newPage();
      try {
        const response = await confirmation.goto(parsed.href, { waitUntil: "domcontentloaded", timeout: Math.min(timeout, 5000) });
        record.browser = { status: response?.status() ?? null, finalUrl: confirmation.url(), title: await confirmation.title() };
        if (response && [404, 410].includes(response.status())) record.status = "FAIL";
        else if (response && response.status() < 400) record.status = "PASS";
        else record.status = "REVIEW";
      } catch (error) {
        record.browser = { error: message(error) };
        record.status = "REVIEW";
      } finally {
        await confirmation.close();
      }
    }
    records.push(record);
  }
  return { records, totalAnchors: links.length, uniqueCount: seen.size,
    uniqueHttpCount: [...seen].filter((url) => /^https?:/.test(url)).length, limits: LIMITS, browserConfirmations: confirmations };
}

async function observeTransports(context, audit, timeout) {
  if (audit.localTarget) return [{ status: "NOT APPLICABLE", reason: "Local preview does not represent production HTTP/HTTPS infrastructure" }];
  const target = new URL(audit.effectiveUrl);
  if (target.username || target.password || target.search || unsafeLink.test(target.pathname)) {
    return [{ status: "NOT TESTED", reason: "Additional protocol requests skipped for credential/query/action-looking target" }];
  }
  const observations = [];
  for (const protocol of ["http:", "https:"]) {
    const destination = new URL(target);
    destination.protocol = protocol;
    try {
      const response = await context.request.head(destination.href, { timeout: Math.min(timeout, 5000), maxRedirects: 0 });
      observations.push({
        method: "HEAD", url: destination.href, status: response.status(), finalUrl: response.url(),
        headers: (await response.headersArray()).map((header) => ({
          name: header.name, value: header.name.toLowerCase() === "set-cookie" ? "[redacted]" : header.value,
        })),
      });
      await response.dispose();
    } catch (error) {
      observations.push({ method: "HEAD", url: destination.href, error: message(error), status: null });
    }
  }
  return observations;
}

function deriveChecks(audit) {
  const results = [];
  const add = (id, status, observed, pointer, reason) => results.push({
    id, status, observed: typeof observed === "string" ? observed : JSON.stringify(observed),
    detail: reason || "", ...(reason ? { reason } : {}), evidence: reference(pointer),
  });
  const samples = audit.viewports.filter((entry) => entry.dom);
  const desktop = audit.viewports[0]?.dom ? audit.viewports[0] : null;
  const all = (id, predicate, pointer, description) => {
    const defects = samples.filter(predicate).map((entry) => entry.name);
    const scrollLimited = ["runtime", "network", "images"].includes(id) && samples.some((entry) => !entry.scrollCoverage?.complete);
    add(id, defects.length ? "FAIL" : samples.length === VIEWPORTS.length && !scrollLimited ? "PASS" : "NOT TESTED",
      { scope: samples.map((entry) => entry.name), affected: defects, missing: VIEWPORTS.filter((viewport) => !samples.some((entry) => entry.name === viewport.name)).map((entry) => entry.name) },
      pointer, description + (samples.length !== VIEWPORTS.length || scrollLimited ? "; partial coverage: see per-viewport errors/scroll bounds" : ""));
  };
  if (audit.viewports.length) {
    const loads = audit.viewports.map((entry) => ({ name: entry.name, status: entry.httpStatus, error: entry.error }));
    add("load", loads.some((entry) => entry.status >= 400) ? "FAIL" : samples.length === VIEWPORTS.length ? "PASS" : "NOT TESTED", loads, "viewports", "Real navigation at every required viewport");
  }
  if (samples.length) {
    all("runtime", (entry) => entry.pageErrors.length || entry.console.some((item) => item.type === "error" && !item.collectorBlocked), "viewports", "Load and scroll console errors and uncaught exceptions");
    const warnings = samples.flatMap((entry) => entry.console.filter((item) => item.type === "warning").map((item) => ({ viewport: entry.name, ...item })));
    add("warnings", warnings.length ? "REVIEW" : samples.length === VIEWPORTS.length ? "PASS" : "NOT TESTED", warnings, "viewports", "Warnings recorded separately; advisory messages are not automatically product failures");
    all("network", (entry) => entry.failedRequests.some((request) => !request.collectorBlocked) || entry.responses.some((item) => item.status >= 400), "viewports", "Failed requests and HTTP errors across load and scroll");
    for (const id of ["runtime", "network"]) {
      const result = results.find((entry) => entry.id === id);
      if (result.status === "PASS" && samples.some((entry) => entry.failedRequests.some((request) => request.collectorBlocked))) {
        result.status = "REVIEW";
        result.reason = "Read-only collector policy intentionally blocked requests; recorded policy failures are not asserted as product defects";
      }
    }
    all("images", (entry) => entry.dom.images.some((image) => image.visible && image.complete && !image.naturalWidth), "viewports", "Visible image decode after bounded scroll");
    const unfinished = samples.flatMap((entry) => entry.dom.images.filter((image) => image.visible && !image.complete).map((image) => ({ viewport: entry.name, ...image })));
    if (unfinished.length && !results.find((entry) => entry.id === "images" && entry.status === "FAIL")) {
      const imageCheck = results.find((entry) => entry.id === "images");
      imageCheck.status = "REVIEW";
      imageCheck.observed = JSON.stringify({ unfinished, scope: samples.map((entry) => entry.name) });
      imageCheck.reason = "Images still loading at the end of bounded observation; no successful decode claimed";
    }
    const media = samples.flatMap((entry) => entry.dom.media.map((element) => ({ viewport: entry.name, ...element })));
    add("media", media.some((entry) => entry.error) ? "FAIL" : media.length ? "REVIEW" : "NOT APPLICABLE", media, "viewports",
      media.length ? "Embedded media source/state/error inventory; playback and external embeds not activated" : "No media/embed elements observed");
    all("overflow", (entry) => entry.dom.viewport.scrollWidth > entry.width + 2, "viewports", "Measured document horizontal overflow at exact viewport widths");
    add("screenshots", audit.viewports.every((entry) => entry.screenshot && audit.files[entry.screenshot]) ? "PASS" : "NOT TESTED",
      audit.viewports.map((entry) => ({ name: entry.name, screenshot: entry.screenshot, error: entry.screenshotError })), "viewports");
    const cls = samples.map((entry) => ({ name: entry.name, ...entry.cls }));
    add("cls", cls.some((entry) => entry.value > 0.1) ? "FAIL" : cls.some((entry) => !entry.supported) || samples.length !== VIEWPORTS.length || samples.some((entry) => !entry.scrollCoverage?.complete) ? "NOT TESTED" : "PASS",
      cls, "viewports", "Observed early-session CLS, not a field Core Web Vitals assessment");
  }
  if (desktop) {
    const dom = desktop.dom;
    add("title", dom.title.trim() ? "PASS" : "FAIL", dom.title, "viewports/0/dom/title");
    add("language", dom.lang ? "PASS" : "FAIL", dom.lang || "(missing)", "viewports/0/dom/lang");
    const visibleHeadings = dom.headings.filter((entry) => entry.visible);
    const h1 = visibleHeadings.filter((entry) => Number(entry.level) === 1);
    const jumps = visibleHeadings.filter((entry, index) => index && Number(entry.level) > Number(visibleHeadings[index - 1].level) + 1);
    const invalidLevels = visibleHeadings.filter((entry) => !Number.isInteger(Number(entry.level)) || Number(entry.level) < 1);
    add("headings", h1.length === 1 && !jumps.length && !invalidLevels.length ? "PASS" : "REVIEW",
      { visible: visibleHeadings, hidden: dom.headings.filter((entry) => !entry.visible), h1Count: h1.length, jumps }, "viewports/0/dom/headings",
      "Visible heading hierarchy measured; hidden headings excluded; editorial correctness needs manual review");
    const mains = dom.landmarks.filter((entry) => entry.visible && (entry.tag === "main" && !entry.role || entry.role === "main"));
    add("landmarks", mains.length === 1 ? "PASS" : "REVIEW", dom.landmarks, "viewports/0/dom/landmarks");
    add("metadata", "REVIEW", { metadata: dom.metadata, canonical: dom.canonical }, "viewports/0/dom", "Inventory only; intended indexing/social metadata requires product context");
    add("page-identity", "REVIEW", { original: audit.url, effective: audit.effectiveUrl, final: desktop.finalUrl,
      status: desktop.httpStatus, protocol: dom.protocol, canonical: dom.canonical, headers: audit.headers, localPreview: audit.localTarget },
    "viewports/0", "Real status/protocol/final URL, canonical and response-header observations; intended redirects/canonical require application context");
    const legacyMetadata = dom.metadata.filter((entry) => /x-ua-compatible/i.test(entry.name || ""));
    add("legacy-metadata", legacyMetadata.length ? "REVIEW" : "NOT APPLICABLE", legacyMetadata, "viewports/0/dom/metadata", "X-UA-Compatible inventory only; no compliance failure inferred");
    add("copy", dom.copy.placeholders.length ? "REVIEW" : "PASS", dom.copy, "viewports/0/dom/copy", "Rendered candidate scan only; absence does not prove editorial quality");
    add("copy-observations", "REVIEW", dom.copy, "viewports/0/dom/copy", "Capitalization, repeated lines, double-space candidates and copyright text are contextual observations; an old year is not automatically noncompliant");
    add("footer", dom.footers.length ? "REVIEW" : "NOT APPLICABLE", dom.footers, "viewports/0/dom/footers", dom.footers.length ? "Visible footer content and links recorded for contextual review" : "No footer/contentinfo element observed");
    add("aria", dom.aria.some((entry) => entry.missingReferences.length) ? "FAIL" : "PASS", dom.aria, "viewports/0/dom/aria",
      "Live ARIA attribute/ID-reference inventory; full axe results provide role/name validation");
    add("tabindex", dom.positiveTabindex.some((entry) => entry.visible) ? "FAIL" : dom.positiveTabindex.length ? "REVIEW" : "PASS", dom.positiveTabindex, "viewports/0/dom/positiveTabindex", "Positive tabindex count/selectors recorded; no altered tab order accepted as a default");
    add("landmark-content", dom.outsideLandmarks.count ? "REVIEW" : "PASS", dom.outsideLandmarks, "viewports/0/dom/outsideLandmarks", "Outside-landmark visible text is a best-practice/context review, not automatically a WCAG defect");
    add("lists", dom.invalidLists.length ? "FAIL" : "PASS", dom.invalidLists, "viewports/0/dom/invalidLists", "Direct non-li children of ul/ol are inventoried; correctly nested lists within li are excluded");
    add("duplicate-ids", dom.duplicateIds.length ? "REVIEW" : "PASS", dom.duplicateIds, "viewports/0/dom/duplicateIds", "Duplicate IDs recorded with counts/selectors; correlate actual ARIA collisions and axe rule tags before assigning WCAG impact");
    add("live-regions", dom.liveRegions.length ? "REVIEW" : "NOT APPLICABLE", { count: dom.liveRegions.length, elements: dom.liveRegions }, "viewports/0/dom/liveRegions", "Live-region presence/states only; actual announcements were NOT TESTED with a real screen reader");
    add("frames", dom.frames.some((entry) => !entry.title?.trim()) ? "REVIEW" : dom.frames.length ? "PASS" : "NOT APPLICABLE", dom.frames, "viewports/0/dom/frames", "Frame title attribute inventory; axe supplies accessible-name validation");
    add("active-navigation", dom.activeLinks.length ? "REVIEW" : "NOT APPLICABLE", dom.activeLinks, "viewports/0/dom/activeLinks", "Initial active-link/anchor mismatches are contextual, not automatic failures");
    const fields = dom.controls.filter((control) => control.visible && !control.disabled && !["hidden", "submit", "reset", "button", "image"].includes(control.type) && control.tag !== "button");
    const unlabeled = fields.filter((control) => !control.labels.some(Boolean) && !control.ariaLabel?.trim() && !control.ariaLabelledby?.trim() && !control.title?.trim());
    add("labels", fields.length ? unlabeled.length ? "FAIL" : "PASS" : "NOT APPLICABLE", { fields, unlabeled }, "viewports/0/dom/controls",
      "Live label/ARIA name source inventory; axe checks referenced accessible-name semantics");
    const visibleImages = dom.images.filter((image) => image.visible);
    const missing = visibleImages.filter((image) => image.alt === null);
    add("alt", visibleImages.length ? missing.length ? "FAIL" : "PASS" : "NOT APPLICABLE", { count: visibleImages.length, hidden: dom.images.length - visibleImages.length, missing }, "viewports/0/dom/images",
      "Attribute presence only; decorative/informative suitability requires manual assessment");
    add("alt-context", dom.images.length ? "REVIEW" : "NOT APPLICABLE", dom.images, "viewports/0/dom/images", "Descriptive vs decorative alt, linked logos and image purpose require context; empty alt is not automatically acceptable");
    add("image-practices", dom.images.length ? "REVIEW" : "NOT APPLICABLE", dom.images, "viewports/0/dom/images", "Natural/rendered dimensions, aspect ratios, width/height attributes, srcset, loading and format inventoried; no missing lazy/WebP/AVIF attribute alone is a failure");
    add("forms", dom.forms.length ? "REVIEW" : "NOT APPLICABLE", { forms: dom.forms, controls: dom.controls }, "viewports/0/dom",
      dom.forms.length ? "Labels, types, required/autocomplete and actions inventoried; no authentication, submission or data mutation attempted" : "No forms present");
    const blankTargets = dom.links.filter((link) => link.target === "_blank" && !/\bnoopener\b|\bnoreferrer\b/.test(link.rel));
    add("external-links", blankTargets.length ? "REVIEW" : "PASS", blankTargets, "viewports/0/dom/links",
      "Modern browsers imply noopener; missing explicit rel is contextual, not a proven vulnerability");
    add("outbound-http", dom.insecureOutboundLinks.length ? "REVIEW" : "PASS", dom.insecureOutboundLinks, "viewports/0/dom/insecureOutboundLinks", "HTTP outbound anchors inventoried; destination/deployment context determines impact");
    add("mixed-content", dom.mixedContent.length ? "REVIEW" : "PASS", { protocol: dom.protocol, sources: dom.mixedContent }, "viewports/0/dom/mixedContent",
      dom.protocol === "https:" ? "Passive inventory; browser network evidence records actual failures" : "Non-HTTPS target; no claim of production TLS security");
    const enabledWidgets = dom.widgets.flatMap((widget) => widget.elements).filter((element) => element.visible && !element.disabled);
    add("widgets", enabledWidgets.length ? "NOT TESTED" : "NOT APPLICABLE", dom.widgets, "viewports/0/dom/widgets",
      enabledWidgets.length ? "Custom menus/dialogs/tabs/search need explicitly safe approved interaction flows; no arbitrary application buttons activated" : "Interactive widget absent, hidden or disabled");
    add("headers", "REVIEW", audit.headers, "headers", "Contextual response-header inventory; absence is not automatically a vulnerability");
    add("cookies", "REVIEW", audit.cookies, "cookies", "Cookie names/flags only, values omitted; local HTTP and third-party scope retained; context required");
    add("https", "REVIEW", { protocol: dom.protocol, secureContext: dom.secureContext }, "viewports/0/dom",
      audit.localTarget ? "Local fixture transport is not evidence of production TLS" : "Transport/context observed; certificate configuration and redirect policy require dedicated testing");
    const components = [
      ["modal-keyboard", "modal"], ["mega-menu-keyboard", "megaMenu"], ["faq-keyboard", "faq"],
      ["expand-all", "expandAll"], ["language-dropdown", "language"], ["search-overlay", "search"],
      ["login-modal", "login"], ["validation-states", "validation"], ["loading-success", "loading"],
    ];
    for (const [id, component] of components) {
      const entries = dom.components[component];
      add(id, entries.some((entry) => !entry.disabled) ? "NOT TESTED" : "NOT APPLICABLE", entries, `viewports/0/dom/components/${component}`,
        entries.some((entry) => !entry.disabled) ? "Component inventoried but this exact keyboard/validation/loading journey was not exercised; no safe flow or authorization assumed" : "Component absent or disabled; no interaction claimed");
    }
  }
  if (audit.axe?.results) {
    const axe = audit.axe.results;
    const wcag = axe.violations.filter((rule) => rule.tags.some((tag) => /^wcag/.test(tag)));
    add("axe", wcag.length ? "FAIL" : axe.violations.length || axe.incomplete.length ? "REVIEW" : "PASS", {
      version: axe.testEngine.version, violations: axe.violations.length, incomplete: axe.incomplete.length,
      passes: axe.passes.length, inapplicable: axe.inapplicable.length, tags: audit.axe.tags,
      rules: axe.violations.map((rule) => ({ id: rule.id, axeImpact: rule.impact, category: rule.tags.some((tag) => /^wcag/.test(tag)) ? "WCAG" : "best-practice", tags: rule.tags, nodes: rule.nodes.length })),
    }, "axe/results", "Full axe runtime output retained, including incomplete results. Axe impact is NOT audit severity; best practices are not silently labeled WCAG failures");
    const names = ["button-name", "link-name", "input-button-name", "label", "select-name"];
    const nameFailures = axe.violations.filter((rule) => names.includes(rule.id));
    const nameIncomplete = axe.incomplete.filter((rule) => names.includes(rule.id));
    add("accessible-names", nameFailures.length ? "FAIL" : nameIncomplete.length ? "REVIEW" : "PASS", {
      violations: nameFailures, incomplete: nameIncomplete, passes: axe.passes.filter((rule) => names.includes(rule.id)),
      buttonCount: desktop?.dom.buttons.length || 0, buttons: desktop?.dom.buttons || [],
    }, "axe/results", "Actual axe accessible-name rules plus live button/name-source counts; no real screen-reader reading order claimed");
    const contrast = axe.violations.filter((rule) => rule.id === "color-contrast");
    const incomplete = axe.incomplete.filter((rule) => rule.id === "color-contrast");
    const passes = axe.passes.filter((rule) => rule.id === "color-contrast");
    add("contrast", contrast.length ? "FAIL" : incomplete.length ? "REVIEW" : passes.length ? "PASS" : "NOT APPLICABLE",
      { violations: contrast, incomplete, passes }, "axe/results", "Desktop computed color contrast measured by axe; unresolved/image/gradient states require manual review");
  }
  if (audit.keyboard) {
    const steps = audit.keyboard.steps;
    const reachable = steps.filter((step) => !["BODY", "HTML"].includes(step.tag));
    add("keyboard", reachable.length ? "REVIEW" : desktop?.dom.controls.some((control) => control.visible && !control.disabled) ? "FAIL" : "NOT APPLICABLE",
      audit.keyboard, "keyboard", "40 actual Tab steps plus reverse Tab; focus targets/styles and screenshot captured. Logical order, traps and visible indicator quality remain manual");
    add("focus", reachable.some((step) => !step.visible) ? "FAIL" : reachable.length ? "REVIEW" : "NOT APPLICABLE", audit.keyboard, "keyboard",
      "Actual focus style/rect measurements and shot-focus.png; CSS outlines alone cannot prove visible focus");
  }
  if (audit.links) {
    const entries = audit.links.records;
    add("links", entries.some((entry) => entry.status === "FAIL") ? "FAIL" : entries.some((entry) => ["REVIEW", "NOT TESTED"].includes(entry.status)) ? "REVIEW" : "PASS",
      audit.links, "links", "Unique resolved URLs, bounded HEAD with real-browser confirmation; blocked/403 results are REVIEW, not proven broken");
  }
  const menus = audit.viewports.filter((viewport) => viewport.ui).map((viewport) => ({
    viewport: viewport.name, ...viewport.ui.menu, candidates: viewport.ui.inventory.menus,
  }));
  if (menus.length) {
    const exercised = menus.filter((entry) => entry.before !== undefined && !entry.error);
    const untested = menus.filter((entry) => entry.error || entry.before === undefined && entry.candidates.some((candidate) => candidate.visible && !candidate.disabled));
    add("menu", exercised.some((entry) => entry.before === entry.after) ? "FAIL" : untested.length ? "NOT TESTED" : exercised.length ? "PASS" : "NOT APPLICABLE",
      menus, "viewports", "Safe non-form navigation toggles exercised at every viewport where eligible; absent/disabled menus are not applicable");
  }
  if (audit.ui) {
    const ui = audit.ui;
    if (ui.skip) {
      const firstTab = audit.keyboard?.firstTab;
      const transfer = ui.skip.observed?.activeId === ui.skip.raw.slice(1);
      const firstIsSkip = firstTab?.href === ui.skip.raw && firstTab.visible;
      add("skip", ui.skip.error ? "NOT TESTED" : ui.skip.observed.hash !== ui.skip.raw ? "FAIL" : transfer && firstIsSkip ? "PASS" : "REVIEW",
        { ...ui.skip, firstTab, transfer, firstIsSkip }, "ui/skip",
        ui.skip.error || "First real Tab, skip visibility, target existence and actual Enter focus transfer recorded; hash movement alone is not a pass");
    }
    else add("skip", ui.inventory.skips.length ? "FAIL" : "REVIEW", ui.inventory.skips, "ui/inventory/skips",
      ui.inventory.skips.length ? "Skip-link candidate lacks a valid target or safe activation path" : "No explicit skip-link candidate observed; alternate bypass mechanisms need manual review");
    add("theme", ui.theme?.error ? "NOT TESTED" : "REVIEW", ui.theme || {}, "ui/theme",
      ui.theme?.error || "Actual light/dark media preferences and computed colors retained; visual correctness requires manual assessment");
  }
  if (audit.transport) add("transport-probes", audit.localTarget ? "NOT APPLICABLE" : "REVIEW", audit.transport, "transport", "Bounded HEAD observations for HTTP/HTTPS variants; failures are contextual, not automatic vulnerabilities");
  return completeChecks(results, { reason: audit.error || "Required measurement unavailable or interrupted; see raw collector errors" });
}

async function runSmokeCheck(url, { artifactDirectory, targetIdentity, timeout = 15000, onProgress = () => {} } = {}) {
  const startedAt = new Date().toISOString();
  const audit = {
    collector: COLLECTOR, contractVersion: VERSION, startedAt, endedAt: null, durationMs: 0,
    url: targetIdentity || url, title: null, error: null, errors: [], viewports: [], files: {},
    limits: LIMITS, tools: {}, headers: [], cookies: [], sourceSha256: sourceHash(),
    provenance: { runtime: process.version, collectorPath: __filename, contractPath: path.join(__dirname, "smoke-contract.js"), implementation: "deterministic Playwright collector; no agent judgments accepted as execution" },
    safety: { credentials: false, submissions: false, mutationPayloads: false, permissions: [], interactions: ["Tab", "Shift+Tab", "scroll"], blockedRequests: [] },
  };
  let target, run, browser, context;
  try {
    const resolved = resolveTarget(url);
    audit.url = targetIdentity || resolved.identity;
    audit.localTarget = !!resolved.filePath || /^file:/i.test(targetIdentity || "");
    const candidateRun = createArtifactRun(audit.url, artifactDirectory);
    const ownedFiles = ["audit.json", "smoke-result.json", "audit.json.pending", "smoke-result.json.pending", ...artifactNames()];
    for (const name of ownedFiles) {
      let stat;
      try { stat = fs.lstatSync(candidateRun.file(name)); }
      catch (error) { if (error.code === "ENOENT") continue; throw error; }
      if (!stat.isFile()) throw new Error(`Refusing non-regular Smoke output: ${name}`);
      fs.unlinkSync(candidateRun.file(name));
    }
    run = candidateRun;
    audit.artifactDirectory = run.directory;
    fs.writeFileSync(run.file("collector-source.js"), fs.readFileSync(__filename));
    fs.writeFileSync(run.file("contract-source.js"), fs.readFileSync(path.join(__dirname, "smoke-contract.js")));
    target = await prepareTarget(resolved);
    audit.effectiveUrl = target.url;
    const { chromium } = require("playwright");
    audit.tools.playwright = require("playwright/package.json").version;
    audit.tools.axe = require("axe-core/package.json").version;
    persistAudit(audit, run);
    onProgress("Launching Chromium for deterministic Smoke evidence");
    try {
      browser = await chromium.launch();
    } catch (error) {
      throw new Error(`Chromium launch failed: ${message(error)}. Install with npx playwright install chromium; approve only that setup if required.`);
    }
    audit.tools.browser = browser.version();
    context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, permissions: [] });
    const blockedRequests = new WeakSet();
    // Block outgoing writes even if a target's own handlers attempt an automatic submission.
    await context.route("**/*", async (route) => {
      const request = route.request();
      const requestedUrl = new URL(request.url());
      if (request.isNavigationRequest() && request.url() !== target.url &&
          (unsafeLink.test(requestedUrl.pathname + requestedUrl.search) || requestedUrl.username || requestedUrl.password)) {
        blockedRequests.add(request);
        return route.abort("blockedbyclient");
      }
      if (!["GET", "HEAD"].includes(request.method())) {
        blockedRequests.add(request);
        audit.safety.blockedRequests.push({ url: request.url(), method: request.method(), reason: "Blocked by read-only audit policy" });
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    await context.addInitScript(installObservers);
    for (const viewport of VIEWPORTS) {
      onProgress(`Measuring ${viewport.name} ${viewport.width}×${viewport.height}`);
      const observation = { ...viewport, screenshot: null, console: [], pageErrors: [], failedRequests: [], responses: [], phases: [] };
      audit.viewports.push(observation);
      const page = await context.newPage();
      page.setDefaultTimeout(timeout);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      let phase = "load";
      page.on("console", (entry) => observation.console.push({ phase, type: entry.type(), text: entry.text(), location: entry.location(),
        collectorBlocked: /ERR_BLOCKED_BY_CLIENT|blockedbyclient/i.test(entry.text()) }));
      page.on("pageerror", (error) => observation.pageErrors.push({ phase, message: message(error) }));
      page.on("requestfailed", (request) => observation.failedRequests.push({ phase, url: request.url(), type: request.resourceType(), error: request.failure()?.errorText,
        collectorBlocked: blockedRequests.has(request) }));
      page.on("response", (response) => observation.responses.push({ phase, url: response.url(), status: response.status(), type: response.request().resourceType() }));
      try {
        const response = await page.goto(target.url, { waitUntil: "load", timeout });
        observation.httpStatus = response?.status() ?? null;
        observation.finalUrl = page.url();
        observation.phases.push({ name: "load", at: Date.now() });
        if (audit.viewports.length === 1) {
          audit.title = await page.title();
          audit.headers = response ? (await response.headersArray()).map((entry) => ({
            name: entry.name, value: entry.name.toLowerCase() === "set-cookie" ? "[redacted; flags in cookies inventory]" : entry.value,
          })) : [];
          fs.writeFileSync(run.file("headers.txt"), audit.headers.map((entry) => `${entry.name}: ${entry.name.toLowerCase() === "set-cookie" ? "[redacted; flags in audit.json cookies inventory]" : entry.value}`).join("\n") + "\n");
          fs.writeFileSync(run.file("page.html"), await page.content());
        }
        await page.waitForTimeout(LIMITS.settleMs);
        observation.loadDOM = await page.evaluate(inspectDOM);
        if (audit.viewports.length === 1) {
          await page.screenshot({ path: run.file("shot-desktop-viewport.png"), timeout });
          observation.viewportScreenshot = "shot-desktop-viewport.png";
        }
        phase = "scroll";
        let count = 0, scrollState = null;
        const position = () => ({ y: scrollY, height: document.documentElement.scrollHeight, viewportHeight: innerHeight,
          complete: scrollY + innerHeight >= document.documentElement.scrollHeight - 2 });
        for (; count < LIMITS.scrollSteps; ) {
          count++;
          await page.evaluate(() => scrollBy(0, innerHeight * 0.8));
          await page.waitForTimeout(100);
          scrollState = await page.evaluate(position);
          if (scrollState.complete) {
            await page.waitForTimeout(LIMITS.settleMs);
            scrollState = await page.evaluate(position);
            if (scrollState.complete) break;
          }
        }
        observation.scrollCoverage = { ...scrollState, steps: count, limit: LIMITS.scrollSteps };
        await page.waitForTimeout(LIMITS.settleMs);
        observation.phases.push({ name: "scroll", steps: count, at: Date.now() });
        observation.dom = await page.evaluate(inspectDOM);
        observation.permissions = await page.evaluate(async () => {
          if (!navigator.permissions) return { supported: false };
          const states = {};
          for (const name of ["geolocation", "camera", "microphone", "notifications"]) {
            try { states[name] = (await navigator.permissions.query({ name })).state; }
            catch { states[name] = "unsupported"; }
          }
          return { supported: true, states };
        });
        observation.cls = clsMeasurement(await page.evaluate(() => window.__qaSmoke || null));
        await page.evaluate(() => scrollTo(0, 0));
        try {
          await page.screenshot({ path: run.file(viewport.screenshot), fullPage: true, timeout });
          observation.screenshot = viewport.screenshot;
        } catch (error) {
          observation.screenshotError = message(error);
          audit.errors.push({ stage: `screenshot:${viewport.name}`, error: observation.screenshotError });
        }
        if (audit.viewports.length === 1) {
          try {
            onProgress("Running full desktop axe-core WCAG audit");
            phase = "axe";
            await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
            const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];
            audit.axe = { tags, results: await page.evaluate((tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags } }), tags) };
          } catch (error) {
            audit.errors.push({ stage: "axe", error: message(error) });
          }
          try {
            phase = "keyboard";
            audit.keyboard = await recordKeyboard(page, run, timeout);
          } catch (error) {
            audit.errors.push({ stage: "keyboard", error: message(error) });
          }
        }
        try {
          phase = "safe-ui";
          observation.ui = await safeUI(page, run, timeout, viewport);
          if (audit.viewports.length === 1) audit.ui = observation.ui;
        } catch (error) {
          audit.errors.push({ stage: `safe-ui:${viewport.name}`, error: message(error) });
        }
      } catch (error) {
        observation.error = message(error);
        audit.errors.push({ stage: viewport.name, error: observation.error });
      } finally {
        await page.close().catch(() => {});
        persistAudit(audit, run);
        onProgress(`Persisted ${viewport.name} Smoke checkpoint`);
      }
    }
    const desktop = audit.viewports[0];
    audit.transport = await observeTransports(context, audit, timeout);
    if (desktop.dom) {
      audit.links = await sweepLinks(context, desktop.dom.links, desktop.finalUrl, timeout, onProgress);
      fs.writeFileSync(run.file("link-sweep.txt"), audit.links.records.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    }
    audit.cookies = (await context.cookies()).map(({ name, domain, path: cookiePath, expires, httpOnly, secure, sameSite }) => ({ name, domain, path: cookiePath, expires, httpOnly, secure, sameSite }));
  } catch (error) {
    audit.error = message(error);
    audit.errors.push({ stage: !browser ? "setup" : "collection", error: audit.error });
    onProgress(audit.error);
  } finally {
    if (browser) await browser.close().catch(() => {});
    target?.close();
  }
  audit.endedAt = new Date().toISOString();
  audit.durationMs = Date.parse(audit.endedAt) - Date.parse(startedAt);
  if (audit.errors.length && !audit.error) audit.error = audit.errors.map((entry) => `${entry.stage}: ${entry.error || entry.reason}`).join("; ");
  if (run) {
    return persistAudit(audit, run, true);
  }
  audit.checks = deriveChecks(audit);
  return resultFromAudit(audit, null);
}

function persistAudit(audit, run, complete = false) {
  audit.complete = complete;
  audit.durationMs = Date.now() - Date.parse(audit.startedAt);
  audit.files = {};
  for (const name of artifactNames()) {
    if (fs.existsSync(run.file(name))) audit.files[name] = { sha256: hash(fs.readFileSync(run.file(name))), bytes: fs.statSync(run.file(name)).size };
  }
  audit.checks = deriveChecks(audit);
  // Remove the old companion first, so an interruption can safely fall back to audit.json.
  if (fs.existsSync(run.file("smoke-result.json"))) fs.unlinkSync(run.file("smoke-result.json"));
  const bytes = JSON.stringify(audit, null, 2) + "\n";
  fs.writeFileSync(run.file("audit.json.pending"), bytes);
  fs.renameSync(run.file("audit.json.pending"), run.file("audit.json"));
  const result = resultFromAudit(audit, hash(bytes));
  fs.writeFileSync(run.file("smoke-result.json.pending"), JSON.stringify(result, null, 2) + "\n");
  fs.renameSync(run.file("smoke-result.json.pending"), run.file("smoke-result.json"));
  return result;
}

function resultFromAudit(audit, auditSha256) {
  const measured = audit.viewports.some((entry) => entry.dom);
  const interrupted = audit.complete === false || !!audit.error;
  return {
    contractVersion: audit.contractVersion, checks: audit.checks,
    viewports: audit.viewports.map(({ name, width, height, screenshot, error }) => ({ name, width, height, screenshot, error })),
    tools: audit.tools, safety: audit.safety, title: audit.title, url: audit.url, effectiveUrl: audit.effectiveUrl,
    startedAt: audit.startedAt, endedAt: audit.endedAt, durationMs: audit.durationMs,
    error: audit.error || (audit.complete === false ? "Collection incomplete; only persisted browser observations are retained" : null),
    status: interrupted ? measured ? "PARTIAL" : "BLOCKED" : audit.checks.some((check) => check.status === "FAIL") ? "FAIL" :
      audit.safety?.blockedRequests?.length ? "REVIEW" : "PASS",
    evidence: { collector: COLLECTOR, sourceSha256: audit.sourceSha256, auditSha256, audit: "audit.json", directory: audit.artifactDirectory, files: audit.files },
  };
}

function validateCollectorArtifacts(result, directory) {
  const root = fs.realpathSync(directory);
  const read = (name) => {
    if (typeof name !== "string" || path.basename(name) !== name) throw new Error("Invalid Smoke artifact path");
    const file = fs.realpathSync(path.join(root, name));
    if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) throw new Error("Smoke artifact escaped run directory");
    return fs.readFileSync(file);
  };
  const bytes = read("audit.json");
  const audit = JSON.parse(bytes);
  const fromRawSnapshot = result?.collector === COLLECTOR && JSON.stringify(result) === JSON.stringify(audit);
  if (audit.collector !== COLLECTOR || audit.sourceSha256 !== sourceHash() ||
      !fromRawSnapshot && (result?.evidence?.collector !== COLLECTOR || result.evidence.sourceSha256 !== audit.sourceSha256 ||
      result.evidence.auditSha256 !== hash(bytes))) throw new Error("Untrusted or modified Smoke collector evidence");
  if (audit.contractVersion !== VERSION || result?.contractVersion !== VERSION) throw new Error("Smoke contract version mismatch");
  const expected = deriveChecks(audit);
  if (JSON.stringify(expected) !== JSON.stringify(audit.checks) || JSON.stringify(expected) !== JSON.stringify(result.checks)) throw new Error("Smoke checks do not match measured collector observations");
  if (expected.length !== CHECKLIST.length || new Set(expected.map((check) => check.id)).size !== CHECKLIST.length) throw new Error("Incomplete Smoke check IDs");
  for (const [name, recorded] of Object.entries(audit.files)) {
    const file = read(name);
    if (hash(file) !== recorded.sha256 || file.length !== recorded.bytes) throw new Error(`Modified Smoke artifact: ${name}`);
  }
  for (const check of expected) {
    if (check.evidence) {
      if (!check.evidence.startsWith("audit.json#/")) throw new Error("Smoke evidence must reference collector observations");
      const pointer = check.evidence.slice("audit.json#/".length);
      let value = audit;
      for (const part of pointer.split("/")) value = value?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
      if (value === undefined) throw new Error(`Missing Smoke evidence: ${check.id}`);
    }
  }
  for (const viewport of audit.viewports) {
    const contract = VIEWPORTS.find((entry) => entry.name === viewport.name);
    if (!contract || viewport.width !== contract.width || viewport.height !== contract.height) throw new Error("Smoke viewport mismatch");
    if (viewport.screenshot && (viewport.screenshot !== contract.screenshot || !audit.files[viewport.screenshot])) throw new Error("Missing Smoke screenshot evidence");
  }
  const report = resultFromAudit(audit, hash(bytes));
  if (!fromRawSnapshot && JSON.stringify(report) !== JSON.stringify(result)) throw new Error("Smoke stdout does not match persisted collector result");
  return { status: report.status, report, ...(["BLOCKED", "PARTIAL"].includes(report.status) ? { error: report.error } : {}) };
}

function validateSmokeEvidence(result, directory) {
  try {
    return validateCollectorArtifacts(result, directory);
  } catch (error) {
    return { status: "BLOCKED", error: `BLOCKED: Smoke evidence unavailable or invalid — ${message(error)}` };
  }
}

module.exports = { runSmokeCheck, validateSmokeEvidence, clsMeasurement };

if (require.main === module) {
  const [url = ""] = process.argv.slice(2);
  runSmokeCheck(url, {
    artifactDirectory: process.env.QA_ARTIFACT_DIR,
    targetIdentity: process.env.QA_TARGET_IDENTITY,
    onProgress: (line) => process.stderr.write(`${line}\n`),
  }).then((result) => {
    if (result.evidence.directory && result.evidence.auditSha256) {
      const run = createArtifactRun(result.url, result.evidence.directory);
      const validated = validateSmokeEvidence(result, run.directory);
      const { writeReport } = require("./report");
      writeReport(run, { name: "Smoke", mode: "smoke", result: validated.report || result, smokeValidated: !!validated.report, validation: validated });
    }
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = ["BLOCKED", "PARTIAL"].includes(result.status) ? 2 : result.status === "FAIL" ? 1 : 0;
  }).catch((error) => {
    process.stderr.write(`${message(error)}\n`);
    process.exitCode = 2;
  });
}
