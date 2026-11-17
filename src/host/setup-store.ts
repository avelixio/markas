import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  AGENT_PROVIDERS,
  type AgentModelId,
  type AgentProviderId,
  type AgentReasoningEffort,
  isAgentModel,
  isAgentProvider,
  isReasoningEffort,
  providerOfModel,
  type SaveSetupStateInput,
  SETUP_LANGUAGES,
  SETUP_STEPS,
  type SetupLanguage,
  type SetupState,
  type SetupStep,
} from "../shared/ipc";

/** The setup file as written since the guided setup: everything setup remembers. */
interface StoredSetup {
  version: 3;
  language: SetupLanguage | null;
  preferredProvider: AgentProviderId | null;
  defaultModel: AgentModelId | null;
  defaultReasoningEffort: AgentReasoningEffort | null;
  consentAt: string | null;
  step: SetupStep;
  completedAt: string | null;
  enginePaths: Partial<Record<AgentProviderId, string>>;
}

const FIRST_STEP: SetupStep = SETUP_STEPS[0];
const LAST_STEP: SetupStep = SETUP_STEPS[SETUP_STEPS.length - 1] ?? FIRST_STEP;

const emptySetup = (): StoredSetup => ({
  version: 3,
  language: null,
  preferredProvider: null,
  defaultModel: null,
  defaultReasoningEffort: null,
  consentAt: null,
  step: FIRST_STEP,
  completedAt: null,
  enginePaths: {},
});

export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}

/**
 * What setup remembers, in one small file that is rewritten atomically.
 * A file from before the guided setup (version 2: only the chosen engine) is read as a
 * finished setup, and becomes a version 3 file the first time something is saved.
 */
export class SetupStore {
  readonly #path: string;
  #writeQueue: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  async read(): Promise<SetupState> {
    return toState(await this.#load());
  }

  /**
   * Changes what was given and leaves the rest. Refuses to finish a setup that is not ready:
   * it needs a language, an engine and the consent.
   */
  save(patch: SaveSetupStateInput, now: Date = new Date()): Promise<SetupState> {
    return this.#change((stored) => {
      const next = { ...stored, ...validatePatch(patch) };
      if (patch.consent !== undefined) {
        next.consentAt = patch.consent ? (stored.consentAt ?? now.toISOString()) : null;
      }
      // A default model belongs to one engine. Choosing it also settles which engine is preferred.
      if (next.defaultModel && patch.defaultModel && patch.preferredProvider === undefined) {
        next.preferredProvider = providerOfModel(next.defaultModel);
      }
      if (patch.completed === true) {
        if (!next.preferredProvider) throw new SetupError("Connect an engine before finishing.");
        if (!next.language) throw new SetupError("Choose a language before finishing.");
        if (!next.consentAt) {
          throw new SetupError("Setup cannot finish before the consent step.");
        }
        next.completedAt = stored.completedAt ?? now.toISOString();
        next.step = LAST_STEP;
      } else if (patch.completed === false) {
        next.completedAt = null;
      }
      return next;
    });
  }

  /** Remembers a program the person pointed Markas at, or forgets it when the path is null. */
  rememberEnginePath(engine: AgentProviderId, path: string | null): Promise<SetupState> {
    return this.#change((stored) => {
      const enginePaths = { ...stored.enginePaths };
      if (path) enginePaths[engine] = path;
      else delete enginePaths[engine];
      return { ...stored, enginePaths };
    });
  }

  #change(update: (stored: StoredSetup) => StoredSetup): Promise<SetupState> {
    // One change at a time, so two saves cannot lose each other's fields.
    const change = this.#writeQueue.then(async () => {
      const next = update(await this.#load());
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(next)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.#path);
      return toState(next);
    });
    this.#writeQueue = change.catch(() => undefined);
    return change;
  }

  async #load(): Promise<StoredSetup> {
    try {
      return migrate(JSON.parse(await readFile(this.#path, "utf8")));
    } catch (error) {
      if (isMissing(error) || error instanceof SyntaxError) return emptySetup();
      throw error;
    }
  }
}

/** Reads any version of the file into the current shape. Anything unknown starts setup over. */
function migrate(parsed: unknown): StoredSetup {
  if (typeof parsed !== "object" || parsed === null) return emptySetup();
  const file = parsed as Record<string, unknown>;
  if (file.version === 2) {
    if (!isProvider(file.preferredProvider) || typeof file.completedAt !== "string") {
      return emptySetup();
    }
    // Version 2 was written only when the old setup was finished. It never asked for a
    // language, a model or consent, so those stay empty and are not made up.
    return {
      ...emptySetup(),
      preferredProvider: file.preferredProvider,
      step: LAST_STEP,
      completedAt: file.completedAt,
    };
  }
  if (file.version !== 3) return emptySetup();
  const paths =
    typeof file.enginePaths === "object" && file.enginePaths !== null ? file.enginePaths : {};
  const enginePaths: StoredSetup["enginePaths"] = {};
  for (const engine of AGENT_PROVIDERS) {
    const path = (paths as Record<string, unknown>)[engine];
    if (typeof path === "string" && path) enginePaths[engine] = path;
  }
  return {
    version: 3,
    language: isLanguage(file.language) ? file.language : null,
    preferredProvider: isProvider(file.preferredProvider) ? file.preferredProvider : null,
    defaultModel: isAgentModel(file.defaultModel) ? file.defaultModel : null,
    defaultReasoningEffort: isReasoningEffort(file.defaultReasoningEffort)
      ? file.defaultReasoningEffort
      : null,
    consentAt: typeof file.consentAt === "string" ? file.consentAt : null,
    step: isStep(file.step) ? file.step : FIRST_STEP,
    completedAt: typeof file.completedAt === "string" ? file.completedAt : null,
    enginePaths,
  };
}

function validatePatch(patch: SaveSetupStateInput): Partial<StoredSetup> {
  const fields: Partial<StoredSetup> = {};
  if (patch.language !== undefined) {
    if (!isLanguage(patch.language)) throw new SetupError("Unknown language.");
    fields.language = patch.language;
  }
  if (patch.preferredProvider !== undefined) {
    if (!isProvider(patch.preferredProvider)) throw new SetupError("Unknown provider.");
    fields.preferredProvider = patch.preferredProvider;
  }
  if (patch.defaultModel !== undefined) {
    if (!isAgentModel(patch.defaultModel)) throw new SetupError("Unknown model.");
    fields.defaultModel = patch.defaultModel;
  }
  if (patch.defaultReasoningEffort !== undefined) {
    if (!isReasoningEffort(patch.defaultReasoningEffort)) {
      throw new SetupError("Unknown reasoning effort.");
    }
    fields.defaultReasoningEffort = patch.defaultReasoningEffort;
  }
  if (patch.step !== undefined) {
    if (!isStep(patch.step)) throw new SetupError("Unknown setup step.");
    fields.step = patch.step;
  }
  return fields;
}

function toState(stored: StoredSetup): SetupState {
  return {
    completed: stored.completedAt !== null,
    language: stored.language,
    preferredProvider: stored.preferredProvider,
    defaultModel: stored.defaultModel,
    defaultReasoningEffort: stored.defaultReasoningEffort,
    consentAt: stored.consentAt,
    step: stored.step,
    enginePaths: { ...stored.enginePaths },
  };
}

const isProvider = isAgentProvider;
const isLanguage = (value: unknown): value is SetupLanguage =>
  SETUP_LANGUAGES.includes(value as SetupLanguage);
const isStep = (value: unknown): value is SetupStep => SETUP_STEPS.includes(value as SetupStep);

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
