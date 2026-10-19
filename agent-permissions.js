const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

// Full Copilot CLI transcript written with the documented --share flag. Not .md, so it is
// never listed as a separate report.
const SESSION_TRANSCRIPT = "copilot-session.txt";
const DENIED = /Permission denied (?:and could not request permission from user|because no interactive user response was available)|Denied, no one to approve/;
const NETWORK_ERRORS = {
  5: "proxy could not be resolved", 6: "host could not be resolved", 7: "connection failed",
  28: "timed out", 35: "TLS handshake failed", 52: "empty reply", 55: "send failed",
  56: "receive failed", 60: "TLS certificate rejected",
};

// Copilot CLI already auto-approves tools (--allow-all-tools) and the target origin. Its path
// verification only allows the working directory and system temp directory, so the run
// artifact directory is added for curl downloads, uploads and scratch files. Everything else
// (for example /tmp on macOS, home or system paths) keeps requiring approval.
function agentCliArgs(run, browserUrl) {
  return [
    "--allow-all-tools",
    `--allow-url=${new URL(browserUrl).origin}`,
    "--add-dir", run.directory,
    "--share", run.file(SESSION_TRANSCRIPT),
  ];
}

function checkCurl(bin = "curl") {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { timeout: 5000 }, (err, stdout) => {
      if (!err) return resolve({ available: true, version: stdout.split("\n")[0].trim() });
      resolve({ available: false, error: err.code === "ENOENT" ? "curl was not found on PATH" : `curl --version failed: ${err.message}` });
    });
  });
}

function curlInstructions(run, curl) {
  const dir = JSON.stringify(run.directory);
  if (!curl.available) {
    return `\n\ncurl is unavailable on this host (${curl.error}). Do not use curl; report curl-dependent checks as NOT TESTED with reason "curl unavailable", never PASS.`;
  }
  return `

Shell HTTP checks with curl are permitted in this run and supplement, never replace, browser evidence.
- Copilot CLI auto-approves files only in the working directory, the system temp directory and the run directory ${dir}. Paths elsewhere (including /tmp) are denied because nobody can approve them. Put every curl download, upload source, header dump, cookie jar, config and scratch file in the run directory using absolute paths, for example: curl -sS -L -o ${JSON.stringify(path.join(run.directory, "page.html"))} -w "%{http_code}\\n" "<url>"; or cd ${dir} first.
- Any curl method, header, auth, redirect, body, upload or status-output option may be used. Prefer literal URLs. Use GET/HEAD for link and asset checks; send state-changing requests (POST/PUT/PATCH/DELETE, uploads) only to the target where this test allows safe submissions, never destructive transactions or real credentials.
- Report failures precisely and never as PASS: "Permission denied ... no interactive user response"/"could not request permission" = command denied by Copilot CLI (check not executed); "curl: (N)" network, DNS or TLS errors = NOT TESTED with the error; HTTP 4xx/5xx = observed response (FAIL for broken links); "Operation not permitted" or sandbox messages = blocked by OS/sandbox.`;
}

// Splits a shell command into words and control operators (as null) for diagnostics only;
// this never grants permission.
function shellTokens(command) {
  const tokens = [];
  let word = "";
  let quote = null;
  let started = false;
  const end = () => {
    if (started) tokens.push(word);
    word = "";
    started = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && /[$`"\\\n]/.test(command[i + 1] || "")) word += command[++i];
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      started = true;
    } else if (c === "\\" && i + 1 < command.length) {
      word += command[++i];
      started = true;
    } else if (/[\n;&|()`]/.test(c)) {
      end();
      tokens.push(null);
    } else if (/[\s<>]/.test(c)) {
      end();
    } else {
      word += c;
      started = true;
    }
  }
  end();
  return tokens;
}

const shellWords = (command) => shellTokens(command).filter((token) => token !== null);

// True when curl is executed as a command, not merely mentioned as an argument or in a URL.
function usesCurl(command) {
  let commandPosition = true;
  for (const token of shellTokens(command)) {
    if (token === null) {
      commandPosition = true;
    } else if (commandPosition) {
      if (path.basename(token) === "curl") return true;
      commandPosition = /^[A-Za-z_]\w*=/.test(token) || token === "$" ||
        ["env", "command", "exec", "time", "do", "then", "else", "if", "while", "until", "!", "{"].includes(token);
    }
  }
  return false;
}

const inside = (file, root) => {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

function pathsOutside(command, roots) {
  const outside = new Set();
  for (const word of shellWords(command)) {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(word)) continue;
    const match = word.match(/(?:^|[=@<])(~?\/[^\s]*)$/);
    if (!match || match[1].startsWith("//") || match[1].includes("$")) continue;
    const file = path.resolve(match[1].replace(/^~(?=\/)/, os.homedir()));
    if (/^\/dev\/(?:null|std(?:in|out|err)|fd\/\d+)$/.test(file)) continue;
    if (!roots.some((root) => inside(file, root))) outside.add(file);
  }
  return [...outside];
}

// Shell blocks from Copilot's text output. Output there is collapsed ("3 lines…"), but every
// application-level denial (including subagent commands) is printed.
function parseLog(log) {
  const blocks = [];
  let block = null;
  for (const raw of log.replace(/(\S)([✗●] )/g, "$1\n$2").split("\n")) {
    const line = raw.replace(/^[\s│└├]*/, "").trimEnd();
    const nested = raw !== line && /^[\s│└├]+/.test(raw);
    const header = line.match(/^(?:[✗●✓]\s+)?(.+?) \((?:shell|bash|powershell)\)(?:\s+[\d.]+m?s)?$/);
    if (header && (nested || /^[✗●✓] /.test(raw))) {
      block = { title: header[1], lines: [] };
      blocks.push(block);
    } else if (/^[✗●✓] /.test(raw) || (!nested && raw.trim())) {
      block = null;
    } else if (block && line) {
      block.lines.push(line);
    }
  }
  return blocks.map(({ title, lines }) => {
    const end = lines.findIndex((line) => DENIED.test(line) || /^(?:Approval check|\d+ lines?…|Failed with exit code)/.test(line));
    return {
      title,
      command: (end < 0 ? lines : lines.slice(0, end)).join("\n"),
      denied: DENIED.test(lines.join(" ")),
    };
  });
}

// Shell calls from the --share transcript, including subagent calls, with full output.
function parseTranscript(transcript) {
  const entries = [];
  for (const section of transcript.split(/^### `(?:bash|powershell)`.*$/m).slice(1)) {
    const start = section.search(/^\$ /m);
    if (start < 0) continue;
    const body = section.slice(start + 2);
    const stop = body.search(/\n```|\n### |\n---/);
    const output = stop < 0 ? null : body.slice(stop).match(/^\n```\n([\s\S]*?)\n```/);
    entries.push({ command: (stop < 0 ? body : body.slice(0, stop)).trim(), output: output ? output[1] : null });
  }
  return entries;
}

function classifyOutput(output) {
  if (/curl: (?:command )?not found|command not found: curl|'curl' is not recognized/i.test(output)) {
    return { category: "curl-missing", detail: "curl is not installed or not on PATH" };
  }
  if (/Operation not permitted|sandbox-exec|(?:blocked|denied) by (?:the )?sandbox/i.test(output)) {
    return { category: "sandbox-restricted", detail: "OS or sandbox policy blocked the command; Copilot CLI permissions cannot override this" };
  }
  const curlError = output.match(/curl: \((\d+)\)[^\n]*/);
  if (curlError && curlError[1] === "22") return { category: "http-error", detail: curlError[0] };
  if (curlError) {
    return { category: "network-error", detail: `${curlError[0]}${NETWORK_ERRORS[curlError[1]] ? ` (${NETWORK_ERRORS[curlError[1]]})` : ""}` };
  }
  return null;
}

function commandDiagnostics({ log = "", transcript = null, run, workspace, curl, tempDirectory = os.tmpdir() }) {
  const roots = [run.directory, workspace, tempDirectory].filter(Boolean).map((root) => path.resolve(root));
  const shared = transcript ? parseTranscript(transcript) : [];
  const squash = (text) => text.replace(/\s+/g, "");
  const entries = [];
  for (const block of parseLog(log).filter((item) => item.denied)) {
    const exact = shared.find((item) => !item.used && squash(item.command) === squash(block.command));
    if (exact) exact.used = true;
    const command = exact ? exact.command : block.command;
    const outside = pathsOutside(command, roots);
    entries.push({
      category: "permission-denied", command, curl: usesCurl(command),
      detail: outside.length
        ? `Copilot CLI path verification: outside the approved run, workspace and system temp directories: ${outside.join(", ")}`
        : "Copilot CLI required approval and no user could answer (not an OS, network or sandbox error)",
    });
  }
  for (const item of shared) {
    if (item.used || item.output === null || DENIED.test(item.output) || !usesCurl(item.command)) continue;
    const issue = classifyOutput(item.output);
    if (issue) entries.push({ ...issue, command: item.command, curl: true });
  }
  const counts = {};
  for (const entry of entries) counts[entry.category] = (counts[entry.category] || 0) + 1;
  return {
    curl,
    transcript: transcript === null ? "unavailable (only permission denials can be identified from the console log)" : SESSION_TRANSCRIPT,
    counts,
    entries,
  };
}

function diagnosticsMarkdown(diagnostics) {
  const lines = ["## Command diagnostics"];
  lines.push(diagnostics.curl.available ? `curl: ${diagnostics.curl.version}` : `curl: unavailable — ${diagnostics.curl.error}`);
  if (!diagnostics.entries.length) {
    lines.push("No denied shell commands or curl failures were detected.");
    return lines.join("\n");
  }
  lines.push("Commands below did not complete as intended; checks depending on them were not executed and are not PASS evidence.");
  for (const entry of diagnostics.entries) {
    lines.push(`- ${entry.category.toUpperCase()}: ${entry.detail}\n  Command: ${entry.command.replace(/\n/g, " ")}`);
  }
  return lines.join("\n");
}

function diagnosticsSummary(diagnostics) {
  const parts = Object.entries(diagnostics.counts).map(([category, count]) => `${count} ${category}`);
  return parts.length ? `Command diagnostics: ${parts.join(", ")}.` : "";
}

module.exports = {
  SESSION_TRANSCRIPT, agentCliArgs, checkCurl, curlInstructions, shellTokens, shellWords, usesCurl,
  pathsOutside, parseLog, parseTranscript, classifyOutput, commandDiagnostics, diagnosticsMarkdown, diagnosticsSummary,
};
