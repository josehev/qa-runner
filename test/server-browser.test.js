const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const { connectBrowser } = require("../browser-mcp");

function testRun(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qa-server-browser-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, file: (name) => path.join(directory, name), publicPath: (name) => `/results/${name}` };
}

function isolatedApp(t) {
  const context = {
    require: (name) => name === "./artifacts"
      ? { ...require("../artifacts"), createArtifactRun: () => testRun(t) }
      : name.startsWith("./") ? require(path.join(__dirname, "..", name)) : require(name),
    __dirname: path.join(__dirname, ".."),
    process, console, URL, setTimeout, clearTimeout, module: { exports: {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8"), context);
  return context.module.exports;
}

async function routeFixture(t, mode, { url = `https://example.com/server-browser-${mode}`, promptId = "a11y" } = {}) {
  let run;
  let browserUrl;
  let invocation;
  let killed = false;
  let onKilled;
  const whenKilled = new Promise((resolve) => { onKilled = resolve; });
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    killed = true;
    onKilled();
    if (mode === "browser-timeout") setImmediate(() => child.emit("close", 1));
  };
  const context = {
    require: (name) => {
      if (name === "./artifacts") return { ...require("../artifacts"), createArtifactRun: () => (run = testRun(t)) };
      if (name === "child_process") return {
        spawn: (command, args, options) => {
          invocation = { command, args, options };
          if (promptId === "browser-check") browserUrl = args[1];
          if (mode === "timeout" || mode === "disconnect") return child;
          if (mode === "browser-timeout") {
            child.stdout.write('{"passed":true}');
            return child;
          }
          setImmediate(() => {
            const directory = options.env.QA_ARTIFACT_DIR;
            if (mode === "spawn-error") {
              child.emit("error", new Error("ENOENT: copilot missing"));
              child.emit("close", -2);
              return;
            }
            child.stdout.write("Agent claims all checks passed\n");
            if (mode === "diagnostics") {
              child.stdout.write([
                "✗ Save page (shell)", "  │ cd /opt/qa-outside && curl -s https://example.com -o page.html",
                "  └ Permission denied because no interactive user response was available. Retry in an interactive",
                "● Check API (shell)", "  │ curl -sS https://api.invalid/status", "  └ 2 lines…", "",
              ].join("\n"));
              fs.writeFileSync(args[args.indexOf("--share") + 1], [
                "### `bash` — Failed", "", "$ cd /opt/qa-outside && curl -s https://example.com -o page.html", "",
                "```", "Permission denied because no interactive user response was available.", "```", "", "---",
                "### `bash`", "", "$ curl -sS https://api.invalid/status", "",
                "```", "curl: (6) Could not resolve host: api.invalid", "<exited with exit code 6>", "```", "",
              ].join("\n"));
            }
            if (mode === "evidence" || mode === "diagnostics") {
              fs.writeFileSync(path.join(directory, "agent-browser.jsonl"), [
                { id: 1, tool: "browser_navigate", arguments: { url: browserUrl }, text: "Page Title: Fixture", isError: false },
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
          browserUrl = _url;
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
    setTimeout: (callback, timeout) => setTimeout(callback, ["timeout", "browser-timeout"].includes(mode) ? 20 : timeout),
    clearTimeout,
    module: { exports: {} },
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  vm.runInNewContext(source, context);
  const server = context.module.exports.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/run?promptId=${promptId}&url=${encodeURIComponent(url)}`);
  assert.equal(response.status, 200);
  if (mode === "disconnect") {
   await response.body.cancel();
   await whenKilled;
   return { run, invocation, messages: [], killed, base, browserUrl };
  }
  const text = await response.text();
  const messages = text.trim().split("\n\n").map((line) => JSON.parse(line.slice(6)));
  return { run, invocation, messages, killed, base, browserUrl };
}

test("all Copilot QA modes share the local preflight, prompt, permission and evidence target, then close it", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qa-server-local-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const url = path.join(directory, "local page.html");
  fs.writeFileSync(url, "<title>Fixture</title>");
  for (const promptId of ["a11y", "forms"]) {
    const { run, invocation, messages, browserUrl } = await routeFixture(t, "evidence", { url, promptId });
    assert.match(browserUrl, /^http:\/\/127\.0\.0\.1:\d+\//);
    assert.ok(invocation.args.includes(`--allow-url=${new URL(browserUrl).origin}`));
    assert.equal(invocation.args[invocation.args.indexOf("--add-dir") + 1], run.directory);
    assert.equal(invocation.args[invocation.args.indexOf("--share") + 1], run.file("copilot-session.txt"));
    for (const broad of ["--allow-all", "--yolo", "--allow-all-paths", "--allow-all-urls"]) assert.ok(!invocation.args.includes(broad));
    assert.ok(!invocation.args.some((arg) => arg.startsWith("--allow-tool")));
    assert.equal(invocation.args.filter((arg) => arg === "--add-dir").length, 1);
    const prompt = invocation.args[invocation.args.indexOf("-p") + 1];
    assert.ok(prompt.includes(browserUrl));
    assert.match(prompt, /Shell HTTP checks with curl are permitted in this run/);
    assert.ok(prompt.includes(JSON.stringify(path.join(run.directory, "page.html"))));
    assert.match(prompt, /local static HTML preview/);
    assert.match(messages.at(-1).data, /Browser evidence validated: PASS/);
    const target = JSON.parse(fs.readFileSync(run.file("target.json"), "utf8"));
    assert.equal(target.original, url);
    assert.equal(target.identity, require("url").pathToFileURL(url).href);
    assert.equal(target.effectiveUrl, browserUrl);
    assert.ok(fs.readFileSync(run.file(`${promptId}.md`), "utf8").includes(`URL: ${url}`));
    const html = fs.readFileSync(run.file("report.html"), "utf8");
    assert.match(html, />PASS<\/span>/);
    assert.match(html, /<h2[^>]*>Executive Summary/);
    assert.ok(html.includes(target.identity));
    await assert.rejects(fetch(browserUrl));
  }
});

test("blocked, failed and timed-out local agent runs release their temporary server", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qa-server-local-fail-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const url = path.join(directory, "index.html");
  fs.writeFileSync(url, "<title>Fixture</title>");
  for (const mode of ["preflight-blocked", "spawn-error", "no-evidence", "timeout"]) {
    const { run, messages, browserUrl } = await routeFixture(t, mode, { url });
    assert.match(messages.at(-1).data, /BLOCKED/);
    const html = fs.readFileSync(run.file("report.html"), "utf8");
    assert.match(html, />N\/A<\/span>/);
    assert.match(html, /Evidence validation: <strong>BLOCKED/);
    assert.match(html, /<h2[^>]*>Reproduction notes for failures/);
    await assert.rejects(fetch(browserUrl));
  }
});

test("disconnecting from a local agent run kills the child and closes the preview", { timeout: 10000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qa-local-disconnect-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const url = path.join(directory, "index.html");
  fs.writeFileSync(url, "<title>Fixture</title>");
  const { browserUrl, killed } = await routeFixture(t, "disconnect", { url });
  assert.equal(killed, true);
  await assert.rejects(fetch(browserUrl));
});

test("local Browser Check closes on disconnect and cannot accept success after timeout", { timeout: 10000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qa-local-browser-stop-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const url = path.join(directory, "index.html");
  fs.writeFileSync(url, "<title>Fixture</title>");
  for (const mode of ["disconnect", "browser-timeout"]) {
    const { run, browserUrl, killed, invocation, messages } = await routeFixture(t, mode, { url, promptId: "browser-check" });
    assert.equal(killed, true);
    assert.equal(invocation.options.env.QA_TARGET_IDENTITY, require("url").pathToFileURL(url).href);
    await assert.rejects(fetch(browserUrl));
    if (mode === "browser-timeout") {
      assert.match(messages.map((message) => message.data).join(""), /Timed out.*FAILED/s);
      assert.doesNotMatch(messages.map((message) => message.data).join(""), /PASSED/);
      const html = fs.readFileSync(run.file("report.html"), "utf8");
      assert.match(html, />N\/A<\/span>/);
      assert.doesNotMatch(html, />PASS<\/span>/);
    }
  }
});

test("real Browser Check API keeps file identity and serves only generated artifacts", async (t) => {
  const { pageSlug, RESULTS } = require("../artifacts");
  const { pathToFileURL } = require("url");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qa-api-local-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "original page.html");
  fs.writeFileSync(file, "<title>Original page</title><script>document.title='API JavaScript'</script>");
  fs.writeFileSync(path.join(directory, "private.json"), '{"secret":"not an artifact"}');
  const identity = pathToFileURL(file).href;
  const pageDirectory = path.join(RESULTS, pageSlug(identity));
  t.after(() => fs.rmSync(pageDirectory, { recursive: true, force: true }));
  const app = require("../server");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/run?promptId=browser-check&url=${encodeURIComponent(file)}`);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /PASSED/);
  const runs = fs.readdirSync(pageDirectory);
  assert.equal(runs.length, 1);
  const runDirectory = path.join(pageDirectory, runs[0]);
  const result = JSON.parse(fs.readFileSync(path.join(runDirectory, "browser-check.json"), "utf8"));
  assert.equal(result.url, identity);
  assert.equal(result.originalTarget, file);
  assert.equal(result.title, "API JavaScript");
  assert.ok(result.screenshot.startsWith(runDirectory + path.sep));
  assert.ok(fs.readFileSync(path.join(runDirectory, "browser-check.md"), "utf8").includes(`URL: ${file}`));
  assert.equal(fs.existsSync(path.join(runDirectory, "original page.html")), false);
  const reportUrl = `${base}/results/${pageSlug(identity)}/${runs[0]}/report.html`;
  const reportResponse = await fetch(reportUrl);
  assert.equal(reportResponse.headers.get("content-security-policy"), "sandbox");
  const html = await reportResponse.text();
  assert.match(html, />PASS<\/span>/);
  assert.match(html, /API JavaScript/);
  assert.match(html, /1\. Accessibility \(WCAG 2\.0\/2\.1 AA\)/);
  assert.match(html, /\d+ ms/);
  const alias = await fetch(reportUrl.replace("report.html", "browser-check.html"));
  assert.equal(await alias.text(), html);
  assert.equal(await (await fetch(reportUrl.replace("report.html", "qa-report.html"))).text(), html);
  const reports = await (await fetch(`${base}/api/results`)).json();
  assert.equal(reports.filter((report) => report.path.includes(`/${runs[0]}/`)).length, 1);
  fs.writeFileSync(path.join(runDirectory, "supplement.html"), "<p>Supplemental artifact</p>");
  assert.equal(await (await fetch(reportUrl.replace("report.html", "supplement.html"))).text(), "<p>Supplemental artifact</p>");
  await assert.rejects(fetch(result.effectiveUrl));
  assert.equal((await fetch(`${base}/results/${pageSlug(identity)}/${runs[0]}/private.json`)).status, 404);
});

test("UI validation uses server filesystem errors and cross-origin pages cannot probe paths or start runs", async (t) => {
  const app = isolatedApp(t);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + "/api/target", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: path.join(os.tmpdir(), "qa-missing-page.html") }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Cannot read local HTML file.*ENOENT/);
  for (const headers of [{ Origin: "http://127.0.0.1:9999" }, { "Sec-Fetch-Site": "cross-site" }]) {
    assert.equal((await fetch(base + "/api/run?promptId=smoke&url=https://example.com", { headers })).status, 403);
    assert.equal((await fetch(base + "/api/target", { method: "POST", headers })).status, 403);
  }
});

test("preflight BLOCKED never starts Copilot or emits a successful completion", async (t) => {
  const { run, invocation, messages } = await routeFixture(t, "preflight-blocked");
  assert.equal(invocation, undefined);
  assert.match(messages.at(-1).data, /BLOCKED: browser environment unavailable.*MCP connection refused/);
  assert.match(fs.readFileSync(run.file("a11y.md"), "utf8"), /MCP connection refused/);
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
  assert.match(fs.readFileSync(run.file("a11y.md"), "utf8"), /PASS: browser_press_key/);
  assert.match(fs.readFileSync(run.file("a11y.md"), "utf8"), /Unvalidated agent output/);
});

test("curl permission, network and transcript diagnostics are reported without changing validated status", async (t) => {
  const { run, messages } = await routeFixture(t, "diagnostics");
  const report = fs.readFileSync(run.file("a11y.md"), "utf8");
  assert.match(report, /\*\*Overall: PASS\*\*/);
  assert.match(report, /## Command diagnostics[\s\S]*PERMISSION-DENIED[\s\S]*NETWORK-ERROR[\s\S]*## Unvalidated agent output/);
  const diagnostics = JSON.parse(fs.readFileSync(run.file("command-diagnostics.json"), "utf8"));
  assert.deepEqual(diagnostics.counts, { "permission-denied": 1, "network-error": 1 });
  assert.match(diagnostics.entries[0].detail, /path verification: .*\/opt\/qa-outside$/);
  assert.match(messages.at(-1).data, /Browser evidence validated: PASS\. Command diagnostics: 1 permission-denied, 1 network-error\./);
  assert.ok(messages.some((message) => /Browser preflight PASS\. curl: /.test(message.data)));
  const html = fs.readFileSync(run.file("report.html"), "utf8");
  assert.match(html, />PASS<\/span>/);
  assert.match(html, /permission-denied/);
  assert.match(html, /network-error/);
  assert.match(html, /path verification/);
  assert.match(html, /curl https|curl -sS https/);
  assert.match(html, /Reproduction notes for failures/);
});

test("CLI exit zero without recorded browser evidence is BLOCKED", async (t) => {
  const { run, messages } = await routeFixture(t, "no-evidence");
  assert.match(messages.at(-1).data, /BLOCKED: browser evidence unavailable or invalid/);
  assert.match(fs.readFileSync(run.file("a11y.md"), "utf8"), /Overall: BLOCKED/);
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
  const app = isolatedApp(t);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = "http://127.0.0.1:1/unreachable-browser-regression";
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/run?promptId=forms&url=${encodeURIComponent(url)}`);
  const text = await response.text();
  assert.match(text, /BLOCKED: browser environment unavailable/);
  assert.match(text, /ERR_UNSAFE_PORT|ERR_CONNECTION_REFUSED/);
  assert.doesNotMatch(text, /Starting browser-backed agent/);
});

test("server limits concurrent browser preflights and releases completed run slots", async (t) => {
  const app = isolatedApp(t);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const urls = ["a", "b"].map((suffix) => `http://127.0.0.1:1/concurrency-browser-regression-${suffix}`);
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
  const run = testRun(t);
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
