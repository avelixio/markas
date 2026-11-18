import packageJson from "../../package.json" with { type: "json" };

/** Markas's own version, as the engines and tool servers are told it. */
export const MARKAS_VERSION: string = packageJson.version;
