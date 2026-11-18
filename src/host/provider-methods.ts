import type { LogbookStore } from "../backend/logbook/logbook-store";
import type { LocalModelServers } from "../backend/providers/local-models";
import type { OpenCodeConnect } from "../backend/providers/opencode-connect";
import type { HostMethod } from "./methods";
import { isObject, requireString } from "./parsers";

export interface ProviderMethodsContext {
  local: LocalModelServers;
  openCode: OpenCodeConnect;
  /** Reads every engine's models again, so a connected provider shows in the model lists. */
  refreshModels: () => Promise<unknown>;
  logbook: LogbookStore;
}

/**
 * The Providers part of the Switchboard: what was found on this computer, and Connect.
 * Sign-ins and keys go to the engine that uses them; Markas keeps none of them, and the
 * Logbook gets only the provider's name.
 */
export function createProviderMethods(context: ProviderMethodsContext): Record<string, HostMethod> {
  const { local, openCode, logbook } = context;
  const noted = async <T>(
    action: "provider.connected" | "provider.disconnected",
    target: string,
    run: () => Promise<T>,
  ): Promise<T> => {
    try {
      const result = await run();
      await logbook.record(action, target, "done").catch(() => undefined);
      // A provider that changed changes the model lists; a failed refresh does not undo it.
      await context.refreshModels().catch(() => undefined);
      return result;
    } catch (error) {
      await logbook.record(action, target, "failed").catch(() => undefined);
      throw error;
    }
  };

  return {
    "providers.local.scan": () => local.scan(),
    "providers.local.connect": async (input) => {
      const id = requireString(field(input, "id"), "id");
      return noted("provider.connected", id, () => local.connect(id));
    },
    "providers.local.disconnect": async (input) => {
      const id = requireString(field(input, "id"), "id");
      return noted("provider.disconnected", id, () => local.disconnect(id));
    },
    "providers.openCode.list": () => openCode.providers(),
    "providers.openCode.startSignIn": async (input) =>
      openCode.startSignIn(
        requireString(field(input, "providerId"), "providerId"),
        method(input),
        answers(input),
      ),
    "providers.openCode.finishSignIn": async (input) => {
      const providerId = requireString(field(input, "providerId"), "providerId");
      const code = field(input, "code");
      let connected: boolean;
      try {
        connected = await openCode.finishSignIn(
          providerId,
          method(input),
          typeof code === "string" && code.trim() ? code : undefined,
        );
      } catch (error) {
        await logbook.record("provider.connected", providerId, "failed").catch(() => undefined);
        throw error;
      }
      // A sign-in the person cancelled is not written down: nothing happened.
      if (connected) {
        await logbook.record("provider.connected", providerId, "done").catch(() => undefined);
        await context.refreshModels().catch(() => undefined);
      }
      return { connected };
    },
    "providers.openCode.cancelSignIn": async (input) => {
      await openCode.cancelSignIn(requireString(field(input, "providerId"), "providerId"));
      return null;
    },
    "providers.openCode.saveKey": async (input) => {
      const providerId = requireString(field(input, "providerId"), "providerId");
      // The key is passed on and dropped; it is never logged or kept here.
      const key = requireString(field(input, "key"), "key");
      return noted("provider.connected", providerId, () => openCode.saveKey(providerId, key));
    },
    "providers.openCode.disconnect": async (input) => {
      const providerId = requireString(field(input, "providerId"), "providerId");
      return noted("provider.disconnected", providerId, () => openCode.disconnect(providerId));
    },
  };
}

const field = (input: unknown, key: string): unknown => (isObject(input) ? input[key] : undefined);

function method(input: unknown): number {
  const value = field(input, "method");
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 50) {
    throw new Error("Choose a way to sign in.");
  }
  return value;
}

function answers(input: unknown): Record<string, string> {
  const given = field(input, "answers");
  if (!isObject(given)) return {};
  return Object.fromEntries(
    Object.entries(given)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .slice(0, 20)
      .map(([key, value]) => [key.slice(0, 100), value.slice(0, 2_000)]),
  );
}
