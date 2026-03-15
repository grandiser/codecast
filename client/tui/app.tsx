import React, { useState, useEffect, useCallback, useRef } from "react";
import { Text, Box, useInput, useApp, useStdout } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import SelectInput from "ink-select-input";
import { writeFileSync } from "fs";
import { basename } from "path";
import { generateRoomCode, joinRoom, joinRoomLocal, parseRoomCode, startServer, stopServer, startTunnel, stopTunnel, username, installHooks, uninstallHooks } from "../lib/room.js";
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
 ___ ___   __| | ___  ___ __ _ ___| |_
/ __/ _ \\ / _\` |/ _ \\/ __/ _\` / __| __|
| (_| (_) | (_| |  __/ (_| (_| \\__ \\ |_
\\___\\___/ \\__,_|\\___|\\___|\\__,_|___/\\__|`;

const COMMANDS = [
  { name: "/end", desc: "leave room" },
  { name: "/export", desc: "save chat to file" },
  { name: "/help", desc: "show commands" },
  { name: "/quit", desc: "exit codecast" },
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
  type: "join" | "leave" | "prompt" | "tool_call" | "file_edit" | "chat" | "system";
  user?: User;
  text: string;
  timestamp: Date;
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
    { label: "Start New Room", value: "start" },
    { label: "Join Room", value: "join" },
    { label: "Quit", value: "quit" },
  ];

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      <BorderBox width={52}>
        <Text color="cyan" bold>
          {ASCII_LOGO}
        </Text>
        <Box marginTop={1}>
          <Text dimColor>see your team code, in real-time.</Text>
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

const EventItem: React.FC<{ event: EventMessage }> = ({ event }) => {
  const time = formatTime(event.timestamp);

  switch (event.type) {
    case "join":
      return (
        <Box>
          <Text dimColor>
            [{time}] -- {event.user?.avatar} {event.user?.name} joined --
          </Text>
        </Box>
      );

    case "leave":
      return (
        <Box>
          <Text dimColor>
            [{time}] -- {event.user?.avatar} {event.user?.name} left --
          </Text>
        </Box>
      );

    case "prompt":
      return (
        <Box>
          <Text dimColor>[{time}] </Text>
          <Text color={event.user?.color} bold>
            {event.user?.avatar} {event.user?.name}
          </Text>
          <Text dimColor> {"\u2192"} Prompt:
          </Text>
          <Text> {event.text}</Text>
        </Box>
      );

    case "tool_call":
      return (
        <Box>
          <Text dimColor>[{time}] </Text>
          <Text color={event.user?.color} bold>
            {event.user?.avatar} {event.user?.name}
          </Text>
          <Text dimColor> {"\u2192"} </Text>
          <Text>{event.text}</Text>
        </Box>
      );

    case "file_edit":
      return (
        <Box>
          <Text dimColor>[{time}] </Text>
          <Text color={event.user?.color} bold>
            {event.user?.avatar} {event.user?.name}
          </Text>
          <Text dimColor> {"\u2192"} editing: </Text>
          <Text color="yellow">{event.text}</Text>
        </Box>
      );

    case "chat":
      return (
        <Box>
          <Text dimColor>[{time}] </Text>
          <Text color={event.user?.color} bold>
            {event.user?.avatar} {event.user?.name}
          </Text>
          <Text>: {event.text}</Text>
        </Box>
      );

    case "system":
      return (
        <Box>
          <Text dimColor>
            [{time}] {event.text}
          </Text>
        </Box>
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
}> = ({ onSubmit }) => {
  const [value, setValue] = useState("");

  const handleSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  };

  const showSuggestions = value.startsWith("/") && !value.includes(" ");
  const filtered = showSuggestions
    ? COMMANDS.filter((c) => c.name.startsWith(value))
    : [];

  return (
    <Box flexDirection="column">
      {filtered.length > 0 && (
        <Box flexDirection="column" paddingX={1} marginBottom={0}>
          {filtered.map((c) => (
            <Box key={c.name}>
              <Text color="cyan" bold>{c.name}</Text>
              <Text dimColor>  {c.desc}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box>
        <Text color="cyan">{"> "}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder="type a message or /command..."
          focus={true}
        />
      </Box>
    </Box>
  );
};

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

  // Color assignment: self = cyan, others get unique colors from pool
  const colorMap = useRef(new Map<string, UserColor>());
  const nextColorIdx = useRef(0);

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

  const addMessage = useCallback((msg: Omit<EventMessage, "id">) => {
    setMessages((prev) => [...prev, { ...msg, id: mkId() }]);
  }, []);

  // Parse incoming server messages and update state
  const wireSocket = useCallback((ws: WebSocket) => {
    ws.on("message", (data) => {
      const text = data.toString();
      const now = new Date();

      // Try parsing as JSON (from hook scripts)
      if (text.startsWith("{")) {
        try {
          const parsed = JSON.parse(text);
          // Hook sends: {"type": "prompt"|"tool_call", "user": "name", "text": "..."}
          // The relay wraps it as "hookuser: {json}", so we get the inner JSON
          const user = getUser(parsed.user);
          const msgType = parsed.type === "tool_call" ? "tool_call"
            : parsed.type === "file_edit" ? "file_edit"
            : "prompt";
          addMessage({ type: msgType, user, text: parsed.text, timestamp: now });
          return;
        } catch {}
      }

      // Relay wraps hook messages as "user_hook: {json}" — unwrap them
      const colonIdx = text.indexOf(": ");
      if (colonIdx > 0) {
        const afterColon = text.slice(colonIdx + 2);
        if (afterColon.startsWith("{")) {
          try {
            const parsed = JSON.parse(afterColon);
            const user = getUser(parsed.user);
            const msgType = parsed.type === "tool_call" ? "tool_call"
              : parsed.type === "file_edit" ? "file_edit"
              : "prompt";
            addMessage({ type: msgType, user, text: parsed.text, timestamp: now });
            return;
          } catch {}
        }
      }

      // Server sends: "username connected"
      if (text.endsWith(" connected")) {
        const name = text.slice(0, -" connected".length);
        // Skip hook user connections
        if (name.endsWith("_hook")) return;
        const user = getUser(name);
        setUsers((prev) =>
          prev.some((u) => u.name === name) ? prev : [...prev, user]
        );
        addMessage({ type: "join", user, text: "", timestamp: now });
        return;
      }

      // Server sends: "username dropped out"
      if (text.endsWith(" dropped out")) {
        const name = text.slice(0, -" dropped out".length);
        if (name.endsWith("_hook")) return;
        const user = getUser(name);
        setUsers((prev) => prev.filter((u) => u.name !== name));
        addMessage({ type: "leave", user, text: "", timestamp: now });
        return;
      }

      // Server sends: "username: message text" (plain chat)
      if (colonIdx > 0) {
        const name = text.slice(0, colonIdx);
        const msg = text.slice(colonIdx + 2);
        const user = getUser(name);
        addMessage({ type: "chat", user, text: msg, timestamp: now });
        return;
      }

      // Fallback — show as system message
      addMessage({ type: "system", text, timestamp: now });
    });

    ws.on("close", () => {
      addMessage({ type: "system", text: "Disconnected from server", timestamp: new Date() });
    });
  }, [addMessage, getUser]);

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
        const ws = joinRoomLocal(code, password);

        ws.on("open", () => {
          const authHandler = (data: any) => {
            const text = data.toString();
            if (text === "__auth_ok__") {
              ws.off("message", authHandler);
              setSocket(ws);
              wireSocket(ws);
              setMessages([]);
              setUptime(0);
              installHooks(process.cwd(), code, 'localhost:4001', password);
              addMessage({ type: "system", text: `Room ${fullCode} created`, timestamp: new Date() });
              setScreen("session");
            } else if (text === "__auth_fail__") {
              ws.off("message", authHandler);
              ws.close();
              setErrorMsg("Authentication failed");
              setScreen("error");
            }
          };
          ws.on("message", authHandler);
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

    // Start tunnel, then connect once we have the public URL
    setConnectSubtitle("Starting tunnel...");
    startTunnel().then((tunnelHost) => {
      connectToRelay(`${code}@${tunnelHost}`);
    }).catch(() => {
      // Tunnel failed — fall back to local-only
      connectToRelay(code);
      addMessage({ type: "system", text: "Tunnel failed — room is local-only (bore not installed?)", timestamp: new Date() });
    });
  }, [addMessage, wireSocket]);

  const handleJoin = useCallback((fullCode: string, password: string) => {
    setRoomCode(fullCode);
    setConnectSubtitle("Joining room...");
    setScreen("connecting");
    setIsHost(false);

    // joinRoom parses "code@host:port" or just "code"
    const ws = joinRoom(fullCode, password);
    const { code: bareCode, host } = parseRoomCode(fullCode);

    ws.on("open", () => {
      const authHandler = (data: any) => {
        const text = data.toString();
        if (text === "__auth_ok__") {
          ws.off("message", authHandler);
          setSocket(ws);
          wireSocket(ws);
          installHooks(process.cwd(), bareCode, host, password);
          setMessages([]);
          setUptime(0);
          setScreen("session");
        } else if (text === "__auth_fail__") {
          ws.off("message", authHandler);
          ws.close();
          setErrorMsg("Invalid room password");
          setScreen("error");
        }
      };
      ws.on("message", authHandler);
    });

    ws.on("error", (err: Error) => {
      setErrorMsg(`Could not connect: ${err.message}`);
      setScreen("error");
    });
  }, [addMessage, wireSocket]);

  const handleEnd = useCallback(() => {
    if (socket) {
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
        case "file_edit":
          return `[${time}] ${m.user?.name} -> editing: ${m.text}`;
        case "system":
          return `[${time}] ${m.text}`;
        default:
          return `[${time}] ${m.text}`;
      }
    });
    const filename = `codecast-${roomCode}-${Date.now()}.txt`;
    writeFileSync(filename, lines.join("\n") + "\n");
    addMessage({ type: "system", text: `Chat exported to ${filename}`, timestamp: new Date() });
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
        if (cmd === "export") {
          handleExport();
          return;
        }
        if (cmd === "help") {
          addMessage({
            type: "system",
            text: "Commands: /end (leave room), /export (save chat), /help (this message), /quit (exit)",
            timestamp: new Date(),
          });
          return;
        }
        addMessage({
          type: "system",
          text: `Unknown command: /${cmd}. Type /help for available commands.`,
          timestamp: new Date(),
        });
        return;
      }
      // Send message to server — it will broadcast back to everyone
      if (socket) {
        socket.send(input);
      }
    },
    [addMessage, handleEnd, handleExport, socket]
  );

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
    handleCommand,
  };
};

// ─── App ────────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const { exit } = useApp();

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
  } = useHandlers();

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
    [handleStart, setScreen, exit]
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
          messages={messages}
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
