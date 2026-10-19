// Deterministic OpenAI-compatible model for Copilot CLI BYOK mode (COPILOT_PROVIDER_BASE_URL).
// It scripts tool calls so tests exercise the real CLI permission engine without a live model.
const http = require("http");

const SUBAGENT_MARKER = "[[QA-SUBAGENT]]";

const textOf = (message) => typeof message.content === "string" ? message.content
  : (message.content || []).map((part) => part.text || "").join("");

function artifactDirectory(userText) {
  const match = userText.match(/only in ("(?:[^"\\]|\\.)*")\. Use absolute paths/);
  return match ? JSON.parse(match[1]) : "";
}

const quote = (value) => `'${value.replace(/'/g, "'\\''")}'`;

const toolCall = (index, name, args) => ({
  role: "assistant", content: null,
  tool_calls: [{ index: 0, id: `call_${index}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
});

// script: { main: [step], subagent: [step] }; step: { bash: "cmd" } | { task: true }.
// "{{DIR}}" in a bash step expands to the shell-quoted run artifact directory from the QA prompt.
function startFakeProvider(script) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (!req.url.endsWith("/chat/completions")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end("{}");
      }
      const request = JSON.parse(body);
      requests.push(request);
      const userText = request.messages.filter((message) => message.role === "user").map(textOf).join("\n");
      const subagent = userText.includes(SUBAGENT_MARKER);
      const steps = (subagent ? script.subagent : script.main) || [];
      const results = request.messages.filter((message) => message.role === "tool").map(textOf);
      const dir = artifactDirectory(userText);
      const step = request.tools?.length ? steps[results.length] : null;
      let delta;
      if (step?.bash) {
        delta = toolCall(results.length, "bash", {
          command: step.bash.replaceAll("{{DIR}}", quote(dir)), description: `step ${results.length}`, mode: "sync", initial_wait: 60,
        });
      } else if (step?.task) {
        delta = toolCall(results.length, "task", {
          name: "curl-subagent", description: "Run curl subagent", agent_type: "general-purpose", mode: "sync",
          prompt: `${SUBAGENT_MARKER} Save files only in ${JSON.stringify(dir)}. Use absolute paths.`,
        });
      } else {
        delta = { role: "assistant", content: `${subagent ? "SUBAGENT_RESULTS" : "RESULTS"}:${JSON.stringify(results)}` };
      }
      const chunk = (choice) => `data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", created: 1, model: request.model, choices: [choice] })}\n\n`;
      const finish = delta.tool_calls ? "tool_calls" : "stop";
      if (request.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(chunk({ index: 0, delta, finish_reason: null }));
        res.write(chunk({ index: 0, delta: {}, finish_reason: finish }));
        return res.end("data: [DONE]\n\n");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "fake", object: "chat.completion", created: 1, model: request.model,
        choices: [{ index: 0, message: delta, finish_reason: finish }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () => new Promise((done) => server.close(done)),
  })));
}

module.exports = { startFakeProvider, SUBAGENT_MARKER };
