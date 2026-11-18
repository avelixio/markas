// @vitest-environment node
// Sending a report without a GitHub account: only checked fields reach GitHub, nobody is
// pinged, and the endpoint holds back when it is flooded or not set up.
import { describe, expect, it } from "vitest";
import { HOURLY_LIMIT, issueFor, POST, parseReport } from "./feedback.js";

const env = { GITHUB_FEEDBACK_TOKEN: "test-token" };
const report = {
  kind: "bug",
  title: "Rounds skip a day",
  description: "It skipped Monday.\r\nThanks @someone",
  details: {
    version: "0.1.2",
    platform: "win32",
    arch: "x64",
    osRelease: "10.0.26200",
    language: "en",
    engines: [
      { id: "claude", state: "available", version: "2.1.322", email: "sam@example.com" },
      { id: "codex", state: "not-installed", version: null },
    ],
  },
};

const request = (body, headers = {}) =>
  new Request("https://site.example.com/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-markas-version": "0.1.2", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

function fakeGitHub({ recent = 0 } = {}) {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/search/issues")) return Response.json({ total_count: recent });
    return Response.json(
      { number: 42, html_url: "https://github.com/avelixio/markas/issues/42" },
      { status: 201 },
    );
  };
  return { calls, fetcher };
}

describe("a report", () => {
  it("keeps only the fields it knows, cleaned and within limits", () => {
    const { report: parsed } = parseReport({
      ...report,
      title: `  ${"x".repeat(200)}  `,
      extra: "dropped",
    });
    expect(parsed.title).toHaveLength(120);
    expect(parsed).not.toHaveProperty("extra");
    expect(parsed.details.engines[0]).not.toHaveProperty("email");
    expect(parseReport({ ...report, kind: "rant" }).error).toBeTruthy();
    expect(parseReport({ ...report, title: "   " }).error).toBeTruthy();
  });

  it("never notifies a GitHub user, and shows the details as a table", () => {
    const { report: parsed } = parseReport(report);
    const issue = issueFor(parsed, "0.1.2");
    expect(issue.body).toContain("@​someone");
    expect(issue.body).toContain("| Engines | Claude Code 2.1.322 |");
    expect(issue.body).not.toContain("sam@example.com");
    expect(issue.labels).toEqual(["from-app", "bug"]);
  });
});

describe("POST /api/feedback", () => {
  it("opens an issue and says which", async () => {
    const github = fakeGitHub();
    const response = await POST(request(report), { env, fetcher: github.fetcher });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      number: 42,
      url: "https://github.com/avelixio/markas/issues/42",
    });
    const created = github.calls.find((call) => call.url.endsWith("/repos/avelixio/markas/issues"));
    const sent = JSON.parse(created.options.body);
    expect(sent.title).toBe("Rounds skip a day");
    expect(sent.body).toContain("Sent from Markas 0.1.2 without a GitHub account.");
  });

  it("refuses what does not come from the app, and what is not a report", async () => {
    const github = fakeGitHub();
    expect(
      (await POST(request(report, { "x-markas-version": "" }), { env, fetcher: github.fetcher }))
        .status,
    ).toBe(400);
    expect((await POST(request("not json"), { env, fetcher: github.fetcher })).status).toBe(400);
    expect(
      (await POST(request({ ...report, kind: "x" }), { env, fetcher: github.fetcher })).status,
    ).toBe(400);
    expect(
      (
        await POST(request({ ...report, description: "y".repeat(20000) }), {
          env,
          fetcher: github.fetcher,
        })
      ).status,
    ).toBe(413);
    expect(github.calls).toHaveLength(0);
  });

  it("waits when the hour is full, and says when it is not set up", async () => {
    const flooded = fakeGitHub({ recent: HOURLY_LIMIT });
    expect((await POST(request(report), { env, fetcher: flooded.fetcher })).status).toBe(429);
    expect(flooded.calls.some((call) => call.url.endsWith("/issues"))).toBe(false);
    expect((await POST(request(report), { env: {}, fetcher: fakeGitHub().fetcher })).status).toBe(
      503,
    );
  });
});
