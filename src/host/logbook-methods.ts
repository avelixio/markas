import type { LogbookAction, LogbookStore } from "../backend/logbook/logbook-store";
import { describeStanding } from "../backend/rounds/standing";
import type { StandingGrant } from "../shared/access";
import type { HostMethod } from "./methods";
import { isObject } from "./parsers";

interface Names {
  botName: (id: string) => string;
  keyName: (id: string) => string;
  roundName: (id: string) => string;
}

type Describe = (input: unknown, result: unknown, names: Names) => string;

const field = (value: unknown, key: string): string => {
  const found = isObject(value) ? value[key] : undefined;
  return typeof found === "string" ? found : "";
};

/**
 * The host actions worth a line in the logbook, and how to name what they acted on.
 * Only names are recorded: never a message, a key's value or any other input.
 */
interface Recorded {
  action: LogbookAction;
  target: Describe;
  before?: boolean;
}

/** What a round may now do without asking, as one line. Empty when the call did not say. */
const standingLine: Describe = (input, result) => {
  if (!isObject(input) || input.standing === undefined) return "";
  const standing = isObject(result) && Array.isArray(result.standing) ? result.standing : [];
  const list = (standing as StandingGrant[]).map(describeStanding).join("; ");
  return `${field(result, "name")}: ${list || "nothing"}`;
};

/** A second line some methods can leave, when one call can mean two different things. */
const ALSO_RECORDED: Record<string, Recorded> = {
  // Giving a round permission in advance is worth its own line, with exactly what was given.
  "rounds.create": {
    action: "round.standing-set",
    // A new round that was given nothing needs no line saying so.
    target: (input, result, names) =>
      isObject(input) && Array.isArray(input.standing) && input.standing.length > 0
        ? standingLine(input, result, names)
        : "",
  },
  "rounds.update": { action: "round.standing-set", target: standingLine },
  // Changing how much a bot may do alone is worth its own line, with the new level.
  "agent.updateBot": {
    action: "bot.access",
    target: (input, result) =>
      field(input, "access") ? `${field(result, "name")}: ${field(input, "access")}` : "",
  },
};

const RECORDED: Record<string, Recorded> = {
  "agent.createBot": { action: "bot.created", target: (_input, result) => field(result, "name") },
  // A draft that was turned away for its folder made no bot, so it leaves no line.
  "agent.createBotFromDraft": {
    action: "bot.created",
    target: (_input, result) => field(isObject(result) ? result.bot : null, "name"),
  },
  "agent.updateBot": {
    action: "bot.renamed",
    target: (input, result) => (field(input, "name") ? field(result, "name") : ""),
  },
  // The name is read before the call, because afterwards the bot is gone.
  "agent.deleteBot": {
    action: "bot.deleted",
    target: (input, _result, names) => names.botName(String(input)),
    before: true,
  },
  "agent.restoreBot": {
    action: "bot.restored",
    target: (input, _result, names) => names.botName(String(input)),
    before: true,
  },
  "agent.purgeBot": {
    action: "bot.purged",
    target: (input, _result, names) => names.botName(String(input)),
    before: true,
  },
  "keyring.create": { action: "key.created", target: (_input, result) => field(result, "name") },
  "keyring.update": { action: "key.changed", target: (_input, result) => field(result, "name") },
  "keyring.share": { action: "key.shared", target: (_input, result) => field(result, "name") },
  "keyring.reveal": {
    action: "key.shown",
    target: (input, _result, names) => names.keyName(String(input)),
    before: true,
  },
  "keyring.remove": {
    action: "key.removed",
    target: (input, _result, names) => names.keyName(String(input)),
    before: true,
  },
  "rounds.create": { action: "round.created", target: (_input, result) => field(result, "name") },
  "rounds.update": { action: "round.changed", target: (_input, result) => field(result, "name") },
  "rounds.runNow": {
    action: "round.started",
    target: (input, _result, names) => names.roundName(String(input)),
    before: true,
  },
  "rounds.remove": {
    action: "round.removed",
    target: (input, _result, names) => names.roundName(String(input)),
    before: true,
  },
  // Moving from one setup step to the next is not worth a line; a choice or the finish is.
  "setup.save": {
    action: "setup.saved",
    target: (input) =>
      field(input, "defaultModel") ||
      field(input, "preferredProvider") ||
      (isObject(input) && input.completed === true ? "finished" : ""),
  },
};

/**
 * Wraps host methods so the ones that matter leave a line in the logbook, whether they
 * succeed or fail, and adds the method that reads it.
 */
export function withLogbook(
  methods: Record<string, HostMethod>,
  logbook: LogbookStore,
  names: Names,
): Record<string, HostMethod> {
  const wrapped: Record<string, HostMethod> = { ...methods };
  for (const [name, recorded] of Object.entries(RECORDED)) {
    const method = methods[name];
    if (!method) continue;
    wrapped[name] = async (input) => {
      const known = recorded.before ? recorded.target(input, null, names) : "";
      try {
        const result = await method(input);
        const target = recorded.before ? known : recorded.target(input, result, names);
        // An update that did not touch what this action is about is not worth a line.
        if (target) await logbook.record(recorded.action, target, "done");
        const also = ALSO_RECORDED[name];
        const alsoTarget = also?.target(input, result, names);
        if (also && alsoTarget) await logbook.record(also.action, alsoTarget, "done");
        return result;
      } catch (error) {
        const target = known || recorded.target(input, null, names) || field(input, "name");
        if (target) await logbook.record(recorded.action, target, "failed");
        throw error;
      }
    };
  }
  wrapped["logbook.list"] = (input) =>
    logbook.list(isObject(input) && typeof input.limit === "number" ? input.limit : undefined);
  return wrapped;
}
