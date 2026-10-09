const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { toMarkdown, validateUrl } = require("./browser-check");
const { RESULTS, createArtifactRun, resultUrl, listReports, resolveResult, legacyResultPath } = require("./artifacts");
const { browserPreflight } = require("./browser-preflight");
const { agentMcpConfig } = require("./browser-mcp");
const { browserInstructions, validateAgentEvidence, evidenceMarkdown } = require("./browser-evidence");

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
app.get("/api/run", async (req, res) => {
  const { promptId, url } = req.query;
  const p = loadPrompts().find((x) => x.id === promptId);
  try {
    if (!p || typeof url !== "string") throw new Error("Invalid request");
    validateUrl(url);
  } catch {
    return res.status(400).end("Invalid prompt or URL");
  }
  const run = createArtifactRun(url, null);

  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);

  if (p.type === "playwright") return runBrowserCheck(p, url, req, res, send, run);

  send("start", `▶ ${p.name} on ${url}\nBrowser preflight…\n`);
  let disconnected = false;
  res.on("close", () => { disconnected = true; });
  const preflight = await browserPreflight(url, run);
  if (disconnected) return;
  if (preflight.status === "BLOCKED") {
    fs.writeFileSync(run.file(`${p.id}.md`), `# ${p.name}\nURL: ${url}\n\n${preflight.error}\n`);
    send("end", `${preflight.error}\nReport: ${run.publicPath(`${p.id}.html`)}`);
    return res.end();
  }

  const fullPrompt = p.prompt.replaceAll("{{URL}}", url) +
    `\n\n${p.browserSteps || ""}` +
    `\n\nSave ALL files generated during this QA run (reports, screenshots, logs, scripts, downloads, and temporary files) only in ${JSON.stringify(run.directory)}. Use absolute paths; do not write artifacts in the workspace root or other report folders. QA_ARTIFACT_DIR is set to this directory.` +
    browserInstructions(run);
  const args = [
  "-p", fullPrompt,
  "--allow-all-tools",
  `--allow-url=${new URL(url).origin}`,
  "--additional-mcp-config", `@${agentMcpConfig(run)}`
];
 if (p.agent) args.push("--agent", p.agent);

  send("out", "Browser preflight PASS. Starting browser-backed agent…\n");
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
      ? { status: "BLOCKED", error: spawnError } : validateAgentEvidence(run, url, code);
    const mdFile = run.file(`${p.id}.md`);
    const summary = validation.error || `Browser evidence validated: ${validation.status}`;
    fs.writeFileSync(run.file("evidence-validation.json"), JSON.stringify(validation, null, 2));
    const content = `# ${p.name}\nURL: ${url}\n\n**Overall: ${validation.status}**\n${evidenceMarkdown(validation, run)}\n\n## Unvalidated agent output (not accepted as test results)\n${log}`;
    fs.writeFileSync(run.file(`${p.id}.log`), log);
    fs.writeFileSync(mdFile, content);
    
    const htmlFile = run.publicPath(`${p.id}.html`);
    send("end", `\n${summary}. <a href="${htmlFile}" target="_blank">View full report →</a>`);
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
function runBrowserCheck(p, url, req, res, send, run) {
  const shotName = `${p.id}.png`;
  const args = [path.join(__dirname, "browser-check.js"), url, "--screenshot", run.file(shotName)];

  send("start", `▶ ${p.name} on ${url}\n`);
  const child = spawn(process.execPath, args, {
    cwd: run.directory, env: { ...process.env, QA_ARTIFACT_DIR: run.directory },
  });

  let log = "";
  let stdout = "";
  child.stderr.on("data", (d) => { log += d; send("out", d.toString()); });
  child.stdout.on("data", (d) => { stdout += d; });

  const timer = setTimeout(() => {
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
    let result;
    try {
      result = JSON.parse(stdout);
    } catch {
      result = null;
    }

    const summary = result
      ? toMarkdown(result, result.screenshot ? run.publicPath(shotName) : null)
      : "**Overall:** ❌ FAILED\n**Error:** Browser check did not produce a result.";
    if (result) fs.writeFileSync(run.file(`${p.id}.json`), JSON.stringify(result, null, 2));
    fs.writeFileSync(run.file(`${p.id}.log`), log);
    fs.writeFileSync(run.file(`${p.id}.md`), `# ${p.name}\nURL: ${url}\n\n${log}\n${summary}\n`);

    send("out", `\n${summary}\n`);
    const htmlFile = run.publicPath(`${p.id}.html`);
    send("end", `\n✔ Finished (exit ${code}). <a href="${htmlFile}" target="_blank">View full report →</a>`);
    res.end();
  });

  req.on("close", () => child.kill());
}

if (require.main === module) {
  app.listen(PORT, () => console.log(`QA Runner → http://localhost:${PORT}`));
}
module.exports = app;
