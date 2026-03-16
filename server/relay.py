# /// script
# dependencies = ["websockets"]
# ///

import asyncio
import hmac
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
    for websocket in list(ROOMS.get(room, set())):
        asyncio.create_task(send(websocket, message))

async def handler(websocket):
    params = parse_qs(urlparse(websocket.request.path).query)
    room = params.get("room", ["default"])[0]
    user = params.get("user", ["unknown"])[0]
    password = params.get("password", [""])[0]

    if room not in ROOMS:
        ROOMS[room] = set()
        USERS[room] = {}
        PASSWORDS[room] = password
    elif not hmac.compare_digest(PASSWORDS.get(room, ""), password):
        await websocket.send("__auth_fail__")
        await websocket.close(4001, "Invalid password")
        return

    await websocket.send("__auth_ok__")

    # Send existing users to the newcomer (so their user list is complete)
    for existing_user in USERS[room].values():
        if not existing_user.endswith("_hook"):
            await send(websocket, f"{existing_user} connected")

    # Broadcast join before adding to room so newcomer doesn't see their own join
    broadcast(room, f"{user} connected")

    ROOMS[room].add(websocket)
    USERS[room][websocket] = user

    try:
        async for message in websocket:
            broadcast(room, f"{user}: {message}")
    finally:
        ROOMS[room].discard(websocket)
        USERS[room].pop(websocket, None)
        broadcast(room, f"{user} dropped out")

        if not ROOMS[room]:
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
