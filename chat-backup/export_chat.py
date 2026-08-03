#!/usr/bin/env python3
"""Export the Claude Code session transcript (jsonl) to a readable chat-history.txt.

Keeps the human-readable dialogue: user prompts and assistant replies.
Skips tool calls/results, thinking, subagent sidechains, and system reminders.
"""
import json
import re
import sys

SRC = "/root/.claude/projects/-home-user-Koby/c05205f2-2a4f-5d45-aff2-497ee276cb1f.jsonl"
DST = sys.argv[1] if len(sys.argv) > 1 else "/home/user/Koby/chat-backup/chat-history.txt"

def clean_user_text(t):
    # Drop harness-injected system reminder blocks, keep the human text.
    t = re.sub(r"<system-reminder>.*?</system-reminder>", "", t, flags=re.S)
    # Uploaded-file references -> friendly placeholder
    t = re.sub(r'@"/root/\.claude/uploads/[^"]*/([^"]+)"', r"[uploaded file: \1]", t)
    return t.strip()

def blocks_to_text(content, role):
    if isinstance(content, str):
        return clean_user_text(content) if role == "user" else content.strip()
    parts = []
    for b in content:
        if not isinstance(b, dict):
            continue
        bt = b.get("type")
        if bt == "text":
            txt = clean_user_text(b.get("text", "")) if role == "user" else b.get("text", "").strip()
            if txt:
                parts.append(txt)
        elif bt == "image" and role == "user":
            parts.append("[screenshot attached]")
        elif bt == "document" and role == "user":
            parts.append("[document attached]")
        # tool_use / tool_result / thinking are intentionally skipped
    return "\n".join(parts).strip()

entries = []
with open(SRC, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        if d.get("isSidechain"):
            continue
        if d.get("type") not in ("user", "assistant"):
            continue
        msg = d.get("message") or {}
        role = msg.get("role")
        if role not in ("user", "assistant"):
            continue
        # Skip pure tool-result user turns
        content = msg.get("content")
        if isinstance(content, list) and all(
            isinstance(b, dict) and b.get("type") in ("tool_result",) for b in content
        ) and content:
            continue
        text = blocks_to_text(content, role)
        if not text:
            continue
        # Harness-injected turns that aren't part of the human dialogue
        if role == "user" and (
            text.startswith("Base directory for this skill:")
            or text.startswith("This session is being continued from a previous conversation")
            or text.startswith("<command-name>")
        ):
            continue
        ts = (d.get("timestamp") or "")[:16].replace("T", " ")
        entries.append((role, ts, text))

# Merge consecutive assistant chunks of the same turn (streamed text blocks)
merged = []
for role, ts, text in entries:
    if merged and merged[-1][0] == role == "assistant" and merged[-1][1] == ts:
        merged[-1] = (role, ts, merged[-1][2] + "\n" + text)
    else:
        merged.append((role, ts, text))

with open(DST, "w", encoding="utf-8") as out:
    out.write("KOBY PROJECT - CHAT BACKUP\n")
    out.write("Full conversation between the user (coriace24) and Claude,\n")
    out.write("from project start (2026-07-17). Tool activity, code output, and\n")
    out.write("internal reasoning are omitted; every user prompt and every visible\n")
    out.write("assistant reply is preserved in order.\n")
    out.write("This file is regenerated at the end of every prompt.\n")
    out.write("=" * 72 + "\n\n")
    for role, ts, text in merged:
        who = "USER" if role == "user" else "CLAUDE"
        out.write(f"----- {who}  ({ts} UTC) -----\n{text}\n\n")

print(f"Wrote {DST}: {len(merged)} messages")
