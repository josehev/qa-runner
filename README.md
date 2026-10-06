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
ignored by Git; existing historical artifacts are not moved. The results history discovers
nested Markdown reports, and `/results/` URLs serve their reports and associated artifacts.
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
