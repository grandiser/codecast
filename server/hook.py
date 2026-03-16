# /// script
# dependencies = ["websockets"]
# ///
"""Claude Code hook script — reads event from stdin, sends to codecast relay."""

import sys
import json
import asyncio
import websockets
from urllib.parse import quote

async def send_event():
    # Room info is passed as command-line args by the hook command
    if len(sys.argv) < 4:
        return  # missing args, silently skip

    room = sys.argv[1]
    host = sys.argv[2]       # "localhost:4001" or tunnel hostname
    user = sys.argv[3]
    password = sys.argv[4] if len(sys.argv) > 4 else ""

    # Read event JSON from stdin
    raw = sys.stdin.read()
    if not raw.strip():
        return

    event = json.loads(raw)
    # Debug: log raw event to see what fields are available
    try:
        with open("/tmp/codecast_hook_debug.log", "a") as f:
            f.write(json.dumps(event, indent=2, default=str)[:2000] + "\n---\n")
    except Exception:
        pass
    hook_type = event.get("hook_event_name", "")
    prompt = event.get("prompt", "")

    # Build message based on hook type
    if hook_type == "UserPromptSubmit" and prompt:
        text = prompt.strip().replace("\n", " ")
        message = json.dumps({"type": "prompt", "user": user, "text": text})
    elif hook_type == "PostToolUse":
        tool = event.get("tool_name", "unknown")
        tool_input = event.get("tool_input", {})
        additions = 0
        deletions = 0
        message = None
        # Build a short summary
        if tool == "Read":
            text = f"Read {tool_input.get('file_path', '?')}"
        elif tool == "Edit":
            old = tool_input.get("old_string", "")
            new = tool_input.get("new_string", "")
            deletions = len(old.splitlines()) if old else 0
            additions = len(new.splitlines()) if new else 0
            text = f"Edit {tool_input.get('file_path', '?')}"
        elif tool == "Write":
            content = tool_input.get("content", "")
            additions = len(content.splitlines()) if content else 0
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
        if message is None:
            msg = {"type": "tool_call", "user": user, "text": text, "tool_name": tool}
            if additions or deletions:
                msg["additions"] = additions
                msg["deletions"] = deletions
            file_path = tool_input.get("file_path", "")
            if file_path:
                msg["file"] = file_path
            message = json.dumps(msg)
    elif hook_type == "Stop":
        message = json.dumps({"type": "stop", "user": user})
    else:
        return  # unknown hook type, skip

    # Send to relay — use wss for remote hosts, ws for localhost
    # Replace "localhost" with "127.0.0.1" to avoid Windows DNS resolution flakiness
    connect_host = host.replace("localhost", "127.0.0.1")
    protocol = "ws" if host.startswith("localhost") or host.startswith("127.0.0.1") else "wss"
    uri = f"{protocol}://{connect_host}?room={room}&user={user}_hook&password={quote(password, safe='')}"
    try:
        async with websockets.connect(uri) as ws:
            auth = await asyncio.wait_for(ws.recv(), timeout=5)
            if auth != "__auth_ok__":
                return
            await ws.send(message)
    except Exception as e:
        # Log errors for debugging — remove once stable
        try:
            with open("/tmp/codecast_hook_err.log", "a") as f:
                f.write(f"{e.__class__.__name__}: {e}\n")
        except Exception:
            pass

if __name__ == "__main__":
    asyncio.run(send_event())
