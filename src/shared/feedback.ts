/**
 * A bug report or an idea, sent from Markas as a GitHub issue. Shared by the window, which opens
 * the issue on GitHub, and the host, which sends it directly through the website.
 * Only what the person wrote and the details they saw and kept are ever included.
 */

export const FEEDBACK_REPO = "avelixio/markas";
/** The website's endpoint that turns a report into an issue without a GitHub account. */
export const FEEDBACK_ENDPOINT = "https://markas-livid.vercel.app/api/feedback";

export type FeedbackKind = "bug" | "idea";

export const FEEDBACK_LIMITS = {
  title: 120,
  description: 4000,
} as const;

/** What Markas knows about this computer that helps with a report. Never accounts or content. */
export interface FeedbackDetails {
  version: string;
  platform: string;
  arch: string;
  osRelease: string;
  language: string;
  engines: { id: string; state: string; version: string | null }[];
}

export interface FeedbackDraft {
  kind: FeedbackKind;
  title: string;
  description: string;
  /** Null when the person chose not to add the details. */
  details: FeedbackDetails | null;
}

export interface FeedbackSent {
  number: number;
  url: string;
}

const ENGINE_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

const PLATFORM_NAMES: Record<string, string> = {
  win32: "Windows",
  darwin: "macOS",
  linux: "Linux",
};

/** One line per detail, the same in the dialog and in the issue. */
export function detailLines(details: FeedbackDetails): [string, string][] {
  const engines = details.engines
    .filter((engine) => engine.state !== "not-installed")
    .map((engine) => {
      const name = ENGINE_NAMES[engine.id] ?? engine.id;
      return engine.version ? `${name} ${engine.version}` : `${name} (${engine.state})`;
    });
  return [
    ["Markas", details.version],
    [
      "System",
      `${PLATFORM_NAMES[details.platform] ?? details.platform} ${details.osRelease}, ${details.arch}`.trim(),
    ],
    ["Language", details.language],
    ["Engines", engines.length > 0 ? engines.join(", ") : "none found"],
  ];
}

/** Cleans what the person typed: no control characters, no padding, within the limits. */
export function cleanDraft(draft: FeedbackDraft): FeedbackDraft {
  const strip = (text: string, limit: number, keepLines: boolean) =>
    Array.from(
      text
        .replace(keepLines ? /\r\n?/g : /\s+/g, keepLines ? "\n" : " ")
        // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is removed
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
        .trim(),
    )
      .slice(0, limit)
      .join("");
  return {
    kind: draft.kind === "idea" ? "idea" : "bug",
    title: strip(draft.title, FEEDBACK_LIMITS.title, false),
    description: strip(draft.description, FEEDBACK_LIMITS.description, true),
    details: draft.details,
  };
}

/** The issue's body, in the same shape whichever way it is sent. */
export function issueBody(draft: FeedbackDraft): string {
  const parts = [draft.description || "_No description._"];
  if (draft.details) {
    parts.push(
      "",
      "<details><summary>About this computer</summary>",
      "",
      "| | |",
      "|---|---|",
      ...detailLines(draft.details).map(([label, value]) => `| ${label} | ${escapeCell(value)} |`),
      "",
      "</details>",
    );
  }
  return parts.join("\n");
}

const escapeCell = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The address of a new issue on GitHub, filled in, for the person to check and submit. */
export function githubIssueUrl(draft: FeedbackDraft): string {
  const clean = cleanDraft(draft);
  const build = (description: string) => {
    const url = new URL(`https://github.com/${FEEDBACK_REPO}/issues/new`);
    url.searchParams.set("title", clean.title);
    url.searchParams.set("body", issueBody({ ...clean, description }));
    url.searchParams.set("labels", clean.kind === "bug" ? "bug" : "enhancement");
    return url.toString();
  };
  // Browsers and GitHub refuse very long addresses; a long description is cut, and the person
  // sees the cut on GitHub before submitting, where they can paste the rest.
  let description = clean.description;
  let url = build(description);
  while (url.length > GITHUB_URL_LIMIT && description.length > 0) {
    description = `${Array.from(description)
      .slice(0, Math.floor(description.length * 0.8))
      .join("")}…`;
    url = build(description);
  }
  return url;
}

/** The longest new-issue address that GitHub reliably accepts. */
export const GITHUB_URL_LIMIT = 7000;
