# API
## Rules:
### response_name,all,variables,separated,by,comma = response_code(look down),answer_to_request,all,descriptions,separated,by,comma

### response_code:

- a - approved
- d - denied
- i - info for game

### card:
012

0 - type

1 - color (value meaning depends on type)

2 - number (value meaning depends on type)

### In case of bad response:
Write your response variables for two (or more) possible response status by /

Example:

create_player,player_name = response_status,player_id/error_description

# All requests

## Client → server

create_player,player_name = response_status,player_id/error_description

create_room,player_id = response_status,room_id/error_description

join_room,player_id,room_id = response_status,room_id/error_description

leave_room,player_id = response_status,description/error


### Start room_info:

room_info,player_id = response_status,roomates_names_order/error_description,room_owner_name/NONE,game_started/NONE,current_card/NONE,player_number_to_move/NONE,cards_left

roomates_names_order = roommate_1#number_of_his_cards|you#your.cards.separated.by.dot (can be empty: you#|)

you - means player which requested room_info, instead of "you" in answer will be his name

### :End room_info

place_card,player_id,card,new_color = room_info

take_card,player_id = room_info

skip_move,player_id = room_info

uno_press,player_id = room_info


## Info's from server → client

i,place_card,player_order,card

i,room_info,room-info

a,leave_room,Left room

i,uno_punish,player_to_punish_name

i,uno_protection,player_to_protect_name

i,uno_false,no_one_has_uno_+2

# Test Requests

create_player,Anready

create_room,345678

join_room,246587,795268

