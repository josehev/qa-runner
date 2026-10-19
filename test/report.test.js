const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { normalizeReport, renderReport, writeReport, safeLink } = require("../report");

test("aggregation never treats absent, blocked or unexecuted results as PASS", () => {
  for (const input of [
    {}, { result: { passed: true } },
    { result: { passed: false, error: "Chromium missing", checks: [{ name: "Load", status: "not run" }] } },
    { result: { passed: true, checks: [{ status: "unknown" }, { status: "BLOCKED" }] } },
    { mode: "agent", validation: { status: "BLOCKED", error: "Invalid evidence" },
      unvalidatedResult: { status: "PASS", checks: [{ name: "Invented", status: "PASS", observed: "Claim" }] } },
    { mode: "agent", validation: { status: "PASS", report: { checks: [{ status: "NOT TESTED", reason: "Manual" }] } } },
  ]) {
    const model = normalizeReport(input);
    assert.equal(model.status, "N/A");
    assert.equal(model.counts.pass, 0);
    assert.equal(model.bugs.length, 0);
  }
  const blocked = normalizeReport({ mode: "agent", validation: { status: "BLOCKED", error: "Invalid evidence" },
    unvalidatedResult: { checks: [{ name: "Claim", area: "Design", status: "PASS", detail: "Unverified" }] } });
  assert.equal(blocked.areas[0].checks[0].status, "Not tested");
  assert.match(renderReport(blocked), /Unverified/);
  assert.match(renderReport(blocked), /Invalid evidence/);
});

test("failures override success while supported partial testing retains validated semantics", () => {
  const checks = [{ name: "Load", status: "passed" }, { name: "Interaction", status: "failed" }];
  assert.equal(normalizeReport({ result: { passed: true, checks } }).status, "FAIL");
  assert.equal(normalizeReport({ result: { passed: false, checks: checks.slice(0, 1) } }).status, "FAIL");
  assert.equal(normalizeReport({ result: { passed: true, error: "Incomplete", checks: checks.slice(0, 1) } }).status, "FAIL");
  const model = normalizeReport({ mode: "agent", validation: { status: "PASS", report: {
    checks: [{ status: "PASS", area: "Design", name: "Responsive layout", observed: "No overflow" },
      { status: "NOT TESTED", area: "Accessibility", name: "Screen reader", reason: "Manual testing required" }],
  } } });
  assert.equal(model.status, "PASS");
  assert.deepEqual(model.counts, { pass: 1, fail: 0, notTested: 1 });
  assert.equal(model.areas[1].checks[0].status, "Not tested");
  assert.match(renderReport(model), /Manual testing required/);
});

test("metadata uses only recorded values, including zero duration and no fabricated end time", () => {
  const empty = normalizeReport();
  assert.equal(empty.title, "Not recorded");
  assert.equal(empty.durationMs, null);
  assert.equal(empty.startedAt, null);
  const model = normalizeReport({ result: { title: "Fixture", startedAt: "2026-10-19T12:00:00Z", durationMs: 0 } });
  assert.equal(model.title, "Fixture");
  assert.equal(model.durationMs, 0);
  assert.equal(model.endedAt, null);
  assert.equal(normalizeReport({ startedAt: "bad", endedAt: "bad", durationMs: -1 }).durationMs, null);
  assert.equal(normalizeReport({ startedAt: "2026-10-19T12:00:00Z", endedAt: "2026-10-19T12:00:02Z" }).durationMs, 2000);
  const blocked = normalizeReport({ mode: "agent", validation: { status: "BLOCKED" },
    unvalidatedResult: { title: "Invented title" } });
  assert.equal(blocked.title, "Not recorded");
});

test("bug rows preserve area, location and description; sort severity and do not duplicate failed checks", () => {
  const model = normalizeReport({ mode: "agent", validation: { status: "FAIL", report: {
    checks: [{ status: "FAIL", name: "Broken layout", area: "Design", evidence: 2 },
      { status: "FAIL", name: "Unlisted defect", area: "Accessibility", evidence: 3 }],
    bugs: [
      { title: "Missing severity", evidence: 2, area: "Design", page: "/home", section: "Hero", selector: "#hero" },
      { title: "Low issue", evidence: 2, severity: "low" },
      { title: "High issue", description: "Full explanation", evidence: 2, area: "Design", location: "Footer", severity: "HIGH" },
      { title: "Critical issue", evidence: 2, severity: "Critical" },
      { title: "Unrecognized severity", evidence: 2, severity: "urgent" },
    ],
  } } });
  assert.deepEqual(model.bugs.map((bug) => bug.severity), ["Critical", "High", "Low", "Unknown", "Unknown", "Unknown"]);
  assert.equal(model.bugs.length, 6);
  assert.equal(model.bugs[3].location, "/home · Hero · #hero");
  const html = renderReport(model);
  assert.match(html, /<th scope="col">Where found<\/th>/);
  assert.match(html, /<td>Design<\/td>/);
  assert.match(html, /Full explanation/);
  assert.ok(html.indexOf("<strong>Critical issue") < html.indexOf("<strong>Low issue"));
  assert.match(html, />Unknown<\/span>/);
});

test("Browser Check maps only supported areas and preserves every recorded detail", () => {
  const result = {
    passed: false, title: "Fixture", pageErrors: ["TypeError: exact detail"],
    consoleMessages: [{ type: "warning", text: "Warning evidence" }],
    imagesMissingAlt: { count: 1, samples: ["https://example.com/image.png"] },
    checks: [
      { name: "Page response status", status: "passed", detail: "HTTP 200" },
      { name: "Images have alt attributes", status: "failed", detail: "1 image missing alt" },
      { name: "Screenshot captured", status: "failed", detail: "No screenshot" },
    ],
  };
  const model = normalizeReport({ result });
  assert.deepEqual(model.areas.map((area) => area.name), ["Page loading", "Accessibility", "Artifacts"]);
  assert.equal(model.bugs.length, 1);
  assert.equal(model.bugs[0].location, "https://example.com/image.png");
  assert.equal(model.bugs[0].severity, "Unknown");
  const html = renderReport(model);
  assert.match(html, /TypeError: exact detail/);
  assert.match(html, /Warning evidence/);
  assert.match(html, /No screenshot/);
  assert.doesNotMatch(html, /<h3>Design/);
});

test("distinct failed checks and recorded runtime errors remain separate findings", () => {
  const model = normalizeReport({ mode: "agent", validation: { status: "FAIL", report: {
    checks: [
      { status: "FAIL", name: "Layout overflow", evidence: 3 },
      { status: "FAIL", name: "Invisible focus", evidence: 3 },
    ],
  } } });
  assert.equal(model.bugs.length, 2);
  const browser = normalizeReport({ result: { passed: false, pageErrors: ["First exception", "Second exception"],
    consoleMessages: [{ type: "error", text: "Console failure" }, { type: "warning", text: "Not a bug" }],
    checks: [
      { name: "No uncaught page errors", status: "failed" },
      { name: "No console errors", status: "failed" },
    ],
  } });
  assert.deepEqual(browser.bugs.map((bug) => bug.title), ["First exception", "Second exception", "Console failure"]);
});

test("HTML and attributes are escaped in all sections and URL protocols are restricted", () => {
  const attack = `"><script>alert('x')</script>&`;
  const html = renderReport(normalizeReport({
    name: attack, url: 'javascript:alert(1)', title: attack, details: attack,
    result: { passed: false, checks: [{ name: attack, area: attack, status: "failed", observed: attack,
      reason: attack, action: attack, evidence: attack, selector: attack }] },
    diagnostics: { curl: { available: false, error: attack }, transcript: attack,
      entries: [{ category: attack, detail: attack, command: attack }] },
    artifacts: [{ name: attack, url: 'data:text/html,<script>alert(1)</script>' }],
  }));
  assert.doesNotMatch(html, /<script|href="(?:javascript|data):|"><script/);
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
  assert.match(html, /&#39;x&#39;/);
  for (const url of ["javascript:alert(1)", "data:text/html,test", "file:///etc/passwd", "//evil.test",
    "******example.com", "https://example.com/\nfoo", "/results/\\evil"]) {
    assert.equal(safeLink(url), null);
  }
  assert.equal(safeLink("/results/check.json", true), "/results/check.json");
  const safe = renderReport(normalizeReport({ url: 'https://example.com/?a="x"&b=1' }));
  assert.match(safe, /href="https:\/\/example\.com\/\?a=%22x%22&amp;b=1"/);
});

test("report structure is shared across modes, diagnostics precede the final bugs section", () => {
  for (const input of [
    { result: { passed: true, checks: [{ name: "Load", status: "passed" }] } },
    { mode: "agent", validation: { status: "PASS", report: { checks: [{ name: "Load", status: "PASS" }] } },
      diagnostics: { curl: { available: true, version: "curl fixture" }, entries: [
        { category: "network-error", command: "curl https://bad.invalid", detail: "DNS failed" },
      ] } },
    {},
  ]) {
    const html = renderReport(normalizeReport(input));
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<header aria-labelledby="report-title">/);
    assert.match(html, /<h2 id="tests-title">Test areas<\/h2>/);
    assert.match(html, /<h2 id="bugs-title">Bugs found<\/h2>/);
    assert.match(html, /@media print/);
    assert.match(html, /overflow-x: auto/);
    assert.match(html, /No bugs were recorded\. Untested checks/);
    assert.ok(html.lastIndexOf("<section") === html.indexOf('<section aria-labelledby="bugs-title">'));
    if (input.diagnostics) {
      assert.match(html, /DNS failed/);
      assert.match(html, />Not tested<\/span>/);
      assert.ok(html.indexOf('id="diagnostics-title"') < html.indexOf('id="bugs-title"'));
    }
  }
});

test("writer saves self-contained report.html and keeps other artifacts intact", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qa-report-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const run = { directory, file: (name) => path.join(directory, name), publicPath: (name) => `/results/${encodeURIComponent(name)}` };
  fs.writeFileSync(run.file("evidence.json"), '{"evidence":"preserved"}');
  writeReport(run, { name: "Fixture" });
  const html = fs.readFileSync(run.file("report.html"), "utf8");
  assert.match(html, /href="\/results\/evidence.json"/);
  assert.match(html, />N\/A<\/span>/);
  assert.equal(fs.readFileSync(run.file("evidence.json"), "utf8"), '{"evidence":"preserved"}');
});
