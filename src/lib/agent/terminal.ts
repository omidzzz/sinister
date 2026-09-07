import { exec } from "node:child_process";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import { BASE_DIRECTORY } from "./paths";

const execAsync = promisify(exec);

const COMMAND_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 4000;

/**
 * Allowlist for the terminal executor (Phase 2 of the roadmap).
 * Only non-destructive, project-scoped commands are permitted — no installs,
 * no servers (dev/start never terminate), no network fetches, no deletion.
 */
const ALLOWED_COMMAND_PATTERNS: RegExp[] = [
  /^npm (run|test) [a-z0-9:@/._-]+$/i,
  /^npm (run )?(build|lint)$/,
  /^npm test$/,
  /^git (status|diff|log|show|branch|remote -v|rev-parse)( .*)?$/i,
  /^npx (eslint|tsc)( .*)?$/i,
  /^node --version$/i,
  /^npm --version$/i,
];

/** Shell metacharacters that could smuggle extra commands into `exec`. */
const SHELL_META = /[;&|><`$]/;

export function isCommandAllowed(command: string): boolean {
  const cmd = command.trim().replace(/\s+/g, " ");
  if (SHELL_META.test(cmd)) return false;
  return ALLOWED_COMMAND_PATTERNS.some((p) => p.test(cmd));
}

export function commandDenialReason(command: string): string {
  return [
    `Command "${command}" is not on the allowlist, so it was not executed.`,
    "Allowed (auto-runs): `npm run <script>`, `npm test`, `npm run lint`,",
    "`git status|diff|log|show|branch|remote -v|rev-parse`, `npx eslint`, `npx tsc`.",
    "Installs, servers (dev/start), file deletion, and anything with shell",
    "operators (; | & > < $ backtick) are permanently blocked.",
  ].join(" ");
}

function truncate(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return (
    output.slice(0, MAX_OUTPUT_CHARS) +
    `\n… (output truncated, ${output.length - MAX_OUTPUT_CHARS} more chars)`
  );
}

/**
 * Phase 2 "Terminal Executor". Safe allowlisted commands execute directly;
 * anything else is denied by the toolApproval policy in the chat route
 * before this tool ever runs.
 */
export const terminalTool = {
  run_command: tool({
    description:
      "Run a shell command in the project root. Only allowlisted non-destructive commands execute (npm run <script>, npm test, npm run lint, read-only git commands like status/diff/log/show/branch, npx eslint, npx tsc). Everything else is automatically denied. Use this to verify builds, run linters, and inspect git history.",
    inputSchema: z.object({
      command: z
        .string()
        .describe("The command to run, e.g. 'npm run build' or 'git diff'."),
    }),
    execute: async ({ command }) => {
      if (!isCommandAllowed(command)) {
        return { ok: false, command, error: commandDenialReason(command) };
      }
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: BASE_DIRECTORY,
          timeout: COMMAND_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        });
        return {
          ok: true,
          command,
          stdout: truncate(stdout),
          stderr: truncate(stderr),
        };
      } catch (error) {
        // Non-zero exit codes land here — the output is still valuable to observe.
        const err = error as {
          stdout?: string;
          stderr?: string;
          message: string;
          killed?: boolean;
        };
        return {
          ok: false,
          command,
          stdout: err.stdout ? truncate(err.stdout) : undefined,
          stderr: err.stderr ? truncate(err.stderr) : undefined,
          error: err.killed
            ? `Command timed out after ${COMMAND_TIMEOUT_MS / 1000}s.`
            : err.message.split("\n")[0],
        };
      }
    },
  }),
};
