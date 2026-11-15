import type {
  AgentProviderId,
  DesktopPlatform,
  SetupInstallCommand,
  SetupInstallFailure,
} from "../../shared/ipc";
import type { ProcessOutcome } from "./process-runner";

/** One way of installing an engine: a program to start, and what the person would type instead. */
export interface InstallStep {
  /** The tool this way depends on, in plain words. */
  needs: string;
  command: string;
  args: string[];
  /** The exact line a person can paste in a terminal to do the same. */
  manual: string;
  /** Where that line is pasted. */
  shell: SetupInstallCommand["shell"];
}

export const ENGINE_NAMES: Record<AgentProviderId, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

/** The engine's own installer script, as its maker publishes it. Needs no admin rights and no Node.js. */
const SCRIPTS: Record<AgentProviderId, { posix: string; windows: string }> = {
  claude: {
    posix: "curl -fsSL https://claude.ai/install.sh | bash",
    windows: "irm https://claude.ai/install.ps1 | iex",
  },
  codex: {
    posix: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
    windows: "irm https://chatgpt.com/codex/install.ps1 | iex",
  },
};

const NPM_PACKAGES: Record<AgentProviderId, string> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
};

/**
 * The ways to install an engine on this kind of computer, best first.
 * The first is the maker's own installer, which installs for the person only. The second
 * is the npm package, tried only when the first cannot start for lack of its tool.
 */
export function installPlan(engine: AgentProviderId, platform: DesktopPlatform): InstallStep[] {
  const script = SCRIPTS[engine];
  const npm = `npm install -g ${NPM_PACKAGES[engine]}`;
  if (platform === "win32") {
    return [
      {
        needs: "PowerShell",
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          script.windows,
        ],
        manual: script.windows,
        shell: "powershell",
      },
      {
        needs: "Node.js and npm",
        command: "npm.cmd",
        args: ["install", "-g", NPM_PACKAGES[engine]],
        manual: npm,
        shell: "powershell",
      },
    ];
  }
  return [
    {
      needs: "curl",
      command: "/bin/sh",
      args: ["-c", script.posix],
      manual: script.posix,
      shell: "terminal",
    },
    {
      needs: "Node.js and npm",
      command: "/bin/sh",
      args: ["-lc", npm],
      manual: npm,
      shell: "terminal",
    },
  ];
}

/** The command the person can copy to install the engine by hand. */
export function installCommand(
  engine: AgentProviderId,
  platform: DesktopPlatform,
): SetupInstallCommand {
  const [first, second] = installPlan(engine, platform);
  if (!first) throw new Error(`No way to install ${ENGINE_NAMES[engine]} on ${platform}.`);
  return {
    engine,
    command: first.manual,
    shell: first.shell,
    alternative: second?.manual ?? null,
  };
}

/** The command the person can run in a terminal to sign in, instead of the button. */
export function signInCommand(engine: AgentProviderId): string {
  return engine === "claude" ? "claude auth login" : "codex login";
}

/** What an engine is started with to open its own sign-in. */
export function signInArgs(engine: AgentProviderId): string[] {
  return engine === "claude" ? ["auth", "login"] : ["login"];
}

const NO_INTERNET =
  /could not resolve host|couldn't resolve host|name or service not known|temporary failure in name resolution|remote name could not be resolved|unable to connect to the remote server|no such host is known|network is unreachable|failed to connect|connection (timed out|refused|reset)|operation timed out|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|curl: \((5|6|7|28|35|56)\)/i;
const NO_PERMISSION =
  /EACCES|EPERM|permission denied|access is denied|access to the path .* is denied|operation not permitted|requires elevation|unauthorizedaccess|running scripts is disabled|read-only file system/i;
const MISSING_TOOL =
  /command not found|not found\s*$|is not recognized as (an internal|the name of a cmdlet)|no such file or directory/im;

export type StepFailure = SetupInstallFailure | "missing-tool";

/** Tells from what an installer printed why it did not finish. */
export function classifyInstallFailure(outcome: ProcessOutcome): StepFailure {
  const output = outcome.output;
  // A missing tool often also prints "permission" or "network" words later; check it first
  // only when the shell itself said so (exit code 127 on POSIX, 9009 on Windows).
  if (outcome.code === 127 || outcome.code === 9009) return "missing-tool";
  if (NO_INTERNET.test(output)) return "no-internet";
  if (NO_PERMISSION.test(output)) return "no-permission";
  if (MISSING_TOOL.test(output)) return "missing-tool";
  return "unknown";
}

/** Why an install did not work, in words a person can act on. */
export function installFailureMessage(
  engine: AgentProviderId,
  reason: SetupInstallFailure,
  needs = "",
): string {
  const name = ENGINE_NAMES[engine];
  switch (reason) {
    case "no-internet":
      return `${name} could not be downloaded. Check the internet connection and try again.`;
    case "no-permission":
      return `This computer did not allow ${name} to be installed. Run the command below yourself, or ask whoever manages this computer.`;
    case "node-missing":
      return `${name} could not be installed automatically: ${needs || "Node.js and npm"} are not on this computer. Run the command below yourself, or install Node.js first.`;
    case "not-found-after-install":
      return `The installer finished, but Markas cannot find ${name} yet. Restart Markas, or show Markas where the program is.`;
    case "already-running":
      return `${name} is already being installed.`;
    default:
      return `${name} could not be installed. Run the command below yourself to see what goes wrong.`;
  }
}
