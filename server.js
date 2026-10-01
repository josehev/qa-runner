const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { toMarkdown } = require("./browser-check");

const app = express();
const PORT = 4545;
// Folder containing .github/agents/*.agent.md (your QA project)
const WORKSPACE = process.env.QA_WORKSPACE || process.cwd();
const COPILOT_BIN = process.env.COPILOT_BIN || "copilot";
const BROWSER_CHECK_TIMEOUT = 60000;
const RESULTS = path.join(__dirname, "results");
fs.mkdirSync(RESULTS, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const loadPrompts = () =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "prompts.json"), "utf8"));

app.get("/api/prompts", (_req, res) => res.json(loadPrompts()));

// Serve results as HTML
app.get("/api/results", (_req, res) => {
  const files = fs.readdirSync(RESULTS)
    .filter(f => f.endsWith('.md'))
    .sort((a, b) => parseInt(b.split('-')[0]) - parseInt(a.split('-')[0]))
    .slice(0, 20);
  
  res.json(files.map(f => ({
    name: f,
    path: `/results/${f.replace('.md', '.html')}`,
    created: new Date(parseInt(f.split('-')[0])).toLocaleString()
  })));
});

// Convert markdown results to HTML
app.get("/results/:filename", (req, res) => {
  if (/^\d+-[\w-]+\.png$/.test(req.params.filename)) {
    return res.sendFile(req.params.filename, { root: RESULTS }, (err) => {
      if (err && !res.headersSent) res.status(404).send("Result not found");
    });
  }
  const mdFile = req.params.filename.replace('.html', '.md');
  const filePath = path.join(RESULTS, mdFile);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Result not found");
  }
  
  let content = fs.readFileSync(filePath, "utf8");
  
  // Simple markdown to HTML conversion
 const title = content.match(/# (.+)/)?.[1] || "Test Result";
 const url = content.match(/URL: (.+)/)?.[1] || "";
  
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
  
  const stamp = new Date(parseInt(mdFile.split('-')[0])).toLocaleString();
  
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
  res.send(page);
});

// Server-Sent Events: streams the agent output live
app.get("/api/run", (req, res) => {
  const { promptId, url } = req.query;
  const p = loadPrompts().find((x) => x.id === promptId);
  if (!p || !/^https?:\/\//.test(url || "")) {
    return res.status(400).end("Invalid prompt or URL");
  }

  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);

  if (p.type === "playwright") return runBrowserCheck(p, url, req, res, send);

  const fullPrompt = p.prompt.replaceAll("{{URL}}", url);
  const args = [
  "-p", fullPrompt,
  "--allow-all-tools",
  "--allow-url=qa3-oru.vml.dev"
];
 if (p.agent) args.push("--agent", p.agent);

  send("start", `▶ ${p.name} on ${url}\n`);
  const child = spawn(COPILOT_BIN, args, { cwd: WORKSPACE, shell: process.platform === "win32" });

child.on("error", (err) => {
  send("end", `\n❌ Could not start Copilot CLI (${err.code}). Check that "copilot --version" works in Terminal, or set COPILOT_BIN to its full path.`);
  res.end();
});

  let log = "";
  const onData = (d) => { log += d; send("out", d.toString()); };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);

  child.on("close", (code) => {
    const timestamp = Date.now();
    const mdFile = path.join(RESULTS, `${timestamp}-${p.id}.md`);
    const content = `# ${p.name}\nURL: ${url}\n\n${log}`;
    fs.writeFileSync(mdFile, content);
    
    const htmlFile = `/results/${timestamp}-${p.id}.html`;
    send("end", `\n✔ Finished (exit ${code}). <a href="${htmlFile}" target="_blank">View full report →</a>`);
    res.end();
  });

  req.on("close", () => child.kill());
});

// Runs deterministic Playwright checks in a child process instead of the Copilot CLI
function runBrowserCheck(p, url, req, res, send) {
  const timestamp = Date.now();
  const shotName = `${timestamp}-${p.id}.png`;
  const args = [path.join(__dirname, "browser-check.js"), url, "--screenshot", path.join(RESULTS, shotName)];

  send("start", `▶ ${p.name} on ${url}\n`);
  const child = spawn(process.execPath, args, { cwd: __dirname });

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
      ? toMarkdown(result, result.screenshot ? `/results/${shotName}` : null)
      : "**Overall:** ❌ FAILED\n**Error:** Browser check did not produce a result.";
    if (result) fs.writeFileSync(path.join(RESULTS, `${timestamp}-${p.id}.json`), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(RESULTS, `${timestamp}-${p.id}.md`), `# ${p.name}\nURL: ${url}\n\n${log}\n${summary}\n`);

    send("out", `\n${summary}\n`);
    const htmlFile = `/results/${timestamp}-${p.id}.html`;
    send("end", `\n✔ Finished (exit ${code}). <a href="${htmlFile}" target="_blank">View full report →</a>`);
    res.end();
  });

  req.on("close", () => child.kill());
}

app.listen(PORT, () => console.log(`QA Runner → http://localhost:${PORT}`));
