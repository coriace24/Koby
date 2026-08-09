# Koby — project rules for Claude

## MUST: audit before every commit

After ANY code change — fixes included — run a code review/audit of the diff
BEFORE committing, and fix every defect it finds first. A fix must never break
something else; the audit is how that is enforced. No exceptions, even for
one-line hotfixes.

Also before committing:
- `npx vitest run` (22 engine tests must pass) and `npm run build` must be clean.
- If the change touches the underwriting math or the deal calculator, re-verify
  Excel parity (Test B in `samples/README.md`: NOI 78,320 · cap 7.832% ·
  PMT 5,401.66 · DSCR 1.2083 · total cash 210,000 · CoC 6.4286%).

## Standing sync duties (every push to this repo)

1. Rebuild the Windows package (`bash desktop/build.sh`) and push
   `app.zip` / `Koby.exe` / `KobyStarter.zip` + `VERSION.txt` to the
   `coriace24/Application` repo.
2. Keep `samples/README.md` (the test kit) updated with any flow change.
3. Regenerate the chat backup (`python3 chat-backup/export_chat.py`) and push it.

## Hard-won constraints (do not relearn these)

- ALWAYS `npx prisma@6.19.3 …` — bare `npx prisma` grabs Prisma 7, which fails
  on this schema (P1012).
- Long AI calls (extraction/summary) must use `client.messages.stream(...).finalMessage()`
  — plain `create` throws "Streaming is required" at high max_tokens.
- Keep structured-output schemas small: nesting a subschema into many properties
  blows the "compiled grammar is too large" API limit. Use flat arrays with a
  category enum instead (see rawLines in `src/lib/ai.ts`).
- The AI never does underwriting math and never makes definitive investment
  recommendations; all metrics come from `src/lib/underwriting.ts`.
- The desktop launcher (`desktop/launcher.js`) must stay runnable BOTH as a pkg
  exe and as a plain script under the bundled node.exe (`Start Koby.bat` path).
- User data on desktop lives in `Documents\Koby` (registry-resolved; OneDrive
  redirection) outside the replaceable `app\` folder.
- Never run `npm audit fix` — it downgrades Next and breaks the app.

## Branch / repo

Develop on `claude/clarification-questions-hvq9vp`; never push elsewhere.
Companion repos: `coriace24/Application` (desktop package, branch `main`).
