import { promises as fs } from "node:fs";
import { resolveSafePath } from "@/lib/agent/paths";

/**
 * Read-only endpoint used by the diff-preview UI: fetches the current content
 * of a file (if it exists) so the client can render old-vs-new before the
 * user clicks Approve on a write_file/edit_file tool call.
 */
export async function GET(req: Request) {
  const pathParam = new URL(req.url).searchParams.get("path");
  if (!pathParam) {
    return Response.json({ error: "Missing ?path= parameter." }, { status: 400 });
  }

  try {
    const absolute = resolveSafePath(pathParam);
    const content = await fs.readFile(absolute, "utf8");
    return Response.json({ exists: true, content });
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return Response.json({ exists: false, content: null });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Access denied." },
      { status: 403 },
    );
  }
}