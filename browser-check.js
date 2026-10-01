// Deterministic browser checks powered by Playwright.
// Usage as a module: const { runBrowserCheck } = require("./browser-check");
// Usage from the CLI:  node browser-check.js <url> [--screenshot <file.png>]
// The CLI writes progress lines to stderr and the final JSON result to stdout.

const NAVIGATION_TIMEOUT = 15000;
const MAX_SAMPLES = 20;

function validateUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must start with http:// or https://");
  }
  return parsed.href;
}

async function runBrowserCheck(url, { screenshotPath, timeout = NAVIGATION_TIMEOUT, onProgress = () => {} } = {}) {
  const startedAt = new Date();
  const result = {
    url,
    finalUrl: null,
    status: null,
    title: null,
    pageErrors: [],
    consoleMessages: [],
    imagesMissingAlt: { count: null, samples: [] },
    screenshot: null,
    checks: [],
    error: null,
    passed: false,
    startedAt: startedAt.toISOString(),
    durationMs: 0,
  };

  let browser;
  try {
    result.url = validateUrl(url);

    let chromium;
    try {
      ({ chromium } = require("playwright"));
    } catch {
      throw new Error('Playwright is not installed. Run "npm install" and "npx playwright install chromium".');
    }

    onProgress("Launching Chromium…");
    try {
      browser = await chromium.launch();
    } catch (err) {
      throw new Error(`Could not launch Chromium (${err.message.split("\n")[0]}). Run "npx playwright install chromium".`);
    }

    const page = await browser.newPage();
    page.setDefaultTimeout(timeout);
    page.on("pageerror", (err) => result.pageErrors.push(err.message));
    page.on("console", (msg) => result.consoleMessages.push({ type: msg.type(), text: msg.text() }));

    onProgress(`Navigating to ${result.url}…`);
    // page.goto does not throw on 4xx/5xx responses, so the status is checked explicitly.
    const response = await page.goto(result.url, { waitUntil: "load", timeout });
    result.status = response ? response.status() : null;
    result.finalUrl = page.url();
    result.title = await page.title();
    onProgress(`Response status: ${result.status ?? "none"}`);

    onProgress("Checking images for missing alt attributes…");
    const missing = page.locator("img:not([alt])");
    result.imagesMissingAlt.count = await missing.count();
    result.imagesMissingAlt.samples = (
      await missing.evaluateAll((imgs, max) => imgs.slice(0, max).map((img) => img.currentSrc || img.getAttribute("src") || "(no src)"), MAX_SAMPLES)
    );
    onProgress(`Images missing alt: ${result.imagesMissingAlt.count}`);

    if (screenshotPath) {
      onProgress("Taking screenshot…");
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true, timeout });
        result.screenshot = screenshotPath;
      } catch (err) {
        onProgress(`Screenshot failed: ${err.message.split("\n")[0]}`);
      }
    }
  } catch (err) {
    result.error = err.message.split("\n")[0];
    onProgress(`Error: ${result.error}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const consoleErrors = result.consoleMessages.filter((m) => m.type === "error");
  const navigated = result.status !== null;
  const altChecked = result.imagesMissingAlt.count !== null;
  result.checks = [
    {
      name: "Page response status",
      status: !navigated ? "not run" : result.status < 400 ? "passed" : "failed",
      detail: navigated ? `HTTP ${result.status}` : result.error || "No response received",
    },
    {
      name: "No uncaught page errors",
      status: !navigated ? "not run" : result.pageErrors.length === 0 ? "passed" : "failed",
      detail: `${result.pageErrors.length} page error(s)`,
    },
    {
      name: "No console errors",
      status: !navigated ? "not run" : consoleErrors.length === 0 ? "passed" : "failed",
      detail: `${consoleErrors.length} console error(s), ${result.consoleMessages.length} message(s) total`,
    },
    {
      name: "Images have alt attributes",
      status: !altChecked ? "not run" : result.imagesMissingAlt.count === 0 ? "passed" : "failed",
      detail: altChecked ? `${result.imagesMissingAlt.count} image(s) missing alt` : "Check did not run",
    },
  ];
  if (screenshotPath) {
    result.checks.push({
      name: "Screenshot captured",
      status: result.screenshot ? "passed" : navigated ? "failed" : "not run",
      detail: result.screenshot ? "Full-page screenshot saved" : "No screenshot",
    });
  }
  result.passed = !result.error && result.checks.every((c) => c.status === "passed");
  result.durationMs = Date.now() - startedAt.getTime();
  return result;
}

function toMarkdown(result, screenshotUrl) {
  const icon = { passed: "✅", failed: "❌", "not run": "⚠️" };
  const lines = [
    `**Overall:** ${result.passed ? "✅ PASSED" : "❌ FAILED"}`,
    `**Final URL:** ${result.finalUrl || "n/a"}`,
    `**Title:** ${result.title || "n/a"}`,
    `**Duration:** ${result.durationMs} ms`,
  ];
  if (result.error) lines.push(`**Error:** ${result.error}`);
  lines.push("", "## Checks");
  for (const c of result.checks) lines.push(`${icon[c.status]} ${c.name}: ${c.status.toUpperCase()} (${c.detail})`);

  if (result.pageErrors.length) {
    lines.push("", "## Page errors");
    result.pageErrors.forEach((e) => lines.push(`- ${e}`));
  }
  if (result.consoleMessages.length) {
    lines.push("", "## Console messages");
    result.consoleMessages.slice(0, 50).forEach((m) => lines.push(`- [${m.type}] ${m.text}`));
  }
  if (result.imagesMissingAlt.count) {
    lines.push("", "## Images missing alt");
    result.imagesMissingAlt.samples.forEach((s) => lines.push(`- ${s}`));
  }
  if (screenshotUrl) lines.push("", `**Screenshot:** ${screenshotUrl}`);
  return lines.join("\n");
}

module.exports = { runBrowserCheck, toMarkdown, validateUrl };

if (require.main === module) {
  const [url = "", ...rest] = process.argv.slice(2);
  const shotIndex = rest.indexOf("--screenshot");
  const screenshotPath = shotIndex !== -1 ? rest[shotIndex + 1] : undefined;

  runBrowserCheck(url, { screenshotPath, onProgress: (msg) => process.stderr.write(`${msg}\n`) })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result.passed ? 0 : 1;
    })
    .catch((err) => {
      process.stderr.write(`${err.stack || err}\n`);
      process.exitCode = 2;
    });
}