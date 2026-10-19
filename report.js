const fs = require("fs");

const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
const escapeHtml = (value) => text(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

function safeLink(value, artifact = false) {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  if (artifact && value.startsWith("/results/")) return value;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function checkStatus(value) {
  const status = text(value).trim().toLowerCase();
  if (["pass", "passed"].includes(status)) return "Pass";
  if (["fail", "failed"].includes(status)) return "Fail";
  return "Not tested";
}

function countsFor(checks) {
  return {
    pass: checks.filter((check) => check.status === "Pass").length,
    fail: checks.filter((check) => check.status === "Fail").length,
    notTested: checks.filter((check) => check.status === "Not tested").length,
  };
}

const browserAreas = {
  "Page response status": "Page loading",
  "No uncaught page errors": "Runtime",
  "No console errors": "Runtime",
  "Images have alt attributes": "Accessibility",
  "Screenshot captured": "Artifacts",
};
const severityOrder = ["Critical", "High", "Medium", "Low", "Informational", "Unknown"];
function severity(value) {
  return severityOrder.find((label) => label.toLowerCase() === text(value).trim().toLowerCase()) || "Unknown";
}

function normalizeReport(input = {}) {
  const result = input.result || {};
  const validation = input.validation;
  const agent = input.mode === "agent";
  const accepted = !agent || ["PASS", "FAIL"].includes(validation?.status);
  const source = agent ? validation?.report || input.unvalidatedResult || {} : result;
  const checks = list(source.checks).map((value) => {
    const check = value || {};
    return {
      name: text(check.name || check.title || check.detail || check.action || "Unnamed check"),
      area: text(check.area || (agent ? "Browser checks" : browserAreas[check.name]) || "Other checks"),
      status: accepted ? checkStatus(check.status) : "Not tested",
      detail: text(check.detail),
      reason: text(check.reason),
      observed: text(check.observed),
      action: text(check.action),
      evidence: text(check.evidence),
      original: check,
    };
  });
  const counts = countsFor(checks);
  const areas = [...new Set(checks.map((check) => check.area))].map((name) => {
    const areaChecks = checks.filter((check) => check.area === name);
    return { name, checks: areaChecks, counts: countsFor(areaChecks) };
  });
  const bugs = accepted ? list(source.bugs).filter((bug) => bug && typeof bug === "object").map((bug) => ({
    title: text(bug.title || bug.description || "Untitled bug"),
    description: text(bug.description),
    location: [bug.page, bug.section, bug.element, bug.selector, bug.location || bug.where]
      .filter(Boolean).map(text).join(" · ") || "Not recorded",
    area: text(bug.area || "Not recorded"),
    severity: severity(bug.severity),
    original: bug,
  })) : [];
  // Explicit findings take precedence over summaries of the same failed check.
  const reportedEvidence = new Set(bugs.map((bug) => bug.original.evidence).filter((id) => id != null));
  for (const check of checks.filter((check) => check.status === "Fail" && check.name !== "Screenshot captured")) {
    if (reportedEvidence.has(check.original.evidence)) continue;
    const errors = !agent && check.name === "No uncaught page errors" ? list(result.pageErrors) :
      !agent && check.name === "No console errors" ? list(result.consoleMessages)
        .filter((message) => message.type === "error").map((message) => message.text) : [];
    for (const title of errors.length ? errors : [check.name]) {
      bugs.push({
        title: text(title), description: check.detail || check.observed,
        area: check.area, severity: severity(check.original.severity),
        location: [check.original.page, check.original.section, check.original.element,
          check.original.selector, check.original.location].filter(Boolean).map(text).join(" · ") ||
          (check.name === "Images have alt attributes" ? list(result.imagesMissingAlt?.samples).join(" · ") : "") ||
          text(input.url || result.url) || "Not recorded",
        original: check.original,
      });
    }
  }
  bugs.sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity));
  const tested = counts.pass + counts.fail;
  const failed = counts.fail > 0 || bugs.length > 0 || validation?.status === "FAIL" ||
    (!agent && (result.passed === false || result.error));
  const status = !tested ? "N/A" : failed ? "FAIL" :
    (agent ? validation?.status === "PASS" : result.passed === true) ? "PASS" : "N/A";
  const date = (value) => {
    if (!value || !Number.isFinite(Date.parse(value))) return null;
    return new Date(value).toISOString();
  };
  const startedAt = date(input.startedAt || (!agent && result.startedAt));
  const endedAt = date(input.endedAt || (!agent && result.endedAt));
  const recordedDuration = input.durationMs ??
    (input.startedAt && input.endedAt && startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) :
      !agent ? result.durationMs : undefined);
  const durationMs = Number.isFinite(recordedDuration) && recordedDuration >= 0 ? recordedDuration :
    startedAt && endedAt && Date.parse(endedAt) >= Date.parse(startedAt) ? Date.parse(endedAt) - Date.parse(startedAt) : null;
  return {
    name: text(input.name || "QA report"),
    title: text(input.title || (accepted && source.title) || "Not recorded"),
    url: text(input.url || result.url || "Not recorded"),
    startedAt, endedAt, durationMs, status, counts, areas, bugs,
    error: text(validation?.error || result.error || input.error),
    validationStatus: text(validation?.status),
    diagnostics: input.diagnostics,
    artifacts: list(input.artifacts),
    details: text(input.details),
    recordedResult: Object.keys(source).length ? JSON.stringify(source, null, 2) : "",
    accepted,
  };
}

const badge = (label) => `<span class="badge ${["Pass", "PASS"].includes(label) ? "pass" : ["Fail", "FAIL"].includes(label) ? "fail" : "neutral"}">${escapeHtml(label)}</span>`;
const linked = (label, href, artifact = false) => {
  const safe = safeLink(href, artifact);
  return safe ? `<a href="${escapeHtml(safe)}" rel="noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label);
};
const countText = (counts) => `${counts.pass} passed · ${counts.fail} failed · ${counts.notTested} not tested`;
const pre = (value) => `<pre>${escapeHtml(value)}</pre>`;

function renderReport(model) {
  const diagnostics = model.diagnostics;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.name)} — QA report</title>
<style>
:root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #18283b; background: #eef2f7; }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 20px; line-height: 1.6; }
main { max-width: 1100px; margin: auto; }
header, section { background: #fff; border: 1px solid #d5deea; border-radius: 16px; padding: 28px; margin-bottom: 24px; box-shadow: 0 4px 18px #18283b08; }
header { border-top: 5px solid #3657a0; }
h1 { font-size: clamp(1.7rem, 4vw, 2.4rem); line-height: 1.2; margin: 8px 0 20px; }
h2 { font-size: 1.3rem; margin: 0 0 12px; }
h3 { font-size: 1.1rem; margin: 0; }
p { margin: 10px 0; }
a { color: #244b94; text-underline-offset: 3px; overflow-wrap: anywhere; }
a:focus-visible { outline: 3px solid #3657a0; outline-offset: 4px; }
.eyebrow { color: #485d74; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; font-size: .8rem; }
.badge { display: inline-block; border-radius: 6px; padding: 3px 10px; font-size: .85rem; font-weight: 700; background: #e9eef5; color: #35475e; white-space: nowrap; }
.pass { color: #145333; background: #dcf3e5; }
.fail { color: #8a1e2c; background: #fde5e8; }
dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; }
dt { color: #485d74; font-size: .85rem; font-weight: 600; }
dd { margin: 3px 0 0; overflow-wrap: anywhere; }
.summary { font-weight: 600; }
.muted { color: #485d74; }
.area { border-top: 1px solid #d5deea; padding-top: 20px; margin-top: 20px; }
ul { padding-left: 24px; }
li { margin: 12px 0; overflow-wrap: anywhere; }
.check-name { font-weight: 600; margin-right: 8px; }
.evidence { margin: 6px 0; white-space: pre-wrap; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: .88rem/1.6 ui-monospace, monospace; background: #f3f6fa; border-radius: 8px; padding: 16px; }
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; min-width: 620px; text-align: left; }
caption { text-align: left; color: #485d74; padding: 0 0 12px; }
th, td { padding: 14px; border-bottom: 1px solid #d5deea; vertical-align: top; overflow-wrap: anywhere; }
th { background: #f3f6fa; }
@media (max-width: 600px) { body { padding: 16px 10px; } header, section { padding: 20px; } }
@media print { :root { background: white; } body { padding: 0; } header, section { box-shadow: none; border-radius: 0; } .table-scroll { overflow: visible; } table { min-width: 0; } tr, li { break-inside: avoid; } a { color: inherit; } }
</style>
</head>
<body><main>
<header aria-labelledby="report-title">
<div class="eyebrow">QA run report</div>
<h1 id="report-title">${escapeHtml(model.name)}</h1>
${badge(model.status)}
<dl>
<div><dt>Tested URL</dt><dd>${linked(model.url, model.url)}</dd></div>
<div><dt>Page title</dt><dd>${escapeHtml(model.title)}</dd></div>
<div><dt>Started (UTC)</dt><dd>${escapeHtml(model.startedAt || "Not recorded")}</dd></div>
<div><dt>Ended (UTC)</dt><dd>${escapeHtml(model.endedAt || "Not recorded")}</dd></div>
<div><dt>Total duration</dt><dd>${model.durationMs === null ? "Not recorded" : `${escapeHtml(model.durationMs)} ms`}</dd></div>
</dl>
<p class="summary">${countText(model.counts)} · ${model.bugs.length} bug(s)</p>
<p class="muted">${model.status === "N/A" ? "No accepted test outcome is available. This is not a successful run." : "Status covers recorded checks only, not full compliance or untested behavior."}</p>
${model.validationStatus ? `<p>Evidence validation: <strong>${escapeHtml(model.validationStatus)}</strong></p>` : ""}
${model.error ? `<p class="evidence">${escapeHtml(model.error)}</p>` : ""}
</header>
<section aria-labelledby="tests-title"><h2 id="tests-title">Test areas</h2>
${model.areas.length ? model.areas.map((area) => `<div class="area"><h3>${escapeHtml(area.name)}</h3>
<p class="muted">${countText(area.counts)}</p><ul>${area.checks.map((check) => `<li><span class="check-name">${escapeHtml(check.name)}</span>${badge(check.status)}
${[["Detail", check.detail], ["Reason", check.reason], ["Observed", check.observed], ["Tool", check.action], ["Evidence ID", check.evidence]].filter(([, value]) => value).map(([label, value]) => `<p class="evidence"><strong>${label}:</strong> ${escapeHtml(value)}</p>`).join("")}</li>`).join("")}</ul></div>`).join("") : "<p>No checks were recorded. Not tested.</p>"}
</section>
${diagnostics ? `<section aria-labelledby="diagnostics-title"><h2 id="diagnostics-title">Command diagnostics</h2>
<p>${escapeHtml(diagnostics.curl?.available ? diagnostics.curl.version : `curl: unavailable — ${diagnostics.curl?.error || "Not recorded"}`)}</p>
<p>Transcript: ${escapeHtml(diagnostics.transcript || "Not recorded")}</p>
${list(diagnostics.entries).length ? `<p>Commands below did not complete as intended; dependent checks are not PASS evidence.</p><ul>${diagnostics.entries.map((entry) => `<li>${badge(entry.category === "http-error" ? "Fail" : "Not tested")} <strong>${escapeHtml(entry.category)}</strong>: ${escapeHtml(entry.detail)}${pre(entry.command)}</li>`).join("")}</ul>` : "<p>No denied shell commands or curl failures were detected.</p>"}
</section>` : ""}
${model.artifacts.length ? `<section aria-labelledby="artifacts-title"><h2 id="artifacts-title">Artifacts</h2><ul>${model.artifacts.map((artifact) => `<li>${linked(artifact.name, artifact.url, true)}</li>`).join("")}</ul></section>` : ""}
${model.recordedResult || model.details ? `<section aria-labelledby="details-title"><h2 id="details-title">Recorded details and evidence</h2>
${model.recordedResult ? `<h3>${model.accepted ? "Recorded result" : "Unvalidated agent result — not accepted as test evidence"}</h3>${pre(model.recordedResult)}` : ""}
${model.details ? `<h3>Run notes and output (unvalidated commentary is not test evidence)</h3>${pre(model.details)}` : ""}
</section>` : ""}
<section aria-labelledby="bugs-title"><h2 id="bugs-title">Bugs found</h2>
${model.bugs.length ? `<div class="table-scroll" role="region" aria-label="Bugs found" tabindex="0"><table>
<caption>Recorded findings, ordered by severity. Missing severity is Unknown.</caption>
<thead><tr><th scope="col">Description</th><th scope="col">Where found</th><th scope="col">Area</th><th scope="col">Severity</th></tr></thead>
<tbody>${model.bugs.map((bug) => `<tr><td><strong>${escapeHtml(bug.title)}</strong>${bug.description && bug.description !== bug.title ? `<p>${escapeHtml(bug.description)}</p>` : ""}</td><td>${escapeHtml(bug.location)}</td><td>${escapeHtml(bug.area)}</td><td>${badge(bug.severity)}</td></tr>`).join("")}</tbody>
</table></div>` : "<p>No bugs were recorded. Untested checks may still contain undiscovered issues.</p>"}
</section>
</main></body></html>`;
}

function writeReport(run, input) {
  const artifacts = fs.readdirSync(run.directory).filter((name) => name !== "report.html")
    .filter((name) => fs.statSync(run.file(name)).isFile())
    .map((name) => ({ name, url: run.publicPath(name) }));
  const model = normalizeReport({ ...input, artifacts });
  fs.writeFileSync(run.file("report.html"), renderReport(model));
  return model;
}

module.exports = { normalizeReport, renderReport, writeReport, safeLink };
