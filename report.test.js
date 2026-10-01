const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseReport, renderReport } = require("./report");

test("summarizes verified checks, metrics, severity and recommendations", () => {
  const report = parseReport(`# Website review
URL: https://example.com

PASS: Navigation works
✅ Security headers are present
WARNING: Accessibility contrast is low
FAIL: Broken links on contact page
Load time: 2.3s
Broken links: 2
Recommendation: Update the contact page links.
\`\`\`
FAIL: This code example is not a check
\`\`\``);
  assert.deepEqual(report.counts, { passed: 2, failed: 1, warnings: 1 });
  assert.equal(report.metrics.length, 2);
  assert.equal(report.checks.find(c => c.description.includes("contrast")).category, "Accessibility");
  assert.equal(report.checks.find(c => c.description.includes("Broken links")).severity, "High");
  const html = renderReport(report, "Today");
  assert.match(html, /❌ 1 issue found/);
  assert.match(html, /Update the contact page links/);
  assert.match(html, /Performance.*?2.3s/);
  assert.match(html, /Technical details \(original test output\)/);
});

test("does not claim success on an incomplete agent run", () => {
  const report = parseReport(`# Smoke test
URL: https://example.com

Error: No authentication information found.`);
  assert.deepEqual(report.counts, { passed: 0, failed: 0, warnings: 0 });
  const html = renderReport(report, "Today");
  assert.match(html, /Test could not be completed/);
  assert.match(html, /Not checked/);
  assert.doesNotMatch(html, /All reported checks passed/);
});

test("extracts measured counts without inventing outcomes for load time", () => {
  const report = parseReport(`# Audit
URL: https://example.com

Load time: 1.8s
Accessibility issues: 0
Broken links: 0`);
  assert.deepEqual(report.counts, { passed: 2, failed: 0, warnings: 0 });
  assert.equal(report.checks.some(c => c.category === "Performance"), false);
  assert.match(renderReport(report, "Today"), /Measured \(no verdict\)/);
});

test("recognizes category headings, numbered checks and explicit severity", () => {
  const report = parseReport(`# Audit
URL: https://example.com

### Security
1. FAIL (Critical): Sensitive information is visible
### Performance
| Response | PASS | Quick response |`);
  assert.equal(report.checks[0].category, "Security");
  assert.equal(report.checks[0].severity, "Critical");
  assert.equal(report.checks[1].category, "Performance");
  assert.match(renderReport(report, "Today"), /1 critical issue found/);
});

test("escapes untrusted content in both summary and technical details", () => {
  const html = renderReport(parseReport(`# <script>alert(1)</script>
URL: https://example.com/?q=<img src=x onerror=alert(1)>

FAIL: Link <img src=x onerror=alert(1)> broken
Recommendation: Remove <script>alert(1)</script>`), "Today");
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<details>/);
});
