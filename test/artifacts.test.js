const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHash } = require("crypto");
const vm = require("vm");
const { migrateArtifacts } = require("../migrate-artifacts");
const { RESULTS, createArtifactRun, pageSlug, listReports, resolveResult, legacyResultPath } = require("../artifacts");

const QA_SCRIPTS = [
  "focus_check.js", "focus_detail.js", "login_aria_check.js",
  "contrast.js", "contrast2.js", "contrast3.js", "contrast4.js", "button_contrast.js", "contrast_check.js",
  "interact.js", "interact_test.js", "modal_close_btn.js", "modal_close_btn2.js", "modal_keyboard.js",
  "modal_toggle_close.js", "faq_expand.js", "faq_expand2.js", "faq_full.js", "cta_test.js", "nav_test.js",
  "check_links_browser.js", "battery_audit.js",
  "audit.js", "clean_screens.js", "login_form_test.js", "qa_interact.js", "qa_myheat.js", "qa_search.js",
  "search_debug.js", "search_test.js", "search_test2.js", "search_test3.js", "search_test4.js", "skip_test.js",
  "sticky_check.js",
];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-artifacts-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, content) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  write("my-project/result reports/.gitkeep", "");
  return { root, write, directory: path.join(root, "my-project", "result reports") };
}

test("migration is deterministic, byte-preserving, grouped, and idempotent", (t) => {
  const { root, write, directory } = fixture(t);
  const sources = {
    "results/123-browser-check.md": "# Check\nURL: https://example.com/a?b=1\n",
    "results/123-browser-check.json": '{"url":"https://example.com/a?b=1"}',
    "results/123-browser-check.png": Buffer.from([0, 255, 1, 128]),
    "results/456-smoke.md": "# Check\nURL: https://example.com/a?b=1\n",
    "results/unknown.md": "# Unknown",
    "results/789-browser-check.json": '{"url":"https://example.com/json-only"}',
    "qa-reports/myheat_results.json": "{}",
    "tmp_audit/focus_0.png": Buffer.from([9, 8, 7]),
    "battery_audit_err.log": "",
    "page_text.txt": "old report\n",
    "links_to_check.txt": "https://oru.myheat.app/nj/",
    "link_status.txt": "403 https://www.tesla.com/support/energy/powerwall/order/order-powerwall",
    "crop_768_top.png": Buffer.from([7, 6, 5]),
  };
  for (const [name, bytes] of Object.entries(sources)) write(name, bytes);
  write("tmp_audit/qa_audit.js", "// owned script");
  write("node_modules/vendor/image.png", "do not touch");
  write("README.md", "do not touch");
  const manifest = migrateArtifacts(root);
  assert.equal(manifest.artifacts.length, Object.keys(sources).length);
  for (const entry of manifest.artifacts) {
    assert.deepEqual(fs.readFileSync(path.join(directory, entry.destination)), Buffer.from(sources[entry.source]));
    assert.equal(entry.sha256, createHash("sha256").update(sources[entry.source]).digest("hex"));
    assert.equal(fs.existsSync(path.join(root, entry.source)), false);
    assert.equal(legacyResultPath(entry.source, directory), entry.destination);
  }
  const entry = (name) => manifest.artifacts.find((item) => item.source === name);
  assert.equal(path.dirname(entry("results/123-browser-check.md").destination), path.dirname(entry("results/123-browser-check.png").destination));
  assert.notEqual(path.dirname(entry("results/123-browser-check.md").destination), path.dirname(entry("results/456-smoke.md").destination));
  assert.match(entry("results/unknown.md").destination, /^unknown-page\//);
  assert.ok(entry("results/789-browser-check.json").destination.startsWith(pageSlug("https://example.com/json-only") + "/"));
  assert.match(entry("links_to_check.txt").destination, /myheat/);
  assert.match(entry("link_status.txt").destination, /battery-program/);
  assert.match(entry("crop_768_top.png").destination, /^unknown-page\/legacy-root-unattributed\//);
  assert.equal(legacyResultPath("results/123-browser-check.html", directory), entry("results/123-browser-check.md").destination.replace(/\.md$/, ".html"));
  assert.ok(fs.existsSync(path.join(directory, ".gitkeep")));
  assert.equal(fs.readFileSync(path.join(root, "tmp_audit/qa_audit.js"), "utf8"), "// owned script");
  assert.equal(fs.readFileSync(path.join(root, "node_modules/vendor/image.png"), "utf8"), "do not touch");
  assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), "do not touch");
  const before = fs.readFileSync(path.join(directory, "legacy-artifacts.json"));
  assert.deepEqual(migrateArtifacts(root), manifest);
  assert.deepEqual(fs.readFileSync(path.join(directory, "legacy-artifacts.json")), before);
});

test("conflicting destinations never overwrite or delete sources", (t) => {
  const { root, write, directory } = fixture(t);
  write("results/123-smoke.md", "URL: https://example.com/\n");
  const manifest = migrateArtifacts(root);
  write("results/123-smoke.md", "URL: https://example.com/\n");
  fs.writeFileSync(path.join(directory, manifest.artifacts[0].destination), "conflict");
  assert.throws(() => migrateArtifacts(root), /Destination conflict/);
  assert.equal(fs.readFileSync(path.join(directory, manifest.artifacts[0].destination), "utf8"), "conflict");
  assert.ok(fs.existsSync(path.join(root, "results/123-smoke.md")));
});

test("migration rejects source symlinks and tampered destination traversal", (t) => {
  const { root, write, directory } = fixture(t);
  write("outside.txt", "outside");
  fs.mkdirSync(path.join(root, "results"));
  fs.symlinkSync(path.join(root, "outside.txt"), path.join(root, "results/123-smoke.md"));
  assert.throws(() => migrateArtifacts(root), /Unsafe source/);
  fs.unlinkSync(path.join(root, "results/123-smoke.md"));
  write("results/123-smoke.md", "URL: https://example.com/\n");
  const manifest = migrateArtifacts(root);
  write("results/123-smoke.md", "URL: https://example.com/\n");
  manifest.artifacts[0].destination = "../../outside.txt";
  fs.writeFileSync(path.join(directory, "legacy-artifacts.json"), JSON.stringify(manifest));
  assert.throws(() => migrateArtifacts(root), /Unsafe destination/);
  assert.equal(fs.readFileSync(path.join(root, "outside.txt"), "utf8"), "outside");
});

test("artifact paths reject traversal, hidden paths, and escaping symlinks", (t) => {
  const { root, write, directory } = fixture(t);
  write("my-project/result reports/page/run/report.md", "# Report");
  write("outside.txt", "outside");
  fs.symlinkSync(path.join(root, "outside.txt"), path.join(directory, "escape.txt"));
  for (const name of ["../outside.txt", "..\\outside.txt", "/etc/passwd", ".gitkeep", "escape.txt", "page/run", "missing", ""]) {
    assert.equal(resolveResult(name, directory), null, name);
  }
  assert.ok(resolveResult("page/run/report.md", directory));
});

test("migration rejects destination and artifact-root symlinks", (t) => {
  const { root, write, directory } = fixture(t);
  write("results/123-smoke.md", "URL: https://example.com/\n");
  fs.symlinkSync(os.tmpdir(), path.join(directory, pageSlug("https://example.com/")));
  assert.throws(() => migrateArtifacts(root), /Unsafe destination/);
  assert.ok(fs.existsSync(path.join(root, "results/123-smoke.md")));
  fs.rmSync(directory, { recursive: true });
  fs.symlinkSync(os.tmpdir(), directory);
  assert.throws(() => migrateArtifacts(root), /Unsafe artifact root/);
});

test("migration rejects dangling symlinks before writing outside its artifact root", (t) => {
  const { root, write, directory } = fixture(t);
  write("results/123-smoke.md", "URL: https://example.com/\n");
  const outside = path.join(root, "outside.json");
  const manifest = path.join(directory, "legacy-artifacts.json");
  fs.symlinkSync(outside, manifest);
  assert.throws(() => migrateArtifacts(root), /Unsafe manifest/);
  assert.equal(fs.existsSync(outside), false);
  assert.ok(fs.existsSync(path.join(root, "results/123-smoke.md")));
  fs.unlinkSync(manifest);
  const page = path.join(directory, pageSlug("https://example.com/"));
  fs.symlinkSync(path.join(root, "missing-page"), page);
  assert.throws(() => migrateArtifacts(root), /Unsafe destination/);
  assert.equal(fs.existsSync(path.join(root, "missing-page")), false);
});

test("future runs are repository-rooted, URL-specific, unique, and safely reusable", (t) => {
  const url = "https://example.com/artifact-test?mode=1";
  const page = path.join(RESULTS, pageSlug(url));
  t.after(() => fs.rmSync(page, { recursive: true, force: true }));
  const first = createArtifactRun(url, null);
  const second = createArtifactRun(url, null);
  assert.notEqual(first.directory, second.directory);
  assert.ok(first.directory.startsWith(RESULTS + path.sep));
  assert.notEqual(pageSlug(url), pageSlug(url.replace("mode=1", "mode=2")));
  assert.equal(createArtifactRun(url, first.directory).directory, first.directory);
  assert.throws(() => createArtifactRun(url, os.tmpdir()), /inside result reports/);
  assert.equal(first.file("../../shot.png"), path.join(first.directory, "shot.png"));
  assert.throws(() => createArtifactRun("file:///tmp/test", null), /http/);
});

test("every checked-in historical artifact resolves and matches its recorded checksum", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(RESULTS, "legacy-artifacts.json"), "utf8"));
  assert.ok(manifest.artifacts.length > 0);
  for (const entry of manifest.artifacts) {
    const file = resolveResult(entry.destination);
    assert.ok(file, entry.destination);
    assert.equal(createHash("sha256").update(fs.readFileSync(file)).digest("hex"), entry.sha256, entry.source);
    assert.equal(legacyResultPath(entry.source), entry.destination);
    assert.equal(fs.existsSync(path.join(__dirname, "..", entry.source)), false);
  }
  assert.ok(listReports().some(({ file }) => file.endsWith("battery-program-qa-report.html")));
});

test("standalone QA scripts are archived outside the repository root", () => {
  const root = path.join(__dirname, "..");
  for (const script of QA_SCRIPTS) {
    assert.equal(fs.existsSync(path.join(root, script)), false, script);
    assert.ok(fs.statSync(path.join(RESULTS, script)).isFile(), script);
  }
  for (const script of ["server.js", "browser-check.js", "artifacts.js", "migrate-artifacts.js"]) {
    assert.ok(fs.statSync(path.join(root, script)).isFile(), script);
  }
});

test("standalone audits save JSON alongside their screenshots without changing stdout", async (t) => {
  for (const script of ["audit.js", "battery_audit.js"]) {
    const url = `https://example.com/${script}`;
    const run = createArtifactRun(url, null);
    t.after(() => fs.rmSync(path.dirname(run.directory), { recursive: true, force: true }));
    const stdout = [];
    const page = {
      on() {},
      goto: async () => {},
      evaluate: async () => ({ title: "Local fixture" }),
      $$: async () => [],
      url: () => url,
      waitForTimeout: async () => {},
      setViewportSize: async () => {},
      keyboard: { press: async () => {} },
      screenshot: async ({ path: file }) => fs.writeFileSync(file, "fixture screenshot"),
    };
    const browser = {
      newPage: async () => page,
      newContext: async () => ({ newPage: async () => page }),
      close: async () => {},
    };
    await vm.runInNewContext(fs.readFileSync(path.join(RESULTS, script), "utf8"), {
      require: (name) => name === "playwright" ? { chromium: { launch: async () => browser } }
        : name === "./artifacts" ? { createArtifactRun: () => run } : require(name),
      console: { log: (text) => stdout.push(text) },
    });
    const report = run.file(script === "audit.js" ? "audit_results.json" : "battery_audit_output.json");
    assert.equal(fs.readFileSync(report, "utf8"), stdout[0]);
    assert.doesNotThrow(() => JSON.parse(stdout[0]));
    if (script === "battery_audit.js") {
      for (const width of [375, 768, 1366, 1920]) assert.ok(fs.existsSync(run.file(`battery_${width}.png`)));
    }
  }
});

test("local HTTP routes redirect old reports and artifacts and serve nested results", async (t) => {
  const app = require("../server");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const manifest = JSON.parse(fs.readFileSync(path.join(RESULTS, "legacy-artifacts.json"), "utf8"));
  for (const source of [
    "results/1790898514644-browser-check.html",
    "results/1790898514644-browser-check.png",
    "qa-reports/battery-program-qa-report.html",
    "tmp_audit/focus_0.png",
    "battery_375.png",
  ]) {
    const response = await fetch(`${base}/${source}`, { redirect: "manual" });
    assert.equal(response.status, 301, source);
    assert.ok(response.headers.get("location").startsWith("/results/"));
    const target = await fetch(base + response.headers.get("location"));
    assert.equal(target.status, 200, source);
    assert.equal(target.headers.get("content-security-policy"), "sandbox");
    if (source.endsWith(".png")) {
      const entry = manifest.artifacts.find((item) => item.source === source);
      assert.deepEqual(Buffer.from(await target.arrayBuffer()), fs.readFileSync(path.join(RESULTS, entry.destination)));
    }
  }
  const history = await (await fetch(`${base}/api/results`)).json();
  assert.ok(history.length);
  for (const report of history) assert.equal((await fetch(base + report.path)).status, 200, report.path);
  for (const unsafe of ["%2e%2e%2fpackage.json", "%2e%2e%5cpackage.json", ".gitkeep", "missing.png"]) {
    assert.equal((await fetch(`${base}/results/${unsafe}`)).status, 404, unsafe);
  }
});
