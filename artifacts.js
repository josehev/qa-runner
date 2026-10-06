const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

const RESULTS = path.join(__dirname, "my-project", "result reports");

function pageSlug(url) {
  const page = new URL(url);
  if (!["http:", "https:"].includes(page.protocol)) {
    throw new Error("URL must start with http:// or https://");
  }
  const label = `${page.host}${page.pathname}`
    .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  const hash = createHash("sha256").update(page.href).digest("hex").slice(0, 12);
  return `${label}-${hash}`;
}

function createArtifactRun(url, directory = process.env.QA_ARTIFACT_DIR) {
  const slug = pageSlug(url);
  fs.mkdirSync(RESULTS, { recursive: true });
  if (directory) {
    directory = fs.realpathSync(directory);
    if (!directory.startsWith(fs.realpathSync(RESULTS) + path.sep)) {
      throw new Error("Artifact directory must be inside result reports");
    }
  } else {
    const pageDirectory = path.join(RESULTS, slug);
    fs.mkdirSync(pageDirectory, { recursive: true });
    if (!fs.realpathSync(pageDirectory).startsWith(fs.realpathSync(RESULTS) + path.sep)) {
      throw new Error("Page directory must be inside result reports");
    }
    directory = fs.mkdtempSync(path.join(pageDirectory, `${Date.now()}-`));
  }
  return {
    directory,
    file: (name) => path.join(directory, path.basename(name)),
    publicPath: (name) => resultUrl(path.join(directory, path.basename(name))),
  };
}

function resultUrl(file) {
  return "/results/" + path.relative(RESULTS, file).split(path.sep).map(encodeURIComponent).join("/");
}

function listReports(directory = RESULTS) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return listReports(file);
    return entry.isFile() && /\.(md|html)$/.test(entry.name)
      ? [{ file, created: fs.statSync(file).mtimeMs }] : [];
  });
}

function resolveResult(relative, directory = RESULTS) {
  if (typeof relative !== "string" || !relative) return null;
  if (relative.split(/[\\/]/).some((part) => part.startsWith("."))) return null;
  const file = path.resolve(directory, relative);
  if (!file.startsWith(directory + path.sep) || !fs.existsSync(file)) return null;
  const realFile = fs.realpathSync(file);
  if (!realFile.startsWith(fs.realpathSync(directory) + path.sep) || !fs.statSync(realFile).isFile()) return null;
  return realFile;
}

function legacyResultPath(source, directory = RESULTS) {
  const manifest = resolveResult("legacy-artifacts.json", directory);
  if (!manifest) return null;
  const entries = JSON.parse(fs.readFileSync(manifest, "utf8")).artifacts;
  let entry = entries.find((item) => item.source === source);
  if (!entry && source.endsWith(".html")) {
    entry = entries.find((item) => item.source === source.replace(/\.html$/, ".md"));
    if (entry && resolveResult(entry.destination, directory)) {
      return entry.destination.replace(/\.md$/, ".html");
    }
  }
  return entry && resolveResult(entry.destination, directory) ? entry.destination : null;
}

module.exports = { RESULTS, pageSlug, createArtifactRun, resultUrl, listReports, resolveResult, legacyResultPath };
