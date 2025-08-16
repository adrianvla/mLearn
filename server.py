# MODIFY THIS
LANGUAGE = ""
FETCH_ANKI = True
ANKI_CONNECT_URL = "http://127.0.0.1:8765"

import uvicorn
from typing import List, Tuple
import json
import urllib.request
from urllib.parse import quote
import urllib.error
import pickle
import os
import sys
import importlib
import re



# print arguments
arguments = sys.argv[1:]
print("Arguments: ", arguments)
ANKI_CONNECT_URL = arguments[0]
FETCH_ANKI = arguments[1] == "true"
LANGUAGE = arguments[2]
RESPATH = arguments[3]
print("Arguments: ", ANKI_CONNECT_URL, FETCH_ANKI, LANGUAGE)
LANGUAGE_DIR_PATH = os.path.join(RESPATH,"languages")


print("Language dir path: ", LANGUAGE_DIR_PATH)


sys.path.append(LANGUAGE_DIR_PATH)
language_module = None

language_module = importlib.import_module(LANGUAGE)

language_module.LOAD_MODULE(RESPATH)
print(language_module)
# rest api
from fastapi import FastAPI, Request
from pydantic import BaseModel
from typing import List
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()




def request(action, **params):
    return {'action': action, 'params': params, 'version': 6}


def invoke(action, **params):
    try:
        requestJson = json.dumps(request(action, **params)).encode('utf-8')
        response = json.load(urllib.request.urlopen(urllib.request.Request(ANKI_CONNECT_URL, requestJson)))
        if len(response) != 2:
            raise Exception('response has an unexpected number of fields')
        if 'error' not in response:
            raise Exception('response is missing required error field')
        if 'result' not in response:
            raise Exception('response is missing required result field')
        if response['error'] is not None:
            raise Exception(response['error'])
        return response['result']
    except urllib.error.URLError as e:
        print(f"Failed to connect to Anki: {e}")
        return None
    except Exception as e:
        print(f"An error occurred: {e}")
        return None


all_cards = []

cards_per_id = {}

words_ids = {}

who_contain = {}

def get_all_cards_CACHE():
    global all_cards
    global cards_per_id
    global words_ids
    global who_contain
    if not os.path.exists('anki-cache.pkl'):
        print("Cache file not found")
        return False
    try:
        with open(os.path.join(RESPATH,'anki-cache.pkl'), 'rb') as f:
            data = pickle.load(f)
            all_cards = data['all_cards']
            cards_per_id = data['cards_per_id']
            words_ids = data['words_ids']
            who_contain = data['who_contain']
        return True
    except Exception as e:
        print(f"Failed to load cache: {e}")
        return False


def get_all_cards():
    global FETCH_ANKI
    print("Fetch Anki is set to",FETCH_ANKI)
    if not FETCH_ANKI:
        return True
    global all_cards
    global cards_per_id
    global words_ids
    global who_contain

    print("Loading all card ids")

    card_ids = invoke('findCards', query='deck:*')
    if card_ids is None:
        print("Failed to load card ids")
        return False
    print("Loaded all card ids")
    print("Loading all cards")
    all_cards = invoke('cardsInfo', cards=card_ids)
    if all_cards is None:
        print("Failed to load cards")
        return False
    print("Recieved all cards")
    # print(all_cards[0]['fields']['Expression']['value'])
    # filter out cards that may crash the server
    all_cards_temp = []
    for card in all_cards:
        if 'Expression' in card['fields']:
            all_cards_temp.append(card)
        # or 'Front' in card['fields'] and 'Front' contains "<intelligent_definition >"
        elif 'Front' in card['fields']:
            if "</intelligent_definition>" in card['fields']['Front']['value']:
                front = re.sub(r'<intelligent_definition\b[^>]*>.*?</intelligent_definition>', '', card['fields']['Front']['value'], flags=re.DOTALL)
                card['fields']['Expression'] = {}
                card['fields']['Meaning'] = {}
                card['fields']['Reading'] = {}
                card['fields']['Reading']['value'] = ""
                card['fields']['Expression']['value'] = front
                match1 = re.search(r'<intelligent_definition\b[^>]*>(.*?)</intelligent_definition>', card['fields']['Front']['value'], flags=re.DOTALL)
                if match1:
                    card['fields']['Meaning']['value'] = match1.group(1).strip()
                    all_cards_temp.append(card)
                else:
                    if 'Back' in card['fields']:
                        card['fields']['Meaning']['value'] = card['fields']['Back']['value']
                        all_cards_temp.append(card)

    all_cards = all_cards_temp
    all_cards = [card for card in all_cards if 'Expression' in card['fields']]

    if len(all_cards) == 0:
        print("No valid cards found, maybe you have selected the wrong deck?")
        sys.exit(-1)
        return

    for card in all_cards:
        words = card['fields']['Expression']['value']
        # trim everything that's ascii
        words = ''.join([i for i in words if ord(i) > 128])
        words_ids[words] = card['cardId']

        cards_per_id[card['cardId']] = card
    print("Loaded all cards")
    print("Loading who_contain")


    # generate who_contain

    no_duplicates = {}

    for card in all_cards:
        characters = card['fields']['Expression']['value']
        characters = ''.join([i for i in characters if ord(i) > 128])
        for character in list(characters):
            if character in who_contain:
                if characters in no_duplicates[character]:
                    continue
                no_duplicates[character].add(characters)
                who_contain[character].append((characters, card['cardId']))
            else:
                no_duplicates[character] = set([characters])
                who_contain[character] = [(characters, card['cardId'])]

    print("Loaded who_contain")
    # Save the objects to a file
    with open(os.path.join(RESPATH,'anki-cache.pkl'), 'wb') as f:
        pickle.dump({
            'all_cards': all_cards,
            'cards_per_id': cards_per_id,
            'words_ids': words_ids,
            'who_contain': who_contain
        }, f)
    return True

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.on_event("startup")
async def startup_event():
    print("Getting all cards")
    resp = get_all_cards()
    if not resp:
        print("Anki is offline, loading from Cache")
        if get_all_cards_CACHE():
            print("Loaded from cache")
        else:
            print("Failed to load from cache")
            sys.exit(-1)

# Request Body
class TokenizeRequest(BaseModel):
    text: str


class TokenizeResponse(BaseModel):
#     tokens: List[Tuple[str, str]]
    tokens: List

class GetCardRequest(BaseModel):
    word: str

class GetCardResponse(BaseModel):
    cards: List
    error: bool
    poor: bool

@app.post("/tokenize", response_model=TokenizeResponse)
def tokenize(req: TokenizeRequest):
    global language_module
#     if language_module is None:
#         print("Language module not loaded")
#         return {"tokens": [], "error": "Language module not loaded"}
#     if not hasattr(language_module, 'LANGUAGE_TOKENIZE'):
#         print("LANGUAGE_TOKENIZE function not found in the language module")
#         return {"tokens": [], "error": "LANGUAGE_TOKENIZE function not found in the language module"}
    print("requested tokenization: ", req.text)
    # text = nagisa.tagging(req.text)
#     print(language_module, language_module.LANGUAGE_TOKENIZE
    tokens = language_module.LANGUAGE_TOKENIZE(req.text)
    # tokens = list(zip(text.words, text.postags))
    return {"tokens": tokens}

getCardCache = {}

@app.post("/getCard", response_model=GetCardResponse)
def get_card(req: GetCardRequest):
    global who_contain
    global all_cards
    global cards_per_id
    global words_ids
    print("requested card: ", req.word)
    if req.word in getCardCache:
        return getCardCache[req.word]
    # get all cards that contain the word
    word = req.word
    matched = []
    max_score = 0
    for character in word:
        if character in who_contain:
            cards = who_contain[character]
            # print("Testing: ", cards)
            # compute closest match
            for card in cards:
                #see how many characters match
                score = 0
                for c in word:
                    if c in card[0]:
                        score += 0.5
                # try to see if the word is a substring of the card
                if word in card[0]:
                    score = len(word)
                # remove score for each character that is not in the word
                for c in card[0]:
                    if c not in word:
                        score -= 1
                if score > max_score:
                    max_score = score
                matched.append((score, card[1]))
    #filter out cards that have the same id
    matched = list(set(matched))
    matched.sort(reverse=True)
    print(matched)
    matched = matched[:5]
    # #get ease of the cards
    # eases = invoke('getEaseFactors', cards=[match[1] for match in matched])
    # for i, match in enumerate(matched):
    #     matched[i] = (match[0], match[1], eases[i])
    result = []
    for match in matched:
        current_card = cards_per_id[match[1]]
        # current_card['ease'] = match[2]
        result.append(current_card)
    if len(result) == 0:
        getCardCache[req.word] = {"cards": ["No cards found"], "error": True}
        return {"cards": ["No cards found"], "error": True}

    getCardCache[req.word] = {"cards": result, "error": False, "poor": max_score < len(req.word)}
    return {"cards": result, "error": False, "poor": max_score < len(req.word)}





class TranslationRequest(BaseModel):
    word: str

class TranslationResponse(BaseModel):
    data: List


@app.post("/translate", response_model=TranslationResponse)
def get_translation(req: TranslationRequest):
    global language_module
    print("requested translation: ", req.word)
    return language_module.LANGUAGE_TRANSLATE(req.word)
class ControlRequest(BaseModel):
    function: str

@app.post("/control")
def control(req: ControlRequest):
    if req.function == "ping":
        return {"response": "pong"}
    elif req.function == "reload":
        get_all_cards()
        return {"response": "Reloaded"}
    else:
        return {"response": "Unknown function"}

@app.post("/fwd-to-anki")
async def fwd_to_anki(req: Request):

    # Get the body of the incoming request
    body = await req.json()

    # Forward the request to AnkiConnect
    requestJson = json.dumps(body).encode('utf-8')
    response = json.load(urllib.request.urlopen(urllib.request.Request(ANKI_CONNECT_URL, requestJson)))
    print("Received response from AnkiConnect:", response)
    return response

@app.post("/quit")
def quit():
    sys.exit(0)


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=7752, log_level="debug")
