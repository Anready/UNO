import random
import asyncio
import websockets


class Client:
    def __init__(self, client_id, name, web_socket):
        self.client_id = client_id
        self.name = name
        self.room_id = None
        self.cards: list[str] = []
        self.web_socket = web_socket
        self.taken_card = None
        self.uno_pressed: bool = False

    def set_room_id(self, room_id):
        self.room_id = room_id

    def append_card(self, card):
        self.cards.append(card)

    def reset_client(self):
        self.room_id = None
        self.cards: list[str] = []
        self.taken_card = None
        self.uno_pressed: bool = False


class Room:
    def __init__(self, room_id, room_owner: Client):
        self.room_id = room_id
        self.room_owner = room_owner
        self.clients: list[Client] = []
        self.current_card = None
        self.all_cards: list[str] = []
        self.current_player_move: Client = None
        self.players_order_clockwise: bool = True
        self.is_game_started: bool = False
        self.room_color = None
        self.move_made_after_uno = True

    def add_player(self, player: Client):
        self.clients.append(player)

    def remove_player(self, player: Client):
        self.clients.remove(player)

    def set_clients(self, players):
        self.clients = players

    def set_current_card(self, card):
        self.current_card = card

    def reset_room(self):
        self.current_card = None
        self.all_cards: list[str] = []
        self.current_player_move: Client = None
        self.players_order_clockwise: bool = True
        self.is_game_started: bool = False
        self.room_color = None


"""
Global Variables
"""
all_rooms: dict[str, Room] = {}
all_clients: dict[str, Client] = {}
all_cards: list[str] = []


"""
Send Messages to roommates
"""
async def send_message_to_roommates(player: Client, message):
    new_clients = []
    for client in all_rooms[player.room_id].clients:
        try:
            await client.web_socket.send("i," + message)
            new_clients.append(client)
        except websockets.exceptions.ConnectionClosedOK:
            print("Клиент отключился")
            all_clients.pop(client.client_id)

    all_rooms[player.room_id].set_clients(new_clients)


"""
Send Room Info to all it members
"""
async def send_room_info_to_members(room: Room):
    for room_player in room.clients:
        await room_player.web_socket.send(f"i,room_info,{get_room_clients(room, room_player)},{room.room_owner.name}," +
                                          f"{room.is_game_started},{room.current_card},{str(get_player_to_move(room))}," +
                                          f"{len(room.all_cards)},{str(room.room_color)}")


"""
Send 'Place card' message
"""
async def send_place_card_to_roommates(room: Room, card, old_player_to_move):
    for room_player in room.clients:
        await room_player.web_socket.send(f"i,place_card,{get_room_clients(room, room_player)},{old_player_to_move},{card}")


"""
Generation of unic ID's
"""
def generate_id(is_client):
    generated_id = "0"
    def create_random_id():
        random_id = random.randint(0, 999999)
        return "0" * (6-len(str(random_id))) + str(random_id)

    if is_client:
        while all_clients.get(generated_id) is not None or generated_id == "0":
            generated_id = create_random_id()
    else:
        while all_rooms.get(generated_id) is not None or generated_id == "0":
            generated_id = create_random_id()

    return generated_id


"""
Room creation
"""
def create_room(room_owner: Client):
    room_id = generate_id(False)
    new_room = Room(room_id, room_owner)
    new_room.add_player(room_owner)
    room_owner.set_room_id(room_id)
    all_rooms[room_id] = new_room


"""
Get all info about others and player-self in a room (name,cards/cards_amount)
"""
def get_room_clients(room: Room, player: Client):
    names_list = ""
    for client in room.clients:
        cards = ""
        amount_of_cards = 0
        is_now_current_player = player.client_id == client.client_id
        for card in client.cards:
            if is_now_current_player:
                cards += card + "."
            else:
                amount_of_cards += 1

        if not is_now_current_player:
            cards = str(amount_of_cards)
        else:
            cards = cards[:-1]

        names_list += client.name + "#" + cards +  "|"
    names_list = names_list[:-1]
    return names_list


"""
Return 'in list (room.clients)' positon of player which must move
"""
def get_player_to_move(room: Room):
    player_to_move = 0
    if room.current_player_move is not None:
        for i in room.clients:
            if room.current_player_move.client_id == i.client_id:
                break
            player_to_move += 1
    else:
        player_to_move = "None"

    return player_to_move

def get_player_id(player: Client, room: Room) -> int:
    for room_player_id in range(0, len(room.clients)):
        if room.clients[room_player_id].client_id == player.client_id:
            return room_player_id

    return -1


"""
Full deck creation (or re-creation, if no cards left)
"""
def create_deck(room: Room = None) -> list[str]:
    room_cards = []
    players_cards = []

    if room is not None:
        players_cards.append(room.current_card)
        for player in room.clients:
            for card in player.cards:
                players_cards.append(card)

    for card in all_cards:
        if card not in players_cards:
            room_cards.append(card)
        else:
            players_cards.remove(card)

    random.shuffle(room_cards)
    while room_cards[len(room_cards) - 1][0] == "2":
        random.shuffle(room_cards)

    return room_cards


"""
Give card(s) to player
"""
async def give_card_to_player(player: Client, room: Room, cards_amount = 1):
    for _ in range(cards_amount):
        if len(room.all_cards) == 0:
            room.all_cards = create_deck(room)

        new_player_card = room.all_cards.pop()
        player.append_card(new_player_card)
        player.uno_pressed = False
        await send_place_card_to_roommates(room, -1, get_player_id(player, room))


"""
Create, deal cards. Set first card
"""
async def init_and_deal_cards(room: Room):
    room.all_cards = create_deck()
    room.set_current_card(room.all_cards.pop())
    room.room_color = room.current_card[1]

    for _ in range(7):
        for player in room.clients:
            await give_card_to_player(player, room)


"""
Game Logic Start: Check if move legal
"""
def is_move_legal(card: str, room_card: str, room_color: str):
    card_type = card[0]
    card_color = card[1]
    card_number = card[2]

    room_card_type = room_card[0]
    room_card_color = room_card[1]
    room_card_number = room_card[2]

    if card_type == "2":
        return True

    if (card_type == "0" or card_type == "1") and (room_card_type == "0" or room_card_type == "1"):
        if room_card_color == card_color:
            return True
        elif room_card_number == card_number and room_card_type == card_type:
            return True
        else:
            return False

    if room_card_type == "2":
        return card_color == room_color

    return False


"""
Get next player to move ::combination::
"""
def get_next_player_id(room: Room) -> int:
    player_to_move = get_player_to_move(room)
    all_room_players = room.clients
    player_order_clockwise = room.players_order_clockwise

    sign = 1

    if not player_order_clockwise:
        sign = -1

    if player_to_move + sign == len(all_room_players) or player_to_move + sign == -1:
        if sign == -1:
            return len(all_room_players) - 1
        else:
            return 0

    return player_to_move + sign


def get_next_player(room: Room) -> Client:
    return room.clients[get_next_player_id(room)]


"""
Place and execute card, set next player
"""
async def place_card(room: Room, player: Client, card: str, new_color: str):
    player.cards.remove(card)

    card_type = card[0]
    card_color = card[1]
    card_number = card[2]

    next_player = get_next_player(room)

    if card_type == "2":
        room.room_color = new_color
        if card_number == "1":
            await give_card_to_player(next_player, room, 4)

    if card_type == "1":
        if card_number == "0":
            room.current_player_move = next_player
            next_player = get_next_player(room)
        elif card_number == "1":
            room.players_order_clockwise = not room.players_order_clockwise
            next_player = get_next_player(room)
        elif card_number == "2":
            await give_card_to_player(next_player, room, 2)

    room.set_current_card(card)
    room.current_player_move = next_player
    if card_type != "2":
        room.room_color = card_color


def skip_move(room: Room):
    room.current_player_move = get_next_player(room)


"""
Player pressed button 'Uno'
"""
async def handle_uno_press(room_player: Client, room: Room):
    player_got_cards = []
    for player in room.clients:
        if len(player.cards) == 1 and not player.uno_pressed and room_player.client_id != player.client_id:
            await give_card_to_player(player, room, 2)
            player_got_cards.append(player.name)
            await send_message_to_roommates(player, f"uno_punish,{player.name},{room_player.name}")
            room.move_made_after_uno = False
        elif len(player.cards) == 1 and not player.uno_pressed and room_player.client_id == player.client_id:
            player.uno_pressed = True
            player_got_cards.append(player.name)
            await send_message_to_roommates(player, f"uno_protection,{player.name}")
            room.move_made_after_uno = False

    if len(player_got_cards) == 0 and room.move_made_after_uno:
        await room_player.web_socket.send("i,uno_false,You got 2 more cards for false press")
        await give_card_to_player(room_player, room, 2)


async def handler(websocket):
    print("Client connected!")
    current_player_id = None
    try:
        async for message in websocket:
            print(f"Got from a client: {message}")
            match message.split(",")[0]:
                case "create_player":
                    player_id = generate_id(True)
                    player = Client(player_id, message.split(",")[1], websocket)
                    all_clients[player.client_id] = player
                    current_player_id = player_id
                    await websocket.send("a,create_player,"+ player.client_id)
                case "create_room":
                    room_owner = all_clients.get(message.split(",")[1])
                    if room_owner is None:
                        await websocket.send("d,create_room,User not exists")
                        continue
                    if room_owner.room_id is not None:
                        await websocket.send("d,create_room,User already in room")
                        continue

                    create_room(room_owner)
                    await websocket.send(f"a,create_room,{room_owner.room_id}")
                    await send_message_to_roommates(room_owner, "Room Created!")
                case "join_room":
                    room_player = all_clients.get(message.split(",")[1])
                    room = all_rooms.get(message.split(",")[2])
                    if room_player is None:
                        await websocket.send("d,join_room,User not exists")
                        continue
                    if room is None:
                        await websocket.send("d,join_room,Room not exists")
                        continue
                    if room_player.room_id == room.room_id:
                        await websocket.send("d,join_room,User already in this room")
                        continue
                    if room.is_game_started:
                        await websocket.send("d,join_room,Game started")
                        continue
                    if len(room.clients) >= 10:
                        await websocket.send("d,join_room,Room is full")

                    room.add_player(room_player)
                    room_player.set_room_id(room.room_id)
                    room_player.cards = []
                    room_player.taken_card = None

                    await websocket.send(f"a,join_room,{room.room_id}")
                    await send_message_to_roommates(room_player, f"New player joined: {room_player.name}")
                case "leave_room":
                    room_player = all_clients.get(message.split(",")[1])
                    if room_player is None:
                        await websocket.send("d,leave_room,User not exists")
                        continue
                    if room_player.room_id is None:
                        await websocket.send("d,leave_room,You are not in a room")
                        continue

                    room = all_rooms.get(room_player.room_id)
                    if room is None:
                        await websocket.send("d,leave_room,Room not exists")
                        continue

                    await send_message_to_roommates(room_player, f"Player left: {room_player.name}")


                    if room.is_game_started:
                        if room.current_player_move.client_id == room_player.client_id:
                            if len(room.clients) >= 3:
                                room.current_player_move = get_next_player(room)
                                room.remove_player(room_player)
                                await send_room_info_to_members(room)

                    if room_player in room.clients:
                        room.remove_player(room_player)

                    room_player.reset_client()

                    await send_room_info_to_members(room)

                    if room.is_game_started:
                        clients_length = len(room.clients)
                        if clients_length == 1:
                            last_client = room.clients[0]
                            last_client.reset_client()
                            await last_client.web_socket.send("a,leave_room,Left room")
                            all_rooms.pop(room.room_id)

                    if room.room_id in all_rooms and len(room.clients) == 0:
                        all_rooms.pop(room.room_id)
                    else:
                        if room.room_owner.client_id == room_player.client_id:
                            room.room_owner = room.clients[0]

                    await websocket.send("a,leave_room,Left room")
                case "room_info":
                    room_player = all_clients.get(message.split(",")[1])
                    if room_player is None:
                        await websocket.send("d,room_info,User not exists")
                        continue
                    if room_player.room_id is None:
                        await websocket.send("d,room_info,You are not in a room")
                        continue

                    room = all_rooms.get(room_player.room_id)
                    if room is None:
                        await websocket.send("d,room_info,Room not exists")
                        continue

                    player_to_move = get_player_to_move(room)

                    await websocket.send(f"a,room_info,{get_room_clients(room, room_player)},{room.room_owner.name},"
                                         f"{room.is_game_started},{room.current_card},{str(player_to_move)},"
                                         f"{len(room.all_cards)},{str(room.room_color)}")
                case "start_game":
                    room_player = all_clients.get(message.split(",")[1])
                    if room_player is None:
                        await websocket.send("d,start_game,User not exists")
                        continue
                    if room_player.room_id is None:
                        await websocket.send("d,start_game,You are not in a room")
                        continue

                    room = all_rooms.get(room_player.room_id)
                    if room is None:
                        await websocket.send("d,start_game,Room not exists")
                        continue
                    if room_player.client_id != room.room_owner.client_id:
                        await websocket.send("d,start_game,You are not a owner of the room!")
                        continue
                    if len(room.clients) < 2:
                        await websocket.send("d,start_game,Not enough players to start (minimum 2)")
                        continue

                    room.current_player_move = room_player
                    await init_and_deal_cards(room)
                    room.is_game_started = True
                    await send_room_info_to_members(room)
                case "place_card":
                    room_player = all_clients.get(message.split(",")[1])
                    if room_player is None:
                        await websocket.send("d,place_card,User not exists")
                        continue
                    if room_player.room_id is None:
                        await websocket.send("d,place_card,You are not in a room")
                        continue

                    room = all_rooms.get(room_player.room_id)
                    if room is None:
                        await websocket.send("d,place_card,Room not exists")
                        continue
                    if not room.is_game_started:
                        await websocket.send("d,place_card,Game not started!")
                        continue
                    if room.current_player_move.client_id != room_player.client_id:
                        await websocket.send("d,place_card,Not your order!")
                        continue


                    card = message.split(",")[2]

                    if room_player.taken_card is not None:
                        if room_player.taken_card != card:
                            await websocket.send("d,place_card,You can make move only with your last card or skip!")
                            continue

                    if not is_move_legal(card, room.current_card, room.room_color):
                        await websocket.send("d,place_card,Not a legal move!")
                        continue

                    old_player_to_move = get_player_to_move(room)
                    new_color = message.split(",")[3]
                    room_player.taken_card = None
                    await place_card(room, room_player, card, new_color)

                    await send_place_card_to_roommates(room, card, old_player_to_move)
                    if len(room_player.cards) == 0:
                        room.reset_room()
                        for player in room.clients:
                            player.cards = []

                        await send_message_to_roommates(room_player, f"game_win,{room_player.name}")

                    room.move_made_after_uno = True
                    await send_room_info_to_members(room)
                case "take_card":
                    room_player = all_clients.get(message.split(",")[1])
                    if room_player is None:
                        await websocket.send("d,take_card,User not exists")
                        continue
                    if room_player.room_id is None:
                        await websocket.send("d,take_card,You are not in a room")
                        continue

                    room = all_rooms.get(room_player.room_id)
                    if room is None:
                        await websocket.send("d,take_card,Room not exists")
                        continue
                    if not room.is_game_started:
                        await websocket.send("d,take_card,Game not started!")
                        continue
                    if room.current_player_move.client_id != room_player.client_id:
                        await websocket.send("d,take_card,Not your order!")
                        continue
                    if room_player.taken_card is not None:
                        await websocket.send("d,take_card,You can take only one card!")
                        continue

                    last_card = room.all_cards[-1]
                    await give_card_to_player(room_player, room)
                    room_player.taken_card = last_card

                    await send_room_info_to_members(room)
                case "skip_move":
                    room_player = all_clients.get(message.split(",")[1])
                    if room_player is None:
                        await websocket.send("d,skip_move,User not exists")
                        continue
                    if room_player.room_id is None:
                        await websocket.send("d,skip_move,You are not in a room")
                        continue

                    room = all_rooms.get(room_player.room_id)
                    if room is None:
                        await websocket.send("d,skip_move,Room not exists")
                        continue
                    if not room.is_game_started:
                        await websocket.send("d,skip_move,Game not started!")
                        continue
                    if room.current_player_move.client_id != room_player.client_id:
                        await websocket.send("d,skip_move,Not your order!")
                        continue
                    if room_player.taken_card is None:
                        await websocket.send("d,skip_move,Take card first!")
                        continue

                    skip_move(room)
                    room_player.taken_card = None
                    room.move_made_after_uno = True
                    await send_room_info_to_members(room)
                case "uno_press":
                    room_player = all_clients.get(message.split(",")[1])
                    if room_player is None:
                        await websocket.send("d,skip_move,User not exists")
                        continue
                    if room_player.room_id is None:
                        await websocket.send("d,skip_move,You are not in a room")
                        continue

                    room = all_rooms.get(room_player.room_id)
                    if room is None:
                        await websocket.send("d,skip_move,Room not exists")
                        continue
                    if not room.is_game_started:
                        await websocket.send("d,skip_move,Game not started!")
                        continue

                    await handle_uno_press(room_player, room)
                    await send_room_info_to_members(room)
    except Exception as e:
        print(e)
        print("Client disconnected")

    if current_player_id is not None:
        if current_player_id in all_clients:
            player = all_clients[current_player_id]
            if player.room_id in all_rooms:
                room = all_rooms[player.room_id]
                if room.is_game_started:
                    if room.current_player_move.client_id == player.client_id:
                        if len(room.clients) >= 3:
                            room.current_player_move = get_next_player(room)
                            room.remove_player(player)
                            await send_room_info_to_members(room)

                if player in room.clients:
                    room.remove_player(player)
                if room.is_game_started:
                    clients_length = len(room.clients)

                    if clients_length == 1:
                        last_client = room.clients[0]
                        last_client.reset_client()
                        await last_client.web_socket.send("a,leave_room,Left room")
                        all_rooms.pop(room.room_id)

                if room.room_id in all_rooms and len(room.clients) == 0:
                    all_rooms.pop(room.room_id)
                else:
                    if room.room_owner.client_id == player.client_id:
                        room.room_owner = room.clients[0]

            all_clients.pop(current_player_id)
            print(f"Player {current_player_id} deleted")


def fill_cards():
    """
    :CARDS:

    012 (type color number)
    type:
     - 0 - default playing cards
     - 1 - action playing cards
     - 2 - special cards
    number:
     when type 0:
       0,1,2,3,4,5,6,7,8,9
     when type 1:
       0 (block), 1 (reverse), 2 (+2)
     when type 2:
       0 (change color), 1 (+4)
    color:
     when type 0-1:
       0 (red), 1 (green), 2 (blue), 3 (yellow)
     when type 2:
       0 (any color)
    """

    for _ in range(2):
        for color in range(0,4):
            for number in range (1,10):
                all_cards.append("0" + str(color) + str(number))
            for special_card in range (0,3):
                all_cards.append("1" + str(color) + str(special_card))

    for _ in range(0,4):
        for special_card in range (0,2):
            all_cards.append("20" + str(special_card))

    print("Cards filled successfully")


async def main():
    fill_cards()
    async with websockets.serve(handler, "0.0.0.0", 8000):
        print("Server started at ws://0.0.0.0:8000")
        await asyncio.Future()


asyncio.run(main())
