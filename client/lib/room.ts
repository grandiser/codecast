import { spawn, execSync, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import { userInfo } from 'os';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import localtunnel from 'localtunnel';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serverDir = resolve(__dirname, '..', '..', '..', 'server');

let serverProcess: ChildProcess | null = null;
let tunnel: localtunnel.Tunnel | null = null;
export const username = userInfo().username;

export const generateRoomCode = (length: number) => {
    let s = '';
    Array.from({ length }).some(() => {
      s += Math.random().toString(36).slice(2);
      return s.length >= length;
    });
    return s.slice(0, length);
  };

// Parse "code@host:port" or just "code" (defaults to localhost:4001)
export const parseRoomCode = (fullCode: string): { code: string; host: string } => {
    const atIdx = fullCode.indexOf('@');
    if (atIdx === -1) {
        return { code: fullCode, host: 'localhost:4001' };
    }
    return { code: fullCode.slice(0, atIdx), host: fullCode.slice(atIdx + 1) };
};

export const joinRoom = (fullCode: string): WebSocket => {
    const { code, host } = parseRoomCode(fullCode);
    const protocol = host.startsWith('localhost') ? 'ws' : 'wss';
    const uri = `${protocol}://${host}?room=${code}&user=${username}`;
    const ws = new WebSocket(uri);
    return ws;
}

// Host always connects locally — tunnel is only for remote joiners
export const joinRoomLocal = (code: string): WebSocket => {
    const uri = `ws://localhost:4001?room=${code}&user=${username}`;
    const ws = new WebSocket(uri);
    return ws;
}

export const startServer = () => {
    serverProcess = spawn('uv run relay.py', [], {
        cwd: serverDir,
        stdio: 'ignore',
        shell: true,
    });
    serverProcess.on('error', () => {});
}

export const serverIsRunning = (): boolean => {
    return serverProcess !== null && !serverProcess.killed;
};

export const stopServer = () => {
    if (serverProcess && serverProcess.pid) {
        try {
            if (process.platform === 'win32') {
                // shell: true spawns a process tree — need to kill the whole tree on Windows
                execSync(`taskkill /F /T /PID ${serverProcess.pid}`, { stdio: 'ignore' });
            } else {
                // Kill the process group (shell: true spawns sh + child)
                process.kill(-serverProcess.pid, 'SIGTERM');
            }
        } catch {
            // already dead
        }
        serverProcess = null;
    }
};

// ─── Tunnel management ──────────────────────────────────────────────────────

export const startTunnel = async (): Promise<string> => {
    tunnel = await localtunnel({ port: 4001 });
    // tunnel.url is like "https://abc-def.loca.lt"
    const host = new URL(tunnel.url).host;
    return host;
};

export const stopTunnel = () => {
    if (tunnel) {
        tunnel.close();
        tunnel = null;
    }
};

// ─── Hook management ────────────────────────────────────────────────────────

// Use forward slashes so the command works in both bash and cmd
const serverPath = serverDir.replace(/\\/g, '/');

const HOOK_MARKER = "__codecast__";

interface ClaudeSettings {
    permissions?: Record<string, unknown>;
    hooks?: Record<string, Array<{
        matcher: string;
        hooks: Array<{ type: string; command: string; _marker?: string }>;
    }>>;
    [key: string]: unknown;
}

// host is "localhost:4001" for hosts, or the tunnel hostname for remote joiners
export const installHooks = (cwd: string, room: string, host: string = 'localhost:4001') => {
    const claudeDir = join(cwd, '.claude');
    const settingsPath = join(claudeDir, 'settings.json');

    // Read existing settings or start fresh
    let settings: ClaudeSettings = {};
    if (existsSync(settingsPath)) {
        try {
            settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        } catch {
            settings = {};
        }
    }

    if (!settings.hooks) settings.hooks = {};

    // Embed room/host/user directly in the command so each project is self-contained
    const hookCommand = `cd ${serverPath} && uv run hook.py ${room} ${host} ${username}`;

    const codecastHook = {
        type: "command",
        command: hookCommand,
        _marker: HOOK_MARKER,
    };

    // Add hooks for each event type we care about
    for (const event of ["UserPromptSubmit", "PostToolUse"]) {
        if (!settings.hooks[event]) {
            settings.hooks[event] = [];
        }

        const entries = settings.hooks[event]!;

        // Remove any existing codecast hooks
        for (const entry of entries) {
            entry.hooks = entry.hooks.filter(h => h._marker !== HOOK_MARKER);
        }

        // Find an entry with empty matcher, or create one
        let catchAll = entries.find(e => e.matcher === "");
        if (!catchAll) {
            catchAll = { matcher: "", hooks: [] };
            entries.push(catchAll);
        }

        catchAll.hooks.push(codecastHook);
    }

    // Write back
    if (!existsSync(claudeDir)) {
        mkdirSync(claudeDir, { recursive: true });
    }
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
};

export const uninstallHooks = (cwd: string) => {
    const settingsPath = join(cwd, '.claude', 'settings.json');

    if (!existsSync(settingsPath)) return;

    let settings: ClaudeSettings;
    try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch {
        return;
    }

    if (!settings.hooks) return;

    // Remove all codecast-marked hooks
    let changed = false;
    for (const event of Object.keys(settings.hooks)) {
        const entries = settings.hooks[event]!;
        for (const entry of entries) {
            const before = entry.hooks.length;
            entry.hooks = entry.hooks.filter(h => h._marker !== HOOK_MARKER);
            if (entry.hooks.length !== before) changed = true;
        }
        // Clean up empty entries
        settings.hooks[event] = entries.filter(e => e.hooks.length > 0);
        if (settings.hooks[event]!.length === 0) {
            delete settings.hooks[event];
        }
    }

    if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
    }

    if (changed) {
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    }
};
