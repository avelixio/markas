import type { DispatchService } from "../backend/dispatch/dispatch-service";
import { importBotFileText } from "../backend/library/bot-library";
import { type ImportBotFileResult, isEngine, oneLine } from "../shared/bot-draft";
import type { HostMethod } from "./methods";
import { isObject, requireString } from "./parsers";

/** The conversation with Dispatch that makes a new bot, for the web UI. */
export function createDispatchMethods(dispatch: DispatchService): Record<string, HostMethod> {
  return {
    "dispatch.open": () => dispatch.open(),
    "dispatch.say": (input) => {
      const text = isObject(input) ? input.text : input;
      return dispatch.say(requireString(text, "text"));
    },
    "dispatch.redraft": () => dispatch.redraft(),
    "dispatch.move": (input) => {
      const engine = isObject(input) ? input.engine : input;
      if (!isEngine(engine)) throw new Error("Unknown engine.");
      return dispatch.move(engine);
    },
    "dispatch.reset": async () => {
      await dispatch.reset();
    },
    "dispatch.repairFile": async (input): Promise<ImportBotFileResult> => {
      if (!isObject(input)) throw new Error("Send the bot file's text.");
      const text = requireString(input.text, "text");
      const fileName = oneLine(input.fileName).slice(0, 200) || null;
      // A file that reads fine now needs no mending.
      const asIs = importBotFileText(text, fileName);
      if (asIs.ok) return asIs;
      const mended = await dispatch.repairFile(text);
      if (mended.ok) return { ok: true, fileName, draft: mended.draft };
      return { ok: false, fileName, message: mended.message, problems: [] };
    },
  };
}
