import { promises as fs } from "node:fs";
import { resolveSafePath } from "@/lib/agent/paths";

/** Phase 4: file access is local-only — never expose it on the public deployment. */
function gate(req: Request): Response | null {
  if (process.env.AGENT_MODE === "public") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const agentKey = process.env.AGENT_KEY;
  if (agentKey && req.headers.get("x-sinister-key") !== agentKey) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-sinister-key",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Read-only endpoint used by the diff-preview UI: fetches the current content
 * of a file (if it exists) so the client can render old-vs-new before the
 * user clicks Approve on a write_file/edit_file tool call.
 */
export async function GET(req: Request) {
  const denied = gate(req);
  if (denied) return denied;

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