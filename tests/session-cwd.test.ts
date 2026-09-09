import { describe, expect, test } from "bun:test";
import { SESSION_CWD_ENV, resolveDetectionCwd, sessionCwd } from "../shared/session-cwd.ts";

describe("sessionCwd", () => {
  test("reads the absolute path the launcher exported", () => {
    expect(sessionCwd({ [SESSION_CWD_ENV]: "/Users/me/dev/some-repo" })).toBe("/Users/me/dev/some-repo");
  });

  test("is null when unset or blank", () => {
    expect(sessionCwd({})).toBeNull();
    expect(sessionCwd({ [SESSION_CWD_ENV]: "   " })).toBeNull();
  });

  test("rejects a relative value rather than resolving it against the plugin dir", () => {
    // A relative path would be resolved against the server's cwd, which IS the
    // plugin directory -- silently reintroducing the bug.
    expect(sessionCwd({ [SESSION_CWD_ENV]: "../some-repo" })).toBeNull();
  });
});

describe("resolveDetectionCwd", () => {
  test("an explicit cwd wins over the launcher's", () => {
    const r = resolveDetectionCwd({
      explicitCwd: "/Users/me/dev/explicit",
      env: { [SESSION_CWD_ENV]: "/Users/me/dev/from-launcher" },
    });
    expect(r).toEqual({ ok: true, cwd: "/Users/me/dev/explicit", source: "explicit" });
  });

  test("falls back to the cwd the launcher captured", () => {
    const r = resolveDetectionCwd({ env: { [SESSION_CWD_ENV]: "/Users/me/dev/caller-repo" } });
    expect(r).toEqual({ ok: true, cwd: "/Users/me/dev/caller-repo", source: "launcher" });
  });

  test("refuses to guess when neither is available", () => {
    const r = resolveDetectionCwd({ env: {} });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain(SESSION_CWD_ENV);
    // The whole point: it must not silently answer with the server's own cwd.
    expect(r.error).not.toContain("github-claude-channel/server.ts");
  });

  test("never falls back to process.cwd(), which is the plugin's own checkout", () => {
    // process.cwd() here is this repo -- exactly the value the old code returned
    // to every caller. A correct implementation cannot produce it from an empty env.
    const r = resolveDetectionCwd({ env: {} });
    expect(r.ok).toBe(false);
    const asAny = r as { cwd?: string };
    expect(asAny.cwd).toBeUndefined();
  });

  test("rejects a relative explicit cwd with an actionable message", () => {
    const r = resolveDetectionCwd({ explicitCwd: "./sub", env: {} });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain("absolute");
  });
});
