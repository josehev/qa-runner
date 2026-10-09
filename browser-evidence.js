const fs = require("fs");
const { validateUrl } = require("./browser-check");

const INTERACTIONS = new Set([
  "browser_click", "browser_press_key", "browser_fill_form",
  "browser_select_option", "browser_drag", "browser_type",
]);

function browserInstructions(run) {
  return `
Browser testing is MANDATORY. Use the playwright MCP tools supplied to this session.
First browser_navigate to the target URL, then inspect browser_snapshot and perform
real interactions: clicks, keyboard Tab/focus, and (where present) form filling and
submissions with empty, invalid and valid input. Capture screenshots, DOM snapshots,
and console messages after interactions. Do not claim real screen-reader testing.
Preflight evidence proves setup ONLY, not that you performed any tests.
Each tool response includes a QA evidence ID. Cite these IDs and exact excerpts of
the observed result, page state, or console response, not the "Ran Playwright code"
section, invented actions/results, or planned test steps.
Write ${JSON.stringify(run.file("agent-result.json"))} with this JSON structure:
{"status":"PASS","checks":[{"status":"PASS","action":"browser_navigate","evidence":1,
"observed":"exact excerpt from this tool's response","detail":"what was verified"}]}
Add a check for navigation and at least one actual interaction. Each PASS/FAIL check
must name the browser tool, its evidence ID, and a nonempty exact observed excerpt.
Use FAIL for observed product defects; NOT TESTED only for intentionally untested
checks with a reason (e.g. manual screen-reader testing). BLOCKED means prerequisites
prevented testing: set overall status BLOCKED and provide a reason. Overall status
must be PASS, FAIL, or BLOCKED. If browser tools are missing or unusable, stop with
BLOCKED: browser environment unavailable and the actual error, never a static fallback.
Your human-readable report must agree with agent-result.json.`;
}

function validateAgentEvidence(run, url, exitCode) {
  try {
    if (exitCode !== 0) throw new Error(`Copilot CLI exited with code ${exitCode}`);
    const report = JSON.parse(fs.readFileSync(run.file("agent-result.json"), "utf8"));
    if (report.status === "BLOCKED") throw new Error(report.reason || "Agent reported browser testing blocked");
    if (!["PASS", "FAIL"].includes(report.status) || !Array.isArray(report.checks) || !report.checks.length) {
      throw new Error("Agent result must contain PASS/FAIL status and evidence-backed checks");
    }
    const records = fs.readFileSync(run.file("agent-browser.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    const supported = [];
    for (const check of report.checks) {
      if (check.status === "NOT TESTED") {
        if (typeof check.reason !== "string" || !check.reason.trim() ||
            /no browser|browser.*(?:unavailable|missing)|no tools/i.test(check.reason)) {
          throw new Error("NOT TESTED cannot hide unavailable browser infrastructure");
        }
        continue;
      }
      if (!["PASS", "FAIL"].includes(check.status)) throw new Error("Invalid or BLOCKED check status");
      const record = records.find((item) => item.id === check.evidence && item.tool === check.action);
      const observedText = record?.text?.replace(/### Ran Playwright code\n```[\s\S]*?```/g, "");
      if (!record || !record.text || typeof check.observed !== "string" ||
          check.observed.trim().length < 3 || !observedText.includes(check.observed)) {
        throw new Error(`Unsupported browser claim: ${check.action || "no action"} (evidence ${check.evidence})`);
      }
      if (record.isError) throw new Error(`Browser tool unavailable or failed: ${record.tool} — ${record.text}`);
      supported.push(record);
    }
    if (!supported.some((item) => !item.isError && item.tool === "browser_navigate" &&
        validateUrl(item.arguments.url) === validateUrl(url))) {
      throw new Error("No evidence of agent navigation to the target URL");
    }
    if (!supported.some((item) => !item.isError && INTERACTIONS.has(item.tool))) {
      throw new Error("No evidence of agent browser interaction");
    }
    if (report.status === "PASS" && report.checks.some((check) => check.status === "FAIL")) {
      throw new Error("Overall PASS contradicts failed checks");
    }
    if (report.status === "FAIL" && !report.checks.some((check) => check.status === "FAIL")) {
      throw new Error("Overall FAIL requires an observed failed check");
    }
    return { status: report.status, report };
  } catch (err) {
    return { status: "BLOCKED", error: `BLOCKED: browser evidence unavailable or invalid — ${err.message}` };
  }
}

function evidenceMarkdown(validation, run) {
  if (validation.status === "BLOCKED") return validation.error;
  const lines = [
    `Browser evidence validated: ${validation.status}`,
    `Tool transcript: ${run.publicPath("agent-browser.jsonl")}`,
    `Preflight: ${run.publicPath("browser-preflight.json")} (setup only)`,
    "",
    "## Validated checks",
  ];
  for (const check of validation.report.checks) {
    lines.push(check.status === "NOT TESTED"
      ? `- NOT TESTED: ${check.reason}`
      : `- ${check.status}: ${check.action} (evidence ${check.evidence})\n  Observed: ${check.observed}`);
  }
  return lines.join("\n");
}

module.exports = { browserInstructions, validateAgentEvidence, evidenceMarkdown };
