import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import { resolveSafePath } from "./paths";

const execAsync = promisify(exec);

const MAX_WRITE_BYTES = 1024 * 1024; // 1 MB per write

/** Phase 3 "Auto-Rollback": commit every applied edit so it can be reverted. */
async function autoCommit(filePath: string): Promise<{
  committed: boolean;
  detail?: string;
}> {
  try {
    await execAsync(`git add "${filePath}"`, { cwd: process.cwd() });
    await execAsync(`git commit -m "AI: edit ${filePath}"`, {
      cwd: process.cwd(),
    });
    return { committed: true };
  } catch (error) {
    // Not fatal — the edit succeeded even if the commit didn't.
    return {
      committed: false,
      detail: error instanceof Error ? error.message.split("\n")[0] : "git failed",
    };
  }
}

function toolError(error: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * The agent's write "hands" (Milestone 3). These tools REQUIRE user approval
 * (configured via toolApproval in the chat route) and never run without an
 * explicit Approve click in the UI.
 */
export const agentWriteTools = {
  write_file: tool({
    description:
      "Create or completely overwrite a file with the given content. Requires explicit user approval — the user sees a diff before deciding. Use edit_file for small in-place changes.",
    inputSchema: z.object({
      path: z
        .string()
        .describe("Relative path from the project root, e.g. 'src/app/page.tsx'."),
      content: z.string().describe("The complete new file content."),
    }),
    execute: async ({ path: filePath, content }) => {
      try {
        if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
          return { ok: false, error: "Content exceeds the 1 MB write limit." };
        }
        const absolute = resolveSafePath(filePath);

        let existed = true;
        let oldContent: string | null = null;
        try {
          oldContent = await fs.readFile(absolute, "utf8");
        } catch {
          existed = false;
        }
        if (existed && oldContent === content) {
          return {
            ok: true,
            path: filePath,
            action: "noop",
            message: "File already has exactly this content — nothing written.",
          };
        }

        await fs.mkdir(path.dirname(absolute), {
          recursive: true,
        });
        await fs.writeFile(absolute, content, "utf8");

        const commit = await autoCommit(filePath);
        return {
          ok: true,
          path: filePath,
          action: existed ? "overwritten" : "created",
          bytes: Buffer.byteLength(content, "utf8"),
          committed: commit.committed,
          commitDetail: commit.detail,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  }),

  edit_file: tool({
    description:
      "Replace an exact snippet inside a file. Requires explicit user approval — the user sees a diff before deciding. The `find` text must match exactly and uniquely unless replaceAll is true.",
    inputSchema: z.object({
      path: z
        .string()
        .describe("Relative path from the project root, e.g. 'src/app/page.tsx'."),
      find: z.string().describe("Exact text to find (must match verbatim)."),
      replace: z.string().describe("Replacement text."),
      replaceAll: z
        .boolean()
        .optional()
        .describe("Replace every occurrence (default: false — requires unique match)."),
    }),
    execute: async ({ path: filePath, find, replace, replaceAll }) => {
      try {
        const absolute = resolveSafePath(filePath);
        const oldContent = await fs.readFile(absolute, "utf8");

        const occurrences = oldContent.split(find).length - 1;
        if (occurrences === 0) {
          return {
            ok: false,
            error: `find text not found in ${filePath}. Read the file again and copy the exact text.`,
          };
        }
        if (occurrences > 1 && !replaceAll) {
          return {
            ok: false,
            error: `find text occurs ${occurrences} times in ${filePath}. Provide more surrounding context so the match is unique, or set replaceAll: true.`,
          };
        }

        const newContent = replaceAll
          ? oldContent.split(find).join(replace)
          : oldContent.replace(find, replace);

        await fs.writeFile(absolute, newContent, "utf8");

        const commit = await autoCommit(filePath);
        return {
          ok: true,
          path: filePath,
          action: "edited",
          occurrencesReplaced: replaceAll ? occurrences : 1,
          committed: commit.committed,
          commitDetail: commit.detail,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  }),
};
