import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { FeedbackDetails } from "../../../shared/feedback";
import { GITHUB_URL_LIMIT, githubIssueUrl } from "../../../shared/feedback";
import { t } from "../i18n";
import { type FeedbackClient, FeedbackDialog } from "./FeedbackDialog";

const details: FeedbackDetails = {
  version: "0.1.2",
  platform: "win32",
  arch: "x64",
  osRelease: "10.0.26200",
  language: "en",
  engines: [{ id: "claude", state: "available", version: "2.1.322" }],
};

function client(overrides: Partial<FeedbackClient> = {}): FeedbackClient {
  return {
    details: vi.fn(async () => details),
    send: vi.fn(async () => ({ number: 42, url: "https://github.com/avelixio/markas/issues/42" })),
    openUrl: vi.fn(async () => undefined),
    ...overrides,
  };
}

const fill = (title: string, description = "It skipped Monday.") => {
  fireEvent.input(screen.getByLabelText(t("feedback.field.title")), { target: { value: title } });
  fireEvent.input(screen.getByLabelText(t("feedback.field.description.bug")), {
    target: { value: description },
  });
};

describe("Send feedback", () => {
  it("shows every detail that would go with the report", async () => {
    render(() => <FeedbackDialog client={client()} onClose={() => undefined} />);
    expect(await screen.findByText("Claude Code 2.1.322")).toBeInTheDocument();
    expect(screen.getByText("Windows 10.0.26200, x64")).toBeInTheDocument();
    expect(screen.getByText(t("feedback.public.title"))).toBeInTheDocument();
  });

  it("sends directly and says which issue was opened", async () => {
    const api = client();
    render(() => <FeedbackDialog client={api} onClose={() => undefined} />);
    await screen.findByText("Claude Code 2.1.322");
    fill("Rounds skip a day");
    fireEvent.click(screen.getByRole("button", { name: t("feedback.send") }));
    expect(await screen.findByText(t("feedback.sent.title"))).toBeInTheDocument();
    expect(api.send).toHaveBeenCalledWith({
      kind: "bug",
      title: "Rounds skip a day",
      description: "It skipped Monday.",
      details,
    });
    fireEvent.click(screen.getByRole("button", { name: t("feedback.sent.see") }));
    expect(api.openUrl).toHaveBeenCalledWith("https://github.com/avelixio/markas/issues/42");
  });

  it("leaves the details out when the person unticks them", async () => {
    const api = client();
    render(() => <FeedbackDialog client={api} onClose={() => undefined} />);
    await screen.findByText("Claude Code 2.1.322");
    fill("An idea");
    fireEvent.click(screen.getByLabelText(t("feedback.details.include")));
    fireEvent.click(screen.getByRole("button", { name: t("feedback.send") }));
    await waitFor(() => expect(api.send).toHaveBeenCalled());
    expect(vi.mocked(api.send).mock.calls[0]?.[0].details).toBeNull();
  });

  it("opens a filled-in issue on GitHub for the person's own account", async () => {
    const api = client();
    render(() => <FeedbackDialog client={api} onClose={() => undefined} />);
    await screen.findByText("Claude Code 2.1.322");
    fill("Rounds skip a day");
    fireEvent.click(screen.getByRole("button", { name: t("feedback.github") }));
    await waitFor(() => expect(api.openUrl).toHaveBeenCalled());
    const url = new URL(String(vi.mocked(api.openUrl).mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("https://github.com/avelixio/markas/issues/new");
    expect(url.searchParams.get("title")).toBe("Rounds skip a day");
    expect(url.searchParams.get("body")).toContain("| Engines | Claude Code 2.1.322 |");
    expect(api.send).not.toHaveBeenCalled();
    expect(screen.getByText(t("feedback.opened"))).toBeInTheDocument();
  });

  it("asks for a title before anything leaves", async () => {
    const api = client();
    render(() => <FeedbackDialog client={api} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: t("feedback.send") }));
    expect(await screen.findByText(t("feedback.needsTitle"))).toBeInTheDocument();
    expect(api.send).not.toHaveBeenCalled();
  });

  it("keeps the report and says why when sending fails", async () => {
    const api = client({
      send: vi.fn(async () => {
        throw new Error("Sending directly is not set up yet. You can open it on GitHub instead.");
      }),
    });
    render(() => <FeedbackDialog client={api} onClose={() => undefined} />);
    fill("Rounds skip a day");
    fireEvent.click(screen.getByRole("button", { name: t("feedback.send") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not set up yet/);
    expect(screen.getByLabelText(t("feedback.field.title"))).toHaveValue("Rounds skip a day");
  });

  it("cuts a very long description to fit a GitHub address", () => {
    const url = githubIssueUrl({
      kind: "bug",
      title: "Long",
      description: "ä".repeat(4000),
      details: null,
    });
    expect(url.length).toBeLessThanOrEqual(GITHUB_URL_LIMIT);
    expect(new URL(url).searchParams.get("body")?.endsWith("…")).toBe(true);
  });
});
