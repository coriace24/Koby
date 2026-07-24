import { NextResponse } from "next/server";

// Public: tells the registration form whether an invite code is required.
export async function GET() {
  return NextResponse.json({ inviteRequired: Boolean(process.env.INVITE_CODE) });
}
