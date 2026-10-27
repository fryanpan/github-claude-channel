/**
 * Turn a GitHub /notifications entry into a channel message.
 *
 * Kept out of broker.ts so it can be tested without starting the daemon.
 * Returns null for reasons the channel does not forward.
 */

export interface GHNotif {
  id: string;
  reason: string;
  repository: { full_name: string };
  subject: { type: string; title: string; url: string | null };
}

/**
 * The subject url is an API url (api.github.com/repos/o/r/issues/5). Map it to
 * the page a person would open. Returns null when there is no url to map.
 */
export function htmlUrl(apiUrl: string | null): string | null {
  if (!apiUrl) return null;
  const m = apiUrl.match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/(issues|pulls)\/(\d+)$/);
  if (!m) return null;
  const kind = m[2] === "pulls" ? "pull" : "issues";
  return `https://github.com/${m[1]}/${kind}/${m[3]}`;
}

export function formatNotif(n: GHNotif): string | null {
  const repo = n.repository.full_name;
  const title = n.subject.title;
  switch (n.reason) {
    case "review_requested":
      return `👀 Review requested on \`${repo}\`: **${title}**`;
    case "comment":
    case "mention":
      return `💬 Mention on \`${repo}\`: **${title}**`;
    case "assign": {
      const url = htmlUrl(n.subject.url);
      return `📌 Assigned on \`${repo}\`: **${title}**${url ? `\n${url}` : ""}`;
    }
    case "subscribed":
      if (n.subject.type !== "Issue") return null;
      return `🆕 New issue on \`${repo}\`: **${title}**`;
    default:
      return null;
  }
}
