const fs = require("fs");
const path = require("path");
const http = require("http");
const { randomBytes } = require("crypto");
const { fileURLToPath, pathToFileURL } = require("url");

// Independent of the caller's cwd (in particular, a child run's artifact directory).
const TARGET_BASE = __dirname;
const ASSET_TYPES = {
  ".html": "text/html", ".htm": "text/html", ".css": "text/css",
  ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".avif": "image/avif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".mp4": "video/mp4", ".webm": "video/webm", ".wasm": "application/wasm",
};

function validateUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("URL must start with http:// or https://");
  }
  return parsed.href;
}

function resolveTarget(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("Enter an HTTP/HTTPS URL or a local .html/.htm file path.");
  }
  input = input.trim();
  if (/^https?:/i.test(input)) return { original: input, identity: validateUrl(input) };
  let filePath;
  if (/^file:/i.test(input)) {
    try {
      const url = new URL(input);
      if (!/^file:\/\/\//i.test(input) || url.host || url.search || url.hash) throw new Error();
      filePath = fileURLToPath(url);
      if (filePath.startsWith("//") || filePath.startsWith("\\\\")) throw new Error();
    } catch {
      throw new Error("Use a local file:/// URL without a host, query, or fragment; encode special characters.");
    }
  } else {
    if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !path.win32.isAbsolute(input)) {
      throw new Error("Unsupported scheme. Use HTTP/HTTPS or a local .html/.htm path or file:/// URL.");
    }
    if (input.startsWith("\\\\") || input.startsWith("//") ||
        (process.platform !== "win32" && path.win32.isAbsolute(input) && !path.isAbsolute(input))) {
      throw new Error("Use a local file path in the format of the machine running QA Runner (not a network path).");
    }
    filePath = path.resolve(TARGET_BASE, input);
  }
  if (!/\.html?$/i.test(filePath)) throw new Error("Local targets must have a .html or .htm extension.");
  try {
    if (!fs.statSync(filePath).isFile()) throw new Error("not a regular file");
    fs.accessSync(filePath, fs.constants.R_OK);
    filePath = fs.realpathSync(filePath);
  } catch (err) {
    throw new Error(`Cannot read local HTML file "${filePath}": ${err.code || err.message}. Check that it exists and is a readable regular file.`);
  }
  if (!/\.html?$/i.test(filePath) || path.basename(filePath).startsWith(".")) {
    throw new Error("The resolved local target must be a non-hidden .html or .htm file.");
  }
  return { original: input, identity: pathToFileURL(filePath).href, filePath };
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." && !path.isAbsolute(relative);
}

async function prepareTarget(target) {
  if (typeof target === "string") target = resolveTarget(target);
  if (!target.filePath) return { ...target, url: target.identity, close: () => {} };
  const root = path.dirname(target.filePath);
  const prefix = `/${randomBytes(24).toString("hex")}/`;
  let origin;
  const server = http.createServer((req, res) => {
    const deny = (status) => { res.writeHead(status); res.end(); };
    if (req.headers.host !== new URL(origin).host ||
        (req.headers.origin && req.headers.origin !== origin)) return deny(403);
    if (!["GET", "HEAD"].includes(req.method)) return deny(405);
    let fd;
    try {
      // Decode the raw path, before URL normalization can hide traversal segments.
      const pathname = decodeURIComponent(req.url.split("?")[0]);
      if (!pathname.startsWith(prefix)) return deny(404);
      const parts = pathname.slice(prefix.length).split("/");
      if (parts.some((part) => !part || part.startsWith(".") ||
          part === "node_modules" || /[\\:\0]/.test(part))) return deny(403);
      const file = path.resolve(root, ...parts);
      const type = ASSET_TYPES[path.extname(file).toLowerCase()];
      if (!inside(root, file) || !type) return deny(403);
      let current = root;
      for (const part of parts) {
        current = path.join(current, part);
        if (fs.lstatSync(current).isSymbolicLink()) return deny(403);
      }
      if (!fs.statSync(file).isFile()) return deny(403);
      if (!inside(root, fs.realpathSync(file))) return deny(403);
      fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
      const stat = fs.fstatSync(fd);
      const realFile = fs.realpathSync(file);
      const currentStat = fs.statSync(realFile);
      if (!stat.isFile() || !inside(root, realFile) ||
          stat.ino !== currentStat.ino || stat.dev !== currentStat.dev) {
        fs.closeSync(fd);
        fd = undefined;
        return deny(403);
      }
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": stat.size,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      if (req.method === "HEAD") {
        fs.closeSync(fd);
        fd = undefined;
        return res.end();
      }
      const stream = fs.createReadStream(file, { fd, autoClose: true });
      fd = undefined;
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    } catch {
      if (fd !== undefined) fs.closeSync(fd);
      if (!res.headersSent) deny(404);
      else res.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  return {
    ...target,
    url: new URL(prefix + pathToFileURL(target.filePath).pathname.split("/").pop(), origin).href,
    close: () => {
      if (closed) return;
      closed = true;
      server.close();
      server.closeAllConnections();
    },
  };
}

module.exports = { TARGET_BASE, validateUrl, resolveTarget, prepareTarget };
