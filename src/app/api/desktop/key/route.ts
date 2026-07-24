import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";

// Desktop-only endpoint: the Windows launcher runs the app with KOBY_DESKTOP=1
// and points KOBY_ENV_FILE at Documents\Koby\.env. The first-launch /setup page
// saves the Anthropic API key here. Never enabled on a hosted deployment.
function desktopEnabled() {
  return process.env.KOBY_DESKTOP === "1" && Boolean(process.env.KOBY_ENV_FILE);
}

export async function GET() {
  return NextResponse.json({
    desktop: desktopEnabled(),
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}

export async function POST(request: NextRequest) {
  if (!desktopEnabled()) {
    return NextResponse.json({ error: "Not available in this deployment." }, { status: 403 });
  }
  const b = await request.json().catch(() => null);
  const key = typeof b?.apiKey === "string" ? b.apiKey.trim() : "";
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) {
    return NextResponse.json(
      { error: "That doesn't look like an Anthropic API key (it starts with sk-ant-)." },
      { status: 400 }
    );
  }

  const envFile = process.env.KOBY_ENV_FILE!;
  let contents = "";
  try {
    contents = await fs.readFile(envFile, "utf8");
  } catch {
    contents = "";
  }
  const line = `ANTHROPIC_API_KEY="${key}"`;
  if (/^ANTHROPIC_API_KEY=.*$/m.test(contents)) {
    contents = contents.replace(/^ANTHROPIC_API_KEY=.*$/m, line);
  } else {
    contents = contents.trimEnd() + (contents.trim() ? "\n" : "") + line + "\n";
  }
  await fs.writeFile(envFile, contents, "utf8");
  process.env.ANTHROPIC_API_KEY = key;

  return NextResponse.json({ ok: true });
}
