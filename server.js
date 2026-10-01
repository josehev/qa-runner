const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { parseReport, renderReport } = require("./report");

const app = express();
const PORT = 4545;
// Folder containing .github/agents/*.agent.md (your QA project)
const WORKSPACE = process.env.QA_WORKSPACE || process.cwd();
const COPILOT_BIN = process.env.COPILOT_BIN || "copilot";
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

let reportWindowStart = Date.now();
const reportRequests = new Map();

// Render saved results as a stakeholder-friendly report
app.get("/results/:filename", (req, res) => {
  if (Date.now() - reportWindowStart >= 60_000) {
    reportRequests.clear();
    reportWindowStart = Date.now();
  }
  const requests = reportRequests.get(req.ip) || 0;
  if (requests >= 120) return res.status(429).send("Too many report requests");
  reportRequests.set(req.ip, requests + 1);

  if (!/^\d+-[a-z0-9-]+\.html$/.test(req.params.filename)) {
    return res.status(404).send("Result not found");
  }
  const mdFile = req.params.filename.replace(/\.html$/, ".md");
  const savedFile = fs.readdirSync(RESULTS).find(file => file === mdFile);

  if (!savedFile) {
    return res.status(404).send("Result not found");
  }
  const filePath = path.join(RESULTS, savedFile);
  const stamp = new Date(parseInt(mdFile.split('-')[0])).toLocaleString();
  res.type("html").send(renderReport(parseReport(fs.readFileSync(filePath, "utf8")), stamp));
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

  const fullPrompt = `${p.prompt.replaceAll("{{URL}}", url)}
Report each verified check on its own line as PASS: description, FAIL: description, or WARNING: description. Use short, plain-language descriptions for non-technical readers; put code, selectors, file paths and stack traces after the summary, not in check descriptions or recommendations. Include measured load time, broken links count, and accessibility issues count only if actually checked. For issues, add a separate "Recommendation: action" line in plain language. Do not mark untested checks as passed.`;
  const args = ["-p", fullPrompt, "--allow-all-tools"];
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
    send("report", htmlFile);
    send("end", code === 0 ? "Test complete. Open the Pass / Fail report to review the results." :
      "The test could not be completed. Open the report or technical output for details.");
    res.end();
  });

  req.on("close", () => child.kill());
});

app.listen(PORT, () => console.log(`QA Runner → http://localhost:${PORT}`));
