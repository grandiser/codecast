# codecast

See your team code, in real-time. Watch Claude Code prompts, tool calls, and file edits stream across your terminal as teammates work.

```
 ___ ___   __| | ___  ___ __ _ ___| |_
/ __/ _ \ / _` |/ _ \/ __/ _` / __| __|
| (_| (_) | (_| |  __/ (_| (_| \__ \ |_
\___\___/ \__,_|\___|\___\__,_|___/\__|
```

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)
- [Python 3.13+](https://www.python.org/)
- [uv](https://docs.astral.sh/uv/) (`pip install uv` or `curl -LsSf https://astral.sh/uv/install.sh | sh`)

## Install

```bash
git clone https://github.com/grandiser/codecast.git
cd codecast/client
pnpm install
npx tsc
pnpm link --global
```

This gives you the `codecast` command globally.

## Usage

### Start a room (host)

```bash
cd your-project/
codecast
```

Select **Start New Room**. A room code like `abc123@some-random.loca.lt` will be generated. Share this code with your team.

Claude Code hooks are automatically installed in the current project. Any prompts and tool calls in your Claude Code session will stream to the room.

### Join a room

```bash
cd your-project/
codecast
```

Select **Join Room** and paste the room code. Your Claude Code activity in this project will also be broadcast to the room.

### Commands

Inside a session:

| Command   | Description      |
|-----------|------------------|
| `/end`    | Leave the room   |
| `/export` | Save chat to file|
| `/help`   | Show commands    |
| `/quit`   | Exit codecast    |

## How it works

```
Claude Code hooks --> hook.py --> WebSocket relay --> TUI viewer
```

1. **Hooks** - When you start/join a room, codecast installs Claude Code hooks in your project's `.claude/settings.json`. These fire on every prompt and tool use.
2. **Relay** - A Python WebSocket server handles room-based message fan-out. Started automatically by the host.
3. **Tunnel** - [localtunnel](https://github.com/localtunnel/localtunnel) exposes the relay to the internet so anyone can join with just the room code.
4. **TUI** - An Ink-based terminal UI shows the live event feed.

## Project isolation

Hooks are installed per-project. If you run codecast in `project-a/` and separately in `project-b/`, each session only sees Claude Code events from its own directory. Two rooms, fully isolated.

## Cleanup

Hooks are automatically removed when you leave a room or exit codecast. If codecast crashes, you can manually remove the hooks from `.claude/settings.json` in your project (look for entries with `"_marker": "__codecast__"`).
