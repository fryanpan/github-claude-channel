/**
 * The broker hands out the owner's GitHub notifications to anyone who can
 * register, with no auth, so it must answer only on this machine. It used to
 * listen on every interface, which put the notifications on the LAN.
 *
 * Each test gets its own broker on its own port, so nothing touches the live
 * broker on 7902.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { networkInterfaces } from "node:os";

const BROKER = new URL("../broker.ts", import.meta.url).pathname;

function freePort(): number {
  const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const p = s.port;
  s.stop(true);
  return p;
}

/** A non-loopback IPv4 address of this machine, or null when it has none. */
function lanAddress(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

const port = freePort();
const broker = Bun.spawn([process.execPath, BROKER], {
  env: { ...process.env, GITHUB_CHANNEL_PORT: String(port) },
  stdout: "ignore",
  stderr: "ignore",
});

afterAll(() => broker.kill());

async function waitForLoopback(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (await reachable(`http://127.0.0.1:${port}/health`)) return;
    await Bun.sleep(100);
  }
  throw new Error("broker never answered on 127.0.0.1");
}

describe("the broker listens on this machine only", () => {
  test("answers on 127.0.0.1", async () => {
    await waitForLoopback();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
  });

  const lan = lanAddress();
  test.skipIf(lan === null)("does not answer on the machine's LAN address", async () => {
    await waitForLoopback();
    expect(await reachable(`http://${lan}:${port}/health`)).toBe(false);
  });
});
