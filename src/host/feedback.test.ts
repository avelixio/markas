// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { feedbackDetails, parseFeedbackDraft, sendFeedback } from "./feedback";

const context = (fetcher?: typeof fetch) => ({
  version: "0.1.2",
  providers: async () => [
    {
      id: "claude" as const,
      state: "available" as const,
      version: "2.1.322",
      message: null,
      email: "sam@example.com",
    },
    { id: "codex" as const, state: "not-installed" as const, version: null, message: null },
  ],
  language: async () => "id",
  fetcher,
  endpoint: "https://site.example.com/api/feedback",
});

const draft = {
  kind: "bug",
  title: "Rounds skip a day",
  description: "It skipped Monday.",
  details: null,
};

describe("feedback from the host", () => {
  it("offers details about this computer and never an account", async () => {
    const details = await feedbackDetails(context());
    expect(details.version).toBe("0.1.2");
    expect(details.language).toBe("id");
    expect(details.engines).toEqual([
      { id: "claude", state: "available", version: "2.1.322" },
      { id: "codex", state: "not-installed", version: null },
    ]);
    expect(JSON.stringify(details)).not.toContain("sam@example.com");
  });

  it("refuses a report without a title or of an unknown kind", () => {
    expect(() => parseFeedbackDraft({ ...draft, title: "  " })).toThrow(/title/);
    expect(() => parseFeedbackDraft({ ...draft, kind: "rant" })).toThrow();
    expect(() => parseFeedbackDraft(null)).toThrow();
  });

  it("sends only the draft, with the app's version, and returns the issue", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        { number: 7, url: "https://github.com/avelixio/markas/issues/7" },
        { status: 201 },
      ),
    ) as unknown as typeof fetch;
    const sent = await sendFeedback(context(fetcher), { ...draft, secret: "dropped" });
    expect(sent).toEqual({ number: 7, url: "https://github.com/avelixio/markas/issues/7" });
    const [url, options] = vi.mocked(fetcher).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://site.example.com/api/feedback");
    expect((options.headers as Record<string, string>)["x-markas-version"]).toBe("0.1.2");
    expect(JSON.parse(String(options.body))).toEqual(draft);
  });

  it("says what went wrong and points to GitHub when sending fails", async () => {
    const refused = (async () =>
      Response.json(
        { error: "Sending directly is not set up yet." },
        { status: 503 },
      )) as unknown as typeof fetch;
    await expect(sendFeedback(context(refused), draft)).rejects.toThrow(
      "Sending directly is not set up yet. You can open it on GitHub instead.",
    );
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(sendFeedback(context(offline), draft)).rejects.toThrow(/internet connection/);
    const odd = (async () =>
      Response.json({ number: 1, url: "https://evil.example.com/1" })) as unknown as typeof fetch;
    await expect(sendFeedback(context(odd), draft)).rejects.toThrow(/did not say which issue/);
  });
});
