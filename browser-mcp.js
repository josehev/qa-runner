const fs = require("fs");
const path = require("path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { ListToolsRequestSchema, CallToolRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { chromium } = require("playwright");

const TIMEOUT = 20000;

function playwrightConfig(directory) {
  return {
    command: process.execPath,
    args: [
      path.join(path.dirname(require.resolve("@playwright/mcp/package.json")), "cli.js"),
      "--headless", "--isolated", "--browser", "chromium",
      "--executable-path", chromium.executablePath(),
      "--output-dir", directory, "--file-paths", "absolute",
      "--timeout-navigation", "15000",
    ],
    cwd: directory,
    env: { ...process.env, QA_ARTIFACT_DIR: directory },
  };
}

function agentMcpConfig(run) {
  const config = {
    mcpServers: {
      playwright: {
        type: "local",
        command: process.execPath,
        args: [path.join(__dirname, "browser-mcp.js")],
        tools: ["*"],
        env: { QA_ARTIFACT_DIR: run.directory, QA_BROWSER_TRANSCRIPT: "agent-browser.jsonl" },
      },
    },
  };
  const file = run.file("playwright-mcp.json");
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
}

function browserConfig(directory, transcript = "preflight-browser.jsonl") {
  return {
    command: process.execPath,
    args: [path.join(__dirname, "browser-mcp.js")],
    cwd: directory,
    env: { ...process.env, QA_ARTIFACT_DIR: directory, QA_BROWSER_TRANSCRIPT: transcript },
  };
}

async function connectBrowser(config) {
  const transport = new StdioClientTransport({ ...config, stderr: "pipe" });
  let diagnostics = "";
  transport.stderr?.on("data", (data) => { diagnostics = (diagnostics + data).slice(-4000); });
  const client = new Client({ name: "qa-runner", version: "1.0.0" });
  try {
    await client.connect(transport, { timeout: TIMEOUT });
    return {
      listTools: () => client.listTools({}, { timeout: TIMEOUT }),
      callTool: (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: TIMEOUT }),
      close: () => client.close(),
    };
  } catch (err) {
    await transport.close().catch(() => {});
    throw new Error(`Playwright MCP connection failed: ${err.message}${diagnostics ? `\n${diagnostics}` : ""}`);
  }
}

async function serveBrowser(directory, transcript) {
  const browser = await connectBrowser(playwrightConfig(directory));
  const server = new Server({ name: "qa-playwright", version: "1.0.0" }, { capabilities: { tools: {} } });
  let id = 0;
  server.setRequestHandler(ListToolsRequestSchema, () => browser.listTools());
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const evidenceId = ++id;
    let result;
    try {
      result = await browser.callTool(params.name, params.arguments || {});
    } catch (err) {
      result = { isError: true, content: [{ type: "text", text: err.message }] };
    }
    // Image bytes are already saved as artifacts; keep the transcript readable.
    fs.appendFileSync(transcript, JSON.stringify({
      id: evidenceId, tool: params.name, arguments: params.arguments,
      isError: Boolean(result.isError),
      text: (result.content || []).filter((item) => item.type === "text").map((item) => item.text).join("\n"),
    }) + "\n");
    return {
      ...result,
      content: [...(result.content || []), { type: "text", text: `QA evidence ID: ${evidenceId}` }],
    };
  });
  const close = async () => {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  };
  process.stdin.once("end", close);
  process.once("SIGTERM", () => close().finally(() => process.exit()));
  process.once("SIGINT", () => close().finally(() => process.exit()));
  await server.connect(new StdioServerTransport());
}

module.exports = { playwrightConfig, browserConfig, agentMcpConfig, connectBrowser, serveBrowser };

if (require.main === module) {
  const directory = process.env.QA_ARTIFACT_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error("QA_ARTIFACT_DIR must be an absolute path");
  serveBrowser(directory, path.join(directory, path.basename(process.env.QA_BROWSER_TRANSCRIPT || "agent-browser.jsonl")))
    .catch((err) => { console.error(err.message); process.exitCode = 1; });
}
