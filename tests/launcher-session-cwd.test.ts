import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LAUNCHER = new URL("../bin/github-channel-mcp.sh", import.meta.url).pathname;
const PLUGIN_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

function runSeam(cwd: string): string {
  const proc = Bun.spawnSync(["/bin/sh", LAUNCHER, `${PLUGIN_DIR}/server.ts`], {
    cwd,
    env: { ...process.env, GITHUB_CHANNEL_MCP_PRINT_SESSION_CWD: "1" },
  });
  return new TextDecoder().decode(proc.stdout).trim();
}

describe("launcher captures the session's cwd", () => {
  test("reports the directory it was spawned in, not the plugin directory", () => {
    const caller = mkdtempSync(join(tmpdir(), "gcc-caller-"));
    const seen = runSeam(caller);
    // realpath, because macOS /tmp is a symlink to /private/tmp.
    expect(seen).toBe(Bun.spawnSync(["/bin/sh", "-c", `cd "${caller}" && pwd -P`]).stdout.toString().trim());
    expect(seen).not.toBe(PLUGIN_DIR);
  });

  test("the value is exported, so the server process actually inherits it", () => {
    // The seam reads the variable back from a CHILD shell. If `export` were
    // dropped the child would print the placeholder instead.
    const caller = mkdtempSync(join(tmpdir(), "gcc-caller-"));
    expect(runSeam(caller)).not.toBe("<not-exported>");
  });

  test("two different callers get two different values", () => {
    // The regression: one shared value for every session on the machine.
    const a = mkdtempSync(join(tmpdir(), "gcc-a-"));
    const b = mkdtempSync(join(tmpdir(), "gcc-b-"));
    expect(runSeam(a)).not.toBe(runSeam(b));
  });

  test("survives a cwd containing spaces", () => {
    const base = mkdtempSync(join(tmpdir(), "gcc-space-"));
    const spaced = join(base, "a dir with spaces");
    mkdirSync(spaced);
    expect(runSeam(spaced)).toContain("a dir with spaces");
  });
});
