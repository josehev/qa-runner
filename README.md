# qa-runner
Local QA testing tool that connects to Copilot agents without needing VS Code open

## Getting started

QA Runner needs the GitHub Copilot CLI and a custom agent with valid YAML frontmatter. A sample agent is included in [`agents/qa-agent.agent.md`](agents/qa-agent.agent.md).

See **[SETUP.md](SETUP.md)** for how to install the agent, check that it loads, configure Playwright MCP so the agent can visit websites, and fix errors such as `custom agent markdown frontmatter is malformed`.

```bash
npm install
mkdir -p ~/.copilot/agents && cp agents/qa-agent.agent.md ~/.copilot/agents/
QA_WORKSPACE=/path/to/your/qa-project npm start   # http://localhost:4545
```

Test results are saved to `results/`, which Git ignores.
