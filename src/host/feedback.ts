import { arch, release } from "node:os";
import {
  cleanDraft,
  FEEDBACK_ENDPOINT,
  type FeedbackDetails,
  type FeedbackDraft,
  type FeedbackSent,
} from "../shared/feedback";
import type { AgentProviderStatus } from "../shared/ipc";

export interface FeedbackContext {
  version: string;
  /** The engines as the host sees them. Their email is never read here. */
  providers: () => Promise<AgentProviderStatus[]>;
  language: () => Promise<string>;
  /** Injectable for tests; the real one is the global fetch. */
  fetcher?: typeof fetch;
  /** MARKAS_FEEDBACK_URL can point the host at a test endpoint. */
  endpoint?: string;
}

/** The details a report may carry, shown to the person in full before anything is sent. */
export async function feedbackDetails(context: FeedbackContext): Promise<FeedbackDetails> {
  const [providers, language] = await Promise.all([
    context.providers().catch(() => []),
    context.language().catch(() => "en"),
  ]);
  return {
    version: context.version,
    platform: process.platform,
    arch: arch(),
    osRelease: release(),
    language,
    engines: providers.map((provider) => ({
      id: provider.id,
      state: provider.state,
      version: provider.version ?? null,
    })),
  };
}

export function parseFeedbackDraft(input: unknown): FeedbackDraft {
  if (!input || typeof input !== "object") throw new Error("A report needs a title and a kind.");
  const raw = input as Record<string, unknown>;
  if (raw.kind !== "bug" && raw.kind !== "idea") throw new Error("A report is a bug or an idea.");
  if (typeof raw.title !== "string" || typeof raw.description !== "string") {
    throw new Error("A report needs a title and a description.");
  }
  const draft = cleanDraft({
    kind: raw.kind,
    title: raw.title,
    description: raw.description,
    details: raw.details === null || raw.details === undefined ? null : parseDetails(raw.details),
  });
  if (!draft.title) throw new Error("A report needs a title.");
  return draft;
}

function parseDetails(value: unknown): FeedbackDetails {
  const raw = (value ?? {}) as Record<string, unknown>;
  const text = (field: unknown) => (typeof field === "string" ? field.slice(0, 80) : "");
  const engines = Array.isArray(raw.engines) ? raw.engines.slice(0, 5) : [];
  return {
    version: text(raw.version),
    platform: text(raw.platform),
    arch: text(raw.arch),
    osRelease: text(raw.osRelease),
    language: text(raw.language),
    engines: engines.map((engine) => {
      const item = (engine ?? {}) as Record<string, unknown>;
      return {
        id: text(item.id),
        state: text(item.state),
        version: typeof item.version === "string" ? item.version.slice(0, 40) : null,
      };
    }),
  };
}

/**
 * Sends a report to the website, which opens the GitHub issue. Only the draft the person saw
 * leaves this computer, and only when they choose to send it.
 */
export async function sendFeedback(
  context: FeedbackContext,
  input: unknown,
): Promise<FeedbackSent> {
  const draft = parseFeedbackDraft(input);
  const fetcher = context.fetcher ?? fetch;
  const endpoint = context.endpoint ?? process.env.MARKAS_FEEDBACK_URL ?? FEEDBACK_ENDPOINT;
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-markas-version": context.version,
      },
      body: JSON.stringify(draft),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error(
      "The report could not be sent. Check the internet connection, or open it on GitHub.",
    );
  }
  const body = (await response.json().catch(() => ({}))) as {
    number?: unknown;
    url?: unknown;
    error?: unknown;
  };
  if (!response.ok) {
    const reason =
      typeof body.error === "string" ? body.error : `The website answered ${response.status}.`;
    throw new Error(`${reason} You can open it on GitHub instead.`);
  }
  if (typeof body.number !== "number" || typeof body.url !== "string" || !isIssueUrl(body.url)) {
    throw new Error(
      "The website did not say which issue it opened. You can open it on GitHub instead.",
    );
  }
  return { number: body.number, url: body.url };
}

export function createFeedbackMethods(context: FeedbackContext) {
  return {
    "feedback.details": () => feedbackDetails(context),
    "feedback.send": (input: unknown) => sendFeedback(context, input),
  };
}

const isIssueUrl = (url: string) =>
  /^https:\/\/github\.com\/avelixio\/markas\/issues\/\d+$/.test(url);
