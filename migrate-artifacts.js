const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const { pageSlug, resolveResult } = require("./artifacts");

const RECYCLING = "/en/save-money/rebates-incentives-credits/nj/residential/efficient-products/recycling";
const MYHEAT = "/en/save-money/rebates-incentives-credits/myheat";
const BATTERY = "/en/save-money/rebates-incentives-credits/ny/residential/battery-program";
const ROOT_OUTPUT = /^(?:battery_.*\.(?:png|json|log)|clean_.*\.png|screenshot_.*\.png|search_result.*\.png|crop_.*\.png|faq_focus\.png|focus_contact_test\.png|login_modal_test\.png|interact_result\.png|sticky_viewport_768\.png|page_text\.txt|link_status.*\.txt|unique_links\.txt|links_to_check\.txt)$/;
const digest = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function isSymlink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

function inferGroup(source, root) {
  const name = path.basename(source);
  const folder = path.dirname(source);
  let url;
  let run;
  if (folder === "results") {
    const stamp = name.match(/^\d+/)?.[0];
    const report = fs.readdirSync(path.join(root, folder)).sort()
      .find((file) => file.startsWith(`${stamp}-`) && file.endsWith(".md"));
    if (report) {
      url = fs.readFileSync(path.join(root, folder, report), "utf8").match(/^URL:\s*(https?:\/\/\S+)/m)?.[1];
    }
    if (!url && name.endsWith(".json")) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(root, source), "utf8"));
        url = content.url || content.finalUrl;
      } catch {
        // Malformed historical JSON is still preserved under the fallback page.
      }
    }
    run = stamp || path.parse(name).name;
  } else if (folder === "tmp_audit") {
    url = `https://qa3-oru.vml.dev${RECYCLING}`;
    run = "tmp-audit";
  } else if (folder === "qa-reports") {
    url = `https://dev10.oru.com${name.startsWith("battery-program") ? BATTERY : name.startsWith("oru-recycling") ? RECYCLING : MYHEAT}`;
    run = `qa-reports-${url.endsWith(BATTERY) ? "battery" : url.endsWith(RECYCLING) ? "recycling" : "myheat"}`;
  } else {
    const text = name.endsWith(".txt") ? fs.readFileSync(path.join(root, source), "utf8") : "";
    const battery = /^(battery_|search_result|focus_contact_test|login_modal_test|interact_result|sticky_viewport)/.test(name)
      || /battery-program|tesla\.com\/support\/energy|sunrun\.com\/solar-battery/.test(text);
    const myheat = /myheat/i.test(text);
    const recycling = /^(clean_|screenshot_(?:375|768|1366|1920)\.png$|faq_focus\.png$)/.test(name);
    if (battery || myheat || recycling) {
      url = `https://dev10.oru.com${battery ? BATTERY : myheat ? MYHEAT : RECYCLING}`;
    }
    run = name.endsWith(".txt") ? `root-${battery ? "battery-links" : myheat ? "myheat" : "unattributed"}`
      : name.startsWith("battery_") ? "root-battery"
      : name.startsWith("clean_") ? "root-clean"
      : name.startsWith("search_result") ? `root-${path.parse(name).name}`
      : battery ? `root-${path.parse(name).name}`
      : recycling ? "root-audit" : "root-unattributed";
  }
  // Untimestamped collections retain their source identity; no run date is invented.
  let page = "unknown-page";
  if (url) {
    try {
      page = pageSlug(url);
    } catch {
      // Invalid historical URLs must not prevent preservation.
    }
  }
  return `${page}/legacy-${run.replace(/[^a-zA-Z0-9_-]/g, "-")}/${name}`;
}

function migrateArtifacts(root = __dirname) {
  const directory = path.join(root, "my-project", "result reports");
  for (const location of [path.join(root, "my-project"), directory]) {
    if (isSymlink(location)) throw new Error("Unsafe artifact root");
  }
  fs.mkdirSync(directory, { recursive: true });
  const manifestPath = path.join(directory, "legacy-artifacts.json");
  if (isSymlink(manifestPath)) throw new Error("Unsafe manifest");
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { version: 1, artifacts: [] };
  const sources = fs.readdirSync(root).filter((name) => ROOT_OUTPUT.test(name));
  for (const folder of ["results", "qa-reports", "tmp_audit"]) {
    const location = path.join(root, folder);
    if (!fs.existsSync(location)) continue;
    if (!fs.lstatSync(location).isDirectory()) throw new Error(`Unsafe source folder: ${folder}`);
    for (const name of fs.readdirSync(location)) {
      if (!name.startsWith(".") && /\.(md|json|png|txt|log|html)$/.test(name)) sources.push(`${folder}/${name}`);
    }
  }
  const pending = [];
  for (const source of sources.sort()) {
    const file = path.join(root, source);
    if (!fs.lstatSync(file).isFile()) throw new Error(`Unsafe source: ${source}`);
    const sha256 = digest(file);
    const existing = manifest.artifacts.find((entry) => entry.source === source);
    if (existing && existing.sha256 !== sha256) throw new Error(`Changed historical source: ${source}`);
    const entry = existing || { source, destination: inferGroup(source, root), sha256 };
    const parts = entry.destination.split("/");
    if (parts.length !== 3 || parts.some((part) => !part || part.startsWith(".") || part.includes("\\"))) {
      throw new Error(`Unsafe destination: ${entry.destination}`);
    }
    const target = path.join(directory, entry.destination);
    // Check each ancestor before creating or writing anything beneath it.
    for (const location of [directory, path.dirname(path.dirname(target)), path.dirname(target), target]) {
      if (isSymlink(location)) throw new Error(`Unsafe destination: ${entry.destination}`);
    }
    if (fs.existsSync(target) && digest(target) !== sha256) throw new Error(`Destination conflict: ${entry.destination}`);
    pending.push({ entry, file, target });
  }
  for (const { entry, file, target } of pending) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) {
      fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
      const stat = fs.statSync(file);
      fs.utimesSync(target, stat.atime, stat.mtime);
    }
    if (digest(target) !== entry.sha256) throw new Error(`Copy verification failed: ${entry.source}`);
    if (!manifest.artifacts.some((item) => item.source === entry.source)) manifest.artifacts.push(entry);
  }
  manifest.artifacts.sort((a, b) => a.source.localeCompare(b.source, "en"));
  for (const entry of manifest.artifacts) {
    const file = resolveResult(entry.destination, directory);
    if (!file || digest(file) !== entry.sha256) throw new Error(`Missing or changed migrated artifact: ${entry.source}`);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", {
    flag: fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW,
  });
  for (const { file } of pending) fs.unlinkSync(file);
  for (const folder of ["results", "qa-reports"]) {
    const location = path.join(root, folder);
    if (fs.existsSync(location) && fs.readdirSync(location).length === 0) fs.rmdirSync(location);
  }
  return manifest;
}

module.exports = { migrateArtifacts, inferGroup };
if (require.main === module) {
  const manifest = migrateArtifacts();
  console.log(`Verified ${manifest.artifacts.length} historical artifacts in my-project/result reports`);
}
