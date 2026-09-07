# Sinister — Local-First AI Coding Agent

A local-first, web-controlled AI coding agent with a sarcastic-hacker persona
(and a professional client mode). Built with Next.js 16, the Vercel AI SDK v7,
and Groq's free tier.

## Features

- Streaming chat UI (acid rave edition 🕶️)
- Read-only tools: project tree, file reading, regex code search
- Write tools (`write_file` / `edit_file`) with **human approval gate**:
  line-by-line diff preview + Apply/Deny buttons, HMAC-signed approvals
- Allowlisted terminal executor (`npm run build`, `git diff`, `npx eslint`...)
- Git auto-commit after every applied edit (`AI: edit <path>`)
- `.ai_context` scratchpad for long multi-step tasks
- Token budgeting: older history is auto-summarized to respect Groq's TPM limits

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in your keys
npm run dev                  # http://localhost:3000
```

## Phase 4: split deployment

Two deployments, one codebase:

### Deployment A — Public (Vercel)

The public site is a **client-facing chat** with no tools and no file access.

1. Push this repo to GitHub.
2. On [vercel.com](https://vercel.com), import the repo.
3. Add the environment variables:
   - `GROQ_API_KEY` — your Groq key
   - `GROQ_MODEL` — e.g. `openai/gpt-oss-120b`
   - `AGENT_MODE=public` — **critical**: disables all tools/file endpoints
   - Do **NOT** set `AGENT_KEY` or `TOOL_APPROVAL_SECRET` on Vercel.
4. Deploy. Visitors get the guest assistant.

### Deployment B — Local (your PC, full power)

Your machine runs the full agent with filesystem + terminal tools.

1. `.env.local` must contain `GROQ_API_KEY`, a long random `AGENT_KEY`,
   and a long random `TOOL_APPROVAL_SECRET`.
2. Run the server: `npm run build && npm run start` (or `npm run dev`).
3. Expose it with a Cloudflare Tunnel:

   ```bash
   cloudflared tunnel --url http://localhost:3000
   # prints something like: https://random-words.trycloudflare.com
   ```

### The Bridge (admin mode on the live site)

1. Open your deployed site and press **Ctrl+Shift+E** (⌘+Shift+E on Mac).
2. Paste the tunnel URL and your `AGENT_KEY` → Connect.
3. The header shows a **⚡ LOCAL BRIDGE** badge. Chat now streams from your
   local machine — tools, diffs, approvals and all — through the tunnel.
4. Disconnect via the same shortcut. The secret is stored only in that
   browser's localStorage.

Requests from the bridge carry the `x-sinister-key` header; your local server
rejects anything without it (fail-closed).
