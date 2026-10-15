const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { pathToFileURL } = require("url");
const { spawn } = require("child_process");
const { TARGET_BASE, resolveTarget, prepareTarget } = require("../targets");
const { pageSlug, RESULTS, createArtifactRun } = require("../artifacts");
const { runBrowserCheck } = require("../browser-check");
const { browserPreflight } = require("../browser-preflight");
const { connectBrowser, browserConfig } = require("../browser-mcp");
const { validateAgentEvidence } = require("../browser-evidence");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qa-local-"));
  const site = path.join(directory, "site");
  fs.mkdirSync(site);
  const file = path.join(site, "café # 100%.html");
  fs.writeFileSync(file, `<!doctype html><title>Before script</title>
    <link rel="icon" href="image.svg"><link rel="stylesheet" href="style.css">
    <script src="script.js" defer></script><img src="image.svg" alt="fixture">
    <button onclick="document.querySelector('output').textContent='Clicked locally'">Click</button>
    <output>Ready</output>`);
  fs.writeFileSync(path.join(site, "script.js"), "document.title = 'Local JavaScript executed';");
  fs.writeFileSync(path.join(site, "style.css"), "body { color: rgb(1, 2, 3); }");
  fs.writeFileSync(path.join(site, "image.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, site, file };
}

function artifacts(t, identity) {
  const run = createArtifactRun(identity, null);
  t.after(() => fs.rmSync(run.directory, { recursive: true, force: true }));
  t.after(() => {
    const parent = path.dirname(run.directory);
    if (fs.existsSync(parent) && !fs.readdirSync(parent).length) fs.rmdirSync(parent);
  });
  return run;
}

test("targets normalize HTTP and local paths/file URLs without decoding literal path characters", (t) => {
  const { file } = fixture(t);
  const expected = pathToFileURL(fs.realpathSync(file)).href;
  assert.equal(resolveTarget(file).identity, expected);
  assert.equal(resolveTarget(expected).identity, expected);
  const relative = path.relative(TARGET_BASE, file);
  assert.equal(resolveTarget(relative).identity, expected);
  assert.equal(resolveTarget("HTTPS://example.com").identity, "https://example.com/");
  assert.equal(pageSlug(expected), pageSlug(resolveTarget(relative).identity));
  assert.match(expected, /%20/);
  assert.match(expected, /%23/);
  assert.match(expected, /%25/);
});

test("targets reject missing, nonregular, unreadable and unsupported local targets", (t) => {
  const { site } = fixture(t);
  fs.mkdirSync(path.join(site, "directory.html"));
  fs.writeFileSync(path.join(site, "unsupported.txt"), "not HTML");
  fs.writeFileSync(path.join(site, "upper.HTM"), "<title>HTM</title>");
  assert.ok(resolveTarget(path.join(site, "upper.HTM")).filePath);
  for (const [input, message] of [
    ["", /Enter an HTTP/],
    [path.join(site, "missing.html"), /ENOENT.*readable regular file/],
    [path.join(site, "directory.html"), /not a regular file/],
    [path.join(site, "unsupported.txt"), /\.html or .htm/],
    ["ftp://example.com/index.html", /Unsupported scheme/],
    ["data:text/html,hello", /Unsupported scheme/],
    ["file://remote.example/index.html", /local file/],
    ["file:/tmp/index.html", /local file/],
    ["file:///tmp/bad%ZZ.html", /local file/],
    ["file:///tmp/bad%2Fname.html", /local file/],
    ["file:///tmp/index.html?query", /local file/],
    ["file:///tmp/index.html#hash", /local file/],
    ["\\\\server\\share\\index.html", /network path/],
  ]) assert.throws(() => resolveTarget(input), message, input);
  if (process.platform !== "win32") {
    assert.throws(() => resolveTarget("C:\\site\\index.html"), /format of the machine/);
    const unreadable = path.join(site, "unreadable.html");
    fs.writeFileSync(unreadable, "<title>Denied</title>", { mode: 0 });
    if (process.getuid?.() !== 0) assert.throws(() => resolveTarget(unreadable), /EACCES/);
  }
});

function request(url, requestPath, headers = {}, method = "GET") {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: parsed.hostname, port: parsed.port, path: requestPath, method, headers,
    }, (res) => {
      let body = "";
      res.on("data", (data) => { body += data; });
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("loopback serving limits the document tree, rejects escapes and closes idempotently", async (t) => {
  const { site, directory, file } = fixture(t);
  const target = await prepareTarget(file);
  t.after(() => target.close());
  const url = new URL(target.url);
  const prefix = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal((await fetch(target.url)).status, 200);
  const css = await fetch(new URL("style.css", target.url));
  assert.equal(css.headers.get("content-type"), "text/css");
  assert.match(await css.text(), /rgb/);
  fs.writeFileSync(path.join(directory, "secret.js"), "outside");
  fs.writeFileSync(path.join(site, ".secret.js"), "hidden");
  fs.writeFileSync(path.join(site, "private.pem"), "private");
  fs.mkdirSync(path.join(site, "folder"));
  fs.symlinkSync(path.join(directory, "secret.js"), path.join(site, "link.js"));
  fs.symlinkSync(directory, path.join(site, "escape"), "dir");
  for (const suffix of [
    "../secret.js", "%2e%2e/secret.js", "%2e%2e%2fsecret.js",
    "..%5csecret.js", ".secret.js", "private.pem", "link.js", "escape/secret.js",
    "folder", "%00.js", "missing.js", "%ZZ.js", "node_modules/pkg.js",
  ]) {
    assert.notEqual((await request(target.url, prefix + suffix)).status, 200, suffix);
  }
  assert.equal((await request(target.url, "/style.css")).status, 404);
  assert.equal((await request(target.url, url.pathname, { Host: "attacker.test" })).status, 403);
  assert.equal((await request(target.url, url.pathname, { Origin: "https://attacker.test" })).status, 403);
  assert.equal((await request(target.url, url.pathname, {}, "POST")).status, 405);
  const head = await request(target.url, url.pathname, {}, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  target.close();
  target.close();
  await assert.rejects(fetch(target.url));
});

test("real Chromium checks local JavaScript, sibling assets, screenshots, and product failures", async (t) => {
  const { file, site } = fixture(t);
  const identity = resolveTarget(file).identity;
  const run = artifacts(t, identity);
  const result = await runBrowserCheck(file, { screenshotPath: "local.png", artifactDirectory: run.directory });
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.url, identity);
  assert.equal(result.status, 200);
  assert.equal(result.title, "Local JavaScript executed");
  assert.ok(fs.statSync(run.file("local.png")).size > 100);
  await assert.rejects(fetch(result.effectiveUrl));
  fs.writeFileSync(path.join(site, "script.js"), "throw new Error('local product failure');");
  const failure = await runBrowserCheck(file);
  assert.equal(failure.passed, false);
  assert.match(failure.pageErrors.join(), /local product failure/);
  await assert.rejects(fetch(failure.effectiveUrl));
  const missing = await runBrowserCheck(path.join(site, "missing.html"));
  assert.equal(missing.passed, false);
  assert.equal(missing.checks[0].status, "not run");
});

test("local targets execute through real MCP preflight and recorded interaction evidence", async (t) => {
  const { file } = fixture(t);
  const target = await prepareTarget(file);
  t.after(() => target.close());
  const run = artifacts(t, target.identity);
  const preflight = await browserPreflight(target.url, run);
  assert.equal(preflight.status, "PASS", preflight.error);
  assert.equal(preflight.url, target.url);
  const browser = await connectBrowser(browserConfig(run.directory, "agent-browser.jsonl"));
  t.after(() => browser.close());
  for (const [name, args] of [
    ["browser_navigate", { url: target.url }],
    ["browser_evaluate", { function: "() => ({color:getComputedStyle(document.body).color, image:document.querySelector('img').naturalWidth})" }],
    ["browser_click", { target: "button", element: "Click" }],
    ["browser_evaluate", { function: "() => document.querySelector('output').textContent" }],
  ]) {
    const result = await browser.callTool(name, args);
    assert.equal(Boolean(result.isError), false, JSON.stringify(result));
  }
  const records = fs.readFileSync(run.file("agent-browser.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.match(records[1].text, /rgb\(1, 2, 3\)/);
  assert.match(records[1].text, /"image": 10/);
  fs.writeFileSync(run.file("agent-result.json"), JSON.stringify({
    status: "PASS", checks: [
      { status: "PASS", action: "browser_navigate", evidence: records[0].id, observed: "Local JavaScript executed" },
      { status: "PASS", action: "browser_click", evidence: records[2].id, observed: "Local JavaScript executed" },
      { status: "PASS", action: "browser_evaluate", evidence: records[3].id, observed: "Clicked locally" },
    ],
  }));
  const validation = validateAgentEvidence(run, target.url, 0);
  assert.equal(validation.status, "PASS", `${validation.error}\n${JSON.stringify(records)}`);
  assert.equal(validateAgentEvidence(run, target.identity, 0).status, "BLOCKED");
  const other = await prepareTarget(file);
  t.after(() => other.close());
  assert.equal(pageSlug(target.identity), pageSlug(other.identity));
  assert.equal(validateAgentEvidence(run, other.url, 0).status, "BLOCKED");
  target.close();
  const blocked = await browserPreflight(target.url, run);
  assert.equal(blocked.status, "BLOCKED");
});

test("standalone CLI resolves relative local targets independently of cwd and groups artifacts stably", async (t) => {
  const { file } = fixture(t);
  const identity = resolveTarget(file).identity;
  const pageDirectory = path.join(RESULTS, pageSlug(identity));
  t.after(() => fs.rmSync(pageDirectory, { recursive: true, force: true }));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(TARGET_BASE, "browser-check.js"), path.relative(TARGET_BASE, file), "--screenshot", "cli.png",
    ], { cwd: os.tmpdir(), env: { ...process.env, QA_ARTIFACT_DIR: "", QA_TARGET_IDENTITY: "" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => { assert.equal(code, 0, stderr); resolve(JSON.parse(stdout)); });
  });
  assert.equal(result.url, identity);
  assert.equal(result.title, "Local JavaScript executed");
  assert.ok(fs.existsSync(result.screenshot));
  assert.ok(result.screenshot.startsWith(pageDirectory + path.sep));
  await assert.rejects(fetch(result.effectiveUrl));
});
