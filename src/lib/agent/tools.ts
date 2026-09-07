import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import {
  BASE_DIRECTORY,
  PathAccessError,
  resolveSafePath,
  shouldSkipEntry,
} from "./paths";

/** Walk budgets — keep tool output small so we never blow the context window. */
const MAX_TREE_ENTRIES = 1000;
const MAX_TREE_DEPTH = 8;
const MAX_READ_LINES = 400;
const MAX_READ_BYTES = 256 * 1024;
const MAX_SEARCH_FILES = 5000;
const MAX_SEARCH_MATCHES = 60;
const MAX_SEARCH_FILE_BYTES = 512 * 1024;

async function walk(
  dir: string,
  visitor: (absolutePath: string, relativePath: string) => Promise<void> | void,
): Promise<void> {
  const queue: Array<{ abs: string; rel: string; depth: number }> = [
    { abs: dir, rel: "", depth: 0 },
  ];
  let visited = 0;

  while (queue.length > 0) {
    const { abs, rel, depth } = queue.shift()!;
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      continue; // unreadable directory — skip silently
    }

    for (const entry of entries) {
      if (++visited > MAX_SEARCH_FILES) return;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (shouldSkipEntry(entry.name, entry.isDirectory(), childRel)) continue;

      if (entry.isDirectory()) {
        if (depth < MAX_TREE_DEPTH) {
          queue.push({
            abs: path.join(abs, entry.name),
            rel: childRel,
            depth: depth + 1,
          });
        }
      } else {
        await visitor(path.join(abs, entry.name), childRel);
      }
    }
  }
}

/** Renders a compact ASCII tree, e.g. `├── src/`. */
async function renderTree(maxDepth: number): Promise<string> {
  const lines: string[] = [`${path.basename(BASE_DIRECTORY)}/`];
  let count = 0;
  let truncated = false;

  const walkDir = async (dir: string, prefix: string, depth: number) => {
    if (truncated || depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const visible = entries
      .filter((e) => !shouldSkipEntry(e.name, e.isDirectory(), e.name))
      .sort((a, b) => {
        const aDir = a.isDirectory() ? 0 : 1;
        const bDir = b.isDirectory() ? 0 : 1;
        return aDir - bDir || a.name.localeCompare(b.name);
      });

    for (let i = 0; i < visible.length; i++) {
      if (++count > MAX_TREE_ENTRIES) {
        truncated = true;
        return;
      }
      const entry = visible[i];
      const last = i === visible.length - 1;
      lines.push(
        `${prefix}${last ? "└── " : "├── "}${entry.name}${entry.isDirectory() ? "/" : ""}`,
      );
      if (entry.isDirectory()) {
        await walkDir(
          path.join(dir, entry.name),
          `${prefix}${last ? "    " : "│   "}`,
          depth + 1,
        );
      }
    }
  };

  await walkDir(BASE_DIRECTORY, "", 0);
  if (truncated) lines.push(`… (tree truncated at ${MAX_TREE_ENTRIES} entries)`);
  return lines.join("\n");
}

function toolError(error: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error:
      error instanceof PathAccessError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error),
  };
}

/**
 * The agent's read-only "hands" (Milestone 2). Write tools + approval gate
 * arrive in Milestone 3 and will reuse the same path guard.
 */
export const agentTools = {
  get_directory_structure: tool({
    description:
      "Map the project: returns an ASCII directory tree of the entire project, excluding node_modules, .git and other build/secret noise. Use this FIRST to orient yourself before reading or searching files.",
    inputSchema: z.object({
      maxDepth: z
        .number()
        .int()
        .min(1)
        .max(MAX_TREE_DEPTH)
        .optional()
        .describe(`Maximum tree depth (default 4, max ${MAX_TREE_DEPTH}).`),
    }),
    execute: async ({ maxDepth }) => {
      try {
        const tree = await renderTree(maxDepth ?? 4);
        return { ok: true, tree };
      } catch (error) {
        return toolError(error);
      }
    },
  }),

  read_file: tool({
    description:
      "Read a text file from the project. Supports line ranges to avoid loading huge files — prefer reading specific ranges once you know where the relevant code lives.",
    inputSchema: z.object({
      path: z
        .string()
        .describe("Relative path from the project root, e.g. 'src/app/page.tsx'."),
      startLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("First line to read (1-based). Defaults to 1."),
      endLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          `Last line to read. A single call returns at most ${MAX_READ_LINES} lines.`,
        ),
    }),
    execute: async ({ path: filePath, startLine, endLine }) => {
      try {
        const absolute = resolveSafePath(filePath);
        const stat = await fs.stat(absolute);
        if (stat.size > MAX_READ_BYTES) {
          return {
            ok: false,
            error: `File is ${(stat.size / 1024).toFixed(0)} KB — too large. Read it in line ranges.`,
          };
        }

        const content = await fs.readFile(absolute, "utf8");
        const allLines = content.split("\n");
        const totalLines = allLines.length;

        const start = Math.max(1, startLine ?? 1);
        const end = Math.min(totalLines, endLine ?? start + MAX_READ_LINES - 1);
        const slice = allLines.slice(start - 1, end);

        return {
          ok: true,
          path: filePath,
          totalLines,
          startLine: start,
          endLine: end,
          truncated: end < totalLines,
          content: slice
            .map((line, i) => `${String(start + i).padStart(4, " ")} | ${line}`)
            .join("\n"),
        };
      } catch (error) {
        return toolError(error);
      }
    },
  }),

  // SEARCH-CODE-TOOL-BELOW
  search_code: tool({
    description:
      "Search file contents across the project (grep). Treats the query as a regex; falls back to literal substring search if the regex is invalid. Use this instead of reading whole files when looking for a function, import, or string.",
    inputSchema: z.object({
      query: z.string().describe("Regex or literal text to search for."),
      filePattern: z
        .string()
        .optional()
        .describe(
          "Optional glob-like filename filter, e.g. '*.ts' or '*.tsx'. Matches anywhere in the file name.",
        ),
    }),
    execute: async ({ query, filePattern }) => {
      try {
        let matcher: RegExp;
        try {
          matcher = new RegExp(query, "gi");
        } catch {
          matcher = new RegExp(
            query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "gi",
          );
        }
        const nameFilter = filePattern
          ? new RegExp(
              filePattern
                .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                .replace(/\\\*/g, ".*"),
              "i",
            )
          : null;

        const matches: Array<{ file: string; line: number; text: string }> = [];
        let filesSearched = 0;

        await walk(BASE_DIRECTORY, async (absolute, relative) => {
          if (matches.length >= MAX_SEARCH_MATCHES) return;
          if (nameFilter && !nameFilter.test(path.basename(relative))) return;
          filesSearched++;

          let stat;
          try {
            stat = await fs.stat(absolute);
          } catch {
            return;
          }
          if (stat.size > MAX_SEARCH_FILE_BYTES) return;

          let content: string;
          try {
            content = await fs.readFile(absolute, "utf8");
          } catch {
            return; // non-UTF8/binary — skip
          }
          if (content.includes("\0")) return; // binary sniff

          const lines = content.split("\n");
          for (
            let i = 0;
            i < lines.length && matches.length < MAX_SEARCH_MATCHES;
            i++
          ) {
            matcher.lastIndex = 0;
            if (matcher.test(lines[i])) {
              matches.push({
                file: relative,
                line: i + 1,
                text: lines[i].trim().slice(0, 200),
              });
            }
          }
        });

        return {
          ok: true,
          query,
          filesSearched,
          matchCount: matches.length,
          matches,
          note:
            matches.length >= MAX_SEARCH_MATCHES
              ? `Stopped at ${MAX_SEARCH_MATCHES} matches — refine the query to narrow results.`
              : undefined,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  }),

  scratchpad: tool({
    description:
      "Persistent scratchpad stored at .ai_context in the project root (Phase 2 'Sequential Thinking'). Use it to record your plan, findings, and progress during long multi-step operations so you never lose track. Read it at the start of a long task if it exists; append observations as you go.",
    inputSchema: z.object({
      action: z.enum(["read", "append", "overwrite"]).describe(
        "read: get current notes; append: add to the end; overwrite: replace all notes (use for starting a fresh task plan).",
      ),
      content: z
        .string()
        .optional()
        .describe("The note text (required for append/overwrite, ignored for read)."),
    }),
    execute: async ({ action, content }) => {
      try {
        const scratchPath = resolveSafePath(".ai_context");
        if (action === "read") {
          try {
            const notes = await fs.readFile(scratchPath, "utf8");
            return { ok: true, action, notes };
          } catch {
            return { ok: true, action, notes: "(scratchpad is empty)" };
          }
        }
        if (typeof content !== "string" || content.trim() === "") {
          return { ok: false, error: "content is required for append/overwrite." };
        }
        if (action === "append") {
          await fs.appendFile(scratchPath, `\n${content}`, "utf8");
        } else {
          await fs.writeFile(scratchPath, content, "utf8");
        }
        const notes = await fs.readFile(scratchPath, "utf8");
        return { ok: true, action, notes };
      } catch (error) {
        return toolError(error);
      }
    },
  }),
};

