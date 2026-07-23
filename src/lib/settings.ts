import { prisma } from "./db";
import type { UserSettings } from "@prisma/client";

export const AI_MODELS = [
  { value: "", label: "Server default" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8 — most capable (default)" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5 — near-Opus quality, cheaper" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest, cheapest" },
] as const;

export async function getOrCreateSettings(userId: string): Promise<UserSettings> {
  const existing = await prisma.userSettings.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.userSettings.create({ data: { userId } });
}
