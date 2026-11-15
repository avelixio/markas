// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessLevel } from "../access/policy";
import { LogbookStore } from "../logbook/logbook-store";
import { type FakePage, FakeSecretFiller } from "../testing/fake-secret-filler";
import { KeyringCryptoError } from "./crypto";
import { MemoryKeyStore } from "./key-store";
import { handleKeyTool } from "./key-tools";
import { type CreateKeyInput, KeyringStore } from "./keyring-store";
import {
  KeySignIn,
  type KeyUseDecision,
  NoBrowserSecretFiller,
  neighbouringCodeTime,
  type SignInResult,
} from "./sign-in";
import { generateTotp } from "./totp";

const SITE = "https://app.example.com";
const SIBLING = "https://login.example.com";
const USERNAME = "juno.field@example.com";
const PASSWORD = "Tr0ub4dor&3-horse-staple";
const SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
/** The first second of a code window, so "a little early" and "a little late" are easy to say. */
const NOW = 1_700_000_010_000;

const HOME: FakePage = { url: `${SITE}/home`, fields: [] };

/** A sign-in page that asks for everything at once. */
function onePage(accepts: (code: string | undefined) => boolean = () => true): FakePage {
  const page: FakePage = {
    url: `${SITE}/sign-in?next=%2Fhome`,
    fields: ["username", "password"],
    submit: (values) =>
      values.username === USERNAME && values.password === PASSWORD && accepts(values.otp)
        ? HOME
        : undefined,
  };
  return page;
}

/** A page that asks for the one-time code on its own, after the password. */
function codePage(accepts: (code: string) => boolean): FakePage {
  return {
    url: `${SITE}/sign-in/code`,
    fields: ["otp"],
    submit: (values) => (accepts(values.otp ?? "") ? HOME : undefined),
  };
}

function passwordThenCode(accepts: (code: string) => boolean): FakePage {
  return {
    url: `${SITE}/sign-in`,
    fields: ["username", "password"],
    submit: (values) =>
      values.username === USERNAME && values.password === PASSWORD ? codePage(accepts) : undefined,
  };
}

let root: string;
let consoleOutput: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-sign-in-test-"));
  consoleOutput = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    });
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

interface Harness {
  keyring: KeyringStore;
  logbook: LogbookStore;
  filler: FakeSecretFiller;
  keys: KeySignIn;
  keyId: string;
  /** Every question put to the person, and the answers to give, in order. */
  asked: Array<{ detail: string; canAllowForChat: boolean }>;
  answers: KeyUseDecision[];
  clock: { now: number };
  /** Everything the bot was ever told. */
  told: string[];
  signIn(options?: {
    botId?: string;
    chatId?: string;
    level?: AccessLevel;
    key?: { name: string } | { id: string };
  }): Promise<SignInResult>;
  logbookLines(): Promise<
    Array<{ actor: string; action: string; target: string; outcome: string }>
  >;
}

async function harness(
  page: FakePage | null,
  key: Partial<CreateKeyInput> = {},
  twoStep = true,
): Promise<Harness> {
  const keyring = new KeyringStore(root, new MemoryKeyStore());
  await keyring.initialize();
  const created = await keyring.create({
    name: "work-login",
    kind: "login",
    origin: SITE,
    username: USERNAME,
    value: PASSWORD,
    ...(twoStep ? { twoStepSeed: SEED } : {}),
    sharedWith: ["atlas"],
    ...key,
  });
  const logbook = new LogbookStore(root);
  await logbook.initialize();
  const filler = new FakeSecretFiller(page);
  const clock = { now: NOW };
  const names: Record<string, string> = { atlas: "Atlas", juno: "Juno", mika: "Mika" };
  const keys = new KeySignIn({
    keyring,
    filler,
    botName: (id) => names[id] ?? "A bot",
    record: (sentence, outcome) => logbook.record("key.used", sentence, outcome, "bot"),
    now: () => clock.now,
  });
  const asked: Harness["asked"] = [];
  const answers: KeyUseDecision[] = [];
  const told: string[] = [];
  return {
    keyring,
    logbook,
    filler,
    keys,
    keyId: created.id,
    asked,
    answers,
    clock,
    told,
    async signIn(options = {}) {
      const result = await keys.signIn({
        botId: options.botId ?? "atlas",
        chatId: options.chatId ?? "chat-1",
        level: options.level ?? "full",
        key: options.key ?? { name: "work-login" },
        ask: async (detail, canAllowForChat) => {
          asked.push({ detail, canAllowForChat });
          return answers.shift() ?? "deny";
        },
      });
      told.push(JSON.stringify(result));
      return result;
    },
    async logbookLines() {
      const text = await readFile(join(root, "logbook.jsonl"), "utf8").catch(() => "");
      return text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
  };
}

describe("signing a bot in with a saved key", () => {
  it("fills the username and the password, submits, and says only that it worked", async () => {
    const h = await harness(onePage(), {}, false);
    const result = await h.signIn();
    expect(result).toEqual({
      outcome: "signed-in",
      message: `Signed in to ${SITE} with the key "work-login".`,
    });
    expect(h.filler.typed.map((entry) => [entry.field, entry.value])).toEqual([
      ["username", USERNAME],
      ["password", PASSWORD],
    ]);
    expect(h.filler.submits).toBe(1);
    expect(h.filler.page).toBe(HOME);
    expect(h.keyring.list()[0]?.lastUsedAt).toBe(new Date(NOW).toISOString());
  });

  it("types the current one-time code when the site asks on the same page", async () => {
    const expected = generateTotp(SEED, NOW);
    const page = onePage((code) => code === expected);
    page.fields.push("otp");
    const h = await harness(page);
    expect((await h.signIn()).outcome).toBe("signed-in");
    expect(h.filler.typed.map((entry) => entry.field)).toEqual(["username", "password", "otp"]);
    expect(h.filler.typed.at(-1)?.value).toBe(expected);
  });

  it("types the code on its own page when the site asks for it after the password", async () => {
    const expected = generateTotp(SEED, NOW);
    const h = await harness(passwordThenCode((code) => code === expected));
    expect((await h.signIn()).outcome).toBe("signed-in");
    expect(h.filler.typed.map((entry) => entry.field)).toEqual(["username", "password", "otp"]);
    expect(h.filler.submits).toBe(2);
    expect(h.filler.page).toBe(HOME);
  });

  it("does not type a code the site never asks for", async () => {
    const h = await harness(onePage());
    expect((await h.signIn()).outcome).toBe("signed-in");
    expect(h.filler.typed.map((entry) => entry.field)).toEqual(["username", "password"]);
  });

  it("handles a site that asks for the username first and the password on the next page", async () => {
    const passwordPage: FakePage = {
      url: `${SITE}/sign-in/password`,
      fields: ["password"],
      submit: (values) => (values.password === PASSWORD ? HOME : undefined),
    };
    const h = await harness(
      {
        url: `${SITE}/sign-in`,
        fields: ["username"],
        submit: (values) => (values.username === USERNAME ? passwordPage : undefined),
      },
      {},
      false,
    );
    expect((await h.signIn()).outcome).toBe("signed-in");
    expect(h.filler.submits).toBe(2);
    expect(h.filler.page).toBe(HOME);
  });

  it("accepts the key by id as well as by name", async () => {
    const h = await harness(onePage(), {}, false);
    expect((await h.signIn({ key: { id: h.keyId } })).outcome).toBe("signed-in");
  });
});

describe("the exact-site rule", () => {
  it("refuses a sibling host under the same domain and names both sites", async () => {
    const h = await harness({ url: `${SIBLING}/sign-in`, fields: ["username", "password"] });
    const result = await h.signIn();
    expect(result.outcome).toBe("wrong-site");
    expect(result.message).toContain(`is for ${SITE}`);
    expect(result.message).toContain(`your tab is on ${SIBLING}`);
    expect(h.filler.typed).toEqual([]);
    expect(h.filler.submits).toBe(0);
  });

  it("refuses another scheme, another port, a parent domain and a look-alike host", async () => {
    for (const url of [
      "http://app.example.com/sign-in",
      "https://app.example.com:8443/sign-in",
      "https://example.com/sign-in",
      "https://app.example.com.evil.example/sign-in",
      "https://evil.example/?https://app.example.com/",
      "https://app.example.com@evil.example/sign-in",
      "about:blank",
      "not a url",
    ]) {
      const h = await harness({ url, fields: ["username", "password"] });
      const result = await h.signIn();
      expect(result.outcome, url).toBe("wrong-site");
      expect(h.filler.typed, url).toEqual([]);
      await rm(join(root, "keyring.json"), { force: true });
    }
  });

  it("tells the bot only the tab's site, never its full address", async () => {
    const h = await harness({
      url: `${SIBLING}/callback?session=abc123secretsession`,
      fields: ["password"],
    });
    const result = await h.signIn();
    expect(result.message).not.toContain("abc123secretsession");
    expect(JSON.stringify(await h.logbookLines())).not.toContain("abc123secretsession");
  });

  it("stops when the page moves to another site between the check and the typing", async () => {
    const h = await harness(onePage(), {}, false);
    h.filler.moveBeforeTyping = { url: `${SIBLING}/sign-in`, fields: ["username", "password"] };
    const result = await h.signIn();
    expect(result.outcome).toBe("wrong-site");
    expect(result.message).toContain(SIBLING);
    expect(h.filler.typed).toEqual([]);
  });

  it("does not follow a sign-in that moves to another site for the password", async () => {
    const h = await harness(
      {
        url: `${SITE}/sign-in`,
        fields: ["username"],
        submit: () => ({ url: `${SIBLING}/password`, fields: ["password"] }),
      },
      {},
      false,
    );
    const result = await h.signIn();
    expect(result.outcome).toBe("wrong-site");
    expect(h.filler.values).toEqual([USERNAME]);
  });

  it("does not type the code on another site after the password was accepted", async () => {
    const h = await harness({
      url: `${SITE}/sign-in`,
      fields: ["username", "password"],
      submit: () => ({ url: `${SIBLING}/code`, fields: ["otp"] }),
    });
    const result = await h.signIn();
    expect(result.outcome).toBe("signed-in");
    expect(result.message).toContain(`moved the tab to ${SIBLING}`);
    expect(h.filler.typed.map((entry) => entry.field)).toEqual(["username", "password"]);
  });

  it("asks the bot to open the site when it has no tab", async () => {
    const h = await harness(null);
    const result = await h.signIn();
    expect(result.outcome).toBe("no-page");
    expect(result.message).toContain(SITE);
  });

  it("answers the same way while the bot browser is not built yet", async () => {
    const keyring = new KeyringStore(root, new MemoryKeyStore());
    await keyring.initialize();
    await keyring.create({
      name: "work-login",
      kind: "login",
      origin: SITE,
      username: USERNAME,
      value: PASSWORD,
      sharedWith: ["atlas"],
    });
    const keys = new KeySignIn({
      keyring,
      filler: new NoBrowserSecretFiller(),
      botName: () => "Atlas",
      record: async () => undefined,
    });
    const result = await keys.signIn({
      botId: "atlas",
      chatId: "chat-1",
      level: "full",
      key: { name: "work-login" },
      ask: async () => "deny",
    });
    expect(result.outcome).toBe("no-page");
  });
});

describe("who may use a key", () => {
  it("refuses a bot the key is not shared with, exactly as if the key did not exist", async () => {
    const h = await harness(onePage());
    const notShared = await h.signIn({ botId: "juno" });
    const missing = await h.signIn({ botId: "juno", key: { name: "no-such-key" } });
    expect(notShared.outcome).toBe("not-shared");
    expect(missing.outcome).toBe("not-shared");
    expect(notShared.message.replace("work-login", "X")).toBe(
      missing.message.replace("no-such-key", "X"),
    );
    expect((await h.signIn({ botId: "juno", key: { id: h.keyId } })).outcome).toBe("not-shared");
    expect(h.filler.typed).toEqual([]);
    expect(h.asked).toEqual([]);
  });

  it("lists for a bot only the names and sites of its own keys", async () => {
    const h = await harness(onePage());
    await h.keyring.create({
      name: "reports",
      kind: "login",
      origin: "https://reports.example.com",
      username: "mika.reports",
      value: "another-password-9",
      sharedWith: ["mika"],
    });
    expect(h.keys.listForBot("atlas")).toEqual([
      { id: h.keyId, name: "work-login", kind: "login", site: SITE, hasTwoStepCode: true },
    ]);
    expect(h.keys.listForBot("juno")).toEqual([]);
    const listed = await handleKeyTool(h.keys, {
      botId: "atlas",
      chatId: "chat-1",
      level: "ask",
      tool: "keyring_list",
      arguments: {},
      ask: async () => "deny",
    });
    const text = listed.contentItems[0]?.text ?? "";
    expect(listed.success).toBe(true);
    expect(JSON.parse(text).keys).toHaveLength(1);
    for (const secret of [USERNAME, PASSWORD, SEED, "reports", "mika.reports"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("refuses a key that is not a website login", async () => {
    const h = await harness(onePage());
    await h.keyring.create({
      name: "deploy-token",
      kind: "variable",
      variable: "DEPLOY_TOKEN",
      value: "token-value-1234",
      sharedWith: ["atlas"],
    });
    const result = await h.signIn({ key: { name: "deploy-token" } });
    expect(result.outcome).toBe("not-a-login");
    expect(h.filler.typed).toEqual([]);
  });

  it("never fills a key the person keeps for themselves", async () => {
    const h = await harness(onePage(), { fillPolicy: "handoff" });
    const result = await h.signIn();
    expect(result.outcome).toBe("handed-over");
    expect(result.message).toContain("Hand this step over to the person");
    expect(h.filler.typed).toEqual([]);
    expect(h.asked).toEqual([]);
  });

  it("requires exactly one of keyName and keyId", async () => {
    const h = await harness(onePage());
    for (const input of [{}, { keyName: "" }, { keyName: "work-login", keyId: h.keyId }, null]) {
      const result = await handleKeyTool(h.keys, {
        botId: "atlas",
        chatId: "chat-1",
        level: "full",
        tool: "keyring_sign_in",
        arguments: input,
        ask: async () => "deny",
      });
      expect(result.success).toBe(false);
      expect(result.contentItems[0]?.text).toContain("Name one key");
    }
    expect(h.filler.typed).toEqual([]);
  });
});

describe("the person's yes", () => {
  it("asks before the first use of a key in a chat, saying which key and which site", async () => {
    const h = await harness(onePage(), {}, false);
    h.answers.push("once");
    expect((await h.signIn({ level: "ask" })).outcome).toBe("signed-in");
    expect(h.asked).toEqual([
      { detail: `Sign in to ${SITE} with the key "work-login"`, canAllowForChat: true },
    ]);
  });

  it("asks again after allow once, and not again after allow for this chat", async () => {
    const h = await harness(onePage(), {}, false);
    h.answers.push("once", "chat");
    await h.signIn({ level: "ask" });
    h.filler.goTo(onePage());
    await h.signIn({ level: "ask" });
    h.filler.goTo(onePage());
    expect((await h.signIn({ level: "read" })).outcome).toBe("signed-in");
    expect(h.asked).toHaveLength(2);
  });

  it("keeps a yes to one chat, one key and one bot's session", async () => {
    const h = await harness(onePage(), {}, false);
    h.answers.push("chat");
    await h.signIn({ level: "ask" });

    h.filler.goTo(onePage());
    expect((await h.signIn({ level: "ask", chatId: "chat-2" })).outcome).toBe("not-allowed");
    expect(h.asked).toHaveLength(2);

    h.keys.forgetChat("chat-1");
    h.filler.goTo(onePage());
    expect((await h.signIn({ level: "ask" })).outcome).toBe("not-allowed");
    expect(h.asked).toHaveLength(3);
  });

  it("types nothing when the person says no, or when the question cannot be put", async () => {
    const h = await harness(onePage(), {}, false);
    const refused = await h.signIn({ level: "ask" });
    expect(refused.outcome).toBe("not-allowed");
    expect(refused.message).toContain("Do not retry");

    const result = await h.keys.signIn({
      botId: "atlas",
      chatId: "chat-1",
      level: "read",
      key: { name: "work-login" },
      ask: async () => {
        throw new Error("the chat is gone");
      },
    });
    expect(result.outcome).toBe("not-allowed");
    expect(h.filler.typed).toEqual([]);
    expect(h.filler.submits).toBe(0);
  });

  it("does not ask for a bot with full access", async () => {
    const h = await harness(onePage(), {}, false);
    expect((await h.signIn({ level: "full" })).outcome).toBe("signed-in");
    expect(h.asked).toEqual([]);
  });

  it("asks every time for a key marked ask, even at full access, and offers once only", async () => {
    const h = await harness(onePage(), { fillPolicy: "ask" }, false);
    h.answers.push("chat", "once");
    await h.signIn({ level: "full" });
    h.filler.goTo(onePage());
    await h.signIn({ level: "full" });
    expect(h.asked).toHaveLength(2);
    expect(h.asked.every((question) => !question.canAllowForChat)).toBe(true);
  });

  it("does not ask about a key on the wrong site", async () => {
    const h = await harness({ url: `${SIBLING}/sign-in`, fields: ["username", "password"] });
    await h.signIn({ level: "ask" });
    expect(h.asked).toEqual([]);
  });
});

describe("what changed while the person was deciding", () => {
  async function during(
    change: (h: Harness) => Promise<void> | void,
    key: Partial<CreateKeyInput> = {},
  ) {
    const h = await harness(onePage(), key, false);
    const result = await h.keys.signIn({
      botId: "atlas",
      chatId: "chat-1",
      level: "ask",
      key: { name: "work-login" },
      ask: async () => {
        await change(h);
        return "once";
      },
    });
    return { h, result };
  }

  it("says the key was removed", async () => {
    const { h, result } = await during((h) => h.keyring.remove(h.keyId));
    expect(result.outcome).toBe("key-removed");
    expect(result.message).toContain("removed from the keyring");
    expect(h.filler.typed).toEqual([]);
  });

  it("says the key is no longer shared", async () => {
    const { h, result } = await during(async (h) => {
      await h.keyring.share(h.keyId, ["mika"]);
    });
    expect(result.outcome).toBe("not-shared");
    expect(h.filler.typed).toEqual([]);
  });

  it("does not use a key that was moved to another site", async () => {
    const { h, result } = await during(async (h) => {
      await h.keyring.update({ id: h.keyId, origin: SIBLING });
    });
    expect(result.outcome).toBe("key-changed");
    expect(h.filler.typed).toEqual([]);
  });

  it("uses the password as it is now, not as it was when the bot asked", async () => {
    const { h } = await during(async (h) => {
      await h.keyring.update({ id: h.keyId, value: "a-newer-password-22" });
    });
    expect(h.filler.values).toEqual([USERNAME, "a-newer-password-22"]);
  });

  it("does not type into a tab that left the site", async () => {
    const { h, result } = await during((h) => {
      h.filler.goTo({ url: `${SIBLING}/sign-in`, fields: ["username", "password"] });
    });
    expect(result.outcome).toBe("wrong-site");
    expect(h.filler.typed).toEqual([]);
  });
});

describe("when the page does not cooperate", () => {
  it("hands over to the person when the sign-in fields are not found", async () => {
    const h = await harness({ url: `${SITE}/welcome`, fields: [] });
    const result = await h.signIn();
    expect(result.outcome).toBe("handed-over");
    expect(result.message).toContain("sign-in fields were not found");
    expect(result.message).toContain("Hand this step over to the person");
    expect(h.filler.submits).toBe(0);
  });

  it("hands over when the password field never appears", async () => {
    const h = await harness({ url: `${SITE}/sign-in`, fields: ["username"] }, {}, false);
    const result = await h.signIn();
    expect(result.outcome).toBe("handed-over");
    expect(result.message).toContain("password field was not found");
    expect(h.filler.values).toEqual([USERNAME]);
  });

  it("hands over, without trying again, when the site refuses the password", async () => {
    const h = await harness(
      { url: `${SITE}/sign-in`, fields: ["username", "password"], submit: () => undefined },
      {},
      false,
    );
    const result = await h.signIn();
    expect(result.outcome).toBe("handed-over");
    expect(result.message).toContain("may be out of date");
    expect(h.filler.submits).toBe(1);
    expect(h.filler.values.filter((value) => value === PASSWORD)).toHaveLength(1);
  });

  it("hands over when the site wants a code and the key has none", async () => {
    const h = await harness(
      passwordThenCode(() => true),
      {},
      false,
    );
    const result = await h.signIn();
    expect(result.outcome).toBe("handed-over");
    expect(result.message).toContain("has none saved");
    expect(h.filler.typed.map((entry) => entry.field)).toEqual(["username", "password"]);
  });

  it("gives a plain answer when the browser breaks, without the browser's own words", async () => {
    const h = await harness(onePage(), {}, false);
    h.filler.failTyping = new Error(`could not type "${PASSWORD}" into input#user`);
    const result = await h.signIn();
    expect(result.outcome).toBe("browser-failed");
    expect(result.message).not.toContain(PASSWORD);
    expect(result.message).not.toContain("input#user");
  });
});

describe("a clock that runs a little off", () => {
  it("tries the code of the window before, once, when the first is refused early in a window", async () => {
    const previous = generateTotp(SEED, NOW - 30_000);
    const h = await harness(passwordThenCode((code) => code === previous));
    expect((await h.signIn()).outcome).toBe("signed-in");
    const codes = h.filler.typed.filter((entry) => entry.field === "otp").map((e) => e.value);
    expect(codes).toEqual([generateTotp(SEED, NOW), previous]);
  });

  it("tries the code of the window after when the first is refused late in a window", async () => {
    const h = await harness(null);
    h.clock.now = NOW + 20_000;
    const next = generateTotp(SEED, h.clock.now + 30_000);
    h.filler.goTo(passwordThenCode((code) => code === next));
    expect((await h.signIn()).outcome).toBe("signed-in");
    const codes = h.filler.typed.filter((entry) => entry.field === "otp").map((e) => e.value);
    expect(codes).toEqual([generateTotp(SEED, h.clock.now), next]);
  });

  it("retries on a page that asks for password and code together", async () => {
    const previous = generateTotp(SEED, NOW - 30_000);
    // The site keeps the password and shows only the code field again.
    const again = codePage((code) => code === previous);
    const h = await harness({
      url: `${SITE}/sign-in`,
      fields: ["username", "password", "otp"],
      submit: (values) => (values.otp === previous ? HOME : again),
    });
    expect((await h.signIn()).outcome).toBe("signed-in");
    expect(h.filler.typed.filter((entry) => entry.field === "otp")).toHaveLength(2);
  });

  it("stops after one retry and hands over", async () => {
    const h = await harness(passwordThenCode(() => false));
    const result = await h.signIn();
    expect(result.outcome).toBe("handed-over");
    expect(result.message).toContain("did not accept the one-time code");
    expect(h.filler.typed.filter((entry) => entry.field === "otp")).toHaveLength(2);
    expect(h.filler.submits).toBe(3);
  });

  it("picks the neighbouring window", () => {
    expect(neighbouringCodeTime(NOW, NOW + 1_000, 30)).toBe(NOW - 30_000);
    expect(neighbouringCodeTime(NOW + 20_000, NOW + 21_000, 30)).toBe(NOW + 50_000);
    // The clock crossed into the next window while the first code was on its way.
    expect(neighbouringCodeTime(NOW + 29_000, NOW + 31_000, 30)).toBe(NOW + 31_000);
  });
});

describe("the keyring itself is in trouble", () => {
  it("says so when the keyring could not be opened", async () => {
    const filler = new FakeSecretFiller(onePage());
    const keys = new KeySignIn({
      keyring: null,
      filler,
      botName: () => "Atlas",
      record: async () => undefined,
    });
    const result = await keys.signIn({
      botId: "atlas",
      chatId: "chat-1",
      level: "full",
      key: { name: "work-login" },
      ask: async () => "once",
    });
    expect(result.outcome).toBe("keyring-unavailable");
    expect(result.message).toContain("cannot be opened");
    expect(keys.listForBot("atlas")).toBeNull();
    const listed = await handleKeyTool(keys, {
      botId: "atlas",
      chatId: "chat-1",
      level: "full",
      tool: "keyring_list",
      arguments: {},
      ask: async () => "deny",
    });
    expect(listed.success).toBe(false);
    expect(filler.typed).toEqual([]);
  });

  it("says so when a key cannot be read, and types nothing", async () => {
    const h = await harness(onePage(), {}, false);
    vi.spyOn(h.keyring, "openForBot").mockRejectedValue(
      new KeyringCryptoError("The keyring record could not be opened."),
    );
    const result = await h.signIn();
    expect(result.outcome).toBe("keyring-unavailable");
    expect(result.message).toContain("could not be read");
    expect(h.filler.typed).toEqual([]);
    expect((await h.logbookLines())[0]?.outcome).toBe("failed");
  });
});

describe("the logbook", () => {
  it("records each use as who signed in where with which key", async () => {
    const h = await harness(onePage(), {}, false);
    await h.signIn();
    expect(await h.logbookLines()).toMatchObject([
      {
        actor: "bot",
        action: "key.used",
        target: `Atlas signed in to ${SITE} with key work-login`,
        outcome: "done",
      },
    ]);
    expect(h.logbook.list()[0]?.target).toBe(`Atlas signed in to ${SITE} with key work-login`);
  });

  it("records an attempt that did not go through, with the reason", async () => {
    const h = await harness({ url: `${SIBLING}/sign-in`, fields: ["username", "password"] });
    await h.signIn();
    h.filler.goTo(onePage());
    await h.signIn({ level: "ask" });
    expect((await h.logbookLines()).map((line) => [line.target, line.outcome])).toEqual([
      [`Atlas did not sign in to ${SITE} with key work-login: the tab was on ${SIBLING}`, "failed"],
      [`Atlas did not sign in to ${SITE} with key work-login: not allowed`, "failed"],
    ]);
  });

  it("records nothing for a name the bot made up", async () => {
    const h = await harness(onePage());
    await h.signIn({ key: { name: "<script>made up</script>" } });
    expect(await h.logbookLines()).toEqual([]);
  });

  it("still signs in when the logbook cannot be written", async () => {
    const h = await harness(onePage(), {}, false);
    vi.spyOn(h.logbook, "record").mockRejectedValue(new Error("disk full"));
    expect((await h.signIn()).outcome).toBe("signed-in");
    expect(consoleOutput.join("\n")).toContain("logbook could not record");
  });
});

describe("secrets stay with the host", () => {
  it("leaves no username, password, setup key or code in anything a bot, a log or the logbook sees", async () => {
    const h = await harness(passwordThenCode(() => false));
    const page = (accepts: (code: string) => boolean) => passwordThenCode(accepts);

    // Every path that touches the secrets, run one after another.
    await h.signIn(); // code refused twice, handed over
    h.filler.goTo(page((code) => code === generateTotp(SEED, NOW)));
    await h.signIn(); // signed in
    h.filler.goTo({ url: `${SIBLING}/sign-in`, fields: ["username", "password", "otp"] });
    await h.signIn(); // wrong site
    h.filler.goTo({ url: `${SITE}/sign-in`, fields: ["username", "password"] });
    await h.signIn(); // password refused
    h.filler.goTo(onePage());
    h.filler.failTyping = new Error(`typing ${PASSWORD} for ${USERNAME} failed`);
    await h.signIn(); // browser fault
    h.filler.goTo(onePage());
    h.answers.push("chat");
    await h.signIn({ level: "ask" }); // asked, allowed
    await h.signIn({ level: "ask", botId: "juno" }); // not shared
    h.filler.goTo(null);
    await h.signIn(); // no tab
    const listed = await handleKeyTool(h.keys, {
      botId: "atlas",
      chatId: "chat-1",
      level: "ask",
      tool: "keyring_list",
      arguments: {},
      ask: async () => "deny",
    });

    // The fake browser is the only place the secrets went, and only on the key's own site.
    const typed = h.filler.typed;
    expect(typed.length).toBeGreaterThan(8);
    expect(typed.every((entry) => new URL(entry.url).origin === SITE)).toBe(true);
    const codes = typed.filter((entry) => entry.field === "otp").map((entry) => entry.value);
    expect(codes.length).toBeGreaterThanOrEqual(3);
    const lasting = [USERNAME, PASSWORD, SEED, SEED.toLowerCase()];

    const seen = [
      ...h.told,
      JSON.stringify(listed),
      JSON.stringify(h.asked),
      consoleOutput.join("\n"),
      await readFile(join(root, "logbook.jsonl"), "utf8"),
      JSON.stringify(h.logbook.list()),
    ].join("\n");
    expect(seen).toContain("work-login");
    const onDisk = await readFile(join(root, "keyring.json"), "utf8");
    for (const secret of lasting) {
      expect(seen.includes(secret), `a secret (${secret.length} characters) leaked`).toBe(false);
    }
    // The password and the setup key are sealed at rest. The username is kept in the clear
    // for the person's own Keyring screen, and is still never given to a bot.
    for (const secret of [PASSWORD, SEED]) {
      expect(onDisk.includes(secret), "a secret is on disk in the clear").toBe(false);
    }
    // A code is six digits, so random ids are taken out first: one could hold the same digits.
    const withoutIds = seen.replace(/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, "");
    for (const code of new Set(codes)) {
      expect(withoutIds.includes(code), "a one-time code leaked").toBe(false);
    }
    // The same in the encodings a page or a tool tends to echo a value back in.
    for (const secret of [USERNAME, PASSWORD, SEED]) {
      expect(seen).not.toContain(encodeURIComponent(secret));
      expect(seen).not.toContain(Buffer.from(secret).toString("base64"));
    }
  });
});
