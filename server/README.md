# codecast relay server

A room-based WebSocket relay with password protection. It receives messages from connected clients and fans them out to everyone else in the same room.

## How it works

- Clients connect via `ws://localhost:4001?room=ROOM_CODE&user=USERNAME&password=PASSWORD`
- The first connection to a room code creates it and sets the password
- Subsequent connections must provide the matching password or they receive `__auth_fail__` and are disconnected
- On successful auth, the server sends `__auth_ok__` followed by a list of existing users
- When a client sends a message, the server broadcasts it to every other client in the room
- On disconnect, the client is removed and a leave message is broadcast
- When the last person leaves a room, the room is deleted

## Running

```bash
uv run relay.py
```

## Testing

Open two terminals and connect with wscat:

```bash
wscat -c "ws://localhost:4001?room=test&user=alice&password=secret"
wscat -c "ws://localhost:4001?room=test&user=bob&password=secret"
```

Type a message in one, it appears in the other.
