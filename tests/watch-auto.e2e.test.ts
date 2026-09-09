/**
 * End-to-end proof of the actual bug: spawn the MCP server exactly as Claude
 * Code spawns it (/bin/sh <launcher> <server.ts>) from some OTHER repo's
 * directory, and check that watch_repo("auto") answers with THAT repo.
 *
 * The old code answered fryanpan/github-claude-channel here, because the
 * launcher's cd left process.cwd() pointing at this plugin's own checkout.
 *
 * Each test gets its own broker on its own port, so nothing touches the live
 * broker on 7902 or the fleet's real subscriptions.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LAUNCHER = new URL("../bin/github-channel-mcp.sh", import.meta.url).pathname;
const PLUGIN_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const brokerPorts: number[] = [];

function freePort(): number {
  const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const p = s.port;
  s.stop(true);
  return p;
}

function makeRepo(remote: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "gcc-repo-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  if (remote) Bun.spawnSync(["git", "remote", "add", "origin", remote], { cwd: dir });
  return dir;
}

/** Drive one MCP session over stdio and return the text of each tool reply. */
async function callTools(
  cwd: string,
  calls: Array<{ name: string; arguments: Record<string, unknown> }>,
): Promise<string[]> {
  const port = freePort();
  brokerPorts.push(port);
  const child = Bun.spawn(["/bin/sh", LAUNCHER, `${PLUGIN_DIR}/server.ts`], {
    cwd,
    env: {
      ...process.env,
      GITHUB_CHANNEL_PORT: String(port), // isolated broker
      GITHUB_TOKEN: "",                  // never poll GitHub from a test
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const send = (msg: unknown) => child.stdin.write(JSON.stringify(msg) + "\n");
  const reader = child.stdout.getReader();
  let buf = "";
  const pending = new Map<number, string>();

  /** Read stdout until the reply with `id` arrives, then return its text. */
  async function awaitReply(id: number, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (!pending.has(id)) {
      if (Date.now() > deadline) throw new Error(`no reply to id=${id} within ${timeoutMs}ms`);
      const { value, done } = await reader.read();
      if (done) throw new Error(`server closed stdout before replying to id=${id}`);
      buf += new TextDecoder().decode(value);
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim().startsWith("{")) continue;
        const msg = JSON.parse(line);
        if (typeof msg.id !== "number") continue;
        if (msg.error) throw new Error(`id=${msg.id} returned error ${JSON.stringify(msg.error)}`);
        if (msg.result) pending.set(msg.id, msg.result.content?.[0]?.text ?? "");
      }
    }
    return pending.get(id)!;
  }

  send({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
  });
  await awaitReply(1, 45_000);

  // One call at a time, each awaited before the next is sent. The server
  // handles requests concurrently, so firing them together would let a fast
  // read overtake the slow write it is supposed to be observing -- which is
  // not how a caller uses these tools.
  const out: string[] = [];
  for (let i = 0; i < calls.length; i++) {
    send({ jsonrpc: "2.0", id: 2 + i, method: "tools/call", params: calls[i] });
    out.push(await awaitReply(2 + i, 45_000));
  }

  child.kill();
  return out;
}

afterAll(() => {
  // Reap the throwaway brokers this file started.
  for (const port of brokerPorts) {
    const out = Bun.spawnSync(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).stdout.toString().trim();
    for (const pid of out.split("\n").filter(Boolean)) Bun.spawnSync(["kill", pid]);
  }
});

describe('watch_repo("auto") from another repo', () => {
  test("resolves the CALLER's repo, and list_watched confirms it", async () => {
    const dir = makeRepo("https://github.com/acme/widgets.git");
    const [watch, listed] = await callTools(dir, [
      { name: "watch_repo", arguments: { repo: "auto" } },
      { name: "list_watched", arguments: {} },
    ]);

    expect(watch).toContain("acme/widgets");
    // The regression, stated directly: never the plugin's own repo.
    expect(watch).not.toContain("github-claude-channel");

    // Confirm through the READ side too. The old bug produced a success-shaped
    // write reply over a subscription that was not what the caller asked for,
    // so asserting on the write alone would not have caught it.
    expect(listed).toContain("acme/widgets");
    expect(listed).not.toContain("github-claude-channel");
  }, 60_000);

  test("a session starts watching nothing (no startup auto-watch)", async () => {
    const dir = makeRepo("https://github.com/acme/widgets.git");
    const [listed] = await callTools(dir, [{ name: "list_watched", arguments: {} }]);
    // Startup used to add the plugin's own repo to every session on the machine.
    expect(listed).toContain("No repos watched");
  }, 60_000);

  test("an ssh remote resolves too", async () => {
    const dir = makeRepo("git@github.com:acme/widgets.git");
    const [watch] = await callTools(dir, [{ name: "watch_repo", arguments: { repo: "auto" } }]);
    expect(watch).toContain("acme/widgets");
  }, 60_000);

  test("a directory with no GitHub remote is told so, not handed this repo", async () => {
    const dir = makeRepo(null);
    const [watch] = await callTools(dir, [{ name: "watch_repo", arguments: { repo: "auto" } }]);
    expect(watch).toContain("Could not detect");
    expect(watch).toContain(dir.replace("/var/", "/private/var/"));
    expect(watch).not.toContain("Already watching");
    expect(watch).not.toContain("fryanpan/github-claude-channel");
  }, 60_000);
});
