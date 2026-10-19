const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { toMarkdown } = require("./browser-check");
const { resolveTarget, prepareTarget } = require("./targets");
const { RESULTS, createArtifactRun, resultUrl, listReports, resolveResult, legacyResultPath } = require("./artifacts");
const { browserPreflight } = require("./browser-preflight");
const { agentMcpConfig } = require("./browser-mcp");
const { browserInstructions, validateAgentEvidence, evidenceMarkdown } = require("./browser-evidence");
const {
  SESSION_TRANSCRIPT, agentCliArgs, checkCurl, curlInstructions, commandDiagnostics, diagnosticsMarkdown, diagnosticsSummary,
} = require("./agent-permissions");

const app = express();
const PORT = 4545;
// Folder containing .github/agents/*.agent.md (your QA project)
const WORKSPACE = process.env.QA_WORKSPACE || process.cwd();
const COPILOT_BIN = process.env.COPILOT_BIN || "copilot";
const BROWSER_CHECK_TIMEOUT = 60000;
const AGENT_TIMEOUT = 15 * 60 * 1000;
fs.mkdirSync(RESULTS, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  if (!["GET", "HEAD"].includes(req.method)) return next();
  let source;
  try {
    source = decodeURIComponent(req.path).replace(/^\//, "");
  } catch {
    return res.status(400).send("Invalid artifact path");
  }
  const target = legacyResultPath(source);
  if (!target) return next();
  return res.redirect(301, "/results/" + target.split("/").map(encodeURIComponent).join("/"));
});

const loadPrompts = () =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "prompts.json"), "utf8"));

app.get("/api/prompts", (_req, res) => res.json(loadPrompts()));

// A tested page has a different origin and must not start runs or probe local paths.
app.use(["/api/run", "/api/target"], (req, res, next) => {
  if ((req.get("Sec-Fetch-Site") && !["same-origin", "none"].includes(req.get("Sec-Fetch-Site"))) ||
      (req.get("Origin") && req.get("Origin") !== `${req.protocol}://${req.get("Host")}`)) {
    return res.status(403).end("Open QA Runner directly to validate targets or start tests.");
  }
  next();
});
app.post("/api/target", (req, res) => {
  try {
    resolveTarget(req.body.target);
    res.json({ valid: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Serve results as HTML
app.get("/api/results", (_req, res) => {
  const files = listReports()
    .sort((a, b) => b.created - a.created)
    .slice(0, 20);
  
  res.json(files.map(({ file, created }) => ({
    name: path.relative(RESULTS, file),
    path: resultUrl(file.replace(/\.md$/, '.html')),
    created: new Date(created).toLocaleString()
  })));
});

// Convert markdown results to HTML
app.get("/results/*", (req, res) => {
  const filename = req.params[0];
  const filePath = filename.endsWith(".html")
    ? resolveResult(filename.replace(/\.html$/, ".md")) : null;

  if (!filePath) {
    const artifact = resolveResult(filename);
    if (!artifact) return res.status(404).send("Result not found");
    res.set("Content-Security-Policy", "sandbox");
    return res.sendFile(artifact, (err) => {
      if (err && !res.headersSent) res.status(404).send("Result not found");
    });
  }
  
  let content = fs.readFileSync(filePath, "utf8");
  
  // Simple markdown to HTML conversion
 const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
 const title = escapeHtml(content.match(/# (.+)/)?.[1] || "Test Result");
 const url = escapeHtml(content.match(/URL: (.+)/)?.[1] || "");
  
  // Extract the test output (everything after the URL line)
  const output = content.split('\n').slice(2).join('\n');
  
  // Escape HTML and convert markdown
  let html = output
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
  
  const stamp = new Date(fs.statSync(filePath).mtimeMs).toLocaleString();
  
  const page = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 2rem;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 2rem;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .header h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
      font-weight: 700;
    }
    .header .url {
      font-size: 0.95rem;
      opacity: 0.9;
      word-break: break-all;
      font-family: 'Monaco', 'Menlo', monospace;
    }
    .meta {
      font-size: 0.85rem;
      opacity: 0.8;
      margin-top: 0.5rem;
    }
    .content {
      padding: 2rem;
      line-height: 1.7;
      color: #333;
    }
    .content code {
      background: #f5f5f5;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.9em;
      color: #d63384;
    }
    .content strong {
      color: #222;
      font-weight: 600;
    }
    .content em {
      color: #666;
    }
    .content br + br { margin-bottom: 1rem; }
    .footer {
      background: #f8f9fa;
      padding: 1.5rem 2rem;
      border-top: 1px solid #e9ecef;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .back-button {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 0.75rem 1.5rem;
      border-radius: 6px;
      text-decoration: none;
      font-size: 0.95rem;
      font-weight: 500;
      transition: background 0.2s;
    }
    .back-button:hover {
      background: #764ba2;
    }
    .timestamp {
      font-size: 0.85rem;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🧪 ${title}</h1>
      <div class="url">🔗 ${url}</div>
      <div class="meta">Completed: ${stamp}</div>
    </div>
    <div class="content">
      ${html}
    </div>
    <div class="footer">
      <a href="/" class="back-button">← Back to QA Runner</a>
      <span class="timestamp">${stamp}</span>
    </div>
  </div>
</body>
</html>`;
  
  res.set('Content-Type', 'text/html');
  res.set("Content-Security-Policy", "sandbox");
  res.send(page);
});

// Server-Sent Events: streams the agent output live
const runRateLimit = rateLimit({
  windowMs: 60000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
let activeRuns = 0;
app.get("/api/run", runRateLimit, (req, res, next) => {
  if (activeRuns >= 2) return res.status(429).end("Two QA runs are already active; retry when one finishes.");
  activeRuns++;
  res.once("close", () => { activeRuns--; });
  next();
}, async (req, res) => {
  const { promptId, url } = req.query;
  const p = loadPrompts().find((x) => x.id === promptId);
  let target;
  let run;
  let disconnected = false;
  res.once("close", () => { disconnected = true; target?.close(); });
  try {
    if (!p || typeof url !== "string") throw new Error("Invalid request");
    const resolved = resolveTarget(url);
    target = await prepareTarget(resolved);
    if (disconnected) { target.close(); return; }
    run = createArtifactRun(target.identity, null);
    fs.writeFileSync(run.file("target.json"), JSON.stringify({
      original: target.original, identity: target.identity, effectiveUrl: target.url,
    }, null, 2));
  } catch (err) {
    target?.close();
    return res.status(400).end(err.message);
  }
  const browserUrl = target.url;

  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);

  if (p.type === "playwright") return runBrowserCheck(p, url, req, res, send, run, target);

  const curl = await checkCurl();
  if (disconnected) return;
  send("start", `▶ ${p.name} on ${url}\nBrowser preflight…\n`);
  const preflight = await browserPreflight(browserUrl, run);
  if (disconnected) return;
  if (preflight.status === "BLOCKED") {
    fs.writeFileSync(run.file(`${p.id}.md`), `# ${p.name}\nURL: ${url}\n\n${preflight.error}\n`);
    send("end", `${preflight.error}\nReport: ${run.publicPath(`${p.id}.html`)}`);
    return res.end();
  }

  const fullPrompt = p.prompt.replaceAll("{{URL}}", browserUrl) +
    (target.filePath ? "\n\nThis is a local static HTML preview, not a production web server. Backend endpoints and production HTTPS behavior are not provided; report unavailable checks as NOT TESTED with a reason." : "") +
    `\n\n${p.browserSteps || ""}` +
    `\n\nSave ALL files generated during this QA run (reports, screenshots, logs, scripts, downloads, and temporary files) only in ${JSON.stringify(run.directory)}. Use absolute paths; do not write artifacts in the workspace root or other report folders. QA_ARTIFACT_DIR is set to this directory.` +
    browserInstructions(run) +
    curlInstructions(run, curl);
  const args = [
  "-p", fullPrompt,
  ...agentCliArgs(run, browserUrl),
  "--additional-mcp-config", `@${agentMcpConfig(run)}`
];
 if (p.agent) args.push("--agent", p.agent);

  send("out", `Browser preflight PASS. curl: ${curl.available ? curl.version : curl.error}.\nStarting browser-backed agent…\n`);
  const child = spawn(COPILOT_BIN, args, {
    cwd: WORKSPACE, shell: false,
    detached: process.platform !== "win32",
    env: { ...process.env, QA_ARTIFACT_DIR: run.directory },
  });

  const stopAgent = (signal = "SIGTERM") => {
    if (process.platform !== "win32" && child.pid) {
      try {
        // Copilot's MCP servers and Chromium belong to the same process group.
        process.kill(-child.pid, signal);
      } catch (err) {
        if (err.code !== "ESRCH") child.kill(signal);
      }
    } else {
      child.kill(signal);
    }
  };
  let spawnError;
child.on("error", (err) => {
  spawnError = `BLOCKED: browser environment unavailable — Could not start Copilot CLI (${err.message}). Check "copilot --version" or COPILOT_BIN.`;
});

  let log = "";
  const onData = (d) => { log += d; send("out", d.toString()); };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);

  let finished = false;
  let timer;
  const finish = (code) => {
    clearTimeout(timer);
    if (disconnected || finished) return;
    finished = true;
    const validation = spawnError
      ? { status: "BLOCKED", error: spawnError } : validateAgentEvidence(run, browserUrl, code);
    const mdFile = run.file(`${p.id}.md`);
    const summary = validation.error || `Browser evidence validated: ${validation.status}`;
    fs.writeFileSync(run.file("evidence-validation.json"), JSON.stringify(validation, null, 2));
    const transcript = fs.existsSync(run.file(SESSION_TRANSCRIPT)) ? fs.readFileSync(run.file(SESSION_TRANSCRIPT), "utf8") : null;
    const diagnostics = commandDiagnostics({ log, transcript, run, workspace: WORKSPACE, curl });
    fs.writeFileSync(run.file("command-diagnostics.json"), JSON.stringify(diagnostics, null, 2));
    const content = `# ${p.name}\nURL: ${url}\n\n**Overall: ${validation.status}**\n${evidenceMarkdown(validation, run)}\n\n${diagnosticsMarkdown(diagnostics)}\n\n## Unvalidated agent output (not accepted as test results)\n${log}`;
    fs.writeFileSync(run.file(`${p.id}.log`), log);
    fs.writeFileSync(mdFile, content);
    
    const htmlFile = run.publicPath(`${p.id}.html`);
    const commandSummary = diagnosticsSummary(diagnostics);
    send("end", `\n${summary}.${commandSummary ? ` ${commandSummary}` : ""} <a href="${htmlFile}" target="_blank">View full report →</a>`);
    res.end();
  };
  child.on("close", finish);
  timer = setTimeout(() => {
    spawnError = `BLOCKED: browser environment unavailable — Agent timed out after ${AGENT_TIMEOUT / 60000} minutes; browser audit did not complete.`;
    finish(null);
    stopAgent("SIGKILL");
  }, AGENT_TIMEOUT);

  res.on("close", () => {
    clearTimeout(timer);
    stopAgent();
  });
});

// Runs deterministic Playwright checks in a child process instead of the Copilot CLI
function runBrowserCheck(p, url, req, res, send, run, target) {
  const shotName = `${p.id}.png`;
  const args = [path.join(__dirname, "browser-check.js"), target.url, "--screenshot", run.file(shotName)];

  send("start", `▶ ${p.name} on ${url}\n`);
  const child = spawn(process.execPath, args, {
    cwd: run.directory, env: { ...process.env, QA_ARTIFACT_DIR: run.directory, QA_TARGET_IDENTITY: target.identity },
  });

  let log = "";
  let stdout = "";
  let timedOut = false;
  child.stderr.on("data", (d) => { log += d; send("out", d.toString()); });
  child.stdout.on("data", (d) => { stdout += d; });

  const timer = setTimeout(() => {
    timedOut = true;
    target.close();
    const msg = `Timed out after ${BROWSER_CHECK_TIMEOUT / 1000}s\n`;
    log += msg;
    send("out", msg);
    child.kill();
  }, BROWSER_CHECK_TIMEOUT);

  child.on("error", (err) => {
    log += `Could not start browser check (${err.code})\n`;
  });

  child.on("close", (code) => {
    clearTimeout(timer);
    target.close();
    if (res.destroyed) return;
    let result;
    try {
      result = timedOut ? null : JSON.parse(stdout);
    } catch {
      result = null;
    }

    const summary = result
      ? toMarkdown(result, result.screenshot ? run.publicPath(shotName) : null)
      : "**Overall:** ❌ FAILED\n**Error:** Browser check did not produce a result.";
    if (result) {
      result.originalTarget = url;
      fs.writeFileSync(run.file(`${p.id}.json`), JSON.stringify(result, null, 2));
    }
    fs.writeFileSync(run.file(`${p.id}.log`), log);
    fs.writeFileSync(run.file(`${p.id}.md`), `# ${p.name}\nURL: ${url}\n\n${log}\n${summary}\n`);

    send("out", `\n${summary}\n`);
    const htmlFile = run.publicPath(`${p.id}.html`);
    send("end", `\n✔ Finished (exit ${code}). <a href="${htmlFile}" target="_blank">View full report →</a>`);
    res.end();
  });

  res.on("close", () => { clearTimeout(timer); child.kill(); });
}

if (require.main === module) {
  app.listen(PORT, "127.0.0.1", () => console.log(`QA Runner → http://localhost:${PORT}`));
}
module.exports = app;
