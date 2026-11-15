import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage } from "../i18n";
import { enBots } from "../i18n/en.bots";
import { idBots } from "../i18n/id.bots";
import { BotSteps, MAX_BOT_FILE_BYTES } from "./BotSteps";
import type {
  BotDraft,
  BotsClient,
  CreateResult,
  DispatchMessage,
  DispatchTurn,
  ImportResult,
  ReadyBot,
} from "./bots-client";

const SCOUT: BotDraft = {
  name: "Scout",
  role: "Watches public status pages and reports incidents",
  instructions: "Each morning open the status pages and report incidents.",
  sigil: { pattern: 1, color: "coral" },
  engine: "claude",
  model: "claude-sonnet-5",
  access: "ask",
  folder: "",
  round: { label: "Every day at 08:30", schedule: "30 8 * * *", enabled: true },
  tags: ["Browser"],
};

const READY: ReadyBot[] = [
  {
    id: "scout",
    name: "Scout",
    summary: "Watches status pages and reports incidents",
    author: "Markas community",
    category: "Daily",
    tags: ["Browser", "Daily round"],
    sigil: { pattern: 1, color: "coral" },
  },
  {
    id: "quill",
    name: "Quill",
    summary: "Writes and edits documents in your voice",
    author: "Markas community",
    category: "Writing",
    tags: ["Files"],
    sigil: { pattern: 0, color: "sky" },
  },
];

const dispatchSays = (text: string, extra: Partial<DispatchMessage> = {}): DispatchMessage => ({
  id: `d-${text.length}-${Math.random()}`,
  from: "dispatch",
  text,
  ...extra,
});

interface Fake extends BotsClient {
  said: string[];
  replies: DispatchTurn[];
  ready: ReadyBot[] | Error;
  imports: ImportResult[];
  creates: CreateResult[];
  created: Array<{ draft: BotDraft; options: unknown }>;
}

function fakeClient(overrides: Partial<Fake> = {}): Fake {
  const history: DispatchMessage[] = [];
  const next = (fallback: DispatchTurn): DispatchTurn => {
    const turn = fake.replies.shift() ?? fallback;
    if (turn.ok) history.push(...turn.messages);
    return turn.ok ? { ok: true, messages: [...history] } : { ...turn, messages: [...history] };
  };
  const fake: Fake = {
    said: [],
    replies: [],
    ready: READY,
    imports: [],
    creates: [],
    created: [],
    listReady: vi.fn(async () => {
      if (fake.ready instanceof Error) throw fake.ready;
      return fake.ready;
    }),
    readReady: vi.fn(async () => SCOUT),
    importFile: vi.fn(
      async (): Promise<ImportResult> => fake.imports.shift() ?? { ok: true, draft: SCOUT },
    ),
    openDispatch: vi.fn(async () => next({ ok: true, messages: [] })),
    sayToDispatch: vi.fn(async (text: string) => {
      fake.said.push(text);
      history.push({ id: `y-${fake.said.length}`, from: "you", text });
      return next({ ok: true, messages: [dispatchSays("Tell me more.")] });
    }),
    redraft: vi.fn(async () =>
      next({ ok: true, messages: [dispatchSays("Here is a draft.", { draft: SCOUT })] }),
    ),
    moveDispatch: vi.fn(async () => next({ ok: true, messages: [] })),
    repairFile: vi.fn(
      async (): Promise<ImportResult> => fake.imports.shift() ?? { ok: true, draft: SCOUT },
    ),
    create: vi.fn(async (draft: BotDraft, options?: unknown): Promise<CreateResult> => {
      fake.created.push({ draft: structuredClone(draft), options });
      return fake.creates.shift() ?? { ok: true, botId: "bot-scout", testRun: { state: "passed" } };
    }),
    runTest: vi.fn(async () => ({ state: "passed" as const })),
    ...overrides,
  };
  return fake;
}

function open(client: Fake) {
  const onDone = vi.fn();
  const onSkip = vi.fn();
  render(() => <BotSteps client={client} onDone={onDone} onSkip={onSkip} onBack={() => {}} />);
  return { onDone, onSkip };
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

async function say(text: string) {
  const box = screen.getByRole("textbox");
  await fireEvent.input(box, { target: { value: text } });
  await fireEvent.keyDown(box, { key: "Enter" });
}

async function chooseFile(name: string, content: string | { size: number }) {
  const input = screen.getByLabelText("Import a bot file", { selector: "input" });
  const file =
    typeof content === "string"
      ? new File([content], name, { type: "text/markdown" })
      : Object.defineProperty(new File(["x"], name), "size", { value: content.size });
  if (typeof content === "string") {
    Object.defineProperty(file, "text", { value: async () => content });
  }
  await fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  setLanguage("en");
});

describe("bot text", () => {
  it("has the same keys in both languages, none empty, and none of the banned words", () => {
    expect(Object.keys(idBots).sort()).toEqual(Object.keys(enBots).sort());
    const all = [...Object.values(enBots), ...Object.values(idBots)];
    for (const value of all) expect(value.trim()).not.toBe("");
    const joined = all.join("\n");
    expect(joined).not.toMatch(/\bagents?\b/i);
    expect(joined).not.toMatch(/opencode|local model/i);
    expect(joined).not.toContain("—");
  });
});

describe("meeting Dispatch", () => {
  it("greets in the middle of the screen with three ways to start", async () => {
    open(fakeClient());

    expect(await screen.findByRole("heading", { name: "Dispatch" })).toBeInTheDocument();
    expect(screen.getByText(enBots["dispatch.hello"])).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tell me what you need/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pick a ready-made bot/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import a bot file/ })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "5");
  });

  it("can be skipped", async () => {
    const { onSkip } = open(fakeClient());
    await click("Skip for now");
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("greets in Bahasa Indonesia", async () => {
    setLanguage("id");
    open(fakeClient());
    expect(await screen.findByText(idBots["dispatch.hello"])).toBeInTheDocument();
  });
});

describe("describing a bot to Dispatch", () => {
  it("shows what was said, offers short answers, and proposes a draft to review", async () => {
    const client = fakeClient();
    client.replies = [
      { ok: true, messages: [] },
      {
        ok: true,
        messages: [
          dispatchSays("Which pages?", { quickReplies: ["Paste links", "Name the tools"] }),
        ],
      },
      { ok: true, messages: [dispatchSays("Here is a draft.", { draft: SCOUT })] },
    ];
    open(client);
    await screen.findByText(enBots["dispatch.hello"]);

    await say("Check the status pages every morning");
    expect(await screen.findByText("Check the status pages every morning")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "6");

    await fireEvent.click(await screen.findByRole("button", { name: "Name the tools" }));
    expect(client.said).toEqual(["Check the status pages every morning", "Name the tools"]);

    expect(await screen.findByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Every day at 08:30")).toBeInTheDocument();
    await click("Review and create");

    expect(await screen.findByRole("heading", { name: "Scout" })).toBeInTheDocument();
    expect(screen.getByText(enBots["review.from.dispatch"])).toBeInTheDocument();
  });

  it("offers the other engine, a ready-made bot or a form when Dispatch hits its limit", async () => {
    const client = fakeClient();
    client.replies = [
      { ok: false, reason: "limit", message: "limit", otherEngine: "codex", messages: [] },
    ];
    open(client);

    expect(
      await screen.findByText("Dispatch could not start: Claude Code hit its usage limit"),
    ).toBeInTheDocument();
    await click("Use Codex for Dispatch");
    expect(client.moveDispatch).toHaveBeenCalledWith("codex");
    await waitFor(() =>
      expect(screen.queryByText(/Dispatch could not start/)).not.toBeInTheDocument(),
    );
  });

  it("goes to an empty form when Dispatch cannot run at all", async () => {
    const client = fakeClient();
    client.replies = [
      {
        ok: false,
        reason: "unavailable",
        message: "No engine is signed in.",
        otherEngine: null,
        messages: [],
      },
    ];
    open(client);

    expect(await screen.findByText("Dispatch could not start")).toBeInTheDocument();
    expect(screen.getByText(/No engine is signed in\./)).toBeInTheDocument();
    await click("Fill in a form");

    expect(await screen.findByText(enBots["review.from.form"])).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("keeps the messages and offers to draft again when a turn fails", async () => {
    const client = fakeClient();
    client.replies = [
      { ok: true, messages: [] },
      { ok: false, reason: "failed", message: "boom", otherEngine: null, messages: [] },
    ];
    open(client);
    await screen.findByText(enBots["dispatch.hello"]);

    await say("Summarise my inbox");

    expect(await screen.findByText(enBots["dispatch.failed.title"])).toBeInTheDocument();
    expect(screen.getByText("Summarise my inbox")).toBeInTheDocument();
    await click("Draft again");
    expect(await screen.findByText("Draft")).toBeInTheDocument();
  });
});

describe("ready-made bots", () => {
  async function openReady(client: Fake) {
    const result = open(client);
    await screen.findByText(enBots["dispatch.hello"]);
    await click(/Pick a ready-made bot/);
    return result;
  }

  it("lists them, filters by search and category, and opens one for review", async () => {
    const client = fakeClient();
    await openReady(client);

    expect(await screen.findByText("Quill")).toBeInTheDocument();
    await fireEvent.input(screen.getByRole("searchbox"), { target: { value: "status" } });
    expect(screen.queryByText("Quill")).not.toBeInTheDocument();
    await fireEvent.input(screen.getByRole("searchbox"), { target: { value: "" } });
    await click("Writing");
    expect(
      screen.queryByText("Watches status pages and reports incidents"),
    ).not.toBeInTheDocument();
    await click("All");

    await click("Add Scout");
    expect(await screen.findByText(enBots["review.from.ready"])).toBeInTheDocument();
    expect(client.readReady).toHaveBeenCalledWith("scout");
  });

  it("offers retry and import when the list cannot be loaded", async () => {
    const client = fakeClient({ ready: new Error("offline") });
    await openReady(client);

    expect(await screen.findByText(enBots["ready.failed.title"])).toBeInTheDocument();
    client.ready = READY;
    await click("Retry");
    expect(await screen.findByText("Quill")).toBeInTheDocument();
  });

  it("goes back to Dispatch", async () => {
    await openReady(fakeClient());
    await click("Back to Dispatch");
    expect(await screen.findByText(enBots["dispatch.hello"])).toBeInTheDocument();
  });
});

describe("importing a bot file", () => {
  it("opens a good file for review", async () => {
    const client = fakeClient();
    open(client);
    await screen.findByText(enBots["dispatch.hello"]);

    await chooseFile("scout.bot.md", "---\nname: Scout\n---\nDo things.");

    expect(await screen.findByText(enBots["review.from.file"])).toBeInTheDocument();
    expect(client.importFile).toHaveBeenCalledWith(
      "scout.bot.md",
      expect.stringContaining("Scout"),
    );
  });

  it("names the line of a bad file and lets Dispatch repair it", async () => {
    const client = fakeClient();
    client.imports = [{ ok: false, message: "the bot has no name", line: 4 }];
    open(client);
    await screen.findByText(enBots["dispatch.hello"]);

    await chooseFile("scout.bot.md", "---\nformat: 1\n---\n");

    expect(await screen.findByText("scout.bot.md could not be imported")).toBeInTheDocument();
    expect(screen.getByText(/Line 4: the bot has no name/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose another file" })).toBeInTheDocument();

    await click("Ask Dispatch to fix it");
    expect(await screen.findByText(enBots["review.from.file"])).toBeInTheDocument();
    expect(client.repairFile).toHaveBeenCalledWith("scout.bot.md", "---\nformat: 1\n---\n");
  });

  it("refuses a file that is too large without sending it anywhere", async () => {
    const client = fakeClient();
    open(client);
    await screen.findByText(enBots["dispatch.hello"]);

    await chooseFile("huge.bot.md", { size: MAX_BOT_FILE_BYTES + 1 });

    expect(await screen.findByText(/too large to be a bot file/)).toBeInTheDocument();
    expect(client.importFile).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Ask Dispatch to fix it" }),
    ).not.toBeInTheDocument();
  });
});

describe("review and create", () => {
  async function openReview(client: Fake) {
    const result = open(client);
    await screen.findByText(enBots["dispatch.hello"]);
    await click(/Pick a ready-made bot/);
    await fireEvent.click(await screen.findByRole("button", { name: "Add Scout" }));
    await screen.findByRole("heading", { name: "Scout" });
    return result;
  }

  it("creates the bot with what the person changed", async () => {
    const client = fakeClient();
    const { onDone } = await openReview(client);

    await fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Watcher" } });
    await fireEvent.click(screen.getByRole("radio", { name: /Read freely/ }));
    await fireEvent.click(screen.getByRole("button", { name: "Pattern 6" }));
    await fireEvent.click(screen.getByRole("checkbox"));
    await click("Create Watcher and say hello");

    await waitFor(() => expect(onDone).toHaveBeenCalledWith("bot-scout"));
    expect(client.created[0].draft).toMatchObject({
      name: "Watcher",
      access: "read",
      sigil: { pattern: 5, color: "coral" },
      round: { enabled: false },
    });
  });

  it("asks for a name and instructions before creating anything", async () => {
    const client = fakeClient();
    await openReview(client);

    await fireEvent.input(screen.getByLabelText("Name"), { target: { value: "  " } });
    await click("Create the bot");

    expect(screen.getByText(enBots["review.needName"])).toBeInTheDocument();
    expect(client.create).not.toHaveBeenCalled();
  });

  it("never writes over a folder: offers a free one or adopting the old one", async () => {
    const client = fakeClient();
    client.creates = [
      {
        ok: false,
        reason: "folder-in-use",
        folder: "~/.markas/bots/scout",
        suggestedFolder: "~/.markas/bots/scout-2",
      },
    ];
    const { onDone } = await openReview(client);

    await click("Create Scout and say hello");
    expect(await screen.findByText("~/.markas/bots/scout already exists")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adopt it" })).toBeInTheDocument();

    await click("Use ~/.markas/bots/scout-2");
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("bot-scout"));
    expect(client.created[1].draft.folder).toBe("~/.markas/bots/scout-2");
  });

  it("adopts an existing folder only when asked", async () => {
    const client = fakeClient();
    client.creates = [{ ok: false, reason: "folder-in-use", folder: "a", suggestedFolder: "a-2" }];
    await openReview(client);

    await click("Create Scout and say hello");
    await fireEvent.click(await screen.findByRole("button", { name: "Adopt it" }));

    await waitFor(() => expect(client.created).toHaveLength(2));
    expect(client.created[0].options).toBeUndefined();
    expect(client.created[1].options).toEqual({ adoptExistingFolder: true });
  });

  it("says so and lets the person retry when creating fails", async () => {
    const client = fakeClient();
    client.creates = [{ ok: false, reason: "failed", message: "The disk is full." }];
    const { onDone } = await openReview(client);

    await click("Create Scout and say hello");
    expect(await screen.findByText("Scout could not be created")).toBeInTheDocument();
    expect(screen.getByText(/The disk is full\./)).toBeInTheDocument();

    await click("Retry");
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("bot-scout"));
  });

  it("keeps the bot when only its first run fails", async () => {
    const client = fakeClient();
    client.creates = [
      {
        ok: true,
        botId: "bot-scout",
        testRun: { state: "failed", message: "It could not open the page." },
      },
    ];
    const { onDone } = await openReview(client);

    await click("Create Scout and say hello");
    expect(
      await screen.findByText("Scout was created, but its first run failed"),
    ).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();

    await click("Run it again");
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("bot-scout"));
    expect(client.runTest).toHaveBeenCalledWith("bot-scout");
    expect(client.create).toHaveBeenCalledTimes(1);
  });

  it("goes back to where the draft came from", async () => {
    await openReview(fakeClient());
    await click("Back");
    expect(await screen.findByRole("heading", { name: "Ready-made bots" })).toBeInTheDocument();
  });
});
