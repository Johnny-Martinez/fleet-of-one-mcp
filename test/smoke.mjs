// End-to-end smoke test: drives the built server with the REAL MCP client SDK
// over stdio, exercising the actual protocol (initialize -> tools/list -> tools/call).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

let failures = 0;
function ok(cond, label) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}`);
  }
}

// A temp git repo with one untracked change, so expect_changed has something real to match.
const dir = mkdtempSync(join(tmpdir(), "fo-mcp-"));
execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir, shell: true });
writeFileSync(join(dir, "a.txt"), "hello");

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
const names = tools.tools.map((t) => t.name).sort();
ok(names.includes("verify_done") && names.includes("check_repro"), `tools listed: ${names.join(", ")}`);

const sc = async (args, name = "verify_done") => (await client.callTool({ name, arguments: args })).structuredContent;

ok((await sc({ test_command: "true", cwd: dir, expect_changed: ["a.txt"] })).verdict === "PASS", "verify_done PASS (tests pass + claimed change present)");
ok((await sc({ test_command: "false", cwd: dir })).verdict === "FAIL", "verify_done FAIL (tests fail)");
ok((await sc({ test_command: "true", cwd: dir, expect_changed: ["ghost.txt"] })).verdict === "FAIL", "verify_done FAIL (claimed change missing)");

const repro = async (cmd) => (await sc({ repro_command: cmd, cwd: dir }, "check_repro"));
ok((await repro("false")).verdict === "PASS", "check_repro PASS (bug reproduces on failing command)");
ok((await repro("true")).verdict === "FAIL", "check_repro FAIL (no repro on passing command)");

await client.close();
console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} SMOKE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
