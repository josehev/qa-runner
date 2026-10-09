const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { createArtifactRun } = require("../artifacts");
const { browserPreflight } = require("../browser-preflight");
const { agentMcpConfig, browserConfig, connectBrowser, playwrightConfig } = require("../browser-mcp");
const { validateAgentEvidence, browserInstructions } = require("../browser-evidence");

function runFixture(t, url = "http://127.0.0.1/browser-regression") {
  const run = createArtifactRun(url, null);
  t.after(() => fs.rmSync(run.directory, { recursive: true, force: true }));
  return run;
}

async function website(t) {
  const server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><title>Browser regression</title>
      <form onsubmit="event.preventDefault(); document.querySelector('output').textContent='Submitted: '+document.querySelector('input').value">
      <label>Name <input name="name" required></label><button>Submit</button></form>
      <button type="button" onclick="document.querySelector('output').textContent='Clicked'">Click me</button><output>Ready</output>`);
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/`;
}

test("missing Chromium blocks preflight before connecting MCP", async (t) => {
  const run = runFixture(t);
  let connected = false;
  const result = await browserPreflight("https://example.com/", run, {
    executablePath: run.file("missing-chromium"),
    connect: async () => { connected = true; },
  });
  assert.equal(result.status, "BLOCKED");
  assert.match(result.error, /BLOCKED: browser environment unavailable.*Chromium binary missing/);
  assert.match(result.error, /npx playwright install chromium/);
  assert.equal(connected, false);
});

test("MCP connection failure blocks preflight with actual diagnostic", async (t) => {
  const run = runFixture(t);
  const result = await browserPreflight("https://example.com/", run, {
    executablePath: process.execPath,
    connect: async () => { throw new Error("MCP connection refused"); },
  });
  assert.equal(result.status, "BLOCKED");
  assert.match(result.error, /MCP connection refused/);
});

test("real stdio MCP startup failure is caught by preflight", async (t) => {
  const run = runFixture(t);
  const result = await browserPreflight("https://example.com/", run, {
    executablePath: process.execPath,
    config: { command: process.execPath, args: ["-e", "process.stderr.write('MCP startup broken'); process.exit(1)"] },
  });
  assert.equal(result.status, "BLOCKED");
  assert.match(result.error, /MCP connection failed/);
  assert.match(result.error, /MCP startup broken/);
});

test("missing tools, navigation and JavaScript failures never fall back to static testing", async (t) => {
  for (const failure of ["tools", "navigation", "javascript", "screenshot"]) {
    const run = runFixture(t);
    let closed = false;
    const result = await browserPreflight("https://example.com/", run, {
      executablePath: process.execPath,
      connect: async () => ({
        listTools: async () => ({ tools: failure === "tools" ? [] :
          ["browser_navigate", "browser_evaluate", "browser_take_screenshot", "browser_press_key"].map((name) => ({ name })) }),
        callTool: async (name) => {
          if (failure === "navigation" && name === "browser_navigate") {
            return { isError: true, content: [{ type: "text", text: "net::ERR_CONNECTION_REFUSED" }] };
          }
          return { content: [{ type: "text", text: failure === "javascript" ? "{}" : '{"javascript":42}' }] };
        },
        close: async () => { closed = true; },
      }),
    });
    assert.equal(result.status, "BLOCKED", failure);
    assert.equal(closed, true);
    assert.equal(fs.existsSync(run.file("agent-result.json")), false);
  }
});

test("MCP configuration is pinned locally, headless, isolated and run-specific", (t) => {
  const run = runFixture(t);
  const backend = playwrightConfig(run.directory);
  assert.equal(backend.command, process.execPath);
  for (const flag of ["--headless", "--isolated", "--executable-path", "--output-dir"]) {
    assert.ok(backend.args.includes(flag), flag);
  }
  assert.equal(backend.cwd, run.directory);
  assert.equal(backend.env.QA_ARTIFACT_DIR, run.directory);
  const file = agentMcpConfig(run);
  const config = JSON.parse(fs.readFileSync(file, "utf8")).mcpServers.playwright;
  assert.equal(config.command, process.execPath);
  assert.ok(path.isAbsolute(config.args[0]));
  assert.deepEqual(config.tools, ["*"]);
  assert.equal(config.env.QA_ARTIFACT_DIR, run.directory);
  assert.match(browserInstructions(run), /BLOCKED: browser environment unavailable/);
  assert.match(browserInstructions(run), /QA evidence ID/);
});

test("real Chromium launch, JavaScript and navigation capture evidence through agent MCP wrapper", async (t) => {
  const url = await website(t);
  const run = runFixture(t, url);
  const result = await browserPreflight(url, run);
  assert.equal(result.status, "PASS", result.error);
  assert.ok(fs.statSync(run.file("preflight.png")).size > 100);
  assert.match(JSON.stringify(result.evidence), /Browser regression/);
  assert.match(fs.readFileSync(run.file("preflight-browser.jsonl"), "utf8"), /browser_navigate/);
  assert.equal(fs.existsSync(run.file("agent-browser.jsonl")), false);
});

test("agent-facing MCP discovers browser tools and records real form interactions", async (t) => {
  const url = await website(t);
  const run = runFixture(t, url);
  const config = JSON.parse(fs.readFileSync(agentMcpConfig(run), "utf8")).mcpServers.playwright;
  const browser = await connectBrowser({ ...config, env: { ...process.env, ...config.env } });
  t.after(() => browser.close());
  const { tools } = await browser.listTools();
  assert.ok(tools.some((tool) => tool.name === "browser_click"));
  assert.ok(tools.some((tool) => tool.name === "browser_fill_form"));
  const call = async (name, args) => {
    const result = await browser.callTool(name, args);
    assert.equal(Boolean(result.isError), false, JSON.stringify(result));
    return result;
  };
  await call("browser_navigate", { url });
  // The pinned MCP accepts CSS targets as well as snapshot references.
  await call("browser_type", { target: 'input[name="name"]', text: "QA fixture", element: "Name input" });
  await call("browser_click", { target: 'form button', element: "Submit button" });
  await call("browser_evaluate", { function: "() => document.querySelector('output').textContent" });
  await call("browser_take_screenshot", { filename: "agent.png", type: "png" });
  const records = fs.readFileSync(run.file("agent-browser.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(records.some((record) => record.tool === "browser_evaluate" && record.text.includes("Submitted: QA fixture")));
  assert.ok(fs.statSync(run.file("agent.png")).size > 100);
  const nav = records.find((record) => record.tool === "browser_navigate");
  const click = records.find((record) => record.tool === "browser_click");
  fs.writeFileSync(run.file("agent-result.json"), JSON.stringify({
    status: "PASS",
    checks: [
      { status: "PASS", action: nav.tool, evidence: nav.id, observed: "Browser regression" },
      { status: "PASS", action: click.tool, evidence: click.id, observed: "Browser regression" },
      { status: "NOT TESTED", reason: "Manual screen-reader checks require a human" },
    ],
  }));
  assert.equal(validateAgentEvidence(run, url, 0).status, "PASS");
});

test("preflight evidence and unsupported agent claims are rejected", (t) => {
  const run = runFixture(t);
  fs.writeFileSync(run.file("preflight-browser.jsonl"), '{"id":1,"tool":"browser_navigate"}\n');
  fs.writeFileSync(run.file("agent-result.json"), JSON.stringify({
    status: "PASS", checks: [{ status: "PASS", action: "browser_click", evidence: 1, observed: "Clicked" }],
  }));
  assert.equal(validateAgentEvidence(run, "https://example.com/", 0).status, "BLOCKED");
  fs.writeFileSync(run.file("agent-browser.jsonl"), '{"id":1,"tool":"browser_click","text":"Ready","isError":false}\n');
  assert.match(validateAgentEvidence(run, "https://example.com/", 0).error, /Unsupported browser claim/);
  assert.match(validateAgentEvidence(run, "https://example.com/", 1).error, /exited with code 1/);
});

test("statuses, observed excerpts, target navigation and interactions must agree", (t) => {
  const url = "https://example.com/";
  const run = runFixture(t, url);
  const records = [
    { id: 1, tool: "browser_navigate", arguments: { url }, text: "Page Title: Fixture", isError: false },
    { id: 2, tool: "browser_click", text: "DOM changed: Clicked", isError: false },
  ];
  const checks = [
    { status: "PASS", action: "browser_navigate", evidence: 1, observed: "Fixture" },
    { status: "PASS", action: "browser_click", evidence: 2, observed: "Clicked" },
  ];
  const validate = (report, evidence = records) => {
    fs.writeFileSync(run.file("agent-result.json"), JSON.stringify(report));
    fs.writeFileSync(run.file("agent-browser.jsonl"), evidence.map((record) => JSON.stringify(record)).join("\n"));
    return validateAgentEvidence(run, url, 0);
  };
  assert.equal(validate({ status: "PASS", checks }).status, "PASS");
  assert.equal(validate({ status: "FAIL", checks: [checks[0], { ...checks[1], status: "FAIL" }] }).status, "FAIL");
  for (const report of [
    { status: "PASS", checks: [checks[0]] },
    { status: "PASS", checks: [checks[1]] },
    { status: "PASS", checks: [checks[0], { ...checks[1], observed: "Invented" }] },
    { status: "PASS", checks: [checks[0], { ...checks[1], status: "FAIL" }] },
    { status: "NOT TESTED", checks },
    { status: "BLOCKED", reason: "Browser MCP tools unavailable", checks: [] },
    { status: "PASS", checks: [...checks, { status: "NOT TESTED", reason: "no browser available" }] },
  ]) assert.equal(validate(report).status, "BLOCKED");
  assert.equal(validate({ status: "PASS", checks }, [records[0], { ...records[1], isError: true }]).status, "BLOCKED");
  assert.equal(validate({ status: "PASS", checks }, [{ ...records[0], arguments: { url: "https://wrong.example/" } }, records[1]]).status, "BLOCKED");
});
