import { prisma } from "./db";
import type { UserSettings } from "@prisma/client";

export { AI_MODELS } from "./models";

export async function getOrCreateSettings(userId: string): Promise<UserSettings> {
  const existing = await prisma.userSettings.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.userSettings.create({ data: { userId } });
}
