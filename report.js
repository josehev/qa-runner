const fs = require("fs");
const path = require("path");

const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
const escapeHtml = (value) => text(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);

function safeLink(value, artifact = false) {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  if (artifact) {
    let decoded;
    try { decoded = decodeURIComponent(value); } catch { return null; }
    if (/[\u0000-\u001f\u007f\\?#]/.test(decoded) || /%[0-9a-f]{2}/i.test(decoded)) return null;
    const parts = decoded.split("/");
    if (parts.some((part) => part === "." || part === "..")) return null;
    if (value.startsWith("/results/") && parts.slice(2).every(Boolean)) return value;
    return parts.length === 1 && decoded && !decoded.includes(":") ? value : null;
  }
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
  if (["not applicable", "not_applicable"].includes(status)) return "N/A";
  if (["review", "partial", "n/a"].includes(status)) return status.toUpperCase();
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

function smokeSource(input, result) {
  const { VERSION, GROUPS, CHECKLIST, VIEWPORTS, completeChecks } = require("./smoke-contract");
  const trusted = input.smokeValidated === true && result.contractVersion === VERSION;
  const interruption = [...new Set([input.validation?.error, result.error, input.error].map(text).filter(Boolean))].join(" · ");
  const known = new Set(CHECKLIST.map((check) => check.id));
  const definitions = new Map(CHECKLIST.map((check) => [check.id, check]));
  const artifactNames = Array.isArray(input.artifacts) ? new Set(input.artifacts
    .filter((artifact) => artifact && safeLink(artifact.url, true)).map((artifact) => artifact.name)) : null;
  const occurrences = new Map();
  for (const check of list(result.checks)) {
    if (check && typeof check.id === "string") occurrences.set(check.id, (occurrences.get(check.id) || 0) + 1);
  }
  const acceptedChecks = trusted ? list(result.checks).filter((check) =>
    check && known.has(check.id) && occurrences.get(check.id) === 1 &&
    typeof check.status === "string" && ["PASS", "FAIL", "REVIEW", "PARTIAL", "NOT TESTED", "N/A", "NOT APPLICABLE"].includes(check.status.toUpperCase()) &&
    (!["PASS", "FAIL", "REVIEW", "PARTIAL"].includes(check.status.toUpperCase()) ||
      typeof check.observed === "string" && check.observed.trim().length > 0) &&
    (!artifactNames || !["PASS", "FAIL", "REVIEW", "PARTIAL"].includes(check.status.toUpperCase()) ||
      typeof check.evidence === "string" && artifactNames.has(check.evidence.split("#")[0])) &&
    !(definitions.get(check.id).manual && check.status.toUpperCase() === "PASS")
  ).map((check) => ({ ...check, status: check.status.toUpperCase() === "N/A" ? "NOT APPLICABLE" : check.status.toUpperCase() })) : [];
  const partialIds = new Set(acceptedChecks.filter((check) => check.status === "PARTIAL").map((check) => check.id));
  const completed = completeChecks(acceptedChecks.map((check) =>
    check.status === "PARTIAL" ? { ...check, status: "REVIEW" } : check), {
    reason: interruption || (trusted ? "Collector did not record this check." : "Collector evidence was not validated."),
  });
  return {
    trusted,
    error: interruption,
    viewports: VIEWPORTS.map((definition) => {
      const matches = trusted ? list(result.viewports).filter((viewport) => viewport &&
        viewport.width === definition.width && viewport.height === definition.height) : [];
      return matches.length === 1 ? { ...matches[0], name: definition.name } : {
        name: definition.name, width: definition.width, height: definition.height,
        status: "NOT TESTED", reason: "No validated observation for this required viewport.",
      };
    }),
    source: { ...result, bugs: [], checks: CHECKLIST.map((definition) => ({
      ...definition, ...completed.find((check) => check.id === definition.id),
      ...(!definition.manual && partialIds.has(definition.id) ? { status: "PARTIAL" } : {}),
      ...(!trusted && interruption ? { reason: [definition.reason, interruption].filter(Boolean).join(" · ") } : {}),
      id: definition.id, name: definition.name, group: definition.group,
      area: GROUPS.find((group) => group.id === definition.group)?.title || definition.group, subgroup: definition.subgroup,
      how: definition.how, criteria: definition.criteria,
    })) },
  };
}

function normalizeReport(input = {}) {
  const result = input.result || {};
  const validation = input.validation;
  const agent = input.mode === "agent";
  const smoke = input.mode === "smoke";
  const smokeData = smoke ? smokeSource(input, result) : null;
  const error = smoke ? smokeData.error : text(validation?.error || result.error || input.error);
  const accepted = smoke ? smokeData.trusted : !agent || ["PASS", "FAIL"].includes(validation?.status);
  const source = smoke ? smokeData.source : agent ? validation?.report || input.unvalidatedResult || {} : result;
  const checks = list(source.checks).map((value) => {
    const check = value || {};
    return {
      name: text(check.name || check.title || check.detail || check.action || "Unnamed check"),
      area: text(check.area || check.group || (agent ? "Browser checks" : browserAreas[check.name]) || "Other checks"),
      status: accepted ? checkStatus(check.status) : "Not tested",
      detail: text(check.detail),
      reason: text(check.reason),
      observed: text(check.observed),
      action: text(check.action),
      evidence: text(check.evidence),
      id: text(check.id), subgroup: text(check.subgroup), how: text(check.how), criteria: text(check.criteria),
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
  const explicitBugCount = bugs.length;
  // Explicit findings take precedence over summaries of the same failed check.
  const reportedEvidence = new Set(bugs.map((bug) => bug.original.evidence).filter((id) => id != null));
  for (const check of checks.filter((check) => ["Fail", "REVIEW", "PARTIAL"].includes(check.status) && check.name !== "Screenshot captured")) {
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
        original: check.original, impact: check.reason || check.observed || "Impact requires review.",
      });
    }
  }
  bugs.sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity));
  const reviewed = checks.some((check) => ["REVIEW", "PARTIAL"].includes(check.status));
  const reviewStatus = checks.some((check) => check.status === "REVIEW") ? "REVIEW" : "PARTIAL";
  const tested = counts.pass + counts.fail;
  const failed = counts.fail > 0 || explicitBugCount > 0 || validation?.status === "FAIL" ||
    (!agent && (result.passed === false || result.error));
  const status = smoke ? !accepted || (!tested && !reviewed) ? "N/A" : counts.fail ? "FAIL" :
    error || result.status === "PARTIAL" ? "PARTIAL" :
    reviewed ? reviewStatus : counts.notTested ? (tested ? "PARTIAL" : "N/A") : tested ? "PASS" : "N/A" :
    !tested ? (reviewed ? reviewStatus : "N/A") : failed ? "FAIL" : reviewed ? reviewStatus :
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
  const blockedRequests = smoke && accepted ? list(source.safety?.blockedRequests)
    .filter((entry) => entry && typeof entry.method === "string" && typeof entry.url === "string")
    .map((entry) => ({ method: entry.method, url: entry.url, reason: text(entry.reason) })) : [];
  const blockedGroups = new Map();
  for (const request of blockedRequests) {
    const key = JSON.stringify([request.method, request.url]);
    const group = blockedGroups.get(key) || { method: request.method, url: request.url, count: 0 };
    group.count++;
    blockedGroups.set(key, group);
  }
  return {
    name: text(input.name || "QA report"),
    title: text(input.title || (accepted && source.title) || "Not recorded"),
    url: text(input.url || result.url || "Not recorded"),
    startedAt, endedAt, durationMs, status, counts, areas, bugs,
    error,
    validationStatus: text(validation?.status),
    diagnostics: input.diagnostics,
    artifacts: list(input.artifacts).filter((artifact) => artifact && typeof artifact === "object" &&
      !["report.html", "qa-report.html"].includes(artifact.name)),
    details: text(input.details),
    recordedResult: Object.keys(source).length ? JSON.stringify(source, null, 2) : "",
    accepted,
    smoke, checks, viewports: smoke ? smokeData.viewports : [],
    tools: smoke && accepted ? result.tools : null,
    safety: { blockedRequests, groups: [...blockedGroups.values()], total: blockedRequests.length },
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
  const { GROUPS } = require("./smoke-contract");
  const evidence = (value) => {
    if (Array.isArray(value)) return value.map(evidence).join(", ");
    if (value && typeof value === "object") return escapeHtml(value);
    const filename = typeof value === "string" ? value.split("#")[0] : value;
    const artifact = model.artifacts.find((item) => item.name === filename || item.url === filename);
    return artifact ? linked(value, artifact.url, true) : escapeHtml(value == null || value === "" ? "Not recorded" : value);
  };
  const observation = (value) => value.length > 320 ?
    `<details><summary>${escapeHtml(value.slice(0, 160))}…</summary>${pre(value)}</details>` : escapeHtml(value);
  const checkTable = (checks) => checks.length ? `<div class="table-scroll" role="region" aria-label="Audit checks" tabindex="0"><table>
<thead><tr><th scope="col">Check</th><th scope="col">How tested</th><th scope="col">Pass criteria</th><th scope="col">Status</th><th scope="col">Observed / evidence</th></tr></thead>
<tbody>${checks.map((check) => `<tr><td>${escapeHtml(check.name)}</td><td>${escapeHtml(check.how || check.action || "Not recorded")}</td><td>${escapeHtml(check.criteria || "Not recorded")}</td><td>${badge(check.status)}</td><td>${[...new Set([check.observed, check.detail, check.reason].filter(Boolean))].map(observation).join("<br>")}${check.evidence ? `<br><strong>Evidence:</strong> ${evidence(check.original.evidence)}` : ""}</td></tr>`).join("")}</tbody></table></div>` :
    "<p>Not tested — no checks were recorded for this area.</p>";
  const findings = `<div class="table-scroll" role="region" aria-label="Findings" tabindex="0"><table>
<caption>Recorded findings, ordered by severity. Impact describes observed consequences; severity is not inferred from a failed heuristic.</caption>
<thead><tr><th scope="col">#</th><th scope="col">Severity</th><th scope="col">Finding</th></tr></thead>
<tbody>${model.bugs.length ? model.bugs.map((bug, index) => `<tr><td>${index + 1}</td><td>${badge(bug.severity)}</td><td><strong>${escapeHtml(bug.title)}</strong>${bug.description && bug.description !== bug.title ? `<div>${observation(bug.description)}</div>` : ""}<p><strong>Where found:</strong> ${escapeHtml(bug.location)} · <strong>Area:</strong> ${escapeHtml(bug.area)}</p><div><strong>Impact:</strong> ${observation(text(bug.impact || bug.original.impact || "Not recorded"))}</div></td></tr>`).join("") : "<tr><td colspan=\"3\">No bugs were recorded. Untested checks may still contain undiscovered issues.</td></tr>"}</tbody></table></div>`;
  const recordedGroup = (check) => {
    const area = check.area.toLowerCase();
    if (area === "accessibility") return "A";
    if (["design", "layout", "responsive"].includes(area)) return "B";
    if (["artifacts", "links", "media", "assets"].includes(area)) return "C";
    if (area === "runtime") return "D";
    if (area === "page loading") return "G";
    return GROUPS.find((group) => group.title.replace(/^\d+[.)]\s*/, "").toLowerCase() === area)?.id;
  };
  const recordedSubgroup = (check) => {
    if (check.subgroup) return check.subgroup;
    const name = check.name.toLowerCase();
    if (/\balt\b|image alternative/.test(name)) return "Alt text";
    if (/contrast/.test(name)) return "Color contrast";
    if (/keyboard|focus|\btab\b/.test(name)) return "Keyboard navigation & focus";
    if (/form|label|error messaging/.test(name)) return "Form labeling & error messaging";
    if (/screen.reader|aria|landmark|heading|language/.test(name)) return "Screen reader, ARIA, landmarks";
    return "";
  };
  const sections = GROUPS.map((group, index) => {
    const checks = model.smoke ? model.checks.filter((check) => check.original.group === group.id) :
      model.checks.filter((check) => recordedGroup(check) === group.id);
    const title = /^\d+[.)]\s/.test(group.title) ? group.title : `${index + 1}. ${group.title}`;
    const content = group.subgroups?.length ? group.subgroups.map((subgroup) => `<h3>${escapeHtml(subgroup)}</h3>${checkTable(checks.filter((check) => (model.smoke ? check.subgroup : recordedSubgroup(check)) === subgroup))}`).join("") :
      checkTable(checks);
    return `<section aria-labelledby="area-${index + 1}"><h2 id="area-${index + 1}">${escapeHtml(title)}</h2>${content}</section>`;
  }).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.name)} — QA report</title>
<style>
:root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #18283b; background: #eef2f7; }
* { box-sizing: border-box; }
body { margin: 0; padding: 18px 12px; font-size: 13px; line-height: 1.4; }
main { max-width: 980px; margin: auto; }
header, section { background: #fff; border: 1px solid #d5deea; border-radius: 6px; padding: 14px; margin-bottom: 12px; }
header { border-top: 5px solid #3657a0; }
h1 { font-size: 24px; line-height: 1.2; margin: 0 0 10px; }
h2 { font-size: 17px; margin: 0 0 8px; }
h3 { font-size: 14px; margin: 12px 0 6px; }
p { margin: 6px 0; }
a { color: #244b94; text-underline-offset: 3px; overflow-wrap: anywhere; }
a:focus-visible { outline: 3px solid #3657a0; outline-offset: 4px; }
.badge { display: inline-block; border-radius: 3px; padding: 1px 5px; font-size: 12px; font-weight: 700; background: #e9eef5; color: #35475e; white-space: nowrap; }
.pass { color: #145333; background: #dcf3e5; }
.fail { color: #8a1e2c; background: #fde5e8; }
dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; margin: 8px 0; }
dt { color: #485d74; font-size: .85rem; font-weight: 600; }
dd { margin: 3px 0 0; overflow-wrap: anywhere; }
.summary { font-weight: 600; }
.muted { color: #485d74; }
ul { padding-left: 24px; }
li { margin: 4px 0; overflow-wrap: anywhere; }
.evidence { margin: 6px 0; white-space: pre-wrap; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.4 ui-monospace, monospace; background: #f3f6fa; border-radius: 4px; padding: 8px; }
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; min-width: 620px; text-align: left; }
caption { text-align: left; color: #485d74; padding: 0 0 12px; }
th, td { padding: 6px 8px; border-bottom: 1px solid #d5deea; vertical-align: top; overflow-wrap: anywhere; }
th { background: #f3f6fa; }
@media (max-width: 600px) { body { padding: 8px; } header, section { padding: 10px; } }
@media print { :root { background: white; } body { padding: 0; } header, section { box-shadow: none; border-radius: 0; } .table-scroll { overflow: visible; } table { min-width: 0; } tr, li { break-inside: avoid; } a { color: inherit; } }
</style>
</head>
<body><main>
<header aria-labelledby="report-title">
<h1 id="report-title">QA &amp; Accessibility Audit Report</h1>
<p>${escapeHtml(model.name)} ${badge(model.status)}</p>
<dl>
<div><dt>Tested URL</dt><dd>${linked(model.url, model.url)}</dd></div>
<div><dt>Page title</dt><dd>${escapeHtml(model.title)}</dd></div>
<div><dt>Started (UTC)</dt><dd>${escapeHtml(model.startedAt || "Not recorded")}</dd></div>
<div><dt>Ended (UTC)</dt><dd>${escapeHtml(model.endedAt || "Not recorded")}</dd></div>
<div><dt>Total duration</dt><dd>${model.durationMs === null ? "Not recorded" : `${escapeHtml(model.durationMs)} ms`}</dd></div>
</dl>
</header>
<section aria-labelledby="summary-title"><h2 id="summary-title">Executive Summary</h2>
<p class="summary">${countText(model.counts)} · ${model.checks.filter((check) => check.status === "REVIEW").length} review · ${model.checks.filter((check) => check.status === "PARTIAL").length} partial · ${model.checks.filter((check) => check.status === "N/A").length} not applicable · ${model.bugs.length} finding(s)</p>
<p class="muted">${model.status === "N/A" ? "No accepted test outcome is available. This is not a successful run." : "Status covers recorded checks only, not full compliance or untested behavior."}</p>
${model.validationStatus ? `<p>Evidence validation: <strong>${escapeHtml(model.validationStatus)}</strong></p>` : ""}
${model.error ? `<p class="evidence">${escapeHtml(model.error)}</p>` : ""}
${model.smoke ? "<p>Deterministic smoke audit. Automated heuristics and manual review items do not establish accessibility compliance.</p>" : "<p>Recorded run checks only. The deterministic smoke checklist was not executed in this mode.</p>"}
${findings}
</section>
${model.safety?.total ? `<section aria-labelledby="safety-title"><h2 id="safety-title">Read-only policy diagnostics</h2>
<p>Read-only policy blocked ${model.safety.total} requests across ${model.safety.groups.length} method/URL groups. These are intentional safety blocks, not collector errors. Affected checks remain review or not tested; blocked actions were not exercised.</p>
<details><summary>Grouped blocked requests and full details</summary>
<div class="table-scroll" role="region" aria-label="Blocked requests" tabindex="0"><table>
<thead><tr><th scope="col">Method</th><th scope="col">URL</th><th scope="col">Count</th></tr></thead>
<tbody>${model.safety.groups.map((group) => `<tr><td>${escapeHtml(group.method)}</td><td>${escapeHtml(group.url)}</td><td>${group.count}</td></tr>`).join("")}</tbody></table></div>
${pre(JSON.stringify(model.safety.blockedRequests, null, 2))}</details></section>` : ""}
${sections}
<section aria-labelledby="reproduction-title"><h2 id="reproduction-title">Reproduction notes for failures</h2>
${model.bugs.length ? `<ol>${model.bugs.map((bug) => `<li><strong>${escapeHtml(bug.title)}</strong>: ${escapeHtml(bug.original.reproduction || bug.original.steps || `Open ${model.url}; inspect ${bug.location}.`)} ${observation(bug.description)}${bug.original.evidence != null && bug.original.evidence !== "" ? ` Evidence: ${evidence(bug.original.evidence)}` : ""}</li>`).join("")}</ol>` : "<p>No failure reproduction steps were recorded.</p>"}
</section>
<section aria-labelledby="evidence-title"><h2 id="evidence-title">Evidence (same folder)</h2>
${model.artifacts.length ? `<ul>${model.artifacts.map((artifact) => `<li>${linked(artifact.name, artifact.url, true)}</li>`).join("")}</ul>` : "<p>No evidence files were recorded.</p>"}
${model.viewports.length ? `<details open><summary>Viewport observations</summary><div class="table-scroll" role="region" aria-label="Viewport observations" tabindex="0"><table><thead><tr><th scope="col">Viewport</th><th scope="col">Overflow</th><th scope="col">CLS</th><th scope="col">Status / evidence</th></tr></thead><tbody>${model.viewports.map((viewport) => `<tr><td>${escapeHtml(viewport.width)} × ${escapeHtml(viewport.height)}</td><td>${escapeHtml(viewport.overflow ?? "Not recorded")}</td><td>${escapeHtml(viewport.cls ?? "Not recorded")}</td><td>${badge(checkStatus(viewport.status))} ${evidence(viewport.evidence || viewport.screenshot)}${[viewport.error, viewport.reason].filter(Boolean).map((value) => `<br>${escapeHtml(value)}`).join("")}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
${model.tools ? `<details><summary>Tools used</summary>${pre(text(model.tools))}</details>` : ""}
${!model.smoke ? `<details><summary>Recorded checks and details</summary>${model.areas.map((area) => `<p><strong>${escapeHtml(area.name)}</strong> — ${countText(area.counts)}</p>${checkTable(area.checks)}`).join("") || "<p>No checks were recorded. Not tested.</p>"}</details>` : ""}
${diagnostics ? `<details><summary id="diagnostics-title">Command diagnostics</summary>
<p>${escapeHtml(diagnostics.curl?.available ? diagnostics.curl.version : `curl: unavailable — ${diagnostics.curl?.error || "Not recorded"}`)}</p>
<p>Transcript: ${escapeHtml(diagnostics.transcript || "Not recorded")}</p>
${list(diagnostics.entries).length ? `<p>Commands below did not complete as intended; dependent checks are not PASS evidence.</p><ul>${diagnostics.entries.map((entry) => `<li>${badge(entry.category === "http-error" ? "Fail" : "Not tested")} <strong>${escapeHtml(entry.category)}</strong>: ${escapeHtml(entry.detail)}${pre(entry.command)}</li>`).join("")}</ul>` : "<p>No denied shell commands or curl failures were detected.</p>"}
</details>` : ""}
${model.recordedResult ? `<details><summary>${model.accepted ? "Recorded result" : "Unvalidated result — not accepted as test evidence"}</summary>${pre(model.recordedResult)}</details>` : ""}
${model.details ? `<details><summary>Run notes and output (unvalidated commentary is not test evidence)</summary>${pre(model.details)}</details>` : ""}
<p class="muted"><strong>Limitations:</strong> Automated checks do not establish WCAG compliance. ${model.smoke ? "Manual visual and accessibility assessment, real-device testing, and authenticated flows were not exercised by this smoke audit. No real screen reader was operated." : "Manual visual and accessibility assessment, real-device testing, and authenticated flows are not implied by the recorded checks."} Unrecorded behavior remains not tested.</p>
</section>
</main></body></html>`;
}

function writeReport(run, input) {
  const artifacts = fs.readdirSync(run.directory).filter((name) => !["report.html", "qa-report.html"].includes(name))
    .filter((name) => safeLink(encodeURIComponent(name), true) && fs.lstatSync(path.join(run.directory, name)).isFile())
    .map((name) => ({ name, url: run.publicPath(name) }));
  const model = normalizeReport({ ...input, artifacts });
  const html = renderReport(model);
  for (const name of ["qa-report.html", "report.html"]) {
    const descriptor = fs.openSync(run.file(name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
    try {
      if (!fs.fstatSync(descriptor).isFile()) throw new Error("Report output must be a regular file");
      fs.ftruncateSync(descriptor, 0);
      fs.writeFileSync(descriptor, html);
    } finally { fs.closeSync(descriptor); }
  }
  return model;
}

module.exports = { normalizeReport, renderReport, writeReport, safeLink };
