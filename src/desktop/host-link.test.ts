// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dataRoot,
  findRunningHost,
  isExternalWebUrl,
  isHostUrl,
  waitForHost,
  windowUrl,
} from "./host-link";

const token = "a".repeat(64);
const link = { port: 4780, token };
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-desktop-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("desktop host link", () => {
  it("builds the window address with the token in the fragment", () => {
    expect(windowUrl(link)).toBe(`http://127.0.0.1:4780/#token=${token}`);
  });

  it("keeps the window on the host's own pages", () => {
    expect(isHostUrl("http://127.0.0.1:4780/keyring", link)).toBe(true);
    expect(isHostUrl("http://127.0.0.1:4781/", link)).toBe(false);
    expect(isHostUrl("https://127.0.0.1:4780/", link)).toBe(false);
    expect(isHostUrl("https://example.com/", link)).toBe(false);
    expect(isHostUrl("not a url", link)).toBe(false);
  });

  it("opens only web links outside the app", () => {
    expect(isExternalWebUrl("https://example.com/a")).toBe(true);
    expect(isExternalWebUrl("http://example.com")).toBe(true);
    expect(isExternalWebUrl("file:///etc/passwd")).toBe(false);
    expect(isExternalWebUrl("javascript:alert(1)")).toBe(false);
    expect(isExternalWebUrl("nonsense")).toBe(false);
  });

  it("uses MARKAS_HOME when set", () => {
    expect(dataRoot({ MARKAS_HOME: "/data/markas" })).toBe("/data/markas");
    expect(dataRoot({}).endsWith(".markas")).toBe(true);
  });

  it("finds a host only when its record, token and answer are all good", async () => {
    expect(await findRunningHost(root, async () => true)).toBeNull();
    await writeFile(join(root, "host.json"), JSON.stringify({ port: 4780, pid: 1 }));
    expect(await findRunningHost(root, async () => true)).toBeNull();
    await writeFile(join(root, "token"), "short");
    expect(await findRunningHost(root, async () => true)).toBeNull();
    await writeFile(join(root, "token"), `${token}\n`);
    expect(await findRunningHost(root, async () => false)).toBeNull();
    expect(await findRunningHost(root, async () => true)).toEqual(link);
  });

  it("waits for a host that is still starting, and gives up after the timeout", async () => {
    let calls = 0;
    const found = await waitForHost(root, 2_000, async () => {
      calls += 1;
      return calls >= 3 ? link : null;
    });
    expect(found).toEqual(link);
    expect(await waitForHost(root, 300, async () => null)).toBeNull();
  });
});
