# claudecast relay server

A room-based WebSocket relay. It receives messages from connected clients and fans them out to everyone else in the same room. No auth, no persistence, no business logic — just fan-out.

## How it works

- Clients connect via `ws://localhost:4001?room=ROOM_CODE&user=USERNAME`
- The server parses `room` and `user` from the URL query params
- First connection to a room code creates that room
- All subsequent connections with the same room code join it
- When a client sends a message, the server broadcasts it to every other client in the room
- On disconnect, the client is removed from the room and a leave message is broadcast
- When the last person leaves a room, the room is deleted

## Running

```bash
uv run python relay.py
```

## Testing

Open two terminals and connect with wscat:

```bash
wscat -c "ws://localhost:4001?room=test&user=alice"
wscat -c "ws://localhost:4001?room=test&user=bob"
```

Type a message in one, it appears in the other.
