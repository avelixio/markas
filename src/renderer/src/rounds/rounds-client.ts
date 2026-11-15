import type { Schedule } from "../../../backend/rounds/schedule";
import type { StandingGrant, StandingPermission } from "../../../shared/access";
import { callHost } from "../host-client";

export type { Schedule };
export type OverlapPolicy = "wait" | "skip";
export type RunStatus = "running" | "completed" | "failed" | "missed" | "skipped";

export interface RoundRun {
  id: string;
  roundId: string;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: RunStatus;
  detail: string;
  manual: boolean;
}

export interface RoundSummary {
  id: string;
  name: string;
  botId: string;
  instruction: string;
  schedule: Schedule;
  overlap: OverlapPolicy;
  enabled: boolean;
  createdAt: string;
  nextRunAt: string | null;
  lastRun: RoundRun | null;
  /** What the round may do without asking, every time it runs. */
  standing?: StandingGrant[];
  /** False when the bot's engine cannot honour standing permissions yet. */
  standingApplies?: boolean;
}

export interface RoundDraft {
  name: string;
  botId: string;
  instruction: string;
  schedule: Schedule;
  overlap: OverlapPolicy;
  /** Left out when the person did not touch it, so an edit elsewhere changes nothing here. */
  standing?: StandingPermission[];
}

export const roundsClient = {
  list: () => callHost<RoundSummary[]>("rounds.list"),
  create: (draft: RoundDraft) => callHost<RoundSummary>("rounds.create", draft),
  update: (id: string, patch: Partial<RoundDraft> & { enabled?: boolean }) =>
    callHost<RoundSummary>("rounds.update", { id, ...patch }),
  remove: (id: string) => callHost<void>("rounds.remove", id),
  runNow: (id: string) => callHost<RoundRun>("rounds.runNow", id),
  runs: (roundId: string) => callHost<RoundRun[]>("rounds.runs", { roundId, limit: 50 }),
};
