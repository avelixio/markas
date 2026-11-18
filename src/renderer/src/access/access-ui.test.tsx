import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPromptQuestion } from "../../../shared/ipc";
import { PromptCard } from "../components/ConversationPrompts";
import { setLanguage } from "../i18n";
import { AccessChip, AccessControl } from "./AccessControl";

afterEach(() => setLanguage("en"));

const question = (overrides: Partial<AgentPromptQuestion>): AgentPromptQuestion => ({
  id: "permission",
  header: "Permission",
  question: "Atlas wants to run a command on this computer:\ngit status",
  isSecret: false,
  options: [
    { label: "Allow once", description: "" },
    { label: "Don't allow", description: "" },
  ],
  permission: { kind: "command", detail: "git status" },
  ...overrides,
});

describe("AccessControl", () => {
  it("shows the three levels and marks the current one", () => {
    render(() => <AccessControl level="ask" botName="Atlas" onChange={() => undefined} />);
    expect(screen.getByRole("radio", { name: /Ask first/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Read freely/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Full access/ })).not.toBeChecked();
  });

  it("changes to a careful level in one click", () => {
    const onChange = vi.fn();
    render(() => <AccessControl level="ask" botName="Atlas" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /Read freely/ }));
    expect(onChange).toHaveBeenCalledWith("read");
  });

  it("does not give full access until it is confirmed", () => {
    const onChange = vi.fn();
    render(() => <AccessControl level="ask" botName="Atlas" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /Full access/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Give Atlas full access?");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: /Full access/ }));
    fireEvent.click(screen.getByRole("button", { name: "Give full access" }));
    expect(onChange).toHaveBeenCalledWith("full");
  });

  it("labels the level in the chat header, in the chosen language", () => {
    const onClick = vi.fn();
    render(() => <AccessChip level="full" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Full access" }));
    expect(onClick).toHaveBeenCalled();
    setLanguage("id");
    expect(screen.getByRole("button", { name: "Akses penuh" })).toBeInTheDocument();
  });
});

describe("PermissionCard", () => {
  it("shows exactly what the bot wants and sends the person's yes", async () => {
    const onSubmit = vi.fn(async () => true);
    render(() => <PromptCard questions={[question({})]} botName="Atlas" onSubmit={onSubmit} />);
    const card = screen.getByRole("region", { name: "Permission request" });
    expect(card).toHaveTextContent("Atlas wants to run a command on this computer");
    expect(card).toHaveTextContent("git status");
    // A command is never offered for a whole chat.
    expect(
      screen.queryByRole("button", { name: "Allow for this session" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(onSubmit).toHaveBeenCalledWith({ permission: ["Allow once"] });
  });

  it("sends a no, and offers the chat-long yes only when the host does", () => {
    const onSubmit = vi.fn(async () => true);
    render(() => (
      <PromptCard
        questions={[
          question({
            options: [
              { label: "Allow once", description: "" },
              { label: "Allow for this chat", description: "" },
              { label: "Don't allow", description: "" },
            ],
            permission: { kind: "read", detail: "/projects/notes.md" },
          }),
        ]}
        botName="Atlas"
        onSubmit={onSubmit}
      />
    ));
    expect(screen.getByRole("button", { name: "Allow for this session" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Don't allow" }));
    expect(onSubmit).toHaveBeenCalledWith({ permission: ["Don't allow"] });
  });

  it("says a yes for the session covers one website, or one key, when that is what it covers", () => {
    const options = [
      { label: "Allow once", description: "" },
      { label: "Allow for this chat", description: "" },
      { label: "Don't allow", description: "" },
    ];
    const { unmount } = render(() => (
      <PromptCard
        questions={[
          question({
            options,
            permission: { kind: "network", detail: "https://example.com/", covers: "site" },
          }),
        ]}
        botName="Atlas"
        onSubmit={async () => true}
      />
    ));
    expect(screen.getByText(/this website only/)).toBeInTheDocument();
    expect(screen.queryByText(/this tool/)).not.toBeInTheDocument();
    unmount();

    render(() => (
      <PromptCard
        questions={[
          question({
            options,
            permission: { kind: "tool", detail: 'Sign in with the key "notes"', covers: "key" },
          }),
        ]}
        botName="Atlas"
        onSubmit={async () => true}
      />
    ));
    expect(screen.getByText(/this key, on its own website only/)).toBeInTheDocument();
  });

  it("warns when the bot asks for Markas's own data, and answers in the host's words in any language", () => {
    setLanguage("id");
    const onSubmit = vi.fn(async () => true);
    render(() => (
      <PromptCard
        questions={[question({ permission: { kind: "protected", detail: "/data/token" } })]}
        botName="Atlas"
        onSubmit={onSubmit}
      />
    ));
    expect(screen.getByText(/token masuk dan kunci Anda disimpan/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Izinkan sekali" }));
    expect(onSubmit).toHaveBeenCalledWith({ permission: ["Allow once"] });
  });

  it("still shows ordinary questions as before", () => {
    render(() => (
      <PromptCard
        questions={[
          { id: "q", header: "Question", question: "Which one?", isSecret: false, options: null },
        ]}
        onSubmit={async () => true}
      />
    ));
    expect(screen.getByRole("region", { name: "Bot question" })).toHaveTextContent("Which one?");
  });
});
