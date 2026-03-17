# codecast

See your team code, in real-time. Watch Claude Code prompts, tool calls, and file edits stream across your terminal as teammates work.

| | |
|---|---|
| ![Screenshot 1](screenshots/screenshot1.png) | ![Screenshot 2](screenshots/screenshot2.png) |
| ![Screenshot 3](screenshots/screenshot3.png) | ![Screenshot 4](screenshots/screenshot4.png) |

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)
- [Python 3.13+](https://www.python.org/)
- [uv](https://docs.astral.sh/uv/) (`pip install uv` or `curl -LsSf https://astral.sh/uv/install.sh | sh`)

## Install

```bash
git clone https://github.com/grandiser/codecast.git
cd codecast
pnpm install
pnpm link --global
```

That's it. The `codecast` command is now available globally.

## Usage

### Start a room (host)

```bash
cd your-project/
codecast
```

Select **Start New Room** and set a password. A room code like `abc123@some-random.loca.lt` will be generated. Share this code and password with your team.

Claude Code hooks are automatically installed in the current project. Any prompts and tool calls in your Claude Code session will stream to the room.

### Join a room

```bash
cd your-project/
codecast
```

Select **Join Room**, paste the room code, and enter the room password. Your Claude Code activity in this project will also be broadcast to the room.

### Commands

Inside a session:

| Command    | Description                                          |
|------------|------------------------------------------------------|
| `/end`     | Leave the room                                       |
| `/export`  | Save chat to file                                    |
| `/filter`  | Toggle tool visibility (e.g. `/filter Read Edit`)    |
| `/help`    | Show commands                                        |
| `/quit`    | Exit codecast                                        |

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
