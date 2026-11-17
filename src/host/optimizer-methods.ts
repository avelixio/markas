import type { OptimizerStore } from "../backend/optimizer/optimizer-store";
import { type BotSummary, providerOfModel } from "../shared/ipc";
import type { BotContext, OptimizerReport, OptimizerSettings } from "../shared/optimizer";
import type { HostMethod } from "./methods";
import { isObject } from "./parsers";

export interface OptimizerContext {
  store: OptimizerStore;
  bots: () => BotSummary[];
  /** How full each bot's conversation is, for the bots whose engine has said. */
  contextUsage: () => Array<{
    botId: string;
    usedTokens: number;
    contextWindow: number;
    compacting: boolean;
  }>;
  /** Looks for the outside tool that shortens command output. Never installs or runs it on work. */
  findCommandFilter: () => Promise<{ installed: boolean; version: string | null }>;
}

/** The Optimizer page: what keeps the bots' conversations small, and how much it saved. */
export function createOptimizerMethods(context: OptimizerContext): Record<string, HostMethod> {
  return {
    "optimizer.read": async (): Promise<OptimizerReport> => {
      const bots = context.bots();
      const name = (botId: string | null) => bots.find((bot) => bot.id === botId)?.name ?? "";
      const usage = context.contextUsage();
      const totals = context.store.totals();
      return {
        settings: context.store.settings(),
        since: context.store.since(),
        totals,
        measuredTokens: totals.compact.tokens,
        estimatedTokens: totals.trim.tokens,
        perBot: Object.entries(context.store.perBot())
          .map(([botId, tokens]) => ({ botId, name: name(botId), tokens }))
          // A bot that was deleted since has no name to show.
          .filter((row) => row.name !== "")
          .sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name)),
        recent: context.store.recent().map((event) => ({ ...event, botName: name(event.botId) })),
        context: bots.map((bot): BotContext => {
          const reported = usage.find((entry) => entry.botId === bot.id);
          return {
            botId: bot.id,
            name: bot.name,
            engine: providerOfModel(bot.model),
            usedTokens: reported?.usedTokens ?? null,
            contextWindow: reported?.contextWindow ?? null,
            compacting: reported?.compacting ?? false,
          };
        }),
        commandFilter: await context
          .findCommandFilter()
          .catch(() => ({ installed: false, version: null })),
      };
    },
    "optimizer.save": (input): Promise<OptimizerSettings> => {
      if (!isObject(input)) throw new Error("Send what to change.");
      const patch: Partial<OptimizerSettings> = {};
      if (input.autoCompact !== undefined) patch.autoCompact = input.autoCompact as boolean;
      if (input.compactAt !== undefined) patch.compactAt = input.compactAt as number;
      if (input.lean !== undefined) patch.lean = input.lean as boolean;
      return context.store.save(patch);
    },
  };
}
