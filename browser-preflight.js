const fs = require("fs");
const { chromium } = require("playwright");
const { validateUrl } = require("./browser-check");
const { browserConfig, connectBrowser } = require("./browser-mcp");

async function browserPreflight(url, run, {
  executablePath = chromium.executablePath(),
  connect = connectBrowser,
  config,
} = {}) {
  let browser;
  try {
    url = validateUrl(url);
    if (!fs.existsSync(executablePath)) {
      throw new Error(`Chromium binary missing: ${executablePath}. Run "npm install && npx playwright install chromium".`);
    }
    browser = await connect(config || browserConfig(run.directory));
    const { tools } = await browser.listTools();
    for (const name of ["browser_navigate", "browser_evaluate", "browser_take_screenshot", "browser_press_key"]) {
      if (!tools.some((tool) => tool.name === name)) throw new Error(`Playwright MCP tool unavailable: ${name}`);
    }
    const evidence = [];
    const call = async (name, args) => {
      const result = await browser.callTool(name, args);
      evidence.push({ tool: name, arguments: args, result });
      if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`);
      return result;
    };
    await call("browser_navigate", { url });
    const javascript = await call("browser_evaluate", {
      function: "() => ({ javascript: 6 * 7, title: document.title, url: location.href })",
    });
    const text = javascript.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
    if (!/"javascript"\s*:\s*42\b/.test(text)) {
      throw new Error("Browser JavaScript execution did not return the expected result");
    }
    await call("browser_take_screenshot", { filename: "preflight.png", type: "png", fullPage: false });
    if (!fs.existsSync(run.file("preflight.png")) || !fs.statSync(run.file("preflight.png")).size) {
      throw new Error("Browser navigation produced no screenshot evidence");
    }
    const result = { status: "PASS", url, screenshot: "preflight.png", evidence };
    fs.writeFileSync(run.file("browser-preflight.json"), JSON.stringify(result, null, 2));
    return result;
  } catch (err) {
    const result = { status: "BLOCKED", error: `BLOCKED: browser environment unavailable — ${err.message}` };
    fs.writeFileSync(run.file("browser-preflight.json"), JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { browserPreflight };
