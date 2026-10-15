# qa-runner

A local web app for checking websites and local HTML without opening VS Code. Choose a test, enter a
URL or local file path, and watch the output in your browser. The runner offers fixed Playwright checks
or browser-backed Copilot QA tests, and saves reports, logs, and screenshots for review.

## Setup

### Prerequisites

- **Node.js 20 or later and npm** (required by the pinned Playwright dependency).
- **Playwright Chromium**, installed in step 2 below.
- For Copilot tests only: **GitHub Copilot CLI**, authenticated with a GitHub account
  that can use Copilot. Follow the [Copilot CLI installation guide](https://docs.github.com/en/copilot/get-started/cli-quickstart)
  and its Node.js requirements if installing through npm.
- Copilot tests use the `qa-agent` custom agent. Ensure it is available in your QA
  workspace and permits Playwright tools; use `QA_WORKSPACE` if that workspace is
  outside this repository.

### Step by step

1. Clone the repository and enter it (skip cloning if you already have a checkout):

   ```bash
   git clone https://github.com/josehev/qa-runner.git
   cd qa-runner
   node --version
   npm --version
   ```

2. Install the project dependencies and the matching Chromium browser:

   ```bash
   npm ci
   npx playwright install chromium
   ```

   On Linux, if browser launch reports missing system libraries, use
   `npx playwright install --with-deps chromium` (may require administrator privileges).

3. For Copilot tests, verify the CLI and authenticate before starting the server:

   ```bash
   copilot --version
   copilot
   ```

   In the interactive CLI, enter `/login` and follow the prompts, then exit the CLI.
   Skip this step if you only need **Browser Check** or the repository test suite.

4. Verify the installation, then start the local server:

   ```bash
   npm test
   npm start
   ```

   `npm test` runs the repository test suite, including local Chromium tests. It
   requires the installed browser, but no external websites or authenticated Copilot
   session. `npm start` runs the server at **http://localhost:4545**; keep the terminal
   open and use Ctrl+C to stop it.

## Run a QA test

Open http://localhost:4545, choose a test, enter an `http://` or `https://` URL
or a local `.html`/`.htm` file path (see below),
and click **Run Test**. Watch **Test Output**, then open the report under
**Recent Results**. Start with **Browser Check** to verify browser setup; after
authenticating Copilot, run a **Smoke test** to verify the agent workflow too.

Use this only on a trusted local machine and test sites you are authorized to access.
Do not expose the server publicly: it opens supplied URLs and Copilot runs allow tools.

### Local HTML targets

All four testing options accept the same local inputs. For example, in the UI enter:

- `/home/me/demo site/index.html` (macOS/Linux absolute path)
- `C:\sites\demo\index.html` (Windows absolute path, when the runner is on Windows)
- `./demo site/index.html` (relative path)
- `file:///home/me/demo%20site/index.html` (local file URL)

**Relative paths always resolve against the directory containing `server.js` and
`browser-check.js` (the QA Runner repository root)**, regardless of the shell's
working directory, `QA_WORKSPACE`, or a run's artifact directory. Paths refer to
the filesystem of the machine **running QA Runner**, not the browser's machine.
There is no upload or file picker: selecting an HTML file in a browser would not
provide its server path or its sibling assets. Use native paths on the runner's OS;
network/UNC paths and remote file URLs are not supported.

Plain paths preserve literal spaces, Unicode, `#`, and `%`; do not URL-encode them.
File URLs use normal URL encoding (`%20` for spaces, `%23` for `#`, `%25` for `%`)
and must not contain a host, query, or fragment. The target must be a readable,
regular, non-hidden `.html` or `.htm` file (case-insensitive).

The runner previews each local document on a temporary **127.0.0.1-only,
ephemeral-port HTTP server**, separate from the runner UI/API. The same effective
URL is used for Chromium, MCP preflight, Copilot prompts/permissions, and browser
evidence matching. This avoids MCP's unrestricted filesystem-access permission.
The preview closes on completion, error, timeout, or client disconnection.

The **selected document's parent directory is the asset root**. Relative CSS,
JavaScript, images, fonts, JSON, WebAssembly, and audio/video assets in that tree
are served with appropriate MIME types. Keep all needed assets beneath that
directory. Parent-relative escapes, root-relative URLs (such as `/style.css`),
directory listings/index fallback, hidden paths, `node_modules`, symlinked assets,
and other file types are not served. A selected symlink is resolved to its real
document first; that document's parent becomes the root. Use a dedicated demo
directory with no sensitive files: supported sibling assets are readable by the
tested page. Source files are never copied into `/results/`.

JavaScript and real browser interactions still run; this is **not static analysis**.
Response status describes the local preview response, not a production server.
No backend, server-side rendering, production redirects, or HTTPS configuration
is supplied. External services still require network access and may behave
differently under the preview origin; production-only audit checks should be
reported as **NOT TESTED** with a reason. Only test trusted local HTML on a
trusted machine: pages execute code, may contact external services, and Copilot
has its existing tool permissions. The runner UI itself binds only to loopback.

## Configuration (optional)

Set environment variables before `npm start` if you need non-default settings:

- `QA_WORKSPACE`: Copilot's working directory for custom-agent discovery; defaults
  to the directory where the server starts.
- `COPILOT_BIN`: Copilot executable name or path; defaults to `copilot` on `PATH`.
  It is launched directly, not interpreted as a shell command with arguments.
- `QA_ARTIFACT_DIR`: the runner sets this to each run's absolute output directory
  for child processes. Standalone artifact writers can reuse an existing directory
  inside `my-project/result reports/`; normally leave it unset for a new run.

## Browser Check (Playwright)

**Browser Check** runs deterministic checks directly in Chromium, without Copilot
or CLI authentication: response status, uncaught page errors, console errors, and
images missing `alt` attributes. It also records console messages and captures a
full-page screenshot when run from the UI. It is not a full accessibility audit.

Run the same checks from the command line:

```bash
node browser-check.js https://example.com
node browser-check.js https://example.com --screenshot shot.png
node browser-check.js "./demo site/index.html" --screenshot local.png
node browser-check.js "/home/me/demo site/index.html"
node browser-check.js "file:///home/me/demo%20site/index.html"
```

JSON results go to stdout and progress to stderr; a Markdown report, JSON, and log
are also saved in the run directory. `--screenshot` adds a screenshot; its argument
supplies only the filename, so even an absolute path stays inside that run directory.

## Browser-backed Copilot tests

**Smoke test**, **Accessibility audit**, and **Form validation** use Copilot CLI
with the `qa-agent` and Playwright MCP browser tools to navigate, inspect, and
interact with the target. Unlike Browser Check, these are agent-driven audits,
not a fixed list of deterministic checks.

The runner supplies its own recorded MCP configuration, using headless Chromium
from the project's Playwright installation and an isolated in-memory profile.
Before launching Copilot, a browser preflight verifies navigation, JavaScript,
and screenshot capture, saving `preflight.png` and `browser-preflight.json`.
Failure blocks the run rather than falling back to static analysis.

Copilot must write `agent-result.json` with checks citing matching evidence IDs
and exact observed excerpts from recorded tool responses in `agent-browser.jsonl`.
The runner requires target navigation and a real interaction; preflight alone
does not count as agent testing. Missing or invalid evidence blocks the result.
The report separates validated checks from unvalidated agent commentary, and
`evidence-validation.json` records the verdict.

- **PASS**: evidence supports the reported executed checks; not a claim of full compliance.
- **FAIL**: an executed check observed a product defect.
- **NOT TESTED**: an intentionally unexecuted check, with a reason (for example,
  manual screen-reader testing). Playwright is not a real screen reader.
- **BLOCKED**: required browser infrastructure or agent evidence is unavailable
  or invalid. Fix the diagnostic and rerun; this is not a completed static audit.

Evidence validation confirms recorded execution, not the completeness of an audit,
and is not a security boundary against an agent with filesystem access.
Agent runs have a 15-minute deadline. Extra domains may require CLI approval.
The server allows two active runs and five run requests per client per minute;
excess requests receive HTTP 429.

## Reports and artifacts

New runs save artifacts in `my-project/result reports/<page>/<run>/`. Page folders
use a readable host/path label and URL hash; unique run folders keep repeated tests
from overwriting earlier results. Generated runs are ignored by Git. Reports and
their associated files are available through the UI and `/results/` URLs.
Copilot receives the run directory in its prompt and `QA_ARTIFACT_DIR`. For shell
redirection, explicitly write inside that directory; the runner cannot reroute `>`.
Local page folders use the canonical absolute file URL as their identity, so
path/file-URL aliases and repeated runs group together rather than by temporary
port. Reports retain the entered target; browser JSON includes the canonical
`url`, `originalTarget`, `effectiveUrl`, and observed `finalUrl`. API runs also
record that mapping in `target.json`. Preview URLs in evidence are historical
and stop working when the run ends. Screenshots and other generated output stay
inside the normal run directory.

## Historical artifacts

Past outputs from `results/`, `qa-reports/`, `tmp_audit/`, and the repository root
live in `my-project/result reports/<page>/legacy-<run>/`. Timestamped artifacts
are grouped by their report's tested URL and timestamp. Untimestamped collections
use their owning script's page and a source-labelled run, not an invented date.
Reports with no page information use `unknown-page`. Audit scripts remain source
files; vendor files under `node_modules/` are never migrated. `.gitkeep` remains.

`legacy-artifacts.json` records every old path, new relative path, and SHA-256
checksum. The server redirects old `/results/`, `/qa-reports/`, `/tmp_audit/`
and root artifact URLs to their new locations, including virtual `.html` views
of Markdown reports. Related files keep their filenames so relative links work.
Historical contents (including machine-local paths recorded in logs/JSON and
captured website HTML) are preserved byte-for-byte; unavailable original website
assets and `file://` links cannot be served by the runner. Historical HTML is
served with a sandbox policy so captured scripts cannot execute.

To migrate remaining historical artifacts and verify the manifest (not needed for
each new test):

```bash
npm run migrate:artifacts
```

The migration is safe to repeat: it verifies copies before removing sources and
refuses changed sources or conflicting destinations instead of overwriting them.
