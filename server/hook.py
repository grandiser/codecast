# /// script
# dependencies = ["websockets"]
# ///
"""Claude Code hook script — reads event from stdin, sends to codecast relay."""

import sys
import json
import asyncio
import websockets

async def send_event():
    # Room info is passed as command-line args by the hook command
    if len(sys.argv) < 4:
        return  # missing args, silently skip

    room = sys.argv[1]
    port = int(sys.argv[2])
    user = sys.argv[3]

    # Read event JSON from stdin
    raw = sys.stdin.read()
    if not raw.strip():
        return

    event = json.loads(raw)
    hook_type = event.get("hook_event_name", "")
    prompt = event.get("prompt", "")

    # Build message based on hook type
    if hook_type == "UserPromptSubmit" and prompt:
        # Truncate long prompts
        text = prompt.strip().replace("\n", " ")
        if len(text) > 100:
            text = text[:100] + "..."
        message = json.dumps({"type": "prompt", "user": user, "text": text})
    elif hook_type == "PostToolUse":
        tool = event.get("tool_name", "unknown")
        tool_input = event.get("tool_input", {})
        # Build a short summary
        if tool == "Read":
            text = f"Read {tool_input.get('file_path', '?')}"
        elif tool == "Edit":
            text = f"Edit {tool_input.get('file_path', '?')}"
        elif tool == "Write":
            text = f"Write {tool_input.get('file_path', '?')}"
        elif tool == "Bash":
            cmd = tool_input.get("command", "?")
            if len(cmd) > 80:
                cmd = cmd[:80] + "..."
            text = f"Bash: {cmd}"
        elif tool == "Grep":
            text = f"Grep '{tool_input.get('pattern', '?')}'"
        elif tool == "Glob":
            text = f"Glob {tool_input.get('pattern', '?')}"
        else:
            text = f"{tool}"
        message = json.dumps({"type": "tool_call", "user": user, "text": text})
    else:
        return  # unknown hook type, skip

    # Send to relay
    uri = f"ws://localhost:{port}?room={room}&user={user}_hook"
    try:
        async with websockets.connect(uri) as ws:
            await ws.send(message)
    except Exception:
        pass  # relay not running, silently skip

if __name__ == "__main__":
    asyncio.run(send_event())
