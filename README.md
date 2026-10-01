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
full-page screenshot. Results are streamed to the UI and saved in `results/` (`.md` report, `.json`
result and `.png` screenshot).

Playwright needs browser binaries matching the installed package. Install Chromium once with:

```bash
npx playwright install chromium
```

You can also run the check from the command line (JSON result on stdout, progress on stderr):

```bash
node browser-check.js https://example.com --screenshot /tmp/shot.png
```

Only `http://` and `https://` URLs are accepted. The check is meant for a trusted local machine;
don't expose the server publicly, since it opens any URL it is given.
