const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");

async function smokeRoute(t, mode) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qa-smoke-route-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const run = { directory, file: (name) => path.join(directory, name), publicPath: (name) => `/results/${name}` };
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let killed = false;
  child.kill = () => { killed = true; };
  let invocation;
  let validated;
  let closed = false;
  const context = {
    require: (name) => {
      if (name === "./artifacts") return { ...require("../artifacts"), createArtifactRun: () => run };
      if (name === "./targets") return {
        resolveTarget: (url) => ({ identity: url }),
        prepareTarget: async (target) => ({ ...target, url: target.identity, close: () => { closed = true; } }),
      };
      if (name === "./browser-preflight") return { browserPreflight: () => { throw new Error("Smoke must not run agent preflight"); } };
      if (name === "./smoke-check") return {
        validateSmokeEvidence: (result, actualDirectory) => {
          assert.equal(actualDirectory, directory);
          validated = result;
          if (mode === "invalid-evidence") throw new Error("Audit hash mismatch");
          if (mode === "policy") return { status: "REVIEW", report: {
           contractVersion: require("../smoke-contract").VERSION, status: "REVIEW",
           checks: [{ id: "network", status: "REVIEW", observed: "Read-only policy blocked requests" }],
           safety: { blockedRequests: Array.from({ length: 3 }, () => ({
             method: "POST", url: "https://example.com/events", reason: "Blocked by read-only audit policy",
           })) },
          } };
          // A distinct trusted result ensures the server never renders stdout commentary.
          return mode === "partial" ? { status: "PARTIAL", report: {
            contractVersion: require("../smoke-contract").VERSION, title: "Trusted partial fixture", checks: [], tools: {},
          } } :
            { status: "BLOCKED", error: "BLOCKED: collector evidence unavailable" };
        },
      };
      if (name === "child_process") return {
        spawn: (command, args, options) => {
          invocation = { command, args, options };
          if (mode === "timeout") return child;
          setImmediate(() => {
            if (mode === "partial") {
              fs.writeFileSync(run.file("audit.json"), JSON.stringify({ partial: true }));
              child.stdout.write("incomplete JSON");
            } else if (mode === "spawn-error") {
              child.emit("error", new Error("EACCES: launch denied"));
            } else {
              child.stdout.write(JSON.stringify({ title: "Untrusted claim", passed: true, checks: [{ status: "PASS" }] }));
            }
            child.emit("close", 1);
          });
          return child;
        },
      };
      return name.startsWith("./") ? require(path.join(__dirname, "..", name)) : require(name);
    },
    __dirname: path.join(__dirname, ".."),
    process, console, URL, clearTimeout,
    setTimeout: (callback, delay) => setTimeout(callback, mode === "timeout" ? 20 : delay),
    module: { exports: {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8"), context);
  const server = context.module.exports.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/run?promptId=smoke&url=https://example.com/fixture`);
  assert.equal(response.status, 200);
  const messages = (await response.text()).trim().split("\n\n").map((line) => JSON.parse(line.slice(6)));
  return { run, invocation, validated, killed, closed, messages };
}

test("Smoke uses its own collector, validates disk evidence, and retains the full blocked checklist", async (t) => {
  const { run, invocation, validated, closed, messages } = await smokeRoute(t, "untrusted");
  assert.equal(invocation.command, process.execPath);
  assert.equal(path.basename(invocation.args[0]), "smoke-check.js");
  assert.equal(invocation.args[1], "https://example.com/fixture");
  assert.equal(invocation.options.env.QA_ARTIFACT_DIR, run.directory);
  assert.equal(invocation.options.env.QA_TARGET_IDENTITY, "https://example.com/fixture");
  assert.equal(invocation.args.some((arg) => arg.startsWith("--allow")), false);
  assert.equal(validated.title, "Untrusted claim");
  assert.equal(closed, true);
  assert.match(messages.at(-1).data, /BLOCKED.*qa-report\.html/s);
  const html = fs.readFileSync(run.file("qa-report.html"), "utf8");
  assert.equal(html, fs.readFileSync(run.file("report.html"), "utf8"));
  assert.match(html, /NOT TESTED/);
  assert.doesNotMatch(html, /\[x\] PASS/);
  const { CHECKLIST } = require("../smoke-contract");
  for (const check of CHECKLIST) assert.ok(html.includes(check.id), check.id);
});

test("Smoke retains validated partial evidence after incomplete stdout", async (t) => {
  const { run, validated, messages } = await smokeRoute(t, "partial");
  assert.equal(validated.partial, true);
  assert.match(messages.at(-1).data, /PARTIAL/);
  assert.match(fs.readFileSync(run.file("qa-report.html"), "utf8"), /Trusted partial fixture/);
});

test("Smoke API retains grouped policy diagnostics without noisy collector error summaries", async (t) => {
  const { run, messages } = await smokeRoute(t, "policy");
  assert.match(messages.at(-1).data, /REVIEW/);
  assert.doesNotMatch(messages.at(-1).data, /safety:|Non-read-only request blocked/);
  const html = fs.readFileSync(run.file("qa-report.html"), "utf8");
  assert.match(html, /Read-only policy blocked 3 requests across 1 method\/URL groups/);
  assert.match(html, /<td>POST<\/td><td>https:\/\/example.com\/events<\/td><td>3<\/td>/);
  assert.doesNotMatch(html, /\[x\] PASS/);
});

test("Smoke startup failures and deadlines still write reports, release targets and never accept success", async (t) => {
  for (const mode of ["spawn-error", "timeout", "invalid-evidence"]) {
    const { run, killed, closed, messages } = await smokeRoute(t, mode);
    assert.equal(closed, true);
    if (mode === "timeout") assert.equal(killed, true);
    assert.equal(messages.filter((message) => message.type === "end").length, 1);
    assert.match(messages.at(-1).data, mode === "timeout" ? /timed out/ :
      mode === "invalid-evidence" ? /Audit hash mismatch/ : /EACCES/);
    const html = fs.readFileSync(run.file("qa-report.html"), "utf8");
    assert.doesNotMatch(html, /\[x\] PASS/);
    assert.match(html, /NOT TESTED/);
    assert.match(html, mode === "timeout" ? /timed out/ :
      mode === "invalid-evidence" ? /Audit hash mismatch/ : /EACCES/);
  }
});

test("real Smoke API produces isolated validated reports, compatible aliases and one history entry", { timeout: 180000 }, async (t) => {
  const { pathToFileURL } = require("url");
  const { RESULTS, pageSlug } = require("../artifacts");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qa-smoke-api-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "fixture.html");
  fs.writeFileSync(file, `<!doctype html><html lang="en"><head>
    <title>Smoke API fixture</title><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>body{margin:0;color:#222;background:white}a:focus{outline:3px solid blue}main{min-height:1200px}</style>
    </head><body><a href="#main">Skip to main content</a><main id="main" tabindex="-1">
    <h1>Smoke API fixture</h1><p>Local deterministic evidence only.</p></main>
    <script>console.warn("Smoke API fixture warning");</script></body></html>`);
  const identity = pathToFileURL(file).href;
  const pageDirectory = path.join(RESULTS, pageSlug(identity));
  t.after(() => fs.rmSync(pageDirectory, { recursive: true, force: true }));
  const server = require("../server").listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await require("playwright").chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.selectOption("#prompt", "smoke");
    assert.match(await page.locator("#preview").innerText(), /Fixed Smoke baseline.*Playwright \+ axe/s);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
  const execute = async () => {
    const response = await fetch(`${base}/api/run?promptId=smoke&url=${encodeURIComponent(file)}`);
    assert.equal(response.status, 200);
    const output = await response.text();
    assert.match(output, /qa-report\.html/);
    assert.doesNotMatch(output, /Starting browser-backed agent/);
  };
  await execute();
  await execute();
  const runs = fs.readdirSync(pageDirectory);
  assert.equal(runs.length, 2);
  for (const run of runs) {
    const root = path.join(pageDirectory, run);
    const validation = JSON.parse(fs.readFileSync(path.join(root, "evidence-validation.json"), "utf8"));
    assert.ok(validation.report, validation.error);
    assert.equal(validation.report.url, identity);
    assert.equal(validation.report.viewports.length, 4);
    const canonical = `/results/${pageSlug(identity)}/${run}/qa-report.html`;
    const response = await fetch(base + canonical);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-security-policy"), "sandbox");
    const html = await response.text();
    assert.match(html, /QA &amp; Accessibility Audit Report/);
    assert.match(html, /Smoke API fixture/);
    assert.equal(await (await fetch(base + canonical.replace("qa-report.html", "report.html"))).text(), html);
    await assert.rejects(fetch(validation.report.effectiveUrl));
  }
  const history = await (await fetch(base + "/api/results")).json();
  for (const run of runs) {
    const entries = history.filter((entry) => entry.path.includes(`/${run}/`));
    assert.equal(entries.length, 1);
    assert.match(entries[0].path, /qa-report\.html$/);
  }
});
