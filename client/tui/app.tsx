import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Text, Box, useInput, useApp, useStdout } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import SelectInput from "ink-select-input";
import { writeFileSync } from "fs";
import { execSync } from "child_process";
import { basename } from "path";
import { generateRoomCode, joinRoom, parseRoomCode, startServer, stopServer, startTunnel, stopTunnel, username, installHooks, uninstallHooks } from "../lib/room.js";
import type WebSocket from "ws";

// ─── Constants ──────────────────────────────────────────────────────────────

const AVATARS = [
  "\u{1F43B}", // bear
  "\u{1F98A}", // fox
  "\u{1F43A}", // wolf
  "\u{1F989}", // owl
  "\u{1F419}", // octopus
  "\u{1F422}", // turtle
  "\u{1F99D}", // raccoon
  "\u{1F98E}", // lizard
  "\u{1F427}", // penguin
  "\u{1F40D}", // snake
  "\u{1F994}", // hedgehog
  "\u{1F987}", // bat
  "\u{1F9A9}", // flamingo
  "\u{1F41A}", // shell
  "\u{1F40B}", // whale
  "\u{1F99C}", // parrot
];

// Cyan is reserved for self. Others get assigned from this pool in order.
const OTHER_COLORS = [
  "magenta",
  "yellow",
  "green",
  "blue",
  "white",
  "greenBright",
  "cyanBright",
  "magentaBright",
  "yellowBright",
  "blueBright",
  "whiteBright",
] as const;

type UserColor = "cyan" | (typeof OTHER_COLORS)[number];

const ASCII_LOGO = `
 ██████╗ ██████╗ ██████╗ ███████╗ ██████╗ █████╗ ███████╗████████╗
██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔════╝██╔══██╗██╔════╝╚══██╔══╝
██║     ██║   ██║██║  ██║█████╗  ██║     ███████║███████╗   ██║
██║     ██║   ██║██║  ██║██╔══╝  ██║     ██╔══██║╚════██║   ██║
╚██████╗╚██████╔╝██████╔╝███████╗╚██████╗██║  ██║███████║   ██║
 ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝╚══════╝   ╚═╝`;

const COMMANDS = [
  { name: "/copy", desc: "copy room code to clipboard" },
  { name: "/end", desc: "leave room" },
  { name: "/export", desc: "save chat to file" },
  { name: "/filter", desc: "toggle tool call visibility" },
  { name: "/help", desc: "show commands" },
  { name: "/quit", desc: "exit codecast" },
  { name: "/stats", desc: "show user activity rankings" },
];

// ─── Types ──────────────────────────────────────────────────────────────────

type Screen = "welcome" | "join" | "set-password" | "connecting" | "session" | "error";

interface User {
  name: string;
  avatar: string;
  color: UserColor;
}

interface EventMessage {
  id: string;
  type: "join" | "leave" | "prompt" | "tool_call" | "chat" | "system" | "diff_summary";
  toolName?: string;
  user?: User;
  text: string;
  timestamp: Date;
  additions?: number;
  deletions?: number;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

const hashUsername = (name: string): number => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

const getAvatar = (name: string): string => {
  const h = hashUsername(name);
  return AVATARS[h % AVATARS.length]!;
};

const formatTime = (d: Date): string => {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
};

const formatUptime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

let nextId = 0;
const mkId = () => String(++nextId);

// ─── Sub-components ─────────────────────────────────────────────────────────

const BorderBox: React.FC<{
  children: React.ReactNode;
  borderColor?: string;
  width?: number | string;
  height?: number | string;
  flexGrow?: number;
}> = ({ children, borderColor = "cyan", width, height, flexGrow }) => (
  <Box
    borderStyle="round"
    borderColor={borderColor}
    paddingX={2}
    paddingY={1}
    flexDirection="column"
    alignItems="center"
    justifyContent="center"
    width={width as number}
    height={height as number}
    flexGrow={flexGrow}
  >
    {children}
  </Box>
);

// ─── Welcome Screen ─────────────────────────────────────────────────────────

const WelcomeScreen: React.FC<{
  onSelect: (item: { value: string }) => void;
}> = ({ onSelect }) => {
  const items = [
    { label: "New Room", value: "start" },
    { label: "Join Room", value: "join" },
    { label: "Quit", value: "quit" },
  ];

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      <BorderBox width={72}>
        <Text color="cyan" bold>
          {ASCII_LOGO}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>see your team prompt, in real time.</Text>
        </Box>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={onSelect}
            indicatorComponent={({ isSelected }) => (
              <Text color="cyan">{isSelected ? "> " : "  "}</Text>
            )}
            itemComponent={({ isSelected, label }) => (
              <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                {label}
              </Text>
            )}
          />
        </Box>
      </BorderBox>
    </Box>
  );
};

// ─── Join Screen ────────────────────────────────────────────────────────────

const JoinScreen: React.FC<{
  onSubmit: (code: string, password: string) => void;
  onBack: () => void;
}> = ({ onSubmit, onBack }) => {
  const [step, setStep] = useState<"code" | "password">("code");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useInput((_input, key) => {
    if (key.escape) {
      if (step === "password") {
        setStep("code");
        setPassword("");
        setError("");
      } else {
        onBack();
      }
    }
  });

  const handleCodeSubmit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 4) {
      setError("Room code must be at least 4 characters");
      return;
    }
    if (trimmed.length > 128) {
      setError("Room code is too long");
      return;
    }
    setError("");
    setCode(trimmed);
    setStep("password");
  };

  const handlePasswordSubmit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 1) {
      setError("Password cannot be empty");
      return;
    }
    setError("");
    onSubmit(code, trimmed);
  };

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      <BorderBox width={48}>
        {step === "code" ? (
          <>
            <Text bold color="cyan">
              Enter Room Code
            </Text>
            <Box marginTop={1}>
              <Text color="cyan">{"> "}</Text>
              <TextInput
                value={code}
                onChange={setCode}
                onSubmit={handleCodeSubmit}
                placeholder="room code..."
              />
            </Box>
          </>
        ) : (
          <>
            <Text bold color="cyan">
              Enter Room Password
            </Text>
            <Box marginTop={1}>
              <Text dimColor>Room: {code}</Text>
            </Box>
            <Box marginTop={1}>
              <Text color="cyan">{"> "}</Text>
              <TextInput
                value={password}
                onChange={setPassword}
                onSubmit={handlePasswordSubmit}
                placeholder="password..."
                mask="*"
              />
            </Box>
          </>
        )}
        {error ? (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Text dimColor>esc to go back</Text>
        </Box>
      </BorderBox>
    </Box>
  );
};

// ─── Password Set Screen (Host) ─────────────────────────────────────────────

const PasswordSetScreen: React.FC<{
  onSubmit: (password: string) => void;
  onBack: () => void;
}> = ({ onSubmit, onBack }) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useInput((_input, key) => {
    if (key.escape) onBack();
  });

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 1) {
      setError("Password cannot be empty");
      return;
    }
    setError("");
    onSubmit(trimmed);
  };

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      <BorderBox width={48}>
        <Text bold color="cyan">
          Set Room Password
        </Text>
        <Box marginTop={1}>
          <Text dimColor>Others will need this to join.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="cyan">{"> "}</Text>
          <TextInput
            value={password}
            onChange={setPassword}
            onSubmit={handleSubmit}
            placeholder="password..."
            mask="*"
          />
        </Box>
        {error ? (
          <Box marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Text dimColor>esc to go back</Text>
        </Box>
      </BorderBox>
    </Box>
  );
};

// ─── Connecting Screen ──────────────────────────────────────────────────────

const ConnectingScreen: React.FC<{ subtitle: string }> = ({ subtitle }) => (
  <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
    <BorderBox width={40}>
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Connecting...</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{subtitle}</Text>
      </Box>
    </BorderBox>
  </Box>
);

// ─── Event Item ─────────────────────────────────────────────────────────────

const DISPLAY_TRUNCATE = 500;

const truncateDisplay = (text: string): string =>
  text.length > DISPLAY_TRUNCATE ? text.slice(0, DISPLAY_TRUNCATE) + "..." : text;

const EventItem: React.FC<{ event: EventMessage }> = ({ event }) => {
  const time = formatTime(event.timestamp);

  switch (event.type) {
    case "join":
      return (
        <Text dimColor>
          [{time}] -- {event.user?.avatar} {event.user?.name} joined --
        </Text>
      );

    case "leave":
      return (
        <Text dimColor>
          [{time}] -- {event.user?.avatar} {event.user?.name} left --
        </Text>
      );

    case "prompt":
      return (
        <Text wrap="wrap">
          <Text dimColor>[{time}] </Text>
          <Text color={event.user?.color} bold>
            {event.user?.avatar} {event.user?.name}
          </Text>
          <Text dimColor> {"\u2192"} Prompt: </Text>
          <Text>{truncateDisplay(event.text)}</Text>
        </Text>
      );

    case "tool_call":
      return (
        <Text wrap="wrap">
          <Text dimColor>[{time}] </Text>
          <Text color={event.user?.color} bold>
            {event.user?.avatar} {event.user?.name}
          </Text>
          <Text dimColor> {"\u2192"} </Text>
          <Text>{truncateDisplay(event.text)}</Text>
          {(event.additions || event.deletions) ? (
            <>
              <Text>  </Text>
              {event.additions ? <Text color="green">+{event.additions}</Text> : null}
              {event.additions && event.deletions ? <Text> </Text> : null}
              {event.deletions ? <Text color="red">-{event.deletions}</Text> : null}
            </>
          ) : null}
        </Text>
      );

    case "chat":
      return (
        <Text wrap="wrap">
          <Text dimColor>[{time}] </Text>
          <Text color={event.user?.color} bold>
            {event.user?.avatar} {event.user?.name}
          </Text>
          <Text>: {truncateDisplay(event.text)}</Text>
        </Text>
      );

    case "diff_summary":
      return (
        <Text>
          <Text dimColor>[{time}] </Text>
          <Text color={event.user?.color} bold>
            {event.user?.avatar} {event.user?.name}
          </Text>
          <Text dimColor> done </Text>
          {event.additions ? <Text color="green" bold>+{event.additions}</Text> : null}
          {event.additions && event.deletions ? <Text> </Text> : null}
          {event.deletions ? <Text color="red" bold>-{event.deletions}</Text> : null}
        </Text>
      );

    case "system":
      return (
        <Text dimColor>
          [{time}] {event.text}
        </Text>
      );

    default:
      return null;
  }
};

// ─── Header Bar ─────────────────────────────────────────────────────────────

const projectName = basename(process.cwd());

const HeaderBar: React.FC<{
  roomCode: string;
  users: User[];
  uptime: number;
}> = ({ roomCode, users, uptime }) => (
  <Box justifyContent="space-between" width="100%">
    <Box>
      <Text bold color="cyan">
        codecast
      </Text>
      <Text dimColor> {"\u2502"} </Text>
      <Text color="yellow">{projectName}</Text>
      <Text dimColor> {"\u2502"} room: </Text>
      <Text color="green">{roomCode}</Text>
      <Text dimColor> {"\u2502"} </Text>
      {users.map((u, i) => (
        <Text key={u.name}>
          {i > 0 ? "  " : ""}
          <Text color={u.color}>
            {u.avatar} {u.name}
          </Text>
        </Text>
      ))}
    </Box>
    <Text dimColor>{formatUptime(uptime)}</Text>
  </Box>
);

// ─── Message Feed ───────────────────────────────────────────────────────────

const MessageFeed: React.FC<{ messages: EventMessage[] }> = ({ messages }) => {
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const maxVisible = Math.max(5, rows - 8);
  const visible = messages.slice(-maxVisible);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {visible.map((msg) => (
        <EventItem key={msg.id} event={msg} />
      ))}
    </Box>
  );
};

// ─── Input Bar ──────────────────────────────────────────────────────────────

const InputBar: React.FC<{
  onSubmit: (text: string) => void;
}> = React.memo(({ onSubmit }) => {
  const [value, setValue] = useState("");
  const [selIdx, setSelIdx] = useState(-1);

  const showSuggestions = value.startsWith("/") && !value.includes(" ");
  const filtered = showSuggestions
    ? COMMANDS.filter((c) => c.name.startsWith(value))
    : [];

  const handleChange = (v: string) => {
    setValue(v);
    setSelIdx(-1);
  };

  const handleSubmit = (text: string) => {
    // If a suggestion is selected, autocomplete it instead of submitting
    if (selIdx >= 0 && filtered[selIdx]) {
      setValue(filtered[selIdx].name);
      setSelIdx(-1);
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
    setSelIdx(-1);
  };

  useInput((_input, key) => {
    if (filtered.length === 0) return;
    if (key.downArrow) {
      setSelIdx((i) => (i + 1) % filtered.length);
    } else if (key.upArrow) {
      setSelIdx((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (key.tab) {
      if (selIdx >= 0 && filtered[selIdx]) {
        setValue(filtered[selIdx].name);
        setSelIdx(-1);
      } else if (filtered.length === 1 && filtered[0]) {
        setValue(filtered[0].name);
        setSelIdx(-1);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {filtered.length > 0 && (
        <Box flexDirection="column" paddingX={1} marginBottom={0}>
          {filtered.map((c, i) => (
            <Box key={c.name}>
              <Text color="cyan" bold inverse={i === selIdx}>{c.name}</Text>
              <Text dimColor>  {c.desc}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box>
        <Text color="cyan">{"> "}</Text>
        <TextInput
          value={value}
          onChange={handleChange}
          onSubmit={handleSubmit}
          placeholder="type a message or /command..."
          focus={true}
        />
      </Box>
    </Box>
  );
});

// ─── Session Screen ─────────────────────────────────────────────────────────

const SessionScreen: React.FC<{
  roomCode: string;
  users: User[];
  messages: EventMessage[];
  uptime: number;
  onInput: (text: string) => void;
}> = ({ roomCode, users, messages, uptime, onInput }) => {
  const { stdout } = useStdout();
  const cols = (stdout?.columns ?? 80) - 4; // subtract border + padding

  return (
  <Box flexDirection="column" flexGrow={1}>
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      flexGrow={1}
      paddingX={1}
    >
      <HeaderBar roomCode={roomCode} users={users} uptime={uptime} />
      <Text dimColor>{"─".repeat(cols)}</Text>
      <Box flexDirection="column" flexGrow={1}>
        <MessageFeed messages={messages} />
      </Box>
    </Box>
    <InputBar onSubmit={onInput} />
  </Box>
  );
};

// ─── Error Screen ───────────────────────────────────────────────────────────

const ErrorScreen: React.FC<{
  message: string;
  onSelect: (item: { value: string }) => void;
}> = ({ message, onSelect }) => {
  const items = [
    { label: "Try Again", value: "retry" },
    { label: "Quit", value: "quit" },
  ];

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      <BorderBox borderColor="red" width={48}>
        <Text color="red" bold>
          Error
        </Text>
        <Box marginTop={1}>
          <Text>{message}</Text>
        </Box>
        <Box marginTop={1}>
          <SelectInput items={items} onSelect={onSelect} />
        </Box>
      </BorderBox>
    </Box>
  );
};


// -- Handlers
const useHandlers = () => {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [roomCode, setRoomCode] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<EventMessage[]>([]);
  const [uptime, setUptime] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [connectSubtitle, setConnectSubtitle] = useState("");
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [showToolCalls, setShowToolCalls] = useState(false);

  // Color assignment: self = cyan, others get unique colors from pool
  const colorMap = useRef(new Map<string, UserColor>());
  const nextColorIdx = useRef(0);
  const intentionalClose = useRef(false);

  const getUser = useCallback((name: string): User => {
    const avatar = getAvatar(name);

    // Self always gets cyan
    if (name === username) {
      return { name, avatar, color: "cyan" };
    }

    // Check if already assigned
    let color = colorMap.current.get(name);
    if (!color) {
      color = OTHER_COLORS[nextColorIdx.current % OTHER_COLORS.length]!;
      nextColorIdx.current++;
      colorMap.current.set(name, color);
    }

    return { name, avatar, color };
  }, []);

  // Uptime ticker
  useEffect(() => {
    if (screen !== "session") return;
    const timer = setInterval(() => setUptime((u) => u + 1), 1000);
    return () => clearInterval(timer);
  }, [screen]);

  const MAX_MESSAGES = 500;

  // Per-user activity counters — always updated, independent of /filter
  const statsMap = useRef(new Map<string, { prompts: number; toolCalls: number; additions: number; deletions: number }>());

  // Accumulate line changes per user between prompts — flushed as diff_summary on next prompt
  const pendingDiffs = useRef(new Map<string, { additions: number; deletions: number }>());

  const trackStats = useCallback((msg: Omit<EventMessage, "id" | "timestamp">) => {
    const name = msg.user?.name;
    if (!name) return;
    let entry = statsMap.current.get(name);
    if (!entry) { entry = { prompts: 0, toolCalls: 0, additions: 0, deletions: 0 }; statsMap.current.set(name, entry); }
    if (msg.type === "prompt") entry.prompts++;
    else if (msg.type === "tool_call") {
      entry.toolCalls++;
      if (msg.additions) entry.additions += msg.additions;
      if (msg.deletions) entry.deletions += msg.deletions;
    }

  }, []);

  // Batch message updates to avoid starving keyboard input on Windows
  const messageQueue = useRef<EventMessage[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushMessages = useCallback(() => {
    flushTimer.current = null;
    if (messageQueue.current.length === 0) return;
    const batch = messageQueue.current;
    messageQueue.current = [];
    setMessages((prev) => {
      const next = [...prev, ...batch];
      return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
    });
  }, []);

  const addMessage = useCallback((msg: Omit<EventMessage, "id" | "timestamp"> & { timestamp?: Date }) => {
    trackStats(msg);
    messageQueue.current.push({ ...msg, timestamp: msg.timestamp ?? new Date(), id: mkId() });
    if (!flushTimer.current) {
      flushTimer.current = setTimeout(flushMessages, 50);
    }
  }, [flushMessages, trackStats]);

  // Parse incoming server messages and update state
  const wireSocket = useCallback((ws: WebSocket) => {
    const handleHookJson = (parsed: any) => {
      if (typeof parsed.user !== "string" || typeof parsed.text !== "string") return;
      const user = getUser(parsed.user);
      if (parsed.type === "tool_call") {
        const additions = parsed.additions ?? 0;
        const deletions = parsed.deletions ?? 0;
        if (additions || deletions) {
          const pending = pendingDiffs.current.get(parsed.user) ?? { additions: 0, deletions: 0 };
          pending.additions += additions;
          pending.deletions += deletions;
          pendingDiffs.current.set(parsed.user, pending);
        }
        addMessage({ type: "tool_call", user, text: parsed.text, toolName: parsed.tool_name, additions: additions || undefined, deletions: deletions || undefined });
      } else {
        // prompt — flush pending diffs as a summary
        const pending = pendingDiffs.current.get(parsed.user);
        if (pending && (pending.additions || pending.deletions)) {
          addMessage({ type: "diff_summary", user, text: "", additions: pending.additions, deletions: pending.deletions });
          pendingDiffs.current.delete(parsed.user);
        }
        addMessage({ type: "prompt", user, text: parsed.text });
      }
    };

    const tryParseHook = (json: string): boolean => {
      if (!json.startsWith("{")) return false;
      try { handleHookJson(JSON.parse(json)); return true; } catch { return false; }
    };

    ws.on("message", (data) => {
      const text = data.toString();

      // Direct JSON from hook
      if (tryParseHook(text)) return;

      // Relay wraps hook messages as "user_hook: {json}"
      const colonIdx = text.indexOf(": ");
      if (colonIdx > 0 && tryParseHook(text.slice(colonIdx + 2))) return;

      if (text.endsWith(" connected")) {
        const name = text.slice(0, -" connected".length);
        if (name.endsWith("_hook")) return;
        const user = getUser(name);
        setUsers((prev) =>
          prev.some((u) => u.name === name) ? prev : [...prev, user]
        );
        addMessage({ type: "join", user, text: "" });
        return;
      }

      if (text.endsWith(" dropped out")) {
        const name = text.slice(0, -" dropped out".length);
        if (name.endsWith("_hook")) return;
        const user = getUser(name);
        setUsers((prev) => prev.filter((u) => u.name !== name));
        addMessage({ type: "leave", user, text: "" });
        return;
      }

      if (colonIdx > 0) {
        const name = text.slice(0, colonIdx);
        const msg = text.slice(colonIdx + 2);
        addMessage({ type: "chat", user: getUser(name), text: msg });
        return;
      }

      addMessage({ type: "system", text });
    });

    ws.on("close", () => {
      if (intentionalClose.current) {
        intentionalClose.current = false;
        return;
      }
      addMessage({ type: "system", text: "Session ended by host. Exiting..." });
      setTimeout(() => process.exit(0), 2000);
    });
  }, [addMessage, getUser]);

  const setupAuth = useCallback((ws: WebSocket, opts: {
    room: string; host: string; password: string;
    onSuccess?: () => void; failMsg: string;
  }) => {
    const authHandler = (data: any) => {
      const text = data.toString();
      if (text === "__auth_ok__") {
        ws.off("message", authHandler);
        setSocket(ws);
        wireSocket(ws);
        installHooks(process.cwd(), opts.room, opts.host, opts.password);
        setMessages([]);
        setUsers([getUser(username)]);
        setUptime(0);
        opts.onSuccess?.();
        setScreen("session");
      } else if (text === "__auth_fail__") {
        ws.off("message", authHandler);
        ws.close();
        setErrorMsg(opts.failMsg);
        setScreen("error");
      }
    };
    ws.on("message", authHandler);
  }, [wireSocket, addMessage]);

  const handleStart = useCallback((password: string) => {
    setConnectSubtitle("Starting server...");
    setScreen("connecting");
    setIsHost(true);

    startServer();

    const code = generateRoomCode(6);

    const connectToRelay = (fullCode: string) => {
      setRoomCode(fullCode);
      let attempts = 0;
      const tryConnect = () => {
        attempts++;
        const ws = joinRoom(code, password);

        ws.on("open", () => {
          setupAuth(ws, {
            room: code, host: 'localhost:4001', password,
            onSuccess: () => addMessage({ type: "system", text: `Room ${fullCode} created` }),
            failMsg: "Authentication failed",
          });
        });

        ws.on("error", () => {
          if (attempts < 5) {
            setTimeout(tryConnect, 1000);
          } else {
            setErrorMsg("Server failed to start");
            setScreen("error");
          }
        });
      };
      tryConnect();
    };

    setConnectSubtitle("Starting tunnel...");
    startTunnel().then((tunnelHost) => {
      connectToRelay(`${code}@${tunnelHost}`);
    }).catch(() => {
      connectToRelay(code);
      addMessage({ type: "system", text: "Tunnel failed — room is local-only (localtunnel unavailable?)" });
    });
  }, [addMessage, wireSocket, setupAuth]);

  const handleJoin = useCallback((fullCode: string, password: string) => {
    setRoomCode(fullCode);
    setConnectSubtitle("Joining room...");
    setScreen("connecting");
    setIsHost(false);

    const ws = joinRoom(fullCode, password);
    const { code: bareCode, host } = parseRoomCode(fullCode);

    ws.on("open", () => {
      setupAuth(ws, {
        room: bareCode, host, password,
        failMsg: "Invalid room password",
      });
    });

    ws.on("error", (err: Error) => {
      setErrorMsg(`Could not connect: ${err.message}`);
      setScreen("error");
    });
  }, [wireSocket, setupAuth]);

  const handleEnd = useCallback(() => {
    if (socket) {
      intentionalClose.current = true;
      socket.close();
      setSocket(null);
    }
    if (isHost) {
      stopTunnel();
      stopServer();
    }
    setScreen("welcome");
    setMessages([]);
    setUsers([]);
    setUptime(0);
    setRoomCode("");
    setIsHost(false);
    uninstallHooks(process.cwd());
    colorMap.current.clear();
    nextColorIdx.current = 0;
    statsMap.current.clear();
    pendingDiffs.current.clear();
  }, [socket, isHost]);

  const handleExport = useCallback(() => {
    const lines = messages.map((m) => {
      const time = formatTime(m.timestamp);
      switch (m.type) {
        case "join":
          return `[${time}] ${m.user?.name} joined`;
        case "leave":
          return `[${time}] ${m.user?.name} left`;
        case "prompt":
          return `[${time}] ${m.user?.name} -> Prompt: ${m.text}`;
        case "chat":
          return `[${time}] ${m.user?.name}: ${m.text}`;
        case "tool_call":
          return `[${time}] ${m.user?.name} -> ${m.text}`;
        case "system":
          return `[${time}] ${m.text}`;
        default:
          return `[${time}] ${m.text}`;
      }
    });
    const safeCode = roomCode.replace(/[^a-zA-Z0-9._@-]/g, "_");
    const filename = `codecast-${safeCode}-${Date.now()}.txt`;
    writeFileSync(filename, lines.join("\n") + "\n");
    addMessage({ type: "system", text: `Chat exported to ${filename}` });
  }, [messages, roomCode, addMessage]);

  const handleCommand = useCallback(
    (input: string) => {
      if (input.startsWith("/")) {
        const cmd = input.slice(1).toLowerCase().trim();
        if (cmd === "end") {
          handleEnd();
          return;
        }
        if (cmd === "quit") {
          handleEnd();
          process.exit(0);
        }
        if (cmd === "copy") {
          const clipCmd = process.platform === "win32" ? "clip" : process.platform === "darwin" ? "pbcopy" : "xclip -selection clipboard";
          try {
            execSync(clipCmd, { input: roomCode, stdio: ["pipe", "ignore", "ignore"] });
            addMessage({ type: "system", text: `Room code copied: ${roomCode}` });
          } catch {
            addMessage({ type: "system", text: `Room code: ${roomCode}` });
          }
          return;
        }
        if (cmd === "export") {
          handleExport();
          return;
        }
        if (cmd === "filter") {
          setShowToolCalls((prev) => !prev);
          addMessage({ type: "system", text: showToolCalls ? "Tool calls hidden." : "Tool calls visible." });
          return;
        }
        if (cmd === "stats") {
          const entries = Array.from(statsMap.current.entries())
            .map(([name, s]) => ({ name, total: s.prompts + s.toolCalls, ...s }))
            .sort((a, b) => b.total - a.total);
          if (entries.length === 0) {
            addMessage({ type: "system", text: "No activity yet." });
          } else {
            const activityLines = entries.map((e, i) => {
              const medal = i === 0 ? "\u{1F947}" : i === 1 ? "\u{1F948}" : i === 2 ? "\u{1F949}" : `#${i + 1}`;
              return `${medal} ${e.name}  ${e.total} total \u2502 ${e.prompts} prompts \u2502 ${e.toolCalls} tool calls`;
            });
            const diffEntries = entries
              .filter((e) => e.additions || e.deletions)
              .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions));
            const diffLines = diffEntries.map((e, i) => {
              const medal = i === 0 ? "\u{1F947}" : i === 1 ? "\u{1F948}" : i === 2 ? "\u{1F949}" : `#${i + 1}`;
              return `${medal} ${e.name}  +${e.additions} -${e.deletions}`;
            });
            let text = "--- Activity Rankings ---\n" + activityLines.join("\n");
            if (diffLines.length > 0) {
              text += "\n\n--- Line Changes ---\n" + diffLines.join("\n");
            }
            addMessage({ type: "system", text });
          }
          return;
        }
        if (cmd === "help") {
          addMessage({
            type: "system",
            text: "Commands: /copy (copy room code), /end (leave room), /export (save chat), /filter (toggle tool calls), /help (this message), /quit (exit), /stats (activity rankings)",
          });
          return;
        }
        addMessage({
          type: "system",
          text: `Unknown command: /${cmd}. Type /help for available commands.`,
        });
        return;
      }
      // Send message to server — it will broadcast back to everyone
      if (socket) {
        socket.send(input);
      }
    },
    [addMessage, handleEnd, handleExport, socket, showToolCalls]
  );

  // Stable ref so InputBar never re-renders from upstream state changes.
  // This prevents useInput unsubscribe/resubscribe cycles that drop
  // keystrokes on Windows.
  const handleCommandRef = useRef(handleCommand);
  handleCommandRef.current = handleCommand;
  const stableHandleCommand = useCallback((input: string) => {
    handleCommandRef.current(input);
  }, []);

  return {
    screen,
    setScreen,
    roomCode,
    users,
    messages,
    uptime,
    errorMsg,
    setErrorMsg,
    connectSubtitle,
    handleStart,
    handleJoin,
    handleEnd,
    handleCommand: stableHandleCommand,
    showToolCalls,
  };
};

// ─── App ────────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const { exit } = useApp();

  // Keep stdin raw mode alive across all screens. Without this, the
  // "connecting" screen (which has no input components) causes Ink to
  // drop raw mode. On Windows, re-enabling it doesn't reliably resume
  // the stdin readable listener, freezing input on the session screen.
  useInput(() => {});

  // Clear terminal on resize to prevent ghost frames
  useEffect(() => {
    const onResize = () => process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.on("resize", onResize);
    return () => { process.stdout.off("resize", onResize); };
  }, []);

  const {
    screen,
    setScreen,
    roomCode,
    users,
    messages,
    uptime,
    errorMsg,
    connectSubtitle,
    handleStart,
    handleJoin,
    handleCommand,
    showToolCalls,
  } = useHandlers();

  const visibleMessages = useMemo(() =>
    showToolCalls
      ? messages
      : messages.filter((m) => m.type !== "tool_call"),
    [messages, showToolCalls]
  );

  const onWelcomeSelect = useCallback(
    (item: { value: string }) => {
      switch (item.value) {
        case "start":
          setScreen("set-password");
          break;
        case "join":
          setScreen("join");
          break;
        case "quit":
          exit();
          break;
      }
    },
    [setScreen, exit]
  );

  const onErrorSelect = useCallback(
    (item: { value: string }) => {
      if (item.value === "retry") {
        setScreen("welcome");
      } else {
        exit();
      }
    },
    [setScreen, exit]
  );

  switch (screen) {
    case "welcome":
      return <WelcomeScreen onSelect={onWelcomeSelect} />;
    case "set-password":
      return (
        <PasswordSetScreen
          onSubmit={handleStart}
          onBack={() => setScreen("welcome")}
        />
      );
    case "join":
      return (
        <JoinScreen
          onSubmit={handleJoin}
          onBack={() => setScreen("welcome")}
        />
      );
    case "connecting":
      return <ConnectingScreen subtitle={connectSubtitle} />;
    case "session":
      return (
        <SessionScreen
          roomCode={roomCode}
          users={users}
          messages={visibleMessages}
          uptime={uptime}
          onInput={handleCommand}
        />
      );
    case "error":
      return <ErrorScreen message={errorMsg} onSelect={onErrorSelect} />;
    default:
      return null;
  }
};

export default App;
