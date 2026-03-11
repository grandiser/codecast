import asyncio
import websockets
from websockets import ConnectionClosed
from urllib.parse import parse_qs, urlparse

ROOMS = {}

async def send(websocket, message):
    try: 
        await websocket.send(message)
    except ConnectionClosed:
        pass

def broadcast(room, message):
    for websocket in ROOMS[room]:
        asyncio.create_task(send(websocket, message))

async def handler(websocket):
    params = parse_qs(urlparse(websocket.request.path).query)
    room = params.get("room", ["default"])[0]
    user = params.get("user", ["unkown"])[0]

    if ROOMS.get(room, None):
        ROOMS[room].add(websocket)
    else:
        print(f"Server log: Room {room} created.")
        ROOMS[room] = {websocket}

    print(f"Server log: {user} connected to room: {room}")
    broadcast(room, f"{user} connected")
    async for message in websocket:
        broadcast(room, message)
        print(f"Server log: Message sent by {user} in room: {room} : " + message)

    print(f"Server log: {user} dropped out of room: {room}")
    ROOMS[room].discard(websocket)
    broadcast(room, f"{user} dropped out")

    if not ROOMS[room]:
        print(f"Server log: Room {room} deleted.")
        del ROOMS[room]
       


async def main():
    async with websockets.serve(handler, "localhost", 4001) as server:
        await server.serve_forever()

if __name__ == "__main__":
    try:
         asyncio.run(main())
    except KeyboardInterrupt:
        pass

