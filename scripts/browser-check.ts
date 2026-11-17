// Checks the bot browser against a real browser on this computer.
// It starts a small local website with a sign-in form, a one-time code step and an
// "approve on your phone" step, then signs a bot in with the real service:
// the bot types the username, the host fills the password and the code, and the last step
// is handed to the person.
//
//   bun scripts/browser-check.ts             run without windows
//   bun scripts/browser-check.ts --headed    watch it happen
//   bun scripts/browser-check.ts --only=msedge  drive Edge even when Chrome is installed
//   bun scripts/browser-check.ts --download  also download Markas's own Chromium and drive it
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BotBrowserService } from "../src/backend/browser/bot-browser-service";
import { type BrowserFinder, SystemBrowserFinder } from "../src/backend/browser/browser-finder";
import { PlaywrightDriver } from "../src/backend/browser/playwright-driver";
import type { DynamicToolResult } from "../src/backend/protocol";
import { resolveHostPaths } from "../src/host/paths";
import type { BrowserControlState } from "../src/shared/ipc";

const USERNAME = "atlas@example.com";
const PASSWORD = "stock-check-Passw0rd!";
const ONE_TIME_CODE = "482913";
const headed = process.argv.includes("--headed");
const withDownload = process.argv.includes("--download");

// --- The website -----------------------------------------------------------------------------

interface Visit {
  step: "new" | "code" | "approve" | "in";
}
const visits = new Map<string, Visit>();
const received = { password: "", code: "" };
/** What the person did on the pad page through the Browser panel. */
const pad = { clicks: 0, text: "" };

const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
const go = (location: string, cookie?: string) =>
  new Response(null, {
    status: 303,
    headers: cookie ? { location, "set-cookie": cookie } : { location },
  });

const site = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const id = /(?:^|; )sid=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1] ?? "";
    const visit = visits.get(id);
    const form = async () => new URLSearchParams(await request.text());
    switch (`${request.method} ${url.pathname}`) {
      case "GET /login":
        return page(
          "Sign in",
          `<form method="post" action="/login">
             <label>Username <input name="username" autocomplete="username"></label>
             <label>Password <input name="password" type="password"></label>
             <button>Sign in</button>
           </form>${url.searchParams.has("error") ? "<p>Wrong username or password.</p>" : ""}`,
        );
      case "POST /login": {
        const fields = await form();
        received.password = fields.get("password") ?? "";
        if (fields.get("username") !== USERNAME || received.password !== PASSWORD) {
          return go("/login?error=1");
        }
        const fresh = crypto.randomUUID();
        visits.set(fresh, { step: "code" });
        return go("/verify", `sid=${fresh}; Max-Age=3600; Path=/; HttpOnly`);
      }
      case "GET /verify":
        if (!visit) return go("/login");
        return page(
          "Enter your code",
          `<form method="post" action="/verify">
             <label>One-time code <input name="otp" autocomplete="one-time-code" inputmode="numeric"></label>
             <button>Verify</button>
           </form>`,
        );
      case "POST /verify": {
        if (!visit) return go("/login");
        received.code = (await form()).get("otp") ?? "";
        if (received.code !== ONE_TIME_CODE) return go("/verify");
        visit.step = "approve";
        return go("/approve");
      }
      case "GET /approve":
        if (!visit) return go("/login");
        return page(
          "Approve on your phone",
          `<p>We sent a request to your phone. Approve it to finish signing in.</p>
           <script>
             setInterval(async () => {
               const answer = await fetch("/status").then((r) => r.text());
               if (answer === "in") location.href = "/account";
             }, 200);
           </script>`,
        );
      case "GET /status":
        return new Response(visit?.step ?? "new");
      case "GET /account":
        if (visit?.step !== "in") return go("/login");
        return page("Stock overview", "<p>Welcome back, Atlas.</p><a href='/login'>Sign out</a>");
      case "GET /pad":
        // A page that is one big button: a click anywhere moves the caret into the field.
        return page(
          "Pad",
          `<form method="get" action="/pad-done"><input name="text" aria-label="Text"></form>
           <button id="all" style="position:fixed;inset:0;width:100%;height:100%;opacity:0.01">Anywhere</button>
           <script>
             const all = document.getElementById("all");
             all.addEventListener("click", async () => {
               await fetch("/pad-click", { method: "POST" });
               all.remove();
               document.querySelector("input").focus();
             });
           </script>`,
        );
      case "POST /pad-click":
        pad.clicks += 1;
        return new Response("ok");
      case "GET /pad-done":
        pad.text = url.searchParams.get("text") ?? "";
        return page("Pad done", "<p>Thank you.</p>");
      case "GET /slow":
        // A page that never answers.
        return new Promise<Response>(() => undefined);
      default:
        return new Response("Not found", { status: 404 });
    }
  },
});
const origin = `http://127.0.0.1:${site.port}`;

/** The person approving the sign-in on their phone. */
function approveOnPhone(): void {
  for (const visit of visits.values()) if (visit.step === "approve") visit.step = "in";
}

// --- The checks ------------------------------------------------------------------------------

const results: Array<{ name: string; problem: string | null }> = [];
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    results.push({ name, problem: null });
    console.log(`  ok    ${name}`);
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    results.push({ name, problem });
    console.log(`  FAIL  ${name}\n        ${problem}`);
  }
}
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const textOf = (result: DynamicToolResult) =>
  result.contentItems.map((item) => (item.type === "inputText" ? item.text : "")).join("\n");

let calls = 0;
function botTool(service: BotBrowserService, botId: string, name: string, args: unknown = {}) {
  calls += 1;
  return service.handleDynamicTool(
    {
      threadId: `thread-${botId}`,
      turnId: "turn-1",
      callId: `call-${calls}`,
      namespace: "markas_browser",
      tool: name,
      arguments: args,
    },
    { botId },
  );
}

/** Reads the page as the bot does: the text, its revision, and a way to find a reference. */
async function readPage(service: BotBrowserService, botId: string, tabId: string) {
  const result = await botTool(service, botId, "snapshot", { tabId });
  const text = textOf(result);
  expect(result.success, `Reading the page failed: ${text}`);
  return {
    text,
    revision: Number(/Revision: (\d+)/.exec(text)?.[1]),
    ref(kind: string, name: string): string {
      const found = new RegExp(`${kind} "${name}"[^\\n]*\\[ref=(\\w+)\\]`).exec(text)?.[1];
      expect(found, `No ${kind} called "${name}" on the page:\n${text}`);
      return found;
    },
  };
}

async function waitFor(condition: () => boolean | Promise<boolean>, what: string, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function signInFlow(finder: BrowserFinder, label: string, profilesRoot: string) {
  const service = new BotBrowserService({
    profilesRoot,
    finder,
    driver: new PlaywrightDriver(),
    headless: !headed,
    navigationTimeoutMs: 4_000,
    handOffWaitMs: 20_000,
  });
  const controls: BrowserControlState[] = [];
  service.onControlChanged((state) => controls.push(state));
  let tabId = "";

  try {
    await check(`${label}: opens the sign-in page in the bot's own profile`, async () => {
      const opened = await botTool(service, "atlas", "open", { url: `${origin}/login` });
      expect(opened.success, textOf(opened));
      tabId = /Opened tab (\w+)/.exec(textOf(opened))?.[1] ?? "";
      const tabs = service.listTabs();
      expect(tabs.length === 1 && tabs[0]?.ownerBotId === "atlas", "The tab is not listed.");
    });

    await check(`${label}: the bot reads the page and types the username`, async () => {
      const read = await readPage(service, "atlas", tabId);
      expect(read.text.includes('heading "Sign in"'), `Unexpected page:\n${read.text}`);
      const typed = await botTool(service, "atlas", "act", {
        tabId,
        revision: read.revision,
        action: { type: "type", ref: read.ref("textbox", "Username"), text: USERNAME },
      });
      expect(typed.success, textOf(typed));
    });

    await check(`${label}: a secret is refused on the wrong site`, async () => {
      const refused = await service
        .fillSecret({
          botId: "atlas",
          tabId,
          origin: "https://shop.example.com",
          target: { field: "password" },
          value: PASSWORD,
        })
        .then(
          () => null,
          (error: Error) => error.message,
        );
      expect(refused?.includes("so nothing was filled"), `Not refused: ${refused}`);
    });

    await check(`${label}: the host fills the password and the bot cannot read it`, async () => {
      await service.fillSecret({
        botId: "atlas",
        tabId,
        origin,
        target: { field: "password" },
        value: PASSWORD,
      });
      const read = await readPage(service, "atlas", tabId);
      expect(!read.text.includes(PASSWORD), "The password is in what the bot reads.");
      expect(read.text.includes(USERNAME), "The username the bot typed is missing.");
      const picture = await botTool(service, "atlas", "screenshot", { tabId });
      const image = picture.contentItems[0];
      expect(
        image?.type === "inputImage" && image.imageUrl.length > 2_000,
        "The screenshot is missing.",
      );
      const clicked = await botTool(service, "atlas", "act", {
        tabId,
        revision: read.revision,
        action: { type: "click", ref: read.ref("button", "Sign in") },
      });
      expect(clicked.success, textOf(clicked));
      expect(received.password === PASSWORD, "The site did not receive the password.");
    });

    await check(`${label}: the host fills the one-time code`, async () => {
      const read = await readPage(service, "atlas", tabId);
      expect(read.text.includes("Enter your code"), `Not on the code page:\n${read.text}`);
      await service.fillSecret({
        botId: "atlas",
        tabId,
        origin,
        target: { field: "one-time-code" },
        value: ONE_TIME_CODE,
      });
      const after = await readPage(service, "atlas", tabId);
      expect(!after.text.includes(ONE_TIME_CODE), "The code is in what the bot reads.");
      const clicked = await botTool(service, "atlas", "act", {
        tabId,
        revision: after.revision,
        action: { type: "click", ref: after.ref("button", "Verify") },
      });
      expect(clicked.success, textOf(clicked));
      expect(received.code === ONE_TIME_CODE, "The site did not receive the code.");
    });

    await check(
      `${label}: the last step is handed to the person, who gives the tab back`,
      async () => {
        const read = await readPage(service, "atlas", tabId);
        expect(
          read.text.includes("Approve on your phone"),
          `Not on the approve page:\n${read.text}`,
        );
        const waiting = botTool(service, "atlas", "hand_off", {
          tabId,
          reason: "Approve the sign-in on your phone",
        });
        const handOff = service.getControlState().handOffs?.[0];
        expect(handOff?.tabId === tabId && handOff.requestedBy === "bot", "No hand-off is shown.");
        const refused = await botTool(service, "atlas", "snapshot", { tabId });
        expect(!refused.success, "The bot could still read the tab during the hand-off.");

        // The person watches the tab in the Browser panel, does their part, and resumes.
        const view = await service.viewTab(tabId);
        expect(view.controller === "person" && view.image, "The panel has no picture of the tab.");
        approveOnPhone();
        await waitFor(
          () => service.listTabs()[0]?.url === `${origin}/account`,
          "the site to finish signing in",
        );
        service.resumeControl({ tabId, note: "Approved" });
        const result = await waiting;
        expect(textOf(result).includes("gave the tab back. They said: Approved"), textOf(result));
        expect(controls.at(-1)?.handOffs?.length === 0, "The hand-off did not end.");

        const account = await readPage(service, "atlas", tabId);
        expect(account.text.includes("Welcome back, Atlas."), `Not signed in:\n${account.text}`);
      },
    );

    await check(
      `${label}: the person can take over at any time and give the tab back`,
      async () => {
        const handOff = await service.takeControl({ tabId, reason: "Looking at the stock myself" });
        expect(handOff.requestedBy === "person", "The take-over is not recorded.");
        const refused = await botTool(service, "atlas", "act", {
          tabId,
          revision: 0,
          action: { type: "reload" },
        });
        expect(
          !refused.success && textOf(refused).includes("controlling this tab"),
          `The bot could still act: ${textOf(refused)}`,
        );
        service.resumeControl({ tabId });
        const read = await readPage(service, "atlas", tabId);
        expect(read.text.includes("Welcome back, Atlas."), `Unexpected page:\n${read.text}`);
      },
    );

    await check(
      `${label}: the person clicks and types on the page through the Browser panel`,
      async () => {
        const tab = await service.open(`${origin}/pad`, "thread-atlas", "atlas");
        const early = await service
          .personInput({ tabId: tab.id, kind: "click", x: 0.5, y: 0.5 })
          .then(
            () => null,
            (error: Error) => error.message,
          );
        expect(early?.includes("Take it over first"), `Not refused while the bot drives: ${early}`);
        await service.takeControl({ tabId: tab.id });
        await service.personInput({ tabId: tab.id, kind: "click", x: 0.5, y: 0.5 });
        await waitFor(() => pad.clicks === 1, "the page to receive the click");
        await service.personInput({ tabId: tab.id, kind: "type", text: "hello from the panel" });
        await service.personInput({ tabId: tab.id, kind: "key", key: "Enter" });
        await waitFor(() => pad.text === "hello from the panel", "the page to receive the typing");
        const view = await service.viewTab(tab.id);
        expect(
          view.image && view.tab.url.startsWith(`${origin}/pad-done`),
          `Still on ${view.tab.url}`,
        );
        service.resumeControl({ tabId: tab.id });
        await service.close(tab.id);
      },
    );

    await check(
      `${label}: a login from the Keyring is typed and sent for another bot`,
      async () => {
        const tab = await service.open(`${origin}/login`, "thread-juno", "juno");
        const filler = service.secretFiller();
        expect((await filler.currentUrl("juno")) === `${origin}/login`, "The filler sees no tab.");
        expect(await filler.hasField("juno", "password"), "No password field was found.");
        expect(
          !(await filler.hasField("juno", "otp")),
          "A code field was found on the sign-in page.",
        );
        received.password = "";
        const refused = await filler.fillSecret(
          "juno",
          "password",
          PASSWORD,
          "https://shop.example.com",
        );
        expect(refused === "wrong-site", `Typed on the wrong site: ${refused}`);
        expect(
          (await filler.fillSecret("juno", "username", USERNAME, origin)) === "filled",
          "Username not typed.",
        );
        expect(
          (await filler.fillSecret("juno", "password", PASSWORD, origin)) === "filled",
          "Password not typed.",
        );
        await filler.submit("juno");
        await waitFor(
          () =>
            service
              .listTabs()
              .some((open) => open.id === tab.id && open.url === `${origin}/verify`),
          "the site to accept the login",
        );
        expect(received.password === PASSWORD, "The site did not receive the password.");
        const read = await readPage(service, "juno", tab.id);
        expect(!read.text.includes(PASSWORD), "The password is in what the bot reads.");
        await service.close(tab.id);
      },
    );

    await check(`${label}: another bot is not signed in`, async () => {
      const tab = await service.open(`${origin}/account`, "thread-juno", "juno");
      expect(tab.url.startsWith(`${origin}/login`), `Juno landed on ${tab.url}`);
      await service.close(tab.id);
    });

    await check(`${label}: a second program cannot use a profile that is in use`, async () => {
      const second = new BotBrowserService({
        profilesRoot,
        finder,
        driver: new PlaywrightDriver(),
        headless: true,
      });
      try {
        const problem = await second.open(`${origin}/login`, null, "atlas").then(
          () => "it opened",
          (error: Error) => error.message,
        );
        expect(problem.includes("in use by another program"), `Unexpected result: ${problem}`);
      } finally {
        await second.destroy();
      }
    });

    await check(`${label}: a page that never loads times out and the tab survives`, async () => {
      const slow = await botTool(service, "atlas", "open", { url: `${origin}/slow` });
      expect(!slow.success && textOf(slow).includes("took longer than 4 seconds"), textOf(slow));
      const slowTab = /open as (\w+)/.exec(textOf(slow))?.[1] ?? "";
      expect(
        service.listTabs().some((tab) => tab.id === slowTab),
        "The tab is gone.",
      );
      const closed = await botTool(service, "atlas", "close_tab", { tabId: slowTab });
      expect(closed.success, textOf(closed));
    });

    await check(`${label}: the sign-in is still there after the browser was closed`, async () => {
      await service.close(tabId);
      expect(service.listTabs().length === 0, "Tabs are still open.");
      const tab = await service.open(`${origin}/account`, "thread-atlas", "atlas");
      expect(tab.url === `${origin}/account`, `Atlas landed on ${tab.url}`);
    });
  } finally {
    await service.destroy();
  }
}

const profilesRoot = await mkdtemp(join(tmpdir(), "markas-browser-check-"));
const browsersRoot = resolveHostPaths().browsersRoot;
try {
  const system = new SystemBrowserFinder({ browsersRoot });
  const only = /--only=(\w+)/.exec(process.argv.join(" "))?.[1];
  const installed = system
    .installed()
    .filter((target) => !only || (target.kind === "channel" && target.channel === only));
  const chosen: BrowserFinder = {
    installed: () => installed,
    downloaded: () => system.downloaded(),
    download: () => system.download(),
  };
  console.log(
    `Installed browsers Markas can drive: ${installed.map((target) => target.label).join(", ") || "none"}`,
  );
  await signInFlow(chosen, installed[0]?.label ?? "Markas's own Chromium", join(profilesRoot, "a"));

  if (withDownload) {
    // A computer with neither Chrome nor Edge: Markas must fetch and drive its own browser.
    const none = new SystemBrowserFinder({ browsersRoot, exists: () => false });
    visits.clear();
    console.log(`Downloading Chromium to ${browsersRoot} if it is not there yet...`);
    await signInFlow(none, "Markas's own Chromium", join(profilesRoot, "b"));
  }
} finally {
  await site.stop(true);
  await rm(profilesRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
    () => undefined,
  );
}

const failed = results.filter((result) => result.problem);
console.log(
  failed.length === 0
    ? `\nAll ${results.length} browser checks passed.`
    : `\n${failed.length} of ${results.length} browser checks failed.`,
);
process.exit(failed.length === 0 ? 0 : 1);
