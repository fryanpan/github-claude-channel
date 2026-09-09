/**
 * Work out which directory `watch_repo("auto")` should detect a repo from.
 *
 * Why this file exists. The server used to do
 *
 *     const cwd = args.cwd ?? process.cwd();
 *
 * and process.cwd() is never the caller's directory. The launcher does
 * `cd "$(dirname "$entrypoint")"` before exec'ing bun so that module and .env
 * resolution are stable, which leaves the server's cwd pinned to the plugin's
 * own install directory -- the same one for every session on the machine, and
 * the checkout of this very repo.
 *
 * So "auto" resolved to fryanpan/github-claude-channel for every caller,
 * regardless of where it was called from. The tool then answered
 * "Already watching ..." (because startup had added that same repo) and the
 * session's watch list looked populated. Both the write and the read were
 * success-shaped over a subscription to a repo the caller had never asked for,
 * which is why sixteen days of silence went unnoticed: the surface you would
 * check to find the problem was the surface telling the lie.
 *
 * The replacement refuses to guess. A caller-supplied cwd wins; otherwise the
 * cwd the launcher captured before it cd'd away; and if neither is available we
 * return null so the tool can say so. Falling back to process.cwd() is exactly
 * the bug, so there is deliberately no fallback.
 */

/** Env var the launcher sets to the cwd it was spawned with. */
export const SESSION_CWD_ENV = "GITHUB_CHANNEL_SESSION_CWD";

export type CwdSource = "explicit" | "launcher";

export type CwdResolution =
  | { ok: true; cwd: string; source: CwdSource }
  | { ok: false; error: string };

/**
 * The cwd the calling session was in, or null when the launcher did not pass
 * one (an older plugin version, or the server started by hand).
 */
export function sessionCwd(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = (env[SESSION_CWD_ENV] ?? "").trim();
  // Must be absolute: a relative value would be resolved against the plugin
  // directory, quietly reintroducing the bug this module exists to remove.
  if (!raw || !raw.startsWith("/")) return null;
  return raw;
}

export function resolveDetectionCwd(opts: {
  explicitCwd?: string | undefined;
  env?: Record<string, string | undefined>;
}): CwdResolution {
  const explicit = (opts.explicitCwd ?? "").trim();
  if (explicit) {
    if (!explicit.startsWith("/")) {
      return {
        ok: false,
        error:
          `cwd must be an absolute path (got ${JSON.stringify(explicit)}). ` +
          `A relative path would be resolved against this plugin's install directory, not yours.`,
      };
    }
    return { ok: true, cwd: explicit, source: "explicit" };
  }

  const fromLauncher = sessionCwd(opts.env ?? process.env);
  if (fromLauncher) return { ok: true, cwd: fromLauncher, source: "launcher" };

  return {
    ok: false,
    error:
      `Cannot tell which directory this session is in: ${SESSION_CWD_ENV} is not set. ` +
      `This plugin's MCP server runs from its own install directory, so its cwd is not yours. ` +
      `Update the plugin (the launcher passes it from 1.3.0 on) and restart the session, ` +
      `or call watch_repo with an explicit repo ("owner/repo") or cwd.`,
  };
}
