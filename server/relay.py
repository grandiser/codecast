# /// script
# dependencies = ["websockets"]
# ///

import asyncio
import websockets
from websockets import ConnectionClosed
from urllib.parse import parse_qs, urlparse

ROOMS = {}       # room -> set of websockets
USERS = {}       # room -> {websocket: username}
PASSWORDS = {}   # room -> password

async def send(websocket, message):
    try:
        await websocket.send(message)
    except ConnectionClosed:
        pass

def broadcast(room, message):
    for websocket in ROOMS.get(room, set()):
        asyncio.create_task(send(websocket, message))

async def handler(websocket):
    params = parse_qs(urlparse(websocket.request.path).query)
    room = params.get("room", ["default"])[0]
    user = params.get("user", ["unknown"])[0]
    password = params.get("password", [""])[0]

    if room not in ROOMS:
        print(f"Server log: Room {room} created.")
        ROOMS[room] = set()
        USERS[room] = {}
        PASSWORDS[room] = password
    else:
        if PASSWORDS.get(room, "") != password:
            await websocket.send("__auth_fail__")
            await websocket.close(4001, "Invalid password")
            print(f"Server log: {user} rejected from room {room} (bad password)")
            return

    await websocket.send("__auth_ok__")

    # Send existing users to the newcomer (so their user list is complete)
    for existing_user in USERS[room].values():
        if not existing_user.endswith("_hook"):
            await send(websocket, f"{existing_user} connected")

    ROOMS[room].add(websocket)
    USERS[room][websocket] = user

    print(f"Server log: {user} connected to room: {room}")
    broadcast(room, f"{user} connected")

    async for message in websocket:
        broadcast(room, f"{user}: {message}")
        print(f"Server log: Message sent by {user} in room: {room} : " + message)

    print(f"Server log: {user} dropped out of room: {room}")
    ROOMS[room].discard(websocket)
    USERS[room].pop(websocket, None)
    broadcast(room, f"{user} dropped out")

    if not ROOMS[room]:
        print(f"Server log: Room {room} deleted.")
        del ROOMS[room]
        del USERS[room]
        del PASSWORDS[room]


async def main():
    async with websockets.serve(handler, "0.0.0.0", 4001) as server:
        print("Relay listening on 0.0.0.0:4001")
        await server.serve_forever()

if __name__ == "__main__":
    try:
         asyncio.run(main())
    except KeyboardInterrupt:
        pass
