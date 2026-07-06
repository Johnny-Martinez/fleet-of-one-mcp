#!/usr/bin/env node
/**
 * fleet-of-one-mcp-server
 *
 * Proof-of-production tools for AI coding agents. The core Fleet of One
 * discipline, exposed as callable MCP tools:
 *   - verify_done:  make "done" earn itself (run tests + diff git)
 *   - check_repro:  bug-first — confirm the bug reproduces before fixing
 *
 * Local server, stdio transport. It only ever runs the command YOU pass, in the
 * directory YOU specify — no network, no file mutation of its own.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "node:child_process";

const CHARACTER_LIMIT = 20000;

function tail(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return "…(truncated)…\n" + t.slice(t.length - max);
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runCommand(command: string, cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, env: process.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(err), timedOut });
    });
  });
}

async function gitStatus(cwd: string): Promise<{ isRepo: boolean; changed: string[]; diffstat: string }> {
  const status = await runCommand("git status --porcelain", cwd, 15000);
  if (status.code !== 0) return { isRepo: false, changed: [], diffstat: "" };
  const changed = status.stdout
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean)
    // porcelain lines are "XY <path>" (or "XY <old> -> <new>" for renames); keep the final path.
    .map((l) => {
      const path = l.slice(3).trim();
      const arrow = path.split(" -> ");
      return arrow[arrow.length - 1];
    });
  const diff = await runCommand("git diff --stat", cwd, 15000);
  return { isRepo: true, changed, diffstat: diff.stdout.trim() };
}

const server = new McpServer({ name: "fleet-of-one-mcp-server", version: "1.0.0" });

server.registerTool(
  "verify_done",
  {
    title: 'Verify "done"',
    description:
      'Prove a task is actually complete before trusting an agent\'s "done" claim. Runs the given test command and, if the directory is a git repo, diffs the actual changes. Returns PASS only if the tests pass (exit 0) and — when expect_changed is provided — every claimed path actually changed. This is the gate between "agent says done" and "I believe it."',
    inputSchema: {
      test_command: z
        .string()
        .min(1)
        .describe("The command that proves real behavior, e.g. 'npm test' or 'pytest -q'. Runs in the target directory."),
      cwd: z.string().optional().describe("Absolute path to the project directory. Defaults to the server's working directory."),
      expect_changed: z
        .array(z.string())
        .optional()
        .describe("Paths the agent claims it changed; verify_done checks each actually appears in git status."),
      claim: z.string().optional().describe("The agent's stated 'done' claim, echoed back in the verdict for the human reviewer."),
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(1800)
        .default(300)
        .describe("Max seconds to allow the test command to run before it is killed and the verdict is FAIL.")
    },
    outputSchema: {
      verdict: z.enum(["PASS", "FAIL"]),
      test_passed: z.boolean(),
      test_exit_code: z.number().nullable(),
      timed_out: z.boolean(),
      changed_files: z.array(z.string()),
      missing_expected_changes: z.array(z.string()),
      reasons: z.array(z.string()),
      evidence: z.string()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  async ({ test_command, cwd, expect_changed, claim, timeout_seconds }) => {
    const dir = cwd ?? process.cwd();
    const reasons: string[] = [];

    const run = await runCommand(test_command, dir, timeout_seconds * 1000);
    const testPassed = run.code === 0 && !run.timedOut;
    if (run.timedOut) reasons.push(`Test command timed out after ${timeout_seconds}s.`);
    else if (run.code !== 0) reasons.push(`Test command exited ${run.code} (expected 0).`);

    const git = await gitStatus(dir);
    const missing: string[] = [];
    if (expect_changed && expect_changed.length) {
      if (!git.isRepo) {
        reasons.push("expect_changed was provided but the directory is not a git repo, so changes can't be verified.");
      } else {
        for (const p of expect_changed) {
          const hit = git.changed.some((c) => c === p || c.endsWith("/" + p) || c.includes(p));
          if (!hit) missing.push(p);
        }
        if (missing.length) reasons.push(`Claimed changes not found in git status: ${missing.join(", ")}.`);
      }
    }

    const expectedOk = missing.length === 0;
    const verdict: "PASS" | "FAIL" = testPassed && expectedOk ? "PASS" : "FAIL";
    if (verdict === "PASS") {
      reasons.push(`Tests passed${expect_changed?.length ? " and all claimed changes are present" : ""}.`);
    }

    const evidence = tail(
      [
        claim ? `CLAIM: ${claim}` : "",
        `COMMAND: ${test_command}  (cwd: ${dir})`,
        `EXIT: ${run.code}${run.timedOut ? " (timed out)" : ""}`,
        git.isRepo ? `GIT CHANGED (${git.changed.length}): ${git.changed.join(", ") || "none"}` : "GIT: not a repo",
        git.diffstat ? `DIFFSTAT:\n${git.diffstat}` : "",
        "--- test output (tail) ---",
        (run.stdout + (run.stderr ? "\n[stderr]\n" + run.stderr : "")).trim()
      ]
        .filter(Boolean)
        .join("\n"),
      CHARACTER_LIMIT
    );

    const output = {
      verdict,
      test_passed: testPassed,
      test_exit_code: run.code,
      timed_out: run.timedOut,
      changed_files: git.changed,
      missing_expected_changes: missing,
      reasons,
      evidence
    };

    return {
      content: [{ type: "text", text: `${verdict}\n\n${reasons.join("\n")}\n\n${evidence}` }],
      structuredContent: output
    };
  }
);

server.registerTool(
  "check_repro",
  {
    title: "Check reproduction (bug-first)",
    description:
      "Bug-first discipline: before fixing a bug, confirm you actually reproduced it. Runs a command you expect to FAIL and returns PASS only if it genuinely fails (non-zero exit) — i.e., the bug is reproduced. If the command passes, you haven't reproduced the bug yet and shouldn't start 'fixing' it.",
    inputSchema: {
      repro_command: z
        .string()
        .min(1)
        .describe("A command (usually a failing test) that should FAIL while the bug exists, e.g. 'pytest tests/test_bug.py'."),
      cwd: z.string().optional().describe("Absolute path to the project directory. Defaults to the server's working directory."),
      timeout_seconds: z.number().int().min(1).max(1800).default(300).describe("Max seconds before the command is killed.")
    },
    outputSchema: {
      verdict: z.enum(["PASS", "FAIL"]),
      reproduced: z.boolean(),
      exit_code: z.number().nullable(),
      timed_out: z.boolean(),
      reasons: z.array(z.string()),
      evidence: z.string()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  async ({ repro_command, cwd, timeout_seconds }) => {
    const dir = cwd ?? process.cwd();
    const run = await runCommand(repro_command, dir, timeout_seconds * 1000);
    const reproduced = run.code !== 0 && !run.timedOut;
    const reasons: string[] = [];
    if (run.timedOut) reasons.push(`Command timed out after ${timeout_seconds}s — inconclusive, treat as not reproduced.`);
    else if (reproduced) reasons.push(`Command failed (exit ${run.code}) — bug reproduced. Fix it, then re-run to confirm it passes.`);
    else reasons.push("Command passed (exit 0) — the bug did NOT reproduce. Don't 'fix' what you can't reproduce.");

    const evidence = tail(
      `COMMAND: ${repro_command}  (cwd: ${dir})\nEXIT: ${run.code}${run.timedOut ? " (timed out)" : ""}\n--- output (tail) ---\n` +
        (run.stdout + (run.stderr ? "\n[stderr]\n" + run.stderr : "")).trim(),
      CHARACTER_LIMIT
    );

    const output = {
      verdict: (reproduced ? "PASS" : "FAIL") as "PASS" | "FAIL",
      reproduced,
      exit_code: run.code,
      timed_out: run.timedOut,
      reasons,
      evidence
    };

    return {
      content: [{ type: "text", text: `${output.verdict}\n\n${reasons.join("\n")}\n\n${evidence}` }],
      structuredContent: output
    };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel; logs must go to stderr.
  console.error("fleet-of-one-mcp-server running on stdio");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
