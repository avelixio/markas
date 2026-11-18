// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { LogbookStore } from "../backend/logbook/logbook-store";
import type { LocalModelServers } from "../backend/providers/local-models";
import type { OpenCodeConnect } from "../backend/providers/opencode-connect";
import { createProviderMethods } from "./provider-methods";

function harness(overrides: { saveKey?: () => Promise<void> } = {}) {
  const records: Array<[string, string, string]> = [];
  const logbook = {
    record: vi.fn(async (action: string, target: string, outcome: string) => {
      records.push([action, target, outcome]);
    }),
  } as unknown as LogbookStore;
  const local = {
    scan: vi.fn(async () => []),
    connect: vi.fn(async (id: string) => ({ id, connected: true })),
    disconnect: vi.fn(async () => undefined),
  } as unknown as LocalModelServers;
  const openCode = {
    providers: vi.fn(async () => []),
    startSignIn: vi.fn(async () => ({ url: "https://auth.example.com", finish: "wait" })),
    finishSignIn: vi.fn(async () => true),
    saveKey: vi.fn(overrides.saveKey ?? (async () => undefined)),
    disconnect: vi.fn(async () => undefined),
    cancelSignIn: vi.fn(async () => undefined),
  } as unknown as OpenCodeConnect;
  const refreshModels = vi.fn(async () => []);
  const methods = createProviderMethods({ local, openCode, refreshModels, logbook });
  const call = (name: string, input?: unknown) =>
    (methods[name] as (input: unknown) => Promise<unknown>)(input);
  return { call, records, local, openCode, refreshModels };
}

describe("provider methods", () => {
  it("connects a local model server, writes it in the Logbook and looks at the models again", async () => {
    const { call, records, local, refreshModels } = harness();
    await call("providers.local.connect", { id: "lmstudio" });
    expect(local.connect).toHaveBeenCalledWith("lmstudio");
    expect(records).toEqual([["provider.connected", "lmstudio", "done"]]);
    expect(refreshModels).toHaveBeenCalledTimes(1);
  });

  it("passes a browser sign-in on, with the answers given", async () => {
    const { call, openCode, records } = harness();
    await call("providers.openCode.startSignIn", {
      providerId: "openai",
      method: 1,
      answers: { region: "eu", ignored: 4 },
    });
    expect(openCode.startSignIn).toHaveBeenCalledWith("openai", 1, { region: "eu" });
    // Starting is not connecting: nothing is written yet.
    expect(records).toEqual([]);
    expect(
      await call("providers.openCode.finishSignIn", { providerId: "openai", method: 1 }),
    ).toEqual({
      connected: true,
    });
    expect(openCode.finishSignIn).toHaveBeenCalledWith("openai", 1, undefined);
    expect(records).toEqual([["provider.connected", "openai", "done"]]);
  });

  it("never writes a key in the Logbook, and records a refused one as failed", async () => {
    const { call, records } = harness({
      saveKey: async () => {
        throw new Error("That key was refused.");
      },
    });
    await expect(
      call("providers.openCode.saveKey", { providerId: "zeta", key: "sk-not-a-real-key" }),
    ).rejects.toThrow("That key was refused.");
    expect(records).toEqual([["provider.connected", "zeta", "failed"]]);
    expect(JSON.stringify(records)).not.toContain("sk-not-a-real-key");
  });

  it("refuses a request without a way to sign in or a provider", async () => {
    const { call } = harness();
    await expect(call("providers.openCode.startSignIn", { providerId: "openai" })).rejects.toThrow(
      "Choose a way to sign in.",
    );
    await expect(call("providers.openCode.disconnect", {})).rejects.toThrow();
    await expect(call("providers.local.connect", null)).rejects.toThrow();
  });

  it("keeps a connection that worked even when the models cannot be looked at again", async () => {
    const { call, records, refreshModels } = harness();
    refreshModels.mockRejectedValueOnce(new Error("Codex is not running."));
    await call("providers.openCode.disconnect", { providerId: "anthropic" });
    expect(records).toEqual([["provider.disconnected", "anthropic", "done"]]);
  });

  it("cancels a browser sign-in without writing anything down", async () => {
    const { call, openCode, records } = harness();
    (
      openCode.finishSignIn as unknown as { mockResolvedValueOnce: (v: boolean) => void }
    ).mockResolvedValueOnce(false);
    await call("providers.openCode.cancelSignIn", { providerId: "openai" });
    expect(openCode.cancelSignIn).toHaveBeenCalledWith("openai");
    expect(
      await call("providers.openCode.finishSignIn", { providerId: "openai", method: 0 }),
    ).toEqual({
      connected: false,
    });
    expect(records).toEqual([]);
  });
});
