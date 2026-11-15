// @vitest-environment node

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SetupError, SetupStore } from "./setup-store";

/** Whether setup is done, and with which engine. */
async function readSetupState(path: string) {
  const state = await new SetupStore(path).read();
  return { completed: state.completed, preferredProvider: state.preferredProvider };
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const EMPTY = {
  completed: false,
  language: null,
  preferredProvider: null,
  defaultModel: null,
  defaultReasoningEffort: null,
  consentAt: null,
  step: "language",
  enginePaths: {},
};

describe("setup store", () => {
  it("returns incomplete setup when the v2 file is missing", async () => {
    const root = await temporaryRoot();
    await expect(readSetupState(join(root, "markas-setup-v2.json"))).resolves.toEqual({
      completed: false,
      preferredProvider: null,
    });
  });

  it("does not accept the old consent file shape", async () => {
    const root = await temporaryRoot();
    const path = join(root, "markas-setup-v2.json");
    await writeFile(path, '{"version":1,"acceptedAt":"2026-01-01T00:00:00.000Z"}\n');
    await expect(readSetupState(path)).resolves.toEqual({
      completed: false,
      preferredProvider: null,
    });
  });
});

describe("setup store, version 3", () => {
  it("starts empty at the first step", async () => {
    const store = new SetupStore(join(await temporaryRoot(), "setup.json"));
    expect(await store.read()).toEqual(EMPTY);
  });

  it("starts over on a file it cannot read, instead of failing", async () => {
    const path = join(await temporaryRoot(), "setup.json");
    await writeFile(path, "{ not json");
    expect(await new SetupStore(path).read()).toEqual(EMPTY);
    await writeFile(path, '{"version":9,"completedAt":"2026-01-01T00:00:00.000Z"}');
    expect(await new SetupStore(path).read()).toEqual(EMPTY);
  });

  it("treats a version 2 file as a finished setup and makes nothing up", async () => {
    const path = join(await temporaryRoot(), "setup.json");
    await writeFile(
      path,
      '{"version":2,"preferredProvider":"claude","completedAt":"2026-10-01T08:00:00.000Z"}\n',
    );
    const store = new SetupStore(path);

    expect(await store.read()).toEqual({
      ...EMPTY,
      completed: true,
      preferredProvider: "claude",
      step: "review",
    });
    // Reading does not rewrite the file.
    expect(JSON.parse(await readFile(path, "utf8")).version).toBe(2);
    await expect(readSetupState(path)).resolves.toEqual({
      completed: true,
      preferredProvider: "claude",
    });

    // The first save turns it into a version 3 file and keeps when it was finished.
    expect(await store.save({ language: "id" })).toMatchObject({
      completed: true,
      language: "id",
      preferredProvider: "claude",
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      version: 3,
      language: "id",
      preferredProvider: "claude",
      completedAt: "2026-10-01T08:00:00.000Z",
      consentAt: null,
    });
  });

  it("does not accept a version 2 file that was never finished", async () => {
    const path = join(await temporaryRoot(), "setup.json");
    await writeFile(path, '{"version":2,"preferredProvider":"other","completedAt":"x"}');
    expect(await new SetupStore(path).read()).toEqual(EMPTY);
  });

  it("remembers each step as the person goes, so setup resumes where they left", async () => {
    const path = join(await temporaryRoot(), "setup.json");
    const store = new SetupStore(path);
    const agreed = new Date("2026-11-12T09:30:00.000Z");

    await store.save({ language: "id", step: "how-bots-run" });
    await store.save({ step: "engines" });
    await store.save({
      defaultModel: "claude-sonnet-5",
      defaultReasoningEffort: "high",
      step: "consent",
    });
    await store.save({ consent: true, step: "dispatch" }, agreed);

    // A new host process reads the same thing.
    expect(await new SetupStore(path).read()).toEqual({
      completed: false,
      language: "id",
      // Choosing a model settles which engine is preferred.
      preferredProvider: "claude",
      defaultModel: "claude-sonnet-5",
      defaultReasoningEffort: "high",
      consentAt: agreed.toISOString(),
      step: "dispatch",
      enginePaths: {},
    });
  });

  it("keeps the first consent time, and takes consent back when asked", async () => {
    const store = new SetupStore(join(await temporaryRoot(), "setup.json"));
    const first = new Date("2026-11-12T09:30:00.000Z");
    await store.save({ consent: true }, first);
    const again = await store.save({ consent: true }, new Date("2026-11-13T09:30:00.000Z"));
    expect(again.consentAt).toBe(first.toISOString());
    expect((await store.save({ consent: false })).consentAt).toBeNull();
  });

  it("finishes only with a language, an engine and the consent", async () => {
    const store = new SetupStore(join(await temporaryRoot(), "setup.json"));
    await expect(store.save({ completed: true })).rejects.toThrow("Connect an engine");
    await store.save({ preferredProvider: "codex" });
    await expect(store.save({ completed: true })).rejects.toThrow("Choose a language");
    await store.save({ language: "en" });
    await expect(store.save({ completed: true })).rejects.toThrow(SetupError);
    expect((await store.read()).completed).toBe(false);

    const done = await store.save({ consent: true, completed: true });
    expect(done).toMatchObject({ completed: true, step: "review", preferredProvider: "codex" });
    // Setup can be opened again from settings.
    expect((await store.save({ completed: false, step: "engines" })).completed).toBe(false);
  });

  it("refuses values it does not know and changes nothing", async () => {
    const store = new SetupStore(join(await temporaryRoot(), "setup.json"));
    await store.save({ language: "en" });
    const bad = [
      { language: "fr" },
      { preferredProvider: "other" },
      { defaultModel: "some-model" },
      { defaultReasoningEffort: "extreme" },
      { step: "the-end" },
    ];
    for (const patch of bad) {
      await expect(store.save(patch as never)).rejects.toThrow(SetupError);
    }
    expect(await store.read()).toEqual({ ...EMPTY, language: "en" });
  });

  it("remembers and forgets where an engine's program is", async () => {
    const path = join(await temporaryRoot(), "setup.json");
    const store = new SetupStore(path);
    await store.rememberEnginePath("claude", "/apps/claude");
    await store.save({ language: "en" });
    expect((await new SetupStore(path).read()).enginePaths).toEqual({ claude: "/apps/claude" });
    expect((await store.rememberEnginePath("claude", null)).enginePaths).toEqual({});
  });

  it("does not lose a field when two saves arrive together, and leaves no half-written file", async () => {
    const root = await temporaryRoot();
    const store = new SetupStore(join(root, "setup.json"));
    await Promise.all([
      store.save({ language: "id" }),
      store.save({ preferredProvider: "claude" }),
      store.rememberEnginePath("codex", "/apps/codex"),
    ]);
    expect(await store.read()).toMatchObject({
      language: "id",
      preferredProvider: "claude",
      enginePaths: { codex: "/apps/codex" },
    });
    expect(await readdir(root)).toEqual(["setup.json"]);
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "markas-setup-"));
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}
