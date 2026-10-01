const categories = ["Performance", "Accessibility", "Functionality", "Security"];
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);
const clean = (value) => value.replace(/[`*_#]/g, "").trim();

function parseReport(content) {
  const lines = content.split(/\r?\n/);
  const title = clean(lines[0]?.replace(/^#\s*/, "") || "Test Result");
  const url = lines[1]?.startsWith("URL: ") ? lines[1].slice(5).trim() : "";
  const output = lines.slice(2).join("\n").trim();
  const visible = output.replace(/```[\s\S]*?```/g, "");
  const checks = [];
  const recommendations = [];
  const metrics = [];
  let section = "";
  const categoryFor = (text) => {
    if (/\b(load|speed|performance|latency|response time|lcp|fcp)\b/i.test(text)) return "Performance";
    if (/\b(accessib|wcag|a11y|contrast|alt text|screen reader|keyboard)\b/i.test(text)) return "Accessibility";
    if (/\b(secur|vulnerab|https|ssl|tls|xss|authentication)\b/i.test(text)) return "Security";
    if (/\b(link|navigation|form|button|page|functional|console|smoke)\b/i.test(text)) return "Functionality";
    return section || (/\baccessib/i.test(title) ? "Accessibility" : "Functionality");
  };
  const add = (status, description, severity) => {
    if (!description || checks.some(c => c.description === description)) return;
    checks.push({
      status, description, category: categoryFor(description),
      severity: status === "pass" ? null : severity ||
        (status === "warning" ? "Medium" : /\b(security|vulnerability|site unavailable|data loss)\b/i.test(description) ? "Critical" : "High")
    });
  };

  for (const line of visible.split(/\r?\n/)) {
    const heading = line.match(/^\s*#{1,5}\s*(Performance|Accessibility|Functionality|Security)\b/i);
    if (heading) section = heading[1][0].toUpperCase() + heading[1].slice(1).toLowerCase();
    const text = clean(line.replace(/^\s*(?:[-*]\s+|#{1,5}\s+)/, ""));
    if (!text) continue;
    const recommendation = text.match(/^(?:recommendation|suggested fix|fix|action):\s*(.+)/i);
    if (recommendation) {
      recommendations.push(recommendation[1]);
      continue;
    }
    const metric = text.match(/\b(load time|page load|broken links|accessibility issues)\s*:\s*(\d+(?:\.\d+)?\s*(?:ms|s|seconds)?)\b/i);
    if (metric) {
      metrics.push({ label: metric[1], value: metric[2] });
    }
    const table = line.trim().match(/^\|\s*([^|]+)\|\s*(pass(?:ed)?|fail(?:ed)?|warning|warn|critical|high|medium|low|✅|❌|⚠️)\s*\|(?:\s*([^|]*)\|)?/i);
    const direct = text.replace(/^\d+[.)]\s*/, "").match(/^(?:\[(pass|fail|warning|warn|critical|high|medium|low)\]|(pass(?:ed)?|fail(?:ed)?|warning|warn|critical|high|medium|low|✅|❌|⚠️))\s*(?:\((Critical|High|Medium|Low)\))?\s*[:\-–]?\s*(.+)/i);
    const match = table ? [null, table[2], [table[1], table[3]].filter(Boolean).join(": ")] :
      direct ? [null, direct[1] || direct[2], direct[4], direct[3]] : null;
    if (match) {
      const marker = match[1].toLowerCase();
      const status = /^(pass|✅)/.test(marker) ? "pass" : /^(warn|medium|low|⚠)/.test(marker) ? "warning" : "fail";
      const severity = match[3] || (/^(critical|high|medium|low)$/.test(marker) ? marker[0].toUpperCase() + marker.slice(1) : null);
      const description = clean(match[2]);
      add(status, description, severity);
    }
  }

  for (const metric of metrics) {
    const count = Number.parseInt(metric.value, 10);
    if (/broken links|accessibility issues/i.test(metric.label) &&
        !checks.some(c => c.description.toLowerCase().includes(metric.label.toLowerCase()))) {
      add(count ? "fail" : "pass", `${metric.label}: ${count} found`, count ? "High" : null);
    }
  }

  const error = /(?:no authentication information found|no such agent|custom agent[^\n]*failed to load|could not request permission from user|could not start copilot)/i.test(output);
  const counts = {
    passed: checks.filter(c => c.status === "pass").length,
    failed: checks.filter(c => c.status === "fail").length,
    warnings: checks.filter(c => c.status === "warning").length
  };
  return { title, url, output, checks, recommendations, metrics, counts, error };
}

function renderReport(report, stamp) {
  const { title, url, output, checks, recommendations, metrics, counts, error } = report;
  const total = checks.length;
  const critical = checks.filter(c => c.severity === "Critical").length;
  const headline = error ? "⚠️ Test could not be completed" :
    !total ? "⚠️ No verified checks reported" :
    counts.failed ? `❌ ${critical || counts.failed} ${critical ? "critical " : ""}issue${(critical || counts.failed) === 1 ? "" : "s"} found` :
    counts.warnings ? `⚠️ Passed with ${counts.warnings} warning${counts.warnings === 1 ? "" : "s"}` :
    "✅ All reported checks passed";
  const tone = error || !total ? "warning" : counts.failed ? "fail" : counts.warnings ? "warning" : "pass";
  const issueList = checks.filter(c => c.status !== "pass")
    .sort((a, b) => ["Critical", "High", "Medium", "Low"].indexOf(a.severity) - ["Critical", "High", "Medium", "Low"].indexOf(b.severity));
  const actions = [...new Set([...recommendations, ...issueList.map(c => ({
    Performance: "Review slow pages and reduce unnecessary downloads.",
    Accessibility: "Make the affected content easier to use with a keyboard or screen reader.",
    Functionality: "Repair the affected page or interaction, then check it again.",
    Security: "Ask the security team to review and fix the reported risk."
  })[c.category])])];
  const metricHtml = metrics.length ? `<section><h2>Key metrics</h2><div class="grid">${metrics.map(m =>
    `<div class="card"><span>${escapeHtml(m.label)}</span><strong>${escapeHtml(m.value)}</strong></div>`).join("")}</div></section>` : "";
  const categoryHtml = categories.map(category => {
    const group = checks.filter(c => c.category === category);
    const failing = group.filter(c => c.status === "fail").length;
    const warning = group.filter(c => c.status === "warning").length;
    const related = metrics.filter(m => (category === "Performance" && /load/i.test(m.label)) ||
      (category === "Accessibility" && /accessibility/i.test(m.label)) ||
      (category === "Functionality" && /links/i.test(m.label)));
    const state = !group.length ? related.length ? "Measured (no verdict)" : "Not checked" :
      failing ? `❌ ${failing} failed` : warning ? `⚠️ ${warning} warning${warning === 1 ? "" : "s"}` : "✅ Passed";
    return `<div class="category"><strong>${category}</strong><span>${state}${related.length ? ` · ${related.map(m => `${escapeHtml(m.label)}: ${escapeHtml(m.value)}`).join(", ")}` : ""}</span></div>`;
  }).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — QA report</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#19283a;font:17px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:960px;margin:32px auto;padding:36px;background:#fff;border:1px solid #dce3ea;border-radius:12px}
h1{font-size:2rem;margin:0 0 8px}h2{font-size:1.35rem;margin:0 0 16px}section{margin-top:36px}
.meta{color:#4b5b6b;overflow-wrap:anywhere}.headline{font-size:1.45rem;font-weight:700;padding:18px 22px;border-radius:8px;margin-top:26px}
.pass{background:#e5f4e9;color:#145329}.fail{background:#fce9e9;color:#972b2b}.warning{background:#fff2d7;color:#795000}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px}.card{border:1px solid #dce3ea;border-radius:8px;padding:18px;background:#fafbfd}
.card span{display:block;color:#4b5b6b}.card strong{display:block;font-size:1.8rem;margin-top:4px}
.category{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #dce3ea;padding:14px 0}.category span{text-align:right}
li{margin:12px 0}li strong{margin-right:8px}details{margin-top:32px;border-top:1px solid #dce3ea;padding-top:18px}
summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f8;padding:18px;border-radius:8px;font-size:.85rem}
a{color:#174c78}footer{margin-top:40px} .muted{color:#4b5b6b}
@media(max-width:600px){main{margin:0;padding:24px 18px;border:0;border-radius:0}.category{display:block}.category span{display:block;text-align:left}}
@media print{body{background:#fff}main{border:0;margin:0;padding:0}footer,details{display:none}.card,.headline{break-inside:avoid;print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body><main>
<header><h1>${escapeHtml(title)}</h1><div class="meta">Website: ${escapeHtml(url || "Not provided")}<br>Test date: ${escapeHtml(stamp)}</div>
<div class="headline ${tone}" role="status">${headline}</div></header>
<section><h2>At a glance</h2><div class="grid">
<div class="card"><span>Total checks</span><strong>${total}</strong></div>
<div class="card"><span>✅ Passed</span><strong>${counts.passed}</strong></div>
<div class="card"><span>❌ Failed</span><strong>${counts.failed}</strong></div>
<div class="card"><span>⚠️ Warnings</span><strong>${counts.warnings}</strong></div></div></section>
${metricHtml}
<section><h2>By category</h2>${categoryHtml}</section>
<section><h2>Issues found</h2>${issueList.length ? `<ul>${issueList.map(c => `<li><strong>${escapeHtml(c.severity)} · ${escapeHtml(c.category)}</strong>${escapeHtml(c.description)}</li>`).join("")}</ul>` :
  `<p class="muted">${total && !error ? "No issues were reported in the checks above." : "No findings available. The test needs to be run successfully before results can be assessed."}</p>`}</section>
<section><h2>Recommendations</h2>${actions.length ? `<ul>${actions.map(a => `<li>${escapeHtml(a)}</li>`).join("")}</ul>` :
  `<p class="muted">${total && !error ? "No changes recommended based on the reported checks." : "Resolve the test setup or review the technical details, then run the test again."}</p>`}</section>
<details><summary>Technical details (original test output)</summary><pre>${escapeHtml(output || "No output was recorded.")}</pre></details>
<footer><a href="/">← Back to QA Runner</a></footer></main></body></html>`;
}

module.exports = { parseReport, renderReport };
