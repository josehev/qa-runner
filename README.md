# qa-runner
Local QA testing tool that connects to Copilot agents without needing VS Code open

## Setup

```bash
npm install
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
node browser-check.js https://example.com --screenshot shot.png
```

The CLI also saves its report, JSON, and progress log in the run directory. Screenshot
arguments (including absolute paths) supply only the filename; screenshots always stay
inside that run directory. JSON on stdout and progress on stderr remain available.

Only `http://` and `https://` URLs are accepted. The check is meant for a trusted local machine;
don't expose the server publicly, since it opens any URL it is given.

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

Run `npm test` for local migration, content-preservation, path-safety, and HTTP
compatibility tests. No external websites, browser downloads, or Copilot are needed.
