const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const { createArtifactRun } = require("../artifacts");
const { connectBrowser } = require("../browser-mcp");

async function routeFixture(t, mode) {
  const url = `https://example.com/server-browser-${mode}`;
  let run;
  let invocation;
  let killed = false;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { killed = true; };
  const context = {
    require: (name) => {
      if (name === "child_process") return {
        spawn: (command, args, options) => {
          invocation = { command, args, options };
          if (mode === "timeout") return child;
          setImmediate(() => {
            const directory = options.env.QA_ARTIFACT_DIR;
            if (mode === "spawn-error") {
              child.emit("error", new Error("ENOENT: copilot missing"));
              child.emit("close", -2);
              return;
            }
            child.stdout.write("Agent claims all checks passed\n");
            if (mode === "evidence") {
              fs.writeFileSync(path.join(directory, "agent-browser.jsonl"), [
                { id: 1, tool: "browser_navigate", arguments: { url }, text: "Page Title: Fixture", isError: false },
                { id: 2, tool: "browser_press_key", arguments: { key: "Tab" }, text: "Focused button", isError: false },
              ].map((record) => JSON.stringify(record)).join("\n"));
              fs.writeFileSync(path.join(directory, "agent-result.json"), JSON.stringify({
                status: "PASS", checks: [
                  { status: "PASS", action: "browser_navigate", evidence: 1, observed: "Fixture" },
                  { status: "PASS", action: "browser_press_key", evidence: 2, observed: "Focused button" },
                ],
              }));
            }
            child.emit("close", 0);
          });
          return child;
        },
      };
      if (name === "./browser-preflight") return {
        browserPreflight: async (_url, artifactRun) => {
          run = artifactRun;
          return mode === "preflight-blocked"
            ? { status: "BLOCKED", error: "BLOCKED: browser environment unavailable — MCP connection refused" }
            : { status: "PASS" };
        },
      };
      return name.startsWith("./") ? require(path.join(__dirname, "..", name)) : require(name);
    },
    __dirname: path.join(__dirname, ".."),
    process,
    console,
    URL,
    setTimeout: (callback, timeout) => setTimeout(callback, mode === "timeout" ? 20 : timeout),
    clearTimeout,
    module: { exports: {} },
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  vm.runInNewContext(source, context);
  const server = context.module.exports.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(() => { if (run) fs.rmSync(run.directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/run?promptId=smoke&url=${encodeURIComponent(url)}`);
  assert.equal(response.status, 200);
  const text = await response.text();
  const messages = text.trim().split("\n\n").map((line) => JSON.parse(line.slice(6)));
  return { run, invocation, messages, killed, base };
}

test("preflight BLOCKED never starts Copilot or emits a successful completion", async (t) => {
  const { run, invocation, messages } = await routeFixture(t, "preflight-blocked");
  assert.equal(invocation, undefined);
  assert.match(messages.at(-1).data, /BLOCKED: browser environment unavailable.*MCP connection refused/);
  assert.match(fs.readFileSync(run.file("smoke.md"), "utf8"), /MCP connection refused/);
  assert.equal(messages.filter((message) => message.type === "end").length, 1);
});

test("server passes run-specific MCP, target URL permission and mandatory interaction prompt", async (t) => {
  const { run, invocation, messages } = await routeFixture(t, "evidence");
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.env.QA_ARTIFACT_DIR, run.directory);
  assert.ok(invocation.args.includes("--allow-url=https://example.com"));
  const configArg = invocation.args[invocation.args.indexOf("--additional-mcp-config") + 1];
  assert.equal(configArg, `@${run.file("playwright-mcp.json")}`);
  assert.match(invocation.args[invocation.args.indexOf("-p") + 1], /real interactions/);
  assert.match(messages.at(-1).data, /Browser evidence validated: PASS/);
  assert.match(fs.readFileSync(run.file("smoke.md"), "utf8"), /PASS: browser_press_key/);
  assert.match(fs.readFileSync(run.file("smoke.md"), "utf8"), /Unvalidated agent output/);
});

test("CLI exit zero without recorded browser evidence is BLOCKED", async (t) => {
  const { run, messages } = await routeFixture(t, "no-evidence");
  assert.match(messages.at(-1).data, /BLOCKED: browser evidence unavailable or invalid/);
  assert.match(fs.readFileSync(run.file("smoke.md"), "utf8"), /Overall: BLOCKED/);
  assert.equal(JSON.parse(fs.readFileSync(run.file("evidence-validation.json"), "utf8")).status, "BLOCKED");
});

test("Copilot startup failure returns BLOCKED with the actual error", async (t) => {
  const { messages } = await routeFixture(t, "spawn-error");
  assert.match(messages.at(-1).data, /BLOCKED: browser environment unavailable.*ENOENT: copilot missing/);
  assert.equal(messages.filter((message) => message.type === "end").length, 1);
});

test("hung agent returns BLOCKED and is killed even without a close event", async (t) => {
  const { run, messages, killed } = await routeFixture(t, "timeout");
  assert.equal(killed, true);
  assert.match(messages.at(-1).data, /BLOCKED: browser environment unavailable.*timed out/);
  assert.equal(messages.filter((message) => message.type === "end").length, 1);
  assert.equal(JSON.parse(fs.readFileSync(run.file("evidence-validation.json"), "utf8")).status, "BLOCKED");
});

test("run endpoint rejects more than five requests per client per minute", async (t) => {
  const { base } = await routeFixture(t, "no-evidence");
  for (let i = 0; i < 4; i++) {
    const response = await fetch(`${base}/api/run?promptId=invalid`);
    assert.equal(response.status, 400);
    await response.text();
  }
  const response = await fetch(`${base}/api/run?promptId=invalid`);
  assert.equal(response.status, 429);
});

test("real server blocks unreachable targets without trying an unavailable Copilot executable", async (t) => {
  const app = require("../server");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = "http://127.0.0.1:1/unreachable-browser-regression";
  const cleanupRun = createArtifactRun(url, null);
  t.after(() => fs.rmSync(path.dirname(cleanupRun.directory), { recursive: true, force: true }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/run?promptId=forms&url=${encodeURIComponent(url)}`);
  const text = await response.text();
  assert.match(text, /BLOCKED: browser environment unavailable/);
  assert.match(text, /ERR_UNSAFE_PORT|ERR_CONNECTION_REFUSED/);
  assert.doesNotMatch(text, /Starting browser-backed agent/);
});

test("server limits concurrent browser preflights and releases completed run slots", async (t) => {
  const app = require("../server");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const urls = ["a", "b"].map((suffix) => `http://127.0.0.1:1/concurrency-browser-regression-${suffix}`);
  for (const url of urls) {
    const run = createArtifactRun(url, null);
    t.after(() => fs.rmSync(path.dirname(run.directory), { recursive: true, force: true }));
  }
  const start = (url) => fetch(`${base}/api/run?promptId=forms&url=${encodeURIComponent(url)}`);
  const first = await start(urls[0]);
  const second = await start(urls[1]);
  const excess = await start(urls[0]);
  assert.equal(excess.status, 429);
  assert.match(await excess.text(), /already active/);
  await Promise.all([first.text(), second.text()]);
  const invalid = await fetch(`${base}/api/run?promptId=invalid`);
  assert.equal(invalid.status, 400);
});

test("real MCP catches unreachable target navigation", async (t) => {
  const url = "http://127.0.0.1:1/unreachable-mcp-regression";
  const run = createArtifactRun(url, null);
  t.after(() => fs.rmSync(run.directory, { recursive: true, force: true }));
  const browser = await connectBrowser({
    command: process.execPath,
    args: [path.join(__dirname, "..", "browser-mcp.js")],
    env: { ...process.env, QA_ARTIFACT_DIR: run.directory, QA_BROWSER_TRANSCRIPT: "failure.jsonl" },
  });
  t.after(() => browser.close());
  const result = await browser.callTool("browser_navigate", { url });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /ERR_UNSAFE_PORT|ERR_CONNECTION_REFUSED/);
  assert.equal(JSON.parse(fs.readFileSync(run.file("failure.jsonl"), "utf8")).isError, true);
});
