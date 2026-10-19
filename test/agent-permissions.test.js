const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  SESSION_TRANSCRIPT, agentCliArgs, checkCurl, curlInstructions, usesCurl, pathsOutside,
  parseLog, parseTranscript, classifyOutput, commandDiagnostics, diagnosticsMarkdown, diagnosticsSummary,
} = require("../agent-permissions");

const run = { directory: "/qa/result reports/page/run 1", file: (name) => path.join("/qa/result reports/page/run 1", name) };
const curl = { available: true, version: "curl 8.5.0" };
const DENIAL = "Permission denied because no interactive user response was available. Retry in an interactive\n    session so the user can approve it, or try an alternative that does not require this permission.";

test("Copilot args add only the run directory and transcript to the existing tool and target URL approvals", () => {
  const args = agentCliArgs(run, "http://127.0.0.1:4100/page.html?x=1");
  assert.deepEqual(args, [
    "--allow-all-tools", "--allow-url=http://127.0.0.1:4100",
    "--add-dir", run.directory, "--share", run.file(SESSION_TRANSCRIPT),
  ]);
  for (const broad of ["--allow-all", "--yolo", "--allow-all-paths", "--allow-all-urls"]) {
    assert.ok(!args.includes(broad), `${broad} must not be used`);
  }
  assert.ok(!args.some((arg) => /^--(?:allow-tool|add-dir=)/.test(arg)));
  assert.ok(!args.includes("/tmp") && !args.includes(os.homedir()));
});

test("curl instructions direct file transfers to the run directory and forbid PASS for failed commands", () => {
  const text = curlInstructions(run, curl);
  assert.ok(text.includes(JSON.stringify(run.directory)));
  assert.ok(text.includes(JSON.stringify(path.join(run.directory, "page.html"))));
  assert.match(text, /including \/tmp\) are denied/);
  assert.match(text, /POST\/PUT\/PATCH\/DELETE, uploads\) only to the target/);
  assert.match(text, /never as PASS/);
  const missing = curlInstructions(run, { available: false, error: "curl was not found on PATH" });
  assert.match(missing, /curl is unavailable on this host \(curl was not found on PATH\)/);
  assert.match(missing, /NOT TESTED/);
});

test("curl availability distinguishes a missing executable from an installed curl", async () => {
  assert.deepEqual(await checkCurl(path.join(os.tmpdir(), "qa-no-such-curl")), { available: false, error: "curl was not found on PATH" });
  const installed = await checkCurl();
  if (installed.available) assert.match(installed.version, /^curl \d/);
});

test("curl detection requires curl in command position, not a substring or argument", () => {
  for (const command of [
    "curl -s https://example.com", "cd '/qa/run 1' && curl -o page.html \"https://e.com/a?b=1&c=2\"",
    "curl -sI https://e.com | head -1", "/usr/bin/curl https://e.com", "A=1 curl https://e.com",
    "code=$(curl -s -o /dev/null -w '%{http_code}' https://e.com)", "for u in a b; do curl \"$u\"; done",
  ]) assert.equal(usesCurl(command), true, command);
  for (const command of [
    "echo curl > /tmp/x", "grep curl notes.txt", "xcurl https://e.com", "curl_config --help",
    "wget https://e.com/curl", "echo \"curl https://e.com\"", "rm -rf /tmp/curl",
  ]) assert.equal(usesCurl(command), false, command);
});

test("path hints report literal paths outside approved roots and ignore URLs, devices and variables", () => {
  const roots = [run.directory, "/workspace", "/var/folders/tmp"];
  assert.deepEqual(pathsOutside("cd /tmp && curl -s https://e.com/a?x=/etc -o page.html", roots), ["/tmp"]);
  assert.deepEqual(pathsOutside(`curl -o "${run.directory}/a.html" -D "${run.directory}/h.txt" https://e.com`, roots), []);
  assert.deepEqual(pathsOutside("curl -F file=@/etc/passwd --output=/srv/out https://e.com", roots), ["/etc/passwd", "/srv/out"]);
  assert.deepEqual(pathsOutside('curl -o "$QA_ARTIFACT_DIR/a" -o /dev/null https://e.com 2>/dev/null', roots), []);
  assert.deepEqual(pathsOutside("curl -o ~/x https://e.com", roots), [path.join(os.homedir(), "x")]);
});

test("console logs from current and older Copilot CLIs expose denied shell commands, including subagents", () => {
  const log = [
    "● step 0 (shell)", "  │ curl -sS http://127.0.0.1:1/one", "  │ echo second-line", "  └ 3 lines…", "",
    "✗ General-purpose (model: gpt-4.1) Run curl subagent",
    "  │ Permission denied because no interactive user response was available. Retry in an interactive",
    "  │ step 0 (shell)", "  │   │ curl -sS http://h/sub -o '/qa/result reports/page/run", "  │   │ 1'/sub.txt", "  │   └ 2 lines…",
    "  └ step 1 (shell)", "      └ curl -s http://h/deny -o /srv/sd.txt", "      Approval check", "        └ ✗ Denied, no one to approve",
    "",
    "Done.✗ Download homeboost page HTML (shell)",
    "  │ cd /tmp && curl -s https://e.com -o", "  │ homeboost.html",
    "  └ Permission denied and could not request permission from user. Copilot needed the user's approval",
    "    and no one could answer. This is not an OS or sandbox error.",
    "✗ step 2 (shell)", "  │ wc -l /tmp/full.html", `  └ ${DENIAL}`, "  Approval check", "    └ ✗ Denied, no one to approve",
  ].join("\n");
  const blocks = parseLog(log);
  assert.deepEqual(blocks.map((block) => [block.title, block.denied]), [
    ["step 0", false], ["step 0", false], ["step 1", true], ["Download homeboost page HTML", true], ["step 2", true],
  ]);
  assert.equal(blocks[0].command, "curl -sS http://127.0.0.1:1/one\necho second-line");
  assert.equal(blocks[2].command, "curl -s http://h/deny -o /srv/sd.txt");
  assert.equal(blocks[3].command, "cd /tmp && curl -s https://e.com -o\nhomeboost.html");
  assert.equal(blocks[4].command, "wc -l /tmp/full.html");
});

const transcript = (entries) => entries.map(([command, output, failed]) =>
  `### \`bash\`${failed ? " — Failed" : ""}\n\n**step**\n\n$ ${command}\n${output === null ? "\n" : `\n\`\`\`\n${output}\n\`\`\`\n`}\n---\n`).join("\n");

test("transcripts keep multi-line commands, full output and output-less subagent calls", () => {
  const entries = parseTranscript(transcript([
    ["curl -sS http://h/one\necho second", "GET /one\nsecond\n<exited with exit code 0>"],
    ["curl -s http://h/deny -o /srv/x", null],
    ["cd /tmp && curl -s http://h", DENIAL.replace(/\n\s+/, " "), true],
  ]));
  assert.deepEqual(entries, [
    { command: "curl -sS http://h/one\necho second", output: "GET /one\nsecond\n<exited with exit code 0>" },
    { command: "curl -s http://h/deny -o /srv/x", output: null },
    { command: "cd /tmp && curl -s http://h", output: DENIAL.replace(/\n\s+/, " ") },
  ]);
});

test("curl output classification separates missing curl, sandbox, HTTP and network failures", () => {
  assert.equal(classifyOutput("/bin/bash: line 1: curl: command not found").category, "curl-missing");
  assert.equal(classifyOutput("zsh: command not found: curl").category, "curl-missing");
  assert.equal(classifyOutput("curl: (7) Failed to connect: Operation not permitted").category, "sandbox-restricted");
  assert.equal(classifyOutput("curl: (22) The requested URL returned error: 404").category, "http-error");
  for (const code of ["6", "7", "28", "35", "60"]) {
    assert.equal(classifyOutput(`curl: (${code}) failure`).category, "network-error", code);
  }
  assert.equal(classifyOutput("200\n<exited with exit code 0>"), null);
  assert.equal(classifyOutput("404"), null, "observed HTTP statuses are test results, not command failures");
});

test("diagnostics combine log denials with transcript output and stay separate from validated results", () => {
  const log = [
    "✗ step 0 (shell)", "  │ cd /tmp && curl -s http://h -o", "  │ page.html", `  └ ${DENIAL}`,
    "● step 1 (shell)", "  │ curl -sS --fail http://h/500", "  └ 2 lines…",
    "● step 2 (shell)", "  │ curl -sS http://nowhere.invalid", "  └ 2 lines…",
    "● step 3 (shell)", "  │ curl -sS http://h", "  └ 2 lines…",
    "✗ step 4 (shell)", "  │ echo curl > /srv/notes.txt", `  └ ${DENIAL}`,
  ].join("\n");
  const shared = transcript([
    ["cd /tmp && curl -s http://h -o page.html", DENIAL.replace(/\n\s+/, " "), true],
    ["curl -sS --fail http://h/500", "curl: (22) The requested URL returned error: 500"],
    ["curl -sS http://nowhere.invalid", "curl: (6) Could not resolve host: nowhere.invalid"],
    ["curl -sS http://h", "curl: (7) Failed to connect to h port 80: Operation not permitted"],
    ["echo curl > /srv/notes.txt", DENIAL.replace(/\n\s+/, " "), true],
    ["grep 'curl: (7)' notes.txt", "curl: (7) quoted text"],
  ]);
  const diagnostics = commandDiagnostics({ log, transcript: shared, run, workspace: "/workspace", curl, tempDirectory: "/var/folders/tmp" });
  assert.deepEqual(diagnostics.counts, { "permission-denied": 2, "http-error": 1, "network-error": 1, "sandbox-restricted": 1 });
  assert.equal(diagnostics.entries[0].command, "cd /tmp && curl -s http://h -o page.html");
  assert.match(diagnostics.entries[0].detail, /path verification: .*: \/tmp$/);
  assert.equal(diagnostics.entries[1].curl, false);
  assert.match(diagnostics.entries[1].detail, /\/srv\/notes\.txt/);
  assert.match(diagnostics.entries.find((entry) => entry.category === "network-error").detail, /host could not be resolved/);
  const markdown = diagnosticsMarkdown(diagnostics);
  assert.match(markdown, /not executed and are not PASS evidence/);
  assert.match(markdown, /PERMISSION-DENIED: .*\n  Command: cd \/tmp && curl/);
  assert.equal(diagnosticsSummary(diagnostics),
    "Command diagnostics: 2 permission-denied, 1 http-error, 1 network-error, 1 sandbox-restricted.");

  const withoutTranscript = commandDiagnostics({ log, run, workspace: "/workspace", curl: { available: false, error: "curl was not found on PATH" } });
  assert.deepEqual(withoutTranscript.counts, { "permission-denied": 2 });
  assert.match(withoutTranscript.transcript, /unavailable/);
  assert.match(diagnosticsMarkdown(withoutTranscript), /curl: unavailable — curl was not found on PATH/);
  assert.equal(diagnosticsSummary(commandDiagnostics({ log: "", run, workspace: "/workspace", curl })), "");
});

test("historical homeboost curl denials are diagnosed as /tmp path approvals, not network failures", () => {
  const reports = path.join(__dirname, "..", "my-project", "result reports", "qa3-oru-vml-dev-en-save-money-homeboost-fbcea2fbe596");
  for (const [file, count] of [["legacy-1790892911669/1790892911669-smoke.md", 9], ["legacy-1790897322141/1790897322141-smoke.md", 2]]) {
    const log = fs.readFileSync(path.join(reports, file), "utf8");
    const diagnostics = commandDiagnostics({ log, run, workspace: "/Users/qa/qa-runner", curl, tempDirectory: "/var/folders/qa/T" });
    assert.deepEqual(diagnostics.counts, { "permission-denied": count }, file);
    assert.ok(diagnostics.entries.every((entry) => /path verification: .*\/tmp/.test(entry.detail)), file);
  }
});
