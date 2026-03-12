import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import { userInfo } from 'os';

let serverProcess: ChildProcess | null = null;
const username = userInfo().username;

export const generateRoomCode = (length: number) => {
    let s = '';
    Array.from({ length }).some(() => {
      s += Math.random().toString(36).slice(2);
      return s.length >= length;
    });
    return s.slice(0, length);
  };

export const joinRoom = (roomNumber: string): WebSocket => {
    let uri = `ws://localhost:4001?room=${roomNumber}&user=${username}`;
    const ws = new WebSocket(uri);
    return ws;
}

export const startServer = () => {
    serverProcess = spawn('uv', ['run', 'python', 'server/relay.py']);
}

export const createRoom = () => {
    let roomCode = generateRoomCode(6);
    joinRoom(roomCode);
}

export const serverIsRunning = (): boolean => {
    return serverProcess !== null && !serverProcess.killed;
};

export const stopServer = () => {
    if (serverIsRunning() && serverProcess) {
        serverProcess.kill();
    }
};


