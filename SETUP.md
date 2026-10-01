# QA Runner setup

QA Runner starts the GitHub Copilot CLI (`copilot -p "<prompt>" --allow-all-tools --agent <agent>`) for each test. The agent named in `prompts.json` (`qa-agent` by default) must exist and have valid YAML frontmatter, or every test fails.

This repository includes a ready-to-use sample agent: [`agents/qa-agent.agent.md`](agents/qa-agent.agent.md).

## 1. Prerequisites

- Node.js 18 or later
- GitHub Copilot CLI, installed and signed in:

  ```bash
  npm install -g @github/copilot
  copilot --version   # must print a version
  copilot             # first run: sign in with /login, then type /exit
  ```

  The runner starts `copilot` from your `PATH`. If you get `spawn copilot ENOENT`, the terminal that runs `node server.js` can't find `copilot`. Add the folder containing it to your `PATH`. For example, if you installed to `~/.local/bin`, add `export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc`, then open a new terminal.

- Install dependencies once after cloning:

  ```bash
  npm install
  ```

## 2. Install the QA agent

Use **one** of these options.

### Option A: personal agent (works from any folder)

Copy the sample agent to your personal Copilot agents folder:

```bash
mkdir -p ~/.copilot/agents
cp agents/qa-agent.agent.md ~/.copilot/agents/qa-agent.agent.md
```

The Copilot CLI loads personal agents from `~/.copilot/agents/`, whatever `QA_WORKSPACE` is set to.

### Option B: project agent (shared with your team through Git)

Copy the sample agent into the `.github/agents/` folder of the project you want to test from. Then set `QA_WORKSPACE` to that project when you start the runner:

```bash
mkdir -p /path/to/your/qa-project/.github/agents
cp agents/qa-agent.agent.md /path/to/your/qa-project/.github/agents/qa-agent.agent.md
```

The runner starts `copilot` with `QA_WORKSPACE` as its working directory, so the CLI finds project agents in `$QA_WORKSPACE/.github/agents/`. If `QA_WORKSPACE` is not set, the runner uses the folder where you started `node server.js`.

### Agent name

The agent ID is the file name without `.agent.md`, so `qa-agent.agent.md` becomes `qa-agent`. This ID must match the `"agent"` value in `prompts.json`. If you use a different file name, update `prompts.json` to match.

## 3. Required frontmatter format

Every `*.agent.md` file **must start** with a YAML frontmatter block. The first line of the file must be `---`, with no blank lines, spaces or byte-order mark before it:

```markdown
---
name: qa-agent
description: Tests a supplied website URL in a real browser and reports QA findings.
---

You are a QA testing agent. ...instructions in Markdown...
```

| Field         | Required | Notes                                                                                                                |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `name`        | yes      | Use the same value as the file name, e.g. `qa-agent`.                                                                |
| `description` | yes      | One line describing what the agent does. Quote it (`"..."`) if it contains a `:` followed by a space, or starts with a special character like `#`, `[`, `{`, `*` or `&`. |
| `tools`       | no       | List of allowed tools. Leave it out to allow all available tools, including browser MCP tools.                     |

Everything after the closing `---` is the agent's instructions.

## 4. Verify the agent loads

Some guides mention `copilot agent list`, but the Copilot CLI doesn't have that command, so it fails with `Invalid command format`. Use one of these checks instead:

- **Interactive:** run `copilot` from your `QA_WORKSPACE` folder, type `/agent`, and check that `qa-agent` appears in the list. Type `/exit` to quit.
- **Non-interactive** (the same way the runner calls it):

  ```bash
  cd /path/to/your/qa-project   # your QA_WORKSPACE (any folder for Option A)
  copilot -p "Reply with OK" --agent qa-agent --allow-all-tools
  ```

  If it replies normally, the agent loaded. `No such agent: qa-agent` means the file is in the wrong place or has the wrong name. `frontmatter is malformed` means the YAML block is invalid. See [Troubleshooting](#troubleshooting).

## 5. Give the agent a browser (Playwright MCP)

Loading the agent doesn't give it a browser. To visit websites, the Copilot CLI needs a browser tool such as the [Playwright MCP server](https://github.com/microsoft/playwright-mcp). The Copilot CLI doesn't use the MCP configuration from VS Code. You need to configure it separately.

Add Playwright MCP to your personal CLI configuration (`~/.copilot/mcp-config.json`):

```bash
copilot mcp add playwright -- npx -y @playwright/mcp@latest
copilot mcp list   # "playwright" should be listed
```

Or edit `~/.copilot/mcp-config.json` yourself:

```json
{
  "mcpServers": {
    "playwright": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"],
      "tools": ["*"]
    }
  }
}
```

The first time Playwright runs, it may need to download a browser. If it reports that the browser is missing, run `npx playwright install chromium`.

You can also configure MCP servers for one project in `.mcp.json` or `.github/mcp.json` inside `QA_WORKSPACE`. Run `copilot mcp --help` for details.

To check it works, run:

```bash
copilot -p "Open https://example.com and tell me the page title" --agent qa-agent --allow-all-tools
```

The agent should report `Example Domain`. If it says it has no browser tool, check the MCP configuration again.

## 6. Start the runner

```bash
cd /path/to/qa-runner
QA_WORKSPACE=/path/to/your/qa-project npm start
```

Then open <http://localhost:4545>. With Option A (personal agent), `QA_WORKSPACE` can be any existing folder.

Each run saves its output to `results/`. Git ignores this folder (see `.gitignore`), so test outputs aren't committed.

## Troubleshooting

### `custom agent markdown frontmatter is malformed: missing or malformed YAML frontmatter`

The CLI found the agent file but couldn't read its frontmatter. Check that:

1. **The first line is exactly `---`.** There must be nothing before it: no title like `# QA Agent`, no blank line, no spaces. Some editors add an invisible byte-order mark (BOM), so save the file as UTF-8 **without BOM**.
2. **The block is closed** with a second `---` line before the instructions start.
3. **`name:` and `description:` are both present**, each followed by a space and a value.
4. **The YAML is valid.** Use spaces, not tabs. Quote values that contain `: ` or start with a special character, e.g. `description: "QA: smoke and a11y tests"`.
5. **The line endings and quotes are plain.** Pasting from chat or a document can add curly quotes (`“ ”`). Copying [`agents/qa-agent.agent.md`](agents/qa-agent.agent.md) with `cp` avoids this.

To see the start of the file, including hidden characters, run:

```bash
head -n 4 ~/.copilot/agents/qa-agent.agent.md | cat -A   # Linux
head -n 4 ~/.copilot/agents/qa-agent.agent.md | cat -e   # macOS
```

The first line should be `---$`. If it starts with `M-oM-;M-?`, the file has a BOM. If a line ends in `^M$`, the file has Windows line endings. Re-save the file without them, or copy the sample file again.

### `No such agent: <name>, available: ...`

The CLI can't find an agent with that name. Check that:

- The file name matches the `"agent"` value in `prompts.json` (`qa-agent` ↔ `qa-agent.agent.md`).
- The file is in `~/.copilot/agents/` (Option A) or `$QA_WORKSPACE/.github/agents/` (Option B).
- `QA_WORKSPACE` points to a folder that exists. Run `ls "$QA_WORKSPACE/.github/agents"` to check.

### `spawn copilot ENOENT`

The `copilot` executable isn't on the `PATH` of the terminal running the server. See [Prerequisites](#1-prerequisites).

### The agent says it can't open the website

The agent loaded, but the CLI has no browser tool. Set up Playwright MCP as described in [section 5](#5-give-the-agent-a-browser-playwright-mcp).
