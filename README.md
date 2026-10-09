# qa-runner
Local QA testing tool that connects to Copilot agents without needing VS Code open

## Setup

```bash
npm install && npx playwright install chromium
npm start   # http://localhost:4545
```

## Browser Check (Playwright)

The **Browser Check** test runs deterministic checks with Playwright instead of a Copilot agent:
response status, uncaught page errors, console messages, images missing `alt` attributes, and a
full-page screenshot. Results are streamed to the UI and saved in
`my-project/result reports/<page>/<run>/` (`.md` report, `.json` result, `.log` progress
and `.png` screenshot).

All QA artifact writers use this existing folder. Page folders have a readable host/path
label and a URL hash (including query strings); each run gets a timestamp and a unique
suffix so repeated or concurrent tests never overwrite earlier runs. Generated runs are
ignored by Git; migrated historical runs use tracked `legacy-*` run folders. The results
history discovers nested Markdown and HTML reports, and `/results/` URLs serve their
reports and associated artifacts.
Copilot runs retain the QA workspace for agent discovery and receive the absolute run
directory in both their prompt and `QA_ARTIFACT_DIR`. Standalone QA scripts reuse this
directory when launched by an agent, or create their own run directory otherwise.

Playwright needs browser binaries matching the installed package. Install Chromium once with:

```bash
npx playwright install chromium
```

You can also run the check from the command line (JSON result on stdout, progress on stderr):

```bash
node browser-check.js https://example.com
node browser-check.js https://example.com --screenshot shot.png
```

The CLI also saves its report, JSON, and progress log in the run directory. Screenshot
arguments (including absolute paths) supply only the filename; screenshots always stay
inside that run directory. JSON on stdout and progress on stderr remain available.

Only `http://` and `https://` URLs are accepted. The check is meant for a trusted local machine;
don't expose the server publicly, since it opens any URL it is given.

## Browser-backed Copilot tests

Smoke, accessibility, and form tests **require a browser**. Install and authenticate
Copilot CLI (`copilot --version` must work), then use the setup command above.
`COPILOT_BIN` can be an executable path; shell commands/wrappers are not accepted.
`QA_WORKSPACE` selects the workspace used for custom agent discovery. The existing
`qa-agent` must allow Playwright tools; a restrictive custom-agent tool list can
still block an audit.

Each run supplies `--additional-mcp-config @<absolute-config-file>` to Copilot.
The configuration launches the locally pinned Playwright MCP through a recording
wrapper, with headless Chromium, an isolated in-memory profile, and the run's
`QA_ARTIFACT_DIR` as its working/output directory. MCP uses the Chromium executable
installed by the project's pinned Playwright, not an independently downloaded
browser or an MCP configuration from your user profile. The target origin replaces
the previously fixed URL permission; additional domains may require CLI approval.

Before Copilot starts, mandatory preflight connects to that same MCP wrapper,
discovers browser tools, launches Chromium, navigates to the target, executes
JavaScript, and saves `preflight.png` and `browser-preflight.json`. A missing
binary, failed MCP connection, unreachable target, or failed evidence capture
returns **BLOCKED: browser environment unavailable** with the underlying error.
Copilot is not started and no static-only fallback is accepted. On Linux, if
Playwright reports missing system libraries, install them with
`npx playwright install --with-deps chromium`.
Agent runs have a 15-minute deadline; an unfinished run is BLOCKED, not a pass.
Disconnects terminate the CLI; on POSIX systems its MCP/browser process group is
also terminated.
The run endpoint allows five requests per client per minute and at most two
active QA runs (including preflight); excess requests receive HTTP 429.

The run prompt requires navigation, real interactions (including keyboard focus
and safe form submissions), screenshots/DOM observations and console inspection.
The wrapper records agent tool calls/results in `agent-browser.jsonl`, returning
a `QA evidence ID` for each call. Copilot must write `agent-result.json`:

```json
{
  "status": "PASS",
  "checks": [
    {
      "status": "PASS",
      "action": "browser_navigate",
      "evidence": 1,
      "observed": "Page Title: Example",
      "detail": "Rendered target loaded"
    }
  ]
}
```

This illustrates a single check; an accepted report also needs an evidence-backed
interaction. PASS/FAIL checks must cite matching tool calls and exact excerpts
of their responses. The runner rejects missing/mismatched evidence, a failed CLI,
or runs lacking target navigation and interaction. Preflight evidence never
counts as agent testing. The saved report shows validated checks and labels raw
agent commentary as unvalidated; `evidence-validation.json` records the verdict.
This validates recorded execution, not the completeness or correctness of an
agent's entire audit, and is not a security boundary against an untrusted agent
with filesystem access.

- **PASS**: evidence supports the reported executed checks; not a claim of full compliance.
- **FAIL**: an executed check observed a product defect.
- **NOT TESTED**: an intentionally unexecuted check, with a reason (for example,
  manual screen-reader testing). Playwright is not a real screen reader.
- **BLOCKED**: required browser infrastructure or agent evidence is unavailable
  or invalid. Fix the diagnostic and rerun; this is not a completed static audit.

All current agent prompts are browser-required; Browser Check remains the separate
deterministic path. Keep any intentional static analysis clearly identified as
static, rather than using it to substitute for these audits.

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

Run `npm run migrate:artifacts` to migrate remaining files matching these legacy
collections and verify the manifest. The command is repository-rooted regardless
of the invocation directory, deterministic, and safe to repeat. It verifies copies
before removing sources and refuses changed sources or conflicting destinations
rather than overwriting them. New runs keep using unique run directories, not the
historical folders. For shell redirection, explicitly use a path within the run's
`QA_ARTIFACT_DIR`; the runner cannot reroute arbitrary shell `>` commands.

Run `npm test` after setup for migration, content-preservation, path-safety, HTTP
compatibility, preflight failure, MCP wiring, and real Chromium interaction tests.
The browser tests use local HTTP fixtures and deliberately fail if Chromium is
unavailable. No external websites or authenticated Copilot sessions are needed;
tests do not download browsers. CLI authentication/model behavior must still be
verified with a real smoke run on your machine.
