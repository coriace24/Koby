// Single source of truth for the selectable Claude models — imported by both
// the Settings page (client) and the API validator. Keep this module free of
// server-only imports (prisma etc.) so the client bundle can use it.
export const AI_MODELS = [
  { value: "", label: "Server default (claude-opus-5)" },
  { value: "claude-opus-5", label: "Claude Opus 5 — most capable (default)" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8 — previous generation" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5 — near-Opus quality, ~60% cheaper" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest and cheapest" },
] as const;
