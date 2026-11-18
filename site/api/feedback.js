// POST /api/feedback: a bug report or an idea sent from Markas without a GitHub account.
// It becomes a public issue on avelixio/markas, labelled from-app, opened with the token in
// GITHUB_FEEDBACK_TOKEN (a fine-grained token with Issues read and write on this repository).
// The issue is built here from checked fields; nothing the app sends is passed on unread.
import { json } from "./_lib/session.js";

const REPO = "avelixio/markas";
const MAX_BODY_BYTES = 16 * 1024;
/** Across everybody: past this many reports an hour, sending directly waits. */
export const HOURLY_LIMIT = 30;
const LIMITS = { title: 120, description: 4000, field: 80, engines: 5 };
const ENGINE_NAMES = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" };
const PLATFORM_NAMES = { win32: "Windows", darwin: "macOS", linux: "Linux" };

const clean = (text, limit, keepLines = false) =>
  Array.from(
    String(text ?? "")
      .replace(keepLines ? /\r\n?/g : /\s+/g, keepLines ? "\n" : " ")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is removed
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      .trim(),
  )
    .slice(0, limit)
    .join("");

/** "@name" would notify that GitHub user; a report must never ping anybody. */
const quiet = (text) => text.replace(/@(?=[A-Za-z0-9_-])/g, "@​");
const cell = (text) => quiet(text).replace(/\|/g, "\\|");

/** Checks a report and returns it cleaned, or a sentence saying what is wrong. */
export function parseReport(value) {
  if (!value || typeof value !== "object") return { error: "Send the report as JSON." };
  if (value.kind !== "bug" && value.kind !== "idea")
    return { error: "A report is a bug or an idea." };
  if (typeof value.title !== "string" || typeof value.description !== "string") {
    return { error: "A report needs a title and a description." };
  }
  const title = clean(value.title, LIMITS.title);
  if (!title) return { error: "A report needs a title." };
  let details = null;
  if (value.details !== null && value.details !== undefined) {
    const raw = value.details;
    if (typeof raw !== "object") return { error: "The details are not readable." };
    const field = (text) => clean(typeof text === "string" ? text : "", LIMITS.field);
    details = {
      version: field(raw.version),
      platform: field(raw.platform),
      arch: field(raw.arch),
      osRelease: field(raw.osRelease),
      language: field(raw.language),
      engines: (Array.isArray(raw.engines) ? raw.engines : [])
        .slice(0, LIMITS.engines)
        .map((engine) => ({
          id: field(engine?.id),
          state: field(engine?.state),
          version: typeof engine?.version === "string" ? field(engine.version) : null,
        })),
    };
  }
  return {
    report: {
      kind: value.kind,
      title,
      description: clean(value.description, LIMITS.description, true),
      details,
    },
  };
}

/** The issue as it appears on GitHub. */
export function issueFor(report, appVersion) {
  const lines = [quiet(report.description) || "_No description._"];
  if (report.details) {
    const engines = report.details.engines
      .filter((engine) => engine.state !== "not-installed")
      .map((engine) => {
        const name = ENGINE_NAMES[engine.id] ?? engine.id;
        return engine.version ? `${name} ${engine.version}` : `${name} (${engine.state})`;
      });
    const system = `${PLATFORM_NAMES[report.details.platform] ?? report.details.platform} ${report.details.osRelease}, ${report.details.arch}`;
    lines.push(
      "",
      "<details><summary>About this computer</summary>",
      "",
      "| | |",
      "|---|---|",
      `| Markas | ${cell(report.details.version)} |`,
      `| System | ${cell(system.trim())} |`,
      `| Language | ${cell(report.details.language)} |`,
      `| Engines | ${cell(engines.length > 0 ? engines.join(", ") : "none found")} |`,
      "",
      "</details>",
    );
  }
  lines.push("", `_Sent from Markas ${appVersion} without a GitHub account._`);
  return {
    title: quiet(report.title),
    body: lines.join("\n"),
    labels: ["from-app", report.kind === "bug" ? "bug" : "enhancement"],
  };
}

async function recentReports(fetcher, token, now) {
  const since = new Date(now.getTime() - 3_600_000).toISOString().slice(0, 19);
  const query = encodeURIComponent(`repo:${REPO} is:issue label:from-app created:>${since}`);
  const response = await fetcher(`https://api.github.com/search/issues?q=${query}&per_page=1`, {
    headers: github(token),
  });
  if (!response.ok) return 0;
  const body = await response.json().catch(() => ({}));
  return Number(body.total_count) || 0;
}

const github = (token) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "user-agent": "markas-site",
  "x-github-api-version": "2022-11-28",
});

export async function POST(request, { env = process.env, fetcher = fetch, now = new Date() } = {}) {
  const appVersion = request.headers.get("x-markas-version") ?? "";
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(appVersion)) {
    return json({ error: "Reports are sent from the Markas app." }, 400);
  }
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return json({ error: "Send the report as JSON." }, 415);
  }
  const token = env.GITHUB_FEEDBACK_TOKEN;
  if (!token) return json({ error: "Sending directly is not set up yet." }, 503);

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return json({ error: "The report is too long." }, 413);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return json({ error: "Send the report as JSON." }, 400);
  }
  const { report, error } = parseReport(value);
  if (error) return json({ error }, 400);

  if ((await recentReports(fetcher, token, now)) >= HOURLY_LIMIT) {
    return json({ error: "Many reports arrived this hour. Try again later." }, 429);
  }
  const response = await fetcher(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: { ...github(token), "content-type": "application/json" },
    body: JSON.stringify(issueFor(report, appVersion)),
  });
  if (!response.ok) return json({ error: "GitHub did not take the report." }, 502);
  const issue = await response.json();
  return json({ number: issue.number, url: issue.html_url }, 201);
}
