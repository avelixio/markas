import { callHost } from "../host-client";

export type KeyKind = "login" | "token" | "variable";
export type FillPolicy = "auto" | "ask" | "handoff";

export const KEY_KINDS: KeyKind[] = ["login", "token", "variable"];
export const FILL_POLICIES: FillPolicy[] = ["auto", "ask", "handoff"];

/** A key as the host lists it: everything except its secret values. */
export interface KeySummary {
  id: string;
  name: string;
  kind: KeyKind;
  origin: string | null;
  username: string | null;
  variable: string | null;
  hasTwoStepCode: boolean;
  fillPolicy: FillPolicy;
  sharedWith: string[];
  note: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface KeyDraft {
  name: string;
  kind: KeyKind;
  origin?: string;
  username?: string;
  variable?: string;
  value?: string;
  twoStepSeed?: string;
  fillPolicy: FillPolicy;
  sharedWith: string[];
}

export const keyringClient = {
  list: () => callHost<KeySummary[]>("keyring.list"),
  create: (draft: KeyDraft) => callHost<KeySummary>("keyring.create", draft),
  update: (id: string, draft: Partial<KeyDraft>) =>
    callHost<KeySummary>("keyring.update", { ...draft, id }),
  remove: (id: string) => callHost<void>("keyring.remove", id),
  /** Whether a pasted two-step setup key can make codes. The host answers how, never with a code. */
  checkTwoStep: (twoStepSeed: string) =>
    callHost<{ algorithm: string; digits: number; periodSeconds: number }>(
      "keyring.checkTwoStep",
      twoStepSeed,
    ),
  reveal: (id: string) =>
    callHost<{ value: string; twoStepSeed: string | null }>("keyring.reveal", id),
};
