import type {
  AgentModelOption,
  AgentProviderId,
  AgentReasoningEffort,
  SetupStep as HostSetupStep,
  SaveSetupStateInput,
  SetupEngineStatus,
  SetupEvent,
  SetupInstallCommand,
  SetupInstallResult,
  SetupLocateResult,
  SetupModels,
  SetupSignInState,
  SetupState,
} from "../../../shared/ipc";
import { callHost, onHostEvent } from "../host-client";
import type { Language } from "../i18n";

export type EngineId = AgentProviderId;
export const ENGINES: EngineId[] = ["claude", "codex"];

/** What setup can do next for an engine follows from this state alone. */
export type EngineState =
  | "checking"
  | "not-installed"
  | "installing"
  | "sign-in-required"
  | "signing-in"
  | "ready"
  | "outdated"
  | "error";

export interface EngineStatus {
  id: EngineId;
  state: EngineState;
  version: string | null;
  email: string | null;
  /** A plain sentence from the host when something went wrong. */
  message: string | null;
}

export const SETUP_STEPS = [
  "language",
  "engines",
  "model",
  "consent",
  "dispatch",
  "bot",
  "review",
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export interface SetupProgress {
  completed: boolean;
  step: SetupStep;
  language: Language | null;
  preferredProvider: EngineId | null;
  defaultModel: string | null;
  defaultEffort: AgentReasoningEffort | null;
  consentAt: string | null;
}

export type SetupPatch = Partial<Omit<SetupProgress, "completed">> & { completed?: boolean };

export type InstallResult =
  | { ok: true }
  | {
      ok: false;
      reason: "offline" | "permission" | "missing-tool" | "cancelled" | "failed";
      message: string;
    };

export type LocateResult = { ok: true; version: string } | { ok: false; message: string };

export type SignInResult =
  | { ok: true }
  | { ok: false; reason: "timed-out" | "failed"; message: string };

export interface EngineModels {
  models: AgentModelOption[];
  /** True when the engine could not list its models and a built-in list is shown instead. */
  fallback: boolean;
}

/** Everything setup asks of the host. The screens depend on this, not on the host directly. */
export interface SetupClient {
  getState(): Promise<SetupProgress>;
  save(patch: SetupPatch): Promise<SetupProgress>;
  engineStatus(): Promise<EngineStatus[]>;
  installEngine(engine: EngineId): Promise<InstallResult>;
  cancelInstall(engine: EngineId): Promise<void>;
  installCommand(engine: EngineId): Promise<string>;
  locateEngine(engine: EngineId, path: string): Promise<LocateResult>;
  /** Opens the engine's own login and resolves once the person is signed in, or it gave up. */
  signIn(engine: EngineId): Promise<SignInResult>;
  signInCommand(engine: EngineId): Promise<string>;
  listModels(engine: EngineId): Promise<EngineModels>;
}

// ----- The host speaks its own shapes. These turn them into what the screens use. -----

const STEP_FROM_HOST: Record<HostSetupStep, SetupStep> = {
  language: "language",
  "how-bots-run": "engines",
  engines: "engines",
  "default-model": "model",
  consent: "consent",
  dispatch: "dispatch",
  "first-bot": "bot",
  review: "review",
};

const STEP_TO_HOST: Record<SetupStep, HostSetupStep> = {
  language: "language",
  engines: "engines",
  model: "default-model",
  consent: "consent",
  dispatch: "dispatch",
  bot: "first-bot",
  review: "review",
};

export function progressFromHost(state: SetupState): SetupProgress {
  return {
    completed: state.completed,
    step: STEP_FROM_HOST[state.step] ?? "language",
    language: state.language,
    preferredProvider: state.preferredProvider,
    defaultModel: state.defaultModel,
    defaultEffort: state.defaultReasoningEffort,
    consentAt: state.consentAt,
  };
}

/** Only what the patch sets is sent. The host keeps everything else as it is. */
export function patchToHost(patch: SetupPatch): SaveSetupStateInput {
  const out: SaveSetupStateInput = {};
  if (patch.language) out.language = patch.language;
  if (patch.preferredProvider) out.preferredProvider = patch.preferredProvider;
  if (patch.defaultModel)
    out.defaultModel = patch.defaultModel as SaveSetupStateInput["defaultModel"];
  if (patch.defaultEffort) out.defaultReasoningEffort = patch.defaultEffort;
  if (patch.consentAt) out.consent = true;
  if (patch.step) out.step = STEP_TO_HOST[patch.step];
  if (patch.completed !== undefined) out.completed = patch.completed;
  return out;
}

export function statusFromHost(status: SetupEngineStatus): EngineStatus {
  const state: EngineState =
    status.state === "signed-in"
      ? "ready"
      : status.state === "not-signed-in"
        ? "sign-in-required"
        : status.state;
  return {
    id: status.engine,
    state,
    version: status.version,
    email: status.email,
    message: status.message,
  };
}

export function installFromHost(result: SetupInstallResult): InstallResult {
  if (result.result === "installed") return { ok: true };
  if (result.result === "cancelled") return { ok: false, reason: "cancelled", message: "" };
  const reason =
    result.reason === "no-internet"
      ? "offline"
      : result.reason === "no-permission"
        ? "permission"
        : result.reason === "node-missing"
          ? "missing-tool"
          : "failed";
  return { ok: false, reason, message: result.message };
}

export function locateFromHost(result: SetupLocateResult): LocateResult {
  return result.result === "located"
    ? { ok: true, version: result.version }
    : { ok: false, message: result.message };
}

export function signInFromHost(state: SetupSignInState): SignInResult {
  if (state.state === "signed-in") return { ok: true };
  return {
    ok: false,
    reason: state.state === "timed-out" ? "timed-out" : "failed",
    message: state.message ?? "",
  };
}

/**
 * Starts the engine's own sign-in and waits for the host to say how it ended.
 * The host answers at once with "waiting" and reports the end on its event stream.
 */
async function signIn(engine: EngineId): Promise<SignInResult> {
  let settle: (state: SetupSignInState) => void = () => undefined;
  const ended = new Promise<SetupSignInState>((resolve) => {
    settle = resolve;
  });
  const stop = onHostEvent<SetupEvent>("setup", (event) => {
    if (event.type === "sign-in" && event.engine === engine && event.state !== "waiting") {
      settle(event);
    }
  });
  try {
    const first = await callHost<SetupSignInState>("setup.signIn", engine);
    return signInFromHost(first.state === "waiting" ? await ended : first);
  } finally {
    stop();
  }
}

export const setupClient: SetupClient = {
  getState: async () => progressFromHost(await callHost<SetupState>("setup.getState")),
  save: async (patch) =>
    progressFromHost(await callHost<SetupState>("setup.save", patchToHost(patch))),
  engineStatus: async () =>
    (await callHost<SetupEngineStatus[]>("setup.engineStatus")).map(statusFromHost),
  installEngine: async (engine) =>
    installFromHost(await callHost<SetupInstallResult>("setup.installEngine", engine)),
  cancelInstall: async (engine) => {
    await callHost("setup.cancelInstall", engine);
  },
  installCommand: async (engine) =>
    (await callHost<SetupInstallCommand>("setup.installCommand", engine)).command,
  locateEngine: async (engine, path) =>
    locateFromHost(await callHost<SetupLocateResult>("setup.locateEngine", { engine, path })),
  signIn,
  signInCommand: async (engine) =>
    (await callHost<{ command: string }>("setup.signInCommand", engine)).command,
  listModels: async (engine) => {
    const listed = await callHost<SetupModels>("setup.listModels", engine);
    return { models: listed.models, fallback: listed.fallback };
  },
};

export const engineName = (engine: EngineId): string =>
  engine === "claude" ? "Claude Code" : "Codex";
