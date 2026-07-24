import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !email.includes("@") || !name || password.length < 8) {
    return NextResponse.json(
      { error: "Provide a valid email, a name, and a password of at least 8 characters." },
      { status: 400 }
    );
  }

  // Optional registration gate: set INVITE_CODE in the environment to require it.
  if (process.env.INVITE_CODE) {
    const invite = typeof body?.inviteCode === "string" ? body.inviteCode.trim() : "";
    if (invite !== process.env.INVITE_CODE) {
      return NextResponse.json({ error: "Invalid invite code." }, { status: 403 });
    }
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { email, name, passwordHash } });
  await createSession(user.id);
  return NextResponse.json({ id: user.id, email: user.email, name: user.name });
}
