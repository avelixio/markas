// Browser end-to-end test: a real browser clicks through the real web UI on a real host.
//
//   bun run build:ui && node scripts/e2e-ui.mjs [folder for screenshots]
//
// Uses the Chromium that Playwright finds, or Microsoft Edge with MARKAS_E2E_CHANNEL=msedge.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { chromium } from "playwright-core";

const shots = process.argv[2] ?? null;
if (shots) mkdirSync(shots, { recursive: true });
const steps = [];
const step = (name) => {
  steps.push(name);
  console.log(`  ok  ${name}`);
};

const host = spawn("bun", ["scripts/demo-host.ts"], {
  stdio: ["pipe", "pipe", "inherit"],
  // On Windows bun may be a command shim, which only a shell can start.
  shell: process.platform === "win32",
});
const { url, token } = JSON.parse(
  await new Promise((resolve, reject) => {
    createInterface({ input: host.stdout }).once("line", resolve);
    host.once("exit", (code) => reject(new Error(`The demo host stopped with code ${code}.`)));
  }),
);

const browser = await chromium.launch(
  process.env.MARKAS_E2E_CHANNEL ? { channel: process.env.MARKAS_E2E_CHANNEL } : {},
);
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const shot = async (name) => {
    if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
  };
  const area = (name) => page.getByRole("navigation").getByRole("button", { name, exact: true });

  await page.goto(`${url}/#token=${token}`);
  await page.waitForSelector('[data-component="Shell"]');
  for (const name of ["Chats", "Rounds", "Keyring", "Switchboard", "Archive", "Logbook"]) {
    await area(name).waitFor();
  }
  await shot("1-chats");
  step("signs in with the token and shows all six areas");

  await page.getByRole("button", { name: "Continue with Codex" }).click();
  await page.getByRole("button", { name: "Continue with Codex" }).waitFor({ state: "detached" });
  await shot("1b-after-setup");
  step("finishes first-run setup by choosing the engine");

  // A bot to work with, made through the same API the interface uses.
  const bot = await page.evaluate(() => window.markas.agent.createBot());
  assert.ok(bot.id);

  await area("Keyring").click();
  await page.getByText("No keys yet").waitFor();
  const addKey = async (name, site) => {
    await page.getByRole("button", { name: "Add key" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#key-name").fill(name);
    await dialog.locator("#key-origin").fill(site);
    await dialog.locator("#key-username").fill("sam@example.com");
    await dialog.locator("#key-value").fill(`${name}-password-123`);
    await dialog.getByRole("button", { name: "Save key" }).click();
    await dialog.waitFor({ state: "detached" });
  };
  await addKey("metrics", "metrics.example.com");
  await addKey("admin", "admin.example.com");
  assert.equal(await page.locator("tbody tr").count(), 2);
  await shot("2-keyring");
  step("saves two logins on sibling sites as two separate keys");

  await area("Rounds").click();
  await page.getByText("No rounds yet").waitFor();
  await shot("3-rounds-empty");
  await page.getByRole("button", { name: "New round" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#round-name").fill("Morning stock check");
  await dialog.locator("#round-instruction").fill("Check stock levels and report anything low.");
  await shot("4-round-form");
  await dialog.getByRole("button", { name: "Save round" }).click();
  await dialog.waitFor({ state: "detached" });
  const row = page.locator('tr[data-round="Morning stock check"]');
  await row.waitFor();
  assert.match(await row.innerText(), /at 09:00/);
  step("adds a round from the form");

  await page.getByRole("button", { name: "Run Morning stock check now" }).click();
  await page.getByRole("button", { name: "Morning stock check", exact: true }).click();
  const history = page.getByRole("region", { name: "Run history" });
  await history.getByText("Started by you").waitFor();
  // The page refreshes on a timer; ask sooner by reopening the history.
  await assertEventually(async () => {
    await page.getByRole("button", { name: "Morning stock check", exact: true }).click();
    await page.getByRole("button", { name: "Morning stock check", exact: true }).click();
    await history.waitFor();
    return (await history.innerText()).includes("Completed");
  });
  await shot("5-round-ran");
  step("runs the round now and shows the run as completed");

  await page.getByText("Next 7 days").click();
  await page.locator('[data-slot="calendar"]').getByText("Morning stock check").first().waitFor();
  await shot("6-rounds-calendar");
  await page.locator('[data-slot="view"]').getByText("List").click();
  await page.getByRole("button", { name: "Pause Morning stock check" }).click();
  await row.getByText("Paused").waitFor();
  step("shows the coming week and pauses the round");

  await area("Chats").click();
  await page.getByText("Stock looks fine. Nothing is low.").first().waitFor();
  await shot("7-chat-after-round");
  step("shows the round's message and the bot's reply in the chat");

  await area("Logbook").click();
  const logbook = page.locator('[data-component="LogbookPage"]');
  for (const line of [
    "Added a key",
    "Added a round",
    "Started a round by hand",
    "Changed a round",
  ]) {
    await logbook.getByText(line).first().waitFor();
  }
  assert.ok(!(await logbook.innerText()).includes("password-123"));
  await shot("8-logbook");
  step("records each of those actions in the logbook, without any secret");

  await area("Archive").click();
  await page.getByText("No files yet").waitFor();
  await area("Switchboard").click();
  await page.getByText("Not built yet").waitFor();
  await shot("9-switchboard");
  step("opens Archive, and says plainly that Switchboard is not built");

  await page.getByLabel("Language").selectOption("id");
  await area("Ronde").click();
  await page.getByRole("heading", { name: "Ronde", level: 1 }).waitFor();
  await page.locator('tr[data-round="Morning stock check"]').getByText("Dijeda").waitFor();
  await shot("10-rounds-indonesian");
  await page.reload();
  await page.waitForSelector('[data-component="Shell"]');
  assert.equal(await page.locator("html").getAttribute("lang"), "id");
  step("switches to Bahasa Indonesia and keeps it after a reload");

  assert.deepEqual(errors, [], "the page raised no errors");
  step("raises no page errors");
} catch (error) {
  if (shots)
    await browser
      .contexts()[0]
      ?.pages()[0]
      ?.screenshot({ path: `${shots}/failure.png` });
  throw error;
} finally {
  await browser.close();
  host.stdin.end();
}
console.log(`\nbrowser end-to-end: ${steps.length} steps passed`);

async function assertEventually(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error("Timed out waiting for the interface.");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
