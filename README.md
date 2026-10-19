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

JSON results go to stdout and progress to stderr; an HTML report, Markdown, JSON, and log
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
Evidence IDs may be positive integers or their decimal strings (`1` or `"1"`).
Before writing results, the agent reads that transcript and copies each record's
`tool` as `action`, `id` as `evidence`, and a verbatim excerpt of `text` as
`observed` (excluding the echoed Playwright code). Missing IDs, mismatched tools,
and non-verbatim excerpts produce distinct diagnostics; do not bypass validation
or use preflight IDs to repair a blocked report.
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
Agent runs have a 15-minute deadline. Copilot's built-in URL tools are approved
only for the target origin; other domains may require CLI approval (see curl below).
The server allows two active runs and five run requests per client per minute;
excess requests receive HTTP 429.

### Standard run reports

Every completed Browser Check (UI or CLI) and Copilot run, including blocked runs,
saves a self-contained `report.html` in its run directory. The report includes:

- A summary with the tested URL, recorded page title, UTC start/end times, total
  duration, check/bug counts, and a text-labelled **PASS**, **FAIL**, or **N/A** badge.
  Missing metadata is shown as **Not recorded**. Only HTTP(S) URLs are clickable;
  local file identities remain text.
- Test areas derived from actual checks, with a bullet per check labelled **Pass**,
  **Fail**, or **Not tested**, plus recorded details, reasons, and evidence.
- Command diagnostics, artifact links, and complete recorded results/output.
  Unvalidated agent commentary is never used to determine success.
- A final bug table showing description, location, area, and severity, ordered
  Critical → High → Medium → Low → Informational → Unknown. Failed product checks
  without separate bug records become findings with **Unknown** severity; screenshot
  capture failures are not product bugs.

No accepted executed checks means **N/A**, not PASS. Agent evidence validation
retains its **BLOCKED** diagnostic; unaccepted checks are displayed as **Not tested**.
Command failures remain visible without overriding the validated browser verdict.
Reports use inline CSS, responsive tables, and print styles with no external assets.
Markdown, JSON, logs, screenshots, and transcripts remain available unchanged.
Older Markdown-only reports retain their full text but show **N/A** rather than
guessing structured outcomes or timing from prose or file timestamps.

Agents are asked to record a page `title` and a `name` and `area` per check in
`agent-result.json`. An optional `bugs` array records distinct findings with
`title`/`description`, `page`/`section`/`element`/`selector`/`location`, `area`,
and optional `severity`. Each bug must cite the `evidence` ID of a FAIL check;
unsupported bug records block validation. Missing severity is never guessed.

### curl in Copilot runs

Copilot runs are noninteractive (`copilot -p`), so any action that needs approval
is denied with "Permission denied … no interactive user response was available"
(older CLIs: "could not request permission from user"). This is an application
prompt, not an OS, network, or sandbox error. Shell tools, including curl, were
already approved by `--allow-all-tools`; historical curl denials came from the
CLI's **path** check, which auto-approves only the working directory
(`QA_WORKSPACE`) and the system temp directory. Commands such as `cd /tmp && curl`,
`curl -o /tmp/page.html`, or `wc -l /tmp/page.html` were denied on macOS, where the
temp directory is `$TMPDIR` (`/var/folders/…`), not `/tmp`. Run directories outside
the workspace were denied the same way.

Each run now passes `--add-dir <run directory>` and tells the agent to keep curl
downloads, upload sources, header dumps, cookie jars, and scratch files there
using absolute paths. Within that directory, curl may use any argument order,
quoted URLs, redirects (`-L`), HEAD/GET or explicit methods (`-X`), headers and
auth (`-H`, `-A`, `-u`, cookies), request bodies, multipart or `-T` uploads,
downloads, `-w` status output, and compositions such as `cd <run dir> && curl`
or `curl … | grep`. Only that one directory is added; no `--allow-all`, `--yolo`,
`--allow-all-paths`, `--allow-all-urls`, or shell allow rules are used. Approval
is not substring-based: commands that merely mention curl, or curl compositions
that touch other paths (`; touch /elsewhere`, `$(…)`, `> /elsewhere`), still
need approval and are denied. Shell curl URLs are not limited by `--allow-url`
under `--allow-all-tools`, so external linked resources work as before.

Security: the agent can send state-changing requests (POST/PUT/PATCH/DELETE,
uploads) to any reachable host and write downloaded content into the run
directory. The prompt limits these requests to the target and to tests that
permit safe submissions; this is guidance, not enforcement. Run QA only against
targets you are authorized to test, and do not point it at production systems
with destructive endpoints. The CLI may load agent or skill files from added
directories, so do not place untrusted `.github` content in run directories.

Diagnostics: the server checks `curl --version` before each run, records the
session transcript in `copilot-session.txt` (`--share`), and writes
`command-diagnostics.json` plus a **Command diagnostics** report section. It
separates `permission-denied`, `curl-missing`, `network-error`, `http-error`
(`--fail`), and `sandbox-restricted` failures, with the denied path when it can
be identified. These commands are not PASS evidence and do not change the
validated status; the agent is told to report them as BLOCKED or NOT TESTED.

Limitations: CLI path checks are heuristic (for example, unresolved `$VARS` are
not checked) and are not a security boundary. A sandbox, OS policy, proxy,
firewall, or DNS can still block curl. The CLI's command safety analysis may
still ask for approval for some high-risk commands. The transcript is not written
when a run times out or is killed. None of this guarantees coverage of every
scenario.

`npm test` includes an opt-in check against the real Copilot CLI that uses a
scripted local model and local HTTP fixtures (no GitHub authentication):
`QA_TEST_COPILOT_BIN=/path/to/copilot npm test`. It is skipped without that variable.

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
