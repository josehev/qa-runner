// Opt-in regression test against the real Copilot CLI permission engine. A local fake model
// (BYOK) scripts curl commands; no GitHub authentication, live model or external network is used.
// Run with: QA_TEST_COPILOT_BIN=/path/to/copilot npm test
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { startFakeProvider, SUBAGENT_MARKER } = require("./helpers/fake-copilot-provider");

const COPILOT = process.env.QA_TEST_COPILOT_BIN;

function startFixture() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = Buffer.alloc(0);
    req.on("data", (chunk) => { body = Buffer.concat([body, chunk]); });
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: body.toString("latin1") });
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: "/page" });
        return res.end();
      }
      const status = Number(req.url.match(/^\/status\/(\d+)/)?.[1] || 200);
      res.writeHead(status, { "Content-Type": "text/html", "Set-Cookie": "qa=1; Path=/" });
      res.end(req.method === "HEAD" ? undefined
        : `<html><title>QA-FIXTURE</title>${req.method} ${req.url} ${req.headers["content-type"] || ""} ${body.length}</html>\n`);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    base: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((done) => server.close(done)),
  })));
}

test("real Copilot CLI runs QA curl operations noninteractively and still denies unrelated paths", {
  skip: COPILOT ? false : "set QA_TEST_COPILOT_BIN to a Copilot CLI executable",
  timeout: 180000,
}, async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "qa-curl-cli-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const systemTemp = path.join(root, "system temp");
  const outside = path.join(root, "outside");
  const runDirectory = path.join(root, "result reports", "page", "run 1");
  for (const directory of [path.join(workspace, ".github", "agents"), systemTemp, outside, runDirectory, path.join(root, "home")]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(path.join(workspace, ".github", "agents", "qa-agent.agent.md"),
    "---\nname: qa-agent\ndescription: QA regression agent\n---\nFollow the QA prompt.\n");

  const fixture = await startFixture();
  t.after(() => fixture.close());
  const base = fixture.base;
  const out = (name) => `'${path.join(outside, name)}'`;
  const provider = await startFakeProvider({
    main: [
      { bash: `curl -sS -o {{DIR}}/page.html -w '%{http_code}\\n' "${base}/page"` },
      { bash: `cd {{DIR}} && curl -sS -L -A "Mozilla/5.0 (QA; curl)" "${base}/redirect" -o redirected.html -w '%{http_code} %{num_redirects}\\n' && wc -c redirected.html` },
      { bash: `curl -sS -I '${base}/page'` },
      { bash: `curl -sS -X PUT -H 'X-QA: yes' -u qa:fixture --data-binary @{{DIR}}/page.html "${base}/echo?a=1&b=two"` },
      { bash: `curl -sS -F file=@{{DIR}}/page.html -F "note=multipart field" ${base}/upload` },
      { bash: `curl -sS ${base}/upload-put -T {{DIR}}/page.html` },
      { bash: `curl -sS -X DELETE -D {{DIR}}/headers.txt -c {{DIR}}/cookies.txt ${base}/echo -o /dev/null && head -1 {{DIR}}/headers.txt` },
      { bash: `curl -sS --url ${base}/page | grep -c QA-FIXTURE` },
      { bash: `curl -sS -o /dev/null -w '%{http_code}' ${base}/status/404` },
      { bash: `curl -sS --fail ${base}/status/500 -o {{DIR}}/error.html` },
      { bash: "curl -sS --max-time 5 http://127.0.0.1:1/unreachable" },
      { bash: `cd '${outside}' && curl -sS ${base}/page -o outside.html` },
      { bash: `curl -sS ${base}/page -o ${out("direct.html")}` },
      { bash: `curl -sS ${base}/page; touch ${out("injected")}` },
      { bash: `curl -sS "${base}/$(touch ${out("substituted")})"` },
      { bash: `echo curl > ${out("unrelated.txt")}` },
      { task: true },
    ],
    subagent: [
      { bash: `curl -sS ${base}/subagent -o {{DIR}}/subagent.html && cat {{DIR}}/subagent.html` },
      { bash: `curl -sS ${base}/subagent -o ${out("subagent.html")}` },
    ],
  });
  t.after(() => provider.close());

  const environment = {
    COPILOT_BIN: COPILOT, QA_WORKSPACE: workspace, TMPDIR: systemTemp, COPILOT_HOME: path.join(root, "home"),
    COPILOT_PROVIDER_BASE_URL: provider.url, COPILOT_PROVIDER_API_KEY: "fixture", COPILOT_MODEL: "gpt-4.1",
    COPILOT_AUTO_UPDATE: "false", COPILOT_ALLOW_ALL: "",
  };
  const saved = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const run = { directory: runDirectory, file: (name) => path.join(runDirectory, name), publicPath: (name) => `/results/${name}` };
  const context = {
    require: (name) => {
      if (name === "./artifacts") return { ...require("../artifacts"), createArtifactRun: () => run };
      if (name === "./browser-preflight") return { browserPreflight: async () => ({ status: "PASS" }) };
      return name.startsWith("./") ? require(path.join(__dirname, "..", name)) : require(name);
    },
    __dirname: path.join(__dirname, ".."), process, console, URL, setTimeout, clearTimeout, module: { exports: {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8"), context);
  const server = context.module.exports.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/run?promptId=smoke&url=${encodeURIComponent(`${base}/page`)}`);
  const stream = await response.text();

  const main = provider.requests.filter((request) => request.tools?.length &&
    !JSON.stringify(request.messages.filter((message) => message.role === "user")).includes(SUBAGENT_MARKER));
  const results = main.at(-1).messages.filter((message) => message.role === "tool").map((message) => String(message.content));
  const denied = (text) => /Permission denied/.test(text);
  for (const [index, result] of results.slice(0, 11).entries()) assert.ok(!denied(result), `step ${index} was denied: ${result}`);
  assert.match(results[0], /^200/);
  assert.match(results[1], /200 1\n\d+ redirected\.html/);
  assert.match(results[2], /HTTP\/1\.1 200 OK/i);
  assert.match(results[3], /PUT \/echo\?a=1&b=two application\/x-www-form-urlencoded \d+/);
  assert.match(results[4], /POST \/upload multipart\/form-data; boundary=/);
  assert.match(results[5], /PUT \/upload-put/);
  assert.match(results[6], /HTTP\/1\.1 200 OK/);
  assert.match(results[7], /^1\b/);
  assert.match(results[8], /^404/);
  assert.match(results[9], /curl: \(22\)/);
  assert.match(results[10], /curl: \(7\)/);
  for (const result of results.slice(11, 16)) assert.ok(denied(result), `unrelated path was not denied: ${result}`);
  assert.match(results[16], /SUBAGENT_RESULTS/);
  assert.match(results[16], /GET \/subagent/);
  assert.match(results[16], /Permission denied/);

  const methods = fixture.requests.map((request) => `${request.method} ${request.url}`);
  for (const expected of ["GET /page", "GET /redirect", "HEAD /page", "PUT /echo?a=1&b=two", "POST /upload", "PUT /upload-put", "DELETE /echo", "GET /subagent"]) {
    assert.ok(methods.includes(expected), `${expected} missing from ${methods.join(", ")}`);
  }
  const put = fixture.requests.find((request) => request.url === "/echo?a=1&b=two");
  assert.equal(put.headers["x-qa"], "yes");
  assert.equal(put.headers.authorization, `Basic ${Buffer.from("qa:fixture").toString("base64")}`);
  assert.ok(put.body.includes("QA-FIXTURE"));
  assert.match(fixture.requests.find((request) => request.url === "/upload").headers["content-type"], /^multipart\/form-data/);
  assert.equal(fixture.requests.find((request) => request.url === "/redirect").headers["user-agent"], "Mozilla/5.0 (QA; curl)");
  for (const name of ["page.html", "redirected.html", "headers.txt", "cookies.txt", "subagent.html"]) {
    assert.ok(fs.existsSync(run.file(name)), `${name} missing from run directory`);
  }
  assert.deepEqual(fs.readdirSync(outside), []);

  const diagnostics = JSON.parse(fs.readFileSync(run.file("command-diagnostics.json"), "utf8"));
  assert.equal(diagnostics.transcript, "copilot-session.txt");
  assert.equal(diagnostics.counts["permission-denied"], 6);
  assert.equal(diagnostics.counts["http-error"], 1);
  assert.equal(diagnostics.counts["network-error"], 1);
  const denials = diagnostics.entries.filter((entry) => entry.category === "permission-denied");
  assert.equal(denials.filter((entry) => entry.detail.includes(`path verification: outside the approved`) && entry.detail.includes(outside)).length, 5);
  assert.equal(denials.find((entry) => entry.command.startsWith("echo curl")).curl, false);
  const report = fs.readFileSync(run.file("smoke.md"), "utf8");
  assert.match(report, /\*\*Overall: BLOCKED\*\*/);
  assert.match(report, /## Command diagnostics/);
  assert.match(stream, /Command diagnostics: 6 permission-denied, 1 http-error, 1 network-error\./);
});
