const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");
const { createArtifactRun } = require("../artifacts");
const { VERSION, GROUPS, CHECKLIST, VIEWPORTS, completeChecks } = require("../smoke-contract");
const { runSmokeCheck, validateSmokeEvidence, clsMeasurement } = require("../smoke-check");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
function assertInvalid(result, directory, pattern) {
  const validation = validateSmokeEvidence(result, directory);
  assert.equal(validation.status, "BLOCKED");
  assert.equal(validation.report, undefined);
  assert.match(validation.error, pattern);
}
function assertValidated(result, directory) {
  const validation = validateSmokeEvidence(result, directory);
  assert.ok(validation.report, validation.error);
  return validation;
}
function artifacts(t, url) {
  const run = createArtifactRun(url);
  t.after(() => fs.rmSync(run.directory, { recursive: true, force: true }));
  return run;
}

async function website(t, html = fixture("smoke-measured.html")) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Set-Cookie", "fixture=private-cookie-value; HttpOnly; SameSite=Lax");
    if (req.url === "/") res.end(html);
    else if (req.url === "/ok") res.end("<!doctype html><title>Working destination</title><main>OK</main>");
    else if (req.url === "/redirect") { res.writeHead(302, { Location: "/ok" }); res.end(); }
    else if (req.url === "/unsafe-redirect") { res.writeHead(302, { Location: "/logout" }); res.end(); }
    else if (req.url === "/forbidden") { res.writeHead(403); res.end("<title>Access denied</title>"); }
    else { res.writeHead(404); res.end("<title>Missing</title>"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return { url: `http://127.0.0.1:${server.address().port}/`, requests };
}

test("Smoke contract is complete, stable and never promotes manual claims", () => {
  assert.equal(GROUPS.length, 7);
  assert.deepEqual(VIEWPORTS.map(({ width, height }) => [width, height]), [[1920, 1080], [1366, 768], [768, 1024], [375, 812]]);
  assert.deepEqual(GROUPS[0].subgroups, ["Keyboard navigation & focus", "Screen reader, ARIA, landmarks", "Alt text", "Color contrast", "Form labeling & error messaging"]);
  assert.ok(CHECKLIST.filter((entry) => entry.group === "A").every((entry) => GROUPS[0].subgroups.includes(entry.subgroup)));
  assert.equal(new Set(CHECKLIST.map((entry) => entry.id)).size, CHECKLIST.length);
  const completed = completeChecks([{ id: "load", status: "PASS", observed: "HTTP 200" }]);
  assert.equal(completed.length, CHECKLIST.length);
  assert.equal(completed.find((entry) => entry.id === "load").status, "PASS");
  assert.ok(completed.filter((entry) => entry.id !== "load").every((entry) => entry.status === "NOT TESTED" && entry.reason));
  assert.equal(completeChecks([{ id: "screen-reader", status: "PASS" }]).find((entry) => entry.id === "screen-reader").status, "NOT TESTED");
  assert.throws(() => completeChecks([{ id: "invented", status: "PASS" }]), /Unknown/);
  assert.throws(() => completeChecks([{ id: "load", status: "PASS" }, { id: "load", status: "PASS" }]), /duplicate/);
  assert.throws(() => completeChecks([{ id: "load", status: "success" }]), /Invalid/);
});

test("CLS session windows exclude input, separate gaps, and never invent unsupported zeroes", () => {
  assert.equal(clsMeasurement(null).value, null);
  assert.equal(clsMeasurement({ clsSupported: false }).supported, false);
  const measured = clsMeasurement({ clsSupported: true, shifts: [
    { startTime: 100, value: 0.04, hadRecentInput: false },
    { startTime: 900, value: 0.03, hadRecentInput: false },
    { startTime: 1000, value: 0.8, hadRecentInput: true },
    { startTime: 2200, value: 0.06, hadRecentInput: false },
  ] });
  assert.equal(measured.value, 0.07);
  assert.equal(clsMeasurement({ clsSupported: true, shifts: [
    { startTime: 0, value: 0.04, hadRecentInput: false },
    { startTime: 1000, value: 0.06, hadRecentInput: false },
  ] }).value, 0.06);
});

test("real Smoke captures axe, keyboard, unique links, scroll failures and all viewport artifacts without auth", { timeout: 120000 }, async (t) => {
  const { url, requests } = await website(t);
  const run = artifacts(t, url);
  const result = await runSmokeCheck(url, { artifactDirectory: run.directory, timeout: 10000 });
  assert.equal(result.error, null, result.error);
  assert.equal(result.contractVersion, VERSION);
  const validated = validateSmokeEvidence(result, run.directory);
  assert.deepEqual(validated.report, result);
  const audit = JSON.parse(fs.readFileSync(run.file("audit.json")));
  assert.equal(audit.collector, "qa-runner/smoke-check");
  assert.ok(audit.tools.playwright);
  assert.equal(audit.axe.results.testEngine.version, require("axe-core/package.json").version);
  assert.deepEqual(audit.axe.tags, ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]);
  assert.ok(audit.axe.results.violations.some((rule) => rule.id === "color-contrast"));
  assert.ok(Array.isArray(audit.axe.results.incomplete));
  assert.ok(audit.axe.results.violations.some((rule) => rule.id === "image-alt"));
  assert.equal(audit.keyboard.steps.length, 40);
  assert.equal(audit.keyboard.activated, false);
  assert.ok(audit.keyboard.steps.some((step) => step.id === "email"));
  assert.ok(audit.keyboard.steps.some((step) => step.outline.style === "solid"));
  assert.equal(audit.ui.menu.before, "false");
  assert.equal(audit.ui.menu.after, "true");
  assert.equal(audit.ui.menu.targetVisible, true);
  assert.equal(audit.ui.menu.restored, true);
  assert.equal(audit.ui.skip.observed.hash, "#content");
  assert.equal(audit.ui.theme.dark.preference, "dark");
  assert.equal(audit.ui.theme.changed, true);
  assert.ok(fs.statSync(run.file("shot-desktop1920-menu.png")).size > 100);
  assert.ok(fs.statSync(run.file("shot-mobile-menu.png")).size > 100);
  assert.ok(fs.statSync(run.file("shot-dark.png")).size > 100);
  assert.ok(fs.statSync(run.file("shot-focus.png")).size > 100);
  assert.ok(fs.statSync(run.file("shot-desktop-viewport.png")).size > 100);
  assert.ok(fs.statSync(run.file("shot-first-tab.png")).size > 100);
  assert.equal(fs.readFileSync(run.file("collector-source.js"), "utf8"), fs.readFileSync(path.join(__dirname, "..", "smoke-check.js"), "utf8"));
  assert.equal(audit.links.records.filter((entry) => entry.url === url + "ok").length, 1);
  assert.equal(audit.links.records.find((entry) => entry.raw === "http://").status, "FAIL");
  assert.equal(audit.links.records.find((entry) => entry.raw === "").status, "REVIEW");
  assert.equal(audit.links.totalAnchors, audit.viewports[0].dom.links.length);
  assert.equal(audit.links.records.find((entry) => entry.url === url + "forbidden").status, "REVIEW");
  assert.equal(audit.links.records.find((entry) => entry.url === url + "forbidden").browser.status, 403);
  assert.equal(audit.links.records.find((entry) => entry.url === url + "missing").status, "FAIL");
  assert.equal(audit.links.records.find((entry) => entry.url === url + "redirect").status, "PASS");
  assert.equal(audit.links.records.find((entry) => entry.url === url + "redirect").redirects[0].status, 302);
  assert.equal(audit.links.records.find((entry) => entry.url === url + "unsafe-redirect").skipConfirmation, true);
  assert.ok(audit.links.browserConfirmations <= audit.limits.confirmations);
  assert.ok(!requests.some((entry) => entry.url === "/logout" || entry.url === "/login" || entry.method === "POST"));
  assert.ok(!fs.readFileSync(run.file("audit.json"), "utf8").includes("private-cookie-value"));
  assert.ok(!fs.readFileSync(run.file("headers.txt"), "utf8").includes("private-cookie-value"));
  for (const viewport of VIEWPORTS) {
    const measured = audit.viewports.find((entry) => entry.name === viewport.name);
    assert.deepEqual([measured.dom.viewport.width, measured.dom.viewport.height], [viewport.width, viewport.height]);
    assert.deepEqual([measured.loadDOM.viewport.width, measured.loadDOM.viewport.height], [viewport.width, viewport.height]);
    assert.ok(measured.console.some((entry) => entry.phase === "scroll" && entry.text.includes("scroll-only")));
    assert.ok(measured.responses.some((entry) => entry.phase === "scroll" && entry.url.endsWith("/scroll-network-failure")));
    assert.ok(measured.dom.images.some((entry) => entry.visible && entry.naturalWidth === 0));
    assert.equal(measured.cls.supported, true);
    assert.equal(typeof measured.cls.value, "number");
    assert.ok(measured.cls.shifts.length > 0, "early init-script observer captures fixture shift");
    assert.ok(fs.statSync(run.file(viewport.screenshot)).size > 100);
    assert.ok(Object.values(measured.permissions.states).every((state) => state !== "granted"));
  }
  assert.equal(result.checks.find((entry) => entry.id === "headings").status, "PASS");
  assert.equal(result.checks.find((entry) => entry.id === "network").status, "FAIL");
  assert.equal(result.checks.find((entry) => entry.id === "runtime").status, "FAIL");
  assert.equal(result.checks.find((entry) => entry.id === "warnings").status, "REVIEW");
  assert.equal(result.checks.find((entry) => entry.id === "menu").status, "PASS");
  assert.ok(result.checks.filter((entry) => entry.manual).every((entry) => entry.status === "NOT TESTED"));

  const invented = structuredClone(result);
  invented.checks[0].observed = "Agent commentary cannot prove a test";
  assertInvalid(invented, run.directory, /do not match/);
  assertInvalid({ ...result, title: "Agent title" }, run.directory, /stdout does not match/);
  const image = VIEWPORTS[0].screenshot;
  const original = fs.readFileSync(run.file(image));
  fs.writeFileSync(run.file(image), "agent screenshot claim");
  assertInvalid(result, run.directory, /Modified Smoke artifact/);
  fs.writeFileSync(run.file(image), original);
  fs.appendFileSync(run.file("audit.json"), "\n");
  assertInvalid(result, run.directory, /Untrusted or modified/);
});

test("real local target preserves identity and marks absent/disabled widgets not applicable", { timeout: 120000 }, async (t) => {
  const target = path.join(__dirname, "fixtures", "smoke-static.html");
  const identity = require("url").pathToFileURL(target).href;
  const run = artifacts(t, identity);
  const result = await runSmokeCheck(target, { artifactDirectory: run.directory });
  assert.equal(result.url, identity);
  assert.match(result.effectiveUrl, /^http:\/\/127\.0\.0\.1:/);
  assert.equal(result.error, null, result.error);
  assert.equal(result.checks.find((entry) => entry.id === "widgets").status, "NOT APPLICABLE");
  assert.equal(result.checks.find((entry) => entry.id === "forms").status, "NOT APPLICABLE");
  assert.equal(result.checks.find((entry) => entry.id === "alt").status, "NOT APPLICABLE");
  assert.equal(result.checks.find((entry) => entry.id === "https").status, "REVIEW");
  assertValidated(result, run.directory);
});

test("missing Chromium yields explicit setup blocker and no fabricated measurements", { timeout: 30000 }, async (t) => {
  const target = path.join(__dirname, "fixtures", "smoke-static.html");
  const identity = require("url").pathToFileURL(target).href;
  const run = artifacts(t, identity);
  const script = `
    require(${JSON.stringify(path.join(__dirname, "..", "smoke-check.js"))}).runSmokeCheck(
      ${JSON.stringify(target)}, {artifactDirectory: ${JSON.stringify(run.directory)}}
    ).then(r => process.stdout.write(JSON.stringify(r)));`;
  const { stdout } = await promisify(execFile)(process.execPath, ["-e", script], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(__dirname, "fixtures", "no-browser-installed") },
  });
  const result = JSON.parse(stdout);
  assert.equal(result.status, "BLOCKED");
  assert.match(result.error, /Chromium launch failed.*npx playwright install chromium/);
  const audit = JSON.parse(fs.readFileSync(run.file("audit.json")));
  assert.ok(audit.errors.some((entry) => entry.stage === "setup" && entry.error.includes("Chromium launch failed")));
  assert.equal(result.viewports.length, 0);
  assert.ok(result.checks.every((entry) => entry.status === "NOT TESTED"));
  assert.ok(!fs.existsSync(run.file(VIEWPORTS[0].screenshot)));
  assertValidated(result, run.directory);
});

test("HTTP navigation failure affects load without replacing manual cases with successes", { timeout: 120000 }, async (t) => {
  const { url } = await website(t, fixture("smoke-static.html"));
  const run = artifacts(t, url + "missing");
  const result = await runSmokeCheck(url + "missing", { artifactDirectory: run.directory, timeout: 5000 });
  assert.equal(result.checks.find((entry) => entry.id === "load").status, "FAIL");
  assert.equal(result.checks.find((entry) => entry.id === "screen-reader").status, "NOT TESTED");
  assert.equal(result.checks.length, CHECKLIST.length);
});

test("missing observation support is NOT TESTED rather than a fabricated CLS zero", { timeout: 120000 }, async (t) => {
  const { url } = await website(t, fixture("smoke-static.html").replace("</body>", "<script>window.__qaSmoke.clsSupported = false;</script></body>"));
  const run = artifacts(t, url);
  const result = await runSmokeCheck(url, { artifactDirectory: run.directory });
  assert.equal(result.checks.find((entry) => entry.id === "cls").status, "NOT TESTED");
  const audit = JSON.parse(fs.readFileSync(run.file("audit.json")));
  assert.ok(audit.viewports.every((entry) => entry.cls.value === null && entry.cls.supported === false));
  assertValidated(result, run.directory);
});

test("collector rejects agent-written records and missing referenced artifacts", { timeout: 120000 }, async (t) => {
  const target = path.join(__dirname, "fixtures", "smoke-static.html");
  const identity = require("url").pathToFileURL(target).href;
  const run = artifacts(t, identity);
  const result = await runSmokeCheck(target, { artifactDirectory: run.directory });
  assertInvalid({ ...result, contractVersion: "invented" }, run.directory, /version mismatch/);
  assertInvalid({ checks: result.checks }, run.directory, /Untrusted/);
  fs.unlinkSync(run.file(VIEWPORTS[0].screenshot));
  assertInvalid(result, run.directory, /ENOENT/);
});

test("CLI emits JSON only on stdout, progress on stderr, and the shared report", { timeout: 120000 }, async (t) => {
  const target = path.join(__dirname, "fixtures", "smoke-static.html");
  const identity = require("url").pathToFileURL(target).href;
  const run = artifacts(t, identity);
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [path.join(__dirname, "..", "smoke-check.js"), target], {
    cwd: path.join(__dirname, ".."), env: { ...process.env, QA_ARTIFACT_DIR: run.directory },
  });
  const result = JSON.parse(stdout);
  assert.equal(result.contractVersion, VERSION);
  assert.match(stderr, /Measuring desktop/);
  assert.ok(fs.statSync(run.file("qa-report.html")).size > 100);
  assert.ok(fs.statSync(run.file("report.html")).size > 100);
  assert.ok(fs.statSync(run.file("smoke-result.json")).size > 100);
});

test("an interrupted real collector retains independently validated viewport checkpoints", { timeout: 120000 }, async (t) => {
  const target = path.join(__dirname, "fixtures", "smoke-static.html");
  const identity = require("url").pathToFileURL(target).href;
  const run = artifacts(t, identity);
  const child = spawn(process.execPath, [path.join(__dirname, "..", "smoke-check.js"), target], {
    cwd: path.join(__dirname, ".."), detached: true,
    env: { ...process.env, QA_ARTIFACT_DIR: run.directory },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "", interrupted = false;
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    if (!interrupted && stderr.includes(`Persisted ${VIEWPORTS[0].name} Smoke checkpoint`)) {
      interrupted = true;
      process.kill(-child.pid, "SIGKILL");
    }
  });
  t.after(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} });
  await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  assert.equal(interrupted, true, stderr);
  const persisted = JSON.parse(fs.readFileSync(run.file("smoke-result.json")));
  const validation = validateSmokeEvidence(persisted, run.directory);
  assert.equal(validation.status, "PARTIAL");
  assert.equal(validation.report.endedAt, null);
  assert.equal(validation.report.checks.find((entry) => entry.id === "title").status, "PASS");
  assert.equal(validation.report.checks.find((entry) => entry.id === "load").status, "NOT TESTED");
  fs.unlinkSync(run.file("smoke-result.json"));
  const raw = JSON.parse(fs.readFileSync(run.file("audit.json")));
  assert.equal(validateSmokeEvidence(raw, run.directory).status, "PARTIAL");
});

test("browser route enforcement blocks automatic OPTIONS and POST without granting permissions", { timeout: 120000 }, async (t) => {
  const html = fixture("smoke-static.html").replace("</body>", `<script>
    fetch("/write-attempt", {method: "POST", body: "not-sent"}).catch(() => {});
    fetch("/options-attempt", {method: "OPTIONS"}).catch(() => {});
  </script></body>`);
  const { url, requests } = await website(t, html);
  const run = artifacts(t, url);
  const result = await runSmokeCheck(url, { artifactDirectory: run.directory });
  assert.equal(result.status, "REVIEW");
  assert.ok(requests.every((request) => ["GET", "HEAD"].includes(request.method)));
  assert.ok(!requests.some((request) => ["/write-attempt", "/options-attempt"].includes(request.url)));
  const audit = JSON.parse(fs.readFileSync(run.file("audit.json")));
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.error, null);
  assert.equal(result.error, null);
  assert.equal(audit.safety.blockedRequests.length, VIEWPORTS.length * 2);
  for (const method of ["POST", "OPTIONS"]) {
    assert.equal(audit.safety.blockedRequests.filter((entry) => entry.method === method).length, VIEWPORTS.length);
  }
  assert.ok(audit.safety.blockedRequests.every((entry) => entry.url.startsWith(url) && entry.reason));
  assert.deepEqual(result.safety, audit.safety);
  for (const id of ["runtime", "network"]) {
    assert.equal(result.checks.find((entry) => entry.id === id).status, "REVIEW");
  }
  assert.equal(result.checks.find((entry) => entry.id === "load").status, "PASS");
  assert.equal(result.checks.find((entry) => entry.id === "screen-reader").status, "NOT TESTED");
  assert.deepEqual(audit.safety.permissions, []);
  assertValidated(result, run.directory);
});

test("semantic, asset, content and unexercised widget evidence remains contextual and explicit", { timeout: 120000 }, async (t) => {
  const { url, requests } = await website(t, fixture("smoke-semantics.html"));
  const run = artifacts(t, url);
  const result = await runSmokeCheck(url, { artifactDirectory: run.directory });
  const validation = validateSmokeEvidence(result, run.directory);
  assert.ok(validation.report, validation.error);
  const audit = JSON.parse(fs.readFileSync(run.file("audit.json")));
  const dom = audit.viewports[0].dom;
  assert.equal(dom.positiveTabindex.length, 1);
  assert.equal(dom.duplicateIds[0].id, "duplicate");
  assert.ok(dom.invalidLists.some((entry) => entry.child.tag === "ul"));
  assert.ok(dom.outsideLandmarks.count > 0);
  assert.equal(dom.liveRegions.length, 1);
  assert.equal(dom.frames[0].title, "");
  assert.ok(dom.images.some((image) => image.linked && image.alt === "" && image.widthAttribute === "20" && image.intrinsicAspect !== image.renderedAspect));
  assert.ok(dom.metadata.some((entry) => entry.name === "og:title"));
  assert.ok(dom.metadata.some((entry) => entry.name === "twitter:card"));
  assert.ok(dom.copy.placeholders.some((text) => text.includes("undefined")));
  assert.ok(dom.copy.repeatedLines.length);
  assert.ok(dom.copy.copyright.some((text) => text.includes("2020")));
  const checks = Object.fromEntries(result.checks.map((entry) => [entry.id, entry]));
  assert.equal(checks.tabindex.status, "FAIL");
  assert.equal(checks.lists.status, "FAIL");
  assert.equal(checks["accessible-names"].status, "FAIL");
  assert.equal(checks["alt-context"].status, "REVIEW");
  assert.equal(checks["image-practices"].status, "REVIEW");
  assert.equal(checks["copy-observations"].status, "REVIEW");
  assert.equal(checks["duplicate-ids"].status, "REVIEW");
  assert.equal(checks["faq-keyboard"].status, "NOT TESTED");
  assert.equal(checks["language-dropdown"].status, "NOT TESTED");
  assert.equal(checks["search-overlay"].status, "NOT TESTED");
  assert.equal(checks["login-modal"].status, "NOT TESTED");
  assert.equal(checks["validation-states"].status, "NOT TESTED");
  assert.equal(checks["loading-success"].status, "NOT TESTED");
  assert.equal(checks["expand-all"].status, "NOT APPLICABLE");
  assert.ok(!requests.some((request) => request.url === "/login" || request.method === "POST"));
  assert.ok(audit.keyboard.steps.some((step) => step.outline.style === "none" && step.boxShadow !== "none"));
  assert.notEqual(checks.focus.status, "FAIL", "outline:none alone does not fail an alternate box-shadow indicator");
  assert.ok(audit.transport.some((entry) => entry.url?.startsWith("http:") && typeof entry.status === "number"));
  assert.ok(audit.transport.some((entry) => entry.url?.startsWith("https:") && (entry.error || typeof entry.status === "number")));
});
