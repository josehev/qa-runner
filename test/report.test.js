const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
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
  assert.match(html, /<strong>Where found:<\/strong> \/home · Hero · #hero/);
  assert.match(html, /<strong>Area:<\/strong> Design/);
  assert.match(html, /<th scope="col">#<\/th><th scope="col">Severity<\/th><th scope="col">Finding<\/th>/);
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
  const accessibility = html.slice(html.indexOf('id="area-1"'), html.indexOf('id="area-2"'));
  assert.match(accessibility, /<h3>Alt text<\/h3>/);
  assert.match(accessibility, /<td>Images have alt attributes<\/td>/);
  assert.match(html.slice(html.indexOf('id="area-7"'), html.indexOf('id="reproduction-title"')),
    /<td>Page response status<\/td>/);
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

test("compact audit structure is shared across modes and evidence is the final section", () => {
  const encode = (value) => value.replaceAll("&", "&amp;");
  const sectionTitles = [
    "1. Accessibility (WCAG 2.0/2.1 AA)",
    "2. Design, UI & Responsive",
    "3. Links, Media & Assets",
    "4. JavaScript & Console Health",
    "5. Core Functionality & Edge Cases",
    "6. Content, Copy & Grammar",
    "7. Frontend & Coding Best Practices",
  ];
  const accessibilityTitles = [
    "Keyboard navigation & focus", "Screen reader, ARIA, landmarks", "Alt text",
    "Color contrast", "Form labeling & error messaging",
  ];
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
    assert.match(html, /<h1 id="report-title">QA &amp; Accessibility Audit Report<\/h1>/);
    assert.match(html, /<h2 id="summary-title">Executive Summary<\/h2>/);
    const headings = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((match) => match[1]);
    assert.deepEqual(headings, ["Executive Summary",
      ...sectionTitles.map(encode),
      "Reproduction notes for failures", "Evidence (same folder)"]);
    assert.deepEqual([...html.matchAll(/<h3>(.*?)<\/h3>/g)].map((match) => match[1]), accessibilityTitles.map(encode));
    assert.match(html, /max-width: 980px/);
    assert.match(html, /font-size: 13px/);
    assert.match(html, /@media print/);
    assert.match(html, /overflow-x: auto/);
    assert.match(html, /No bugs were recorded\. Untested checks/);
    assert.ok(html.lastIndexOf("<section") === html.indexOf('<section aria-labelledby="evidence-title">'));
    assert.match(html, /deterministic smoke checklist was not executed/);
    if (input.diagnostics) {
      assert.match(html, /DNS failed/);
      assert.match(html, />Not tested<\/span>/);
      assert.ok(html.indexOf('id="diagnostics-title"') > html.indexOf('id="evidence-title"'));
    }
  }
});

test("writer saves identical self-contained report files and keeps other artifacts intact", (t) => {
  const directory = path.join(__dirname, `.report-fixture-${process.pid}-${Date.now()}`);
  fs.mkdirSync(directory);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const run = { directory, file: (name) => path.join(directory, name), publicPath: (name) => `/results/${encodeURIComponent(name)}` };
  fs.writeFileSync(run.file("evidence.json"), '{"evidence":"preserved"}');
  writeReport(run, { name: "Fixture" });
  const html = fs.readFileSync(run.file("report.html"), "utf8");
  assert.equal(fs.readFileSync(run.file("qa-report.html"), "utf8"), html);
  assert.match(html, /href="\/results\/evidence.json"/);
  assert.match(html, />N\/A<\/span>/);
  assert.equal(fs.readFileSync(run.file("evidence.json"), "utf8"), '{"evidence":"preserved"}');
  const repeated = writeReport(run, {});
  assert.deepEqual(repeated.artifacts.map((item) => item.name), ["evidence.json"]);
});

test("review, partial and not applicable checks retain their actual outcomes", () => {
  const model = normalizeReport({ result: { checks: [
    { name: "Review", status: "REVIEW", observed: "Needs human assessment" },
    { name: "Partial", status: "PARTIAL", reason: "Only one state exercised" },
    { name: "Inapplicable", status: "N/A" },
    { name: "Manual", status: "NOT TESTED" },
  ] } });
  assert.deepEqual(model.checks.map((check) => check.status), ["REVIEW", "PARTIAL", "N/A", "Not tested"]);
  assert.equal(model.status, "REVIEW");
  assert.equal(normalizeReport({ result: { checks: [{ status: "PARTIAL", name: "Subset" }] } }).status, "PARTIAL");
  assert.equal(model.bugs.length, 2);
  assert.match(renderReport(model), /Needs human assessment/);
  assert.match(renderReport(normalizeReport({ mode: "agent", validation: { status: "PASS",
    report: { checks: [{ name: "Zero evidence index", status: "PASS", evidence: 0 }] } } })),
  /<strong>Evidence:<\/strong> 0/);
});

test("artifact links reject encoded traversal, external URLs and unsafe filenames", () => {
  for (const href of ["/results/../secret", "/results/%2e%2e/secret", "/results/%252e%252e/secret",
    "/results/%5csecret", "/results/a?x=1", "/results//evil", "https://evil.test/evidence",
    "../secret", "javascript:alert(1)", "/results/%00secret"]) {
    assert.equal(safeLink(href, true), null, href);
  }
  assert.equal(safeLink("smoke-raw.json", true), "smoke-raw.json");
});

test("writer excludes symlinks and does not follow report output symlinks", (t) => {
  const directory = path.join(__dirname, `.report-links-${process.pid}-${Date.now()}`);
  fs.mkdirSync(directory);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const run = { directory, file: (name) => path.join(directory, name), publicPath: (name) => `/results/${encodeURIComponent(name)}` };
  fs.writeFileSync(run.file("original.txt"), "untouched");
  fs.symlinkSync("original.txt", run.file("linked.txt"));
  fs.mkdirSync(run.file("subfolder"));
  const model = writeReport(run, {});
  assert.deepEqual(model.artifacts.map((artifact) => artifact.name), ["original.txt"]);
  fs.unlinkSync(run.file("qa-report.html"));
  fs.symlinkSync("original.txt", run.file("qa-report.html"));
  assert.throws(() => writeReport(run, {}));
  assert.equal(fs.readFileSync(run.file("original.txt"), "utf8"), "untouched");
});

test("smoke normalization requires trusted matching contract evidence and includes omitted checks", () => {
  const { VERSION, CHECKLIST, VIEWPORTS } = require("../smoke-contract");
  const checks = [{ id: CHECKLIST[0].id, status: "PASS", observed: "Collector result" }];
  for (const input of [{}, { smokeValidated: false }, { smokeValidated: true, version: "unknown" }]) {
    const model = normalizeReport({ mode: "smoke", ...input,
      result: { contractVersion: input.version || VERSION, checks } });
    assert.equal(model.counts.pass, 0);
    assert.equal(model.status, "N/A");
    assert.equal(model.checks.length, CHECKLIST.length);
    assert.equal(model.viewports.length, VIEWPORTS.length);
    assert.ok(model.viewports.every((viewport) => viewport.status === "NOT TESTED"));
  }
  const trusted = normalizeReport({ mode: "smoke", smokeValidated: true,
    details: "All checks passed according to model commentary.",
    result: { contractVersion: VERSION, checks } });
  assert.equal(trusted.counts.pass, 1);
  assert.equal(trusted.counts.notTested, CHECKLIST.length - 1);
  assert.equal(trusted.status, "PARTIAL");
  const html = renderReport(trusted);
  assert.match(html, /Collector did not record this check/);
  for (const definition of CHECKLIST) {
    const encoded = definition.name.replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
    assert.ok(html.includes(`<td>${encoded}</td>`), `Missing checklist row: ${definition.id}`);
  }
  const malformed = normalizeReport({ mode: "smoke", smokeValidated: true, result: { contractVersion: VERSION,
    checks: [checks[0], checks[0], { id: "invented", status: "PASS" }, { status: "PASS" },
      { id: CHECKLIST[1].id, status: "probably fine" }, { id: CHECKLIST[2].id, status: "PASS" }] } });
  assert.equal(malformed.counts.pass, 0);
  assert.equal(malformed.checks.length, CHECKLIST.length);
});

test("trusted smoke checks link existing raw collector evidence and cannot pass with missing files", () => {
  const { VERSION, CHECKLIST } = require("../smoke-contract");
  const id = CHECKLIST.find((check) => !check.manual).id;
  const input = { mode: "smoke", smokeValidated: true,
    result: { contractVersion: VERSION, checks: [
      { id, status: "PASS", observed: "Recorded observation", evidence: "audit.json#/navigation/status" },
    ] } };
  const model = normalizeReport({ ...input, artifacts: [{ name: "audit.json", url: "/results/audit.json" }] });
  assert.equal(model.counts.pass, 1);
  assert.match(renderReport(model), /href="\/results\/audit.json"[^>]*>audit.json#\/navigation\/status<\/a>/);
  assert.equal(normalizeReport({ ...input, artifacts: [] }).counts.pass, 0);
  const partial = normalizeReport({ mode: "smoke", smokeValidated: true, result: { contractVersion: VERSION,
    checks: [{ id, status: "PARTIAL", observed: "Only one state was measured", evidence: "audit.json#/observations" }] } });
  assert.equal(partial.checks.find((check) => check.id === id).status, "PARTIAL");
  assert.equal(partial.status, "PARTIAL");
});

test("smoke findings come from observed failures and review, not model findings or inferred severity", () => {
  const { VERSION, CHECKLIST } = require("../smoke-contract");
  const definitions = CHECKLIST.filter((check) => !check.manual).slice(0, 3);
  const model = normalizeReport({ mode: "smoke", smokeValidated: true,
    result: { contractVersion: VERSION, bugs: [{ title: "Invented critical security bug", severity: "Critical" }],
      checks: definitions.map((check, index) => ({
        id: check.id, name: "Model invented a different name", status: ["FAIL", "REVIEW", "NOT APPLICABLE"][index],
        observed: ["An actual failed observation", "Human judgment needed", "No relevant controls"][index],
        reason: "Context is required", evidence: "audit.json#/observations",
      })) } });
  assert.equal(model.status, "FAIL");
  assert.equal(model.bugs.length, 2);
  assert.deepEqual(model.bugs.map((bug) => bug.severity), ["Unknown", "Unknown"]);
  assert.deepEqual(model.bugs.map((bug) => bug.title), definitions.slice(0, 2).map((check) => check.name));
  assert.equal(model.checks.find((check) => check.id === definitions[2].id).status, "N/A");
  const html = renderReport(model);
  assert.match(html, /An actual failed observation/);
  assert.match(html, /Human judgment needed/);
  assert.match(html, /Impact describes observed consequences/);
  assert.match(html, /Manual visual and accessibility assessment, real-device testing, and authenticated flows were not exercised/);
  assert.match(html, /No real screen reader was operated/);
  assert.doesNotMatch(html, /Invented critical security bug|Model invented a different name/);
});

test("smoke metadata, tools, viewport observations and raw evidence are escaped", () => {
  const { VERSION, CHECKLIST, VIEWPORTS } = require("../smoke-contract");
  const attack = `"><script>alert('x')</script>&`;
  const html = renderReport(normalizeReport({ mode: "smoke", smokeValidated: true,
    result: { contractVersion: VERSION, title: attack, tools: { chromium: attack },
      checks: [{ id: CHECKLIST.find((check) => !check.manual).id, status: "REVIEW", observed: attack,
        evidence: attack, detail: attack, reason: attack }],
      viewports: [{ ...VIEWPORTS[0], overflow: attack, cls: attack, status: "REVIEW", evidence: attack }],
    } }));
  assert.doesNotMatch(html, /<script|"><script/);
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
  assert.match(html, /Tools used/);
  assert.match(html, /Viewport observations/);
});

test("long recorded observations stay compact without discarding raw detail", () => {
  const observed = `${"Recorded measurement ".repeat(60)}tail-detail<&>`;
  const html = renderReport(normalizeReport({ result: { passed: true, checks: [
    { name: "No console errors", status: "PASS", observed },
  ] } }));
  assert.match(html, /<details><summary>Recorded measurement .*?…<\/summary><pre>/);
  assert.ok(html.includes(`${observed.slice(0, -3)}&lt;&amp;&gt;</pre>`));
});

test("smoke report writer accepts only evidence files present beside identical report outputs", (t) => {
  const { VERSION, CHECKLIST } = require("../smoke-contract");
  const directory = path.join(__dirname, `.report-smoke-${process.pid}-${Date.now()}`);
  fs.mkdirSync(directory);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const run = { directory, file: (name) => path.join(directory, name), publicPath: (name) => `/results/${encodeURIComponent(name)}` };
  const input = { mode: "smoke", smokeValidated: true, result: { contractVersion: VERSION, checks: [
    { id: CHECKLIST.find((check) => !check.manual).id, status: "PASS", observed: "Recorded observation",
      evidence: "audit.json#/observations" },
  ] } };
  fs.writeFileSync(run.file("audit.json"), '{"observations":"Recorded observation"}');
  assert.equal(writeReport(run, input).counts.pass, 1);
  const html = fs.readFileSync(run.file("qa-report.html"), "utf8");
  assert.equal(fs.readFileSync(run.file("report.html"), "utf8"), html);
  assert.match(html, /href="\/results\/audit.json"[^>]*>audit.json#\/observations<\/a>/);
  fs.unlinkSync(run.file("audit.json"));
  assert.equal(writeReport(run, input).counts.pass, 0);
});

test("smoke accepts both genuine not-applicable spellings without replacing them with missing checks", () => {
  const { VERSION, CHECKLIST } = require("../smoke-contract");
  const id = CHECKLIST.find((check) => !check.manual).id;
  for (const status of ["N/A", "NOT APPLICABLE"]) {
    const model = normalizeReport({ mode: "smoke", smokeValidated: true, result: { contractVersion: VERSION,
      checks: [{ id, status, observed: "No matching controls", reason: "Not applicable to this page" }] } });
    const check = model.checks.find((entry) => entry.id === id);
    assert.equal(check.status, "N/A");
    assert.equal(check.reason, "Not applicable to this page");
    assert.equal(model.counts.notTested, CHECKLIST.length - 1);
  }
});

test("trusted interrupted smoke retains operational diagnostics and cannot become overall PASS", () => {
  const { VERSION, CHECKLIST } = require("../smoke-contract");
  const id = CHECKLIST.find((check) => !check.manual).id;
  const result = { contractVersion: VERSION, checks: [{ id, status: "PASS", observed: "Completed observation" }] };
  for (const input of [
    { error: "Collection timed out", result },
    { validation: { status: "PARTIAL", error: "Collection timed out" }, result },
    { validation: { status: "PARTIAL", error: "Partial collection" }, error: "Collection timed out", result },
    { result: { ...result, status: "PARTIAL", error: "Collection timed out" } },
  ]) {
    const model = normalizeReport({ mode: "smoke", smokeValidated: true, ...input });
    assert.equal(model.status, "PARTIAL");
    assert.match(model.error, /Collection timed out/);
    assert.equal(model.counts.pass, 1);
    assert.match(renderReport(model), /Collection timed out/);
  }
  assert.equal(normalizeReport({ mode: "smoke", smokeValidated: true, error: "Collection timed out",
    result: { contractVersion: VERSION, checks: [{ id, status: "FAIL", observed: "Actual failed observation" }] } }).status, "FAIL");
});

test("every blocked smoke check retains the validation failure reason, including manual checks", () => {
  const { VERSION, CHECKLIST } = require("../smoke-contract");
  const model = normalizeReport({ mode: "smoke", smokeValidated: false,
    validation: { status: "BLOCKED", error: "Collector checksum did not match" },
    result: { contractVersion: VERSION, checks: [] } });
  assert.equal(model.checks.length, CHECKLIST.length);
  assert.ok(model.checks.every((check) => check.reason.includes("Collector checksum did not match")));
  assert.ok(model.checks.every((check) => check.status === "Not tested"));
  assert.equal(model.status, "N/A");
});
