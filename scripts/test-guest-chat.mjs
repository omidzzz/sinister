// Quick CLI test for the guest chat endpoint. Usage:
//   node scripts/test-guest-chat.mjs "question one" "question two"
// Sends each question as a separate conversation and prints the assembled
// reply text (useful for checking persona and opener variety).
// Optional env:
//   TEST_BASE   — target base URL (default http://localhost:3001)
//   TEST_KEY    — x-sinister-key header (for local AGENT_KEY deployments)
//   TEST_CONTEXT — extra `context` string sent with each request (live post index)
//   TEST_SESSION — session_id to send (defaults to none; set to log research rows)
const BASE = process.env.TEST_BASE ?? "http://localhost:3001";
const key = process.env.TEST_KEY;
const context = process.env.TEST_CONTEXT;
const session = process.env.TEST_SESSION;

const questions = process.argv.slice(2);
if (questions.length === 0) {
  console.error("usage: node scripts/test-guest-chat.mjs \"q1\" \"q2\"");
  process.exit(1);
}

for (const [i, q] of questions.entries()) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { "x-sinister-key": key } : {}),
    },
    body: JSON.stringify({
      ...(context ? { context } : {}),
      ...(session ? { sessionId: session, path: "/en", screen: "1920x1080" } : {}),
      messages: [
        {
          id: `test-${i}-${Date.now()}`,
          role: "user",
          parts: [{ type: "text", text: q }],
        },
      ],
    }),
  });
  if (!res.ok) {
    console.error(`[${i}] HTTP ${res.status}:`, await res.text());
    continue;
  }
  const text = await res.text();
  let out = "";
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const evt = JSON.parse(line.slice(5).trim());
      if (evt.type === "text-delta") out += evt.delta;
    } catch {
      /* keepalive or partial line */
    }
  }
  console.log(`\n=== Q${i + 1}: ${q}\n${out || "(no text)"}\n`);
}
