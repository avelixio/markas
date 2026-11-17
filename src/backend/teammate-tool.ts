/** The tool a bot uses to ask for a new teammate. One definition, shared by both engines. */
export const PROPOSE_TEAMMATE_TOOL = "propose_teammate";

export const PROPOSE_TEAMMATE_DESCRIPTION =
  "Ask the person to add a new bot to the crew. Give it a short name, a role in a few words and what it is for. The person sees the proposal and says yes or no; only on a yes is the bot created. Use this only when the person asked for a new teammate or the work clearly needs one, and never to copy yourself.";

export const TEAMMATE_NAME_MAX = 80;
export const TEAMMATE_ROLE_MAX = 120;
export const TEAMMATE_PURPOSE_MAX = 2_000;
