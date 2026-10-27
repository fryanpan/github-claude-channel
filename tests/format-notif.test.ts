import { describe, expect, test } from "bun:test";
import { NEW_ISSUE_WINDOW_MS, formatNotif, htmlUrl, isNewIssue, type GHNotif } from "../shared/format-notif.ts";

function notif(reason: string, type: string, url: string | null): GHNotif {
  return {
    id: "1",
    reason,
    repository: { full_name: "o/r" },
    subject: { type, title: "Fix the thing", url },
  };
}

describe("formatNotif", () => {
  test("forwards an issue assignment with its page url", () => {
    const msg = formatNotif(notif("assign", "Issue", "https://api.github.com/repos/o/r/issues/5"));
    expect(msg).toBe("📌 Assigned on `o/r`: **Fix the thing**\nhttps://github.com/o/r/issues/5");
  });

  test("forwards a PR assignment with its page url", () => {
    const msg = formatNotif(notif("assign", "PullRequest", "https://api.github.com/repos/o/r/pulls/7"));
    expect(msg).toBe("📌 Assigned on `o/r`: **Fix the thing**\nhttps://github.com/o/r/pull/7");
  });

  test("forwards an assignment without a url line when the subject has none", () => {
    expect(formatNotif(notif("assign", "Issue", null))).toBe("📌 Assigned on `o/r`: **Fix the thing**");
  });

  test("forwards a new issue on a watched repo", () => {
    const msg = formatNotif(notif("subscribed", "Issue", "https://api.github.com/repos/o/r/issues/5"));
    expect(msg).toBe("🆕 New issue on `o/r`: **Fix the thing**\nhttps://github.com/o/r/issues/5");
  });

  test("drops subscribed activity that is not an issue", () => {
    expect(formatNotif(notif("subscribed", "PullRequest", null))).toBeNull();
    expect(formatNotif(notif("subscribed", "Release", null))).toBeNull();
  });

  test("keeps the existing reasons and drops unknown ones", () => {
    expect(formatNotif(notif("review_requested", "PullRequest", null))).toBe("👀 Review requested on `o/r`: **Fix the thing**");
    expect(formatNotif(notif("mention", "Issue", null))).toBe("💬 Mention on `o/r`: **Fix the thing**");
    expect(formatNotif(notif("author", "Issue", null))).toBeNull();
  });
});

describe("htmlUrl", () => {
  test("returns null for a url it does not recognise", () => {
    expect(htmlUrl("https://api.github.com/repos/o/r/releases/1")).toBeNull();
  });
});

describe("isNewIssue", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");

  test("is true for an issue created inside the window", () => {
    expect(isNewIssue("2026-01-01T11:59:00Z", now)).toBe(true);
  });

  test("is false for activity on an old issue", () => {
    expect(isNewIssue(new Date(now - NEW_ISSUE_WINDOW_MS - 1000).toISOString(), now)).toBe(false);
    expect(isNewIssue("2024-03-01T00:00:00Z", now)).toBe(false);
  });

  test("is false for a timestamp it cannot parse", () => {
    expect(isNewIssue("", now)).toBe(false);
  });
});
