import type { EngineSetup } from "../backend/setup/engine-setup";
import {
  type AgentProviderId,
  isAgentProvider,
  type SaveSetupStateInput,
  type SetupState,
} from "../shared/ipc";
import type { HostMethod } from "./methods";
import { isObject, requireString } from "./parsers";
import type { SetupStore } from "./setup-store";

export interface SetupMethodsContext {
  store: SetupStore;
  engines: EngineSetup;
  /** Called after a save, so the rest of the host follows what setup now says. */
  applied: (state: SetupState, changed: SaveSetupStateInput) => Promise<void>;
  /** Leaves a line in the Logbook for what setup did to this computer. */
  record?: (action: "engine.installed" | "engine.located", target: string, done: boolean) => void;
}

/**
 * Setup over HTTP: what it remembers, and the things it does to an engine for the person.
 * Signing in is always the engine's own flow. No method here takes, returns or stores a
 * password or a token.
 */
export function createSetupMethods(context: SetupMethodsContext): Record<string, HostMethod> {
  const { store, engines } = context;
  return {
    "setup.getState": () => store.read(),
    "setup.save": async (input) => {
      const patch = parseSave(input);
      const state = await store.save(patch);
      await context.applied(state, patch);
      return state;
    },
    "setup.engineStatus": () => engines.statuses(),
    "setup.installCommand": (input) => engines.installCommand(parseEngine(input)),
    "setup.installEngine": async (input) => {
      const engine = parseEngine(input);
      const result = await engines.install(engine);
      const nothingHappened =
        result.result === "cancelled" ||
        (result.result === "failed" && result.reason === "already-running");
      if (!nothingHappened) {
        context.record?.("engine.installed", engine, result.result === "installed");
      }
      return result;
    },
    "setup.cancelInstall": (input) => ({ cancelled: engines.cancelInstall(parseEngine(input)) }),
    "setup.locateEngine": async (input) => {
      if (!isObject(input)) throw new Error("Invalid locate request.");
      const engine = parseEngine(input);
      const result = await engines.locate(engine, requireString(input.path, "path"));
      context.record?.("engine.located", engine, result.result === "located");
      return result;
    },
    "setup.signIn": (input) => engines.signIn(parseEngine(input)),
    "setup.cancelSignIn": (input) => ({ cancelled: engines.cancelSignIn(parseEngine(input)) }),
    "setup.signInCommand": (input) => engines.signInCommand(parseEngine(input)),
    "setup.listModels": (input) => engines.models(parseEngine(input)),
  };
}

/** The engine a call is about: given by its name, or as `{ engine }`. */
function parseEngine(input: unknown): AgentProviderId {
  const engine = isObject(input) ? input.engine : input;
  if (!isAgentProvider(engine)) throw new Error("Unknown engine.");
  return engine;
}

function parseSave(input: unknown): SaveSetupStateInput {
  if (!isObject(input)) throw new Error("Setup input is required.");
  const patch: SaveSetupStateInput = {};
  // The store checks each value; here only the shape is checked, so a typo is not silently dropped.
  for (const key of [
    "language",
    "preferredProvider",
    "defaultModel",
    "defaultReasoningEffort",
    "step",
  ] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "string") throw new Error(`${key} must be text.`);
    Object.assign(patch, { [key]: input[key] });
  }
  for (const key of ["consent", "completed"] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "boolean") throw new Error(`${key} must be true or false.`);
    patch[key] = input[key];
  }
  return patch;
}
