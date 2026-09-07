import path from "node:path";

/**
 * Security boundary for the whole agent (Phase 3 of the roadmap).
 * Every tool path — read, write, or search — must pass through
 * `resolveSafePath`, which guarantees the resolved location stays inside
 * BASE_DIRECTORY and outside sensitive/deny-listed areas.
 *
 * Override with PROJECT_ROOT in .env.local if the agent should operate on a
 * project other than the one this server runs in.
 */
export const BASE_DIRECTORY = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : process.cwd();

/** Directories the agent may never see (dependency noise, secrets, caches). */
const DENIED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  ".idea",
  ".vscode",
  "dist",
  "build",
  "coverage",
]);

/** File patterns the agent may never read (secrets). */
const DENIED_FILE_PATTERNS = [/^\.env/i, /^\.env\./i, /credentials/i, /secret/i];

/** Extensions that are not worth reading/searching as text. */
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".rar",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp4",
  ".mp3",
  ".wav",
  ".mov",
  ".sqlite",
  ".db",
  ".lock",
]);

export class PathAccessError extends Error {}

/**
 * Validates a user/model-supplied relative path and returns the absolute path
 * iff it is inside BASE_DIRECTORY and not denied. Throws PathAccessError.
 */
export function resolveSafePath(inputPath: string): string {
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw new PathAccessError("Path must be a non-empty string.");
  }

  // Normalise separators and collapse traversal segments.
  const normalised = path
    .normalize(inputPath.replace(/\\/g, "/"))
    .replace(/^[/\\]+/, "");

  const absolute = path.resolve(BASE_DIRECTORY, normalised);

  // The resolved path must stay inside the base directory (path traversal guard).
  const relative = path.relative(BASE_DIRECTORY, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathAccessError(
      `Access denied: "${inputPath}" is outside the project directory.`,
    );
  }

  // Deny-list check on every path segment.
  const segments = relative.split(path.sep);
  const fileName = segments[segments.length - 1] ?? "";
  for (const segment of segments.slice(0, -1)) {
    if (DENIED_DIRECTORIES.has(segment.toLowerCase())) {
      throw new PathAccessError(`Access denied: "${segment}" is off-limits.`);
    }
  }
  if (DENIED_FILE_PATTERNS.some((p) => p.test(fileName))) {
    throw new PathAccessError(
      `Access denied: "${fileName}" looks like a secrets file.`,
    );
  }

  return absolute;
}

/** Whether a relative path (segment array) should be skipped during walks. */
export function shouldSkipEntry(
  name: string,
  isDirectory: boolean,
  relativePath: string,
): boolean {
  if (isDirectory && DENIED_DIRECTORIES.has(name.toLowerCase())) return true;
  if (!isDirectory) {
    if (DENIED_FILE_PATTERNS.some((p) => p.test(name))) return true;
    if (BINARY_EXTENSIONS.has(path.extname(name).toLowerCase())) return true;
  }
  if (name === ".ai_context") return false; // scratchpad stays visible
  void relativePath;
  return false;
}