# fleet-of-one-mcp-server

Proof-of-production tools for AI coding agents — the core [Fleet of One](https://fleetofone.dev) discipline as callable MCP tools. Make **"done" earn itself.**

Two tools, one job: stop trusting an agent's word for it.

| Tool | What it does |
|---|---|
| `verify_done` | Runs your test command and, in a git repo, diffs the actual changes. Returns **PASS** only if tests pass (exit 0) and every claimed change is really there. The gate between "agent says done" and "I believe it." |
| `check_repro` | Bug-first discipline: runs a command you expect to **fail** and confirms it actually fails, so you've reproduced the bug before you start fixing it. |

It only ever runs the command **you** pass, in the directory **you** specify. No network, no file changes of its own. Local stdio server.

## Install

```bash
npm install
npm run build
npm test        # end-to-end smoke test against the built server
```

## Use it with Claude Code

Add to your MCP config (e.g. `.mcp.json` in your project, or the global config):

```json
{
  "mcpServers": {
    "fleet-of-one": {
      "command": "node",
      "args": ["/absolute/path/to/fleet-of-one-mcp-server/dist/index.js"]
    }
  }
}
```

Then an agent can call `verify_done` before claiming a task is complete:

```
verify_done(test_command="npm test", expect_changed=["src/auth.ts"], claim="wired up login")
→ PASS / FAIL with the test exit code, the real git changes, and the evidence tail.
```

## The free skills this is built from

`proof-of-production-lite`, `bug-first-tdd`, and `agent-lane-operations-lite` — the free MIT starter repo: <https://github.com/Johnny-Martinez/fleet-of-one-free>

The full operating system (95-page playbook, 27 skills, 13 tool dossiers) is [Fleet of One](https://fleetofone.dev/?utm_source=github&utm_medium=referral&utm_campaign=fo-organic-launch&utm_content=freerepo-readme-cta).

MIT.
