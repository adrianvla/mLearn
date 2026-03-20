"""
Anki integration routes — card lookup, control, and quit.
"""

import json
import os
import re
import sys
import threading
import urllib.request
import urllib.error

from fastapi import APIRouter, Header, Response
from pydantic import BaseModel
from typing import List, Optional

import config
from logging_utils import _log

router = APIRouter()

# ── Global state ──
all_cards: list = []
cards_per_id: dict = {}
words_ids: dict = {}
who_contain: dict = {}
getCardCache: dict = {}


def get_all_cards_CACHE() -> bool:
    global all_cards, cards_per_id, words_ids, who_contain
    json_path = os.path.join(config.RESPATH, "anki-cache.json")
    pkl_path = os.path.join(config.RESPATH, "anki-cache.pkl")

    # Migration: if only .pkl exists, convert it to .json then rename it to .pkl.bak
    if not os.path.exists(json_path) and os.path.exists(pkl_path):
        _log("Migrating anki-cache.pkl to anki-cache.json")
        try:
            import pickle as _pickle

            with open(pkl_path, "rb") as f:
                data = _pickle.load(f)
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.rename(pkl_path, pkl_path + ".bak")
            _log("Migration complete; old cache renamed to anki-cache.pkl.bak")
        except Exception as e:
            _log(f"Migration from .pkl failed: {e}")
            return False

    if not os.path.exists(json_path):
        _log("Cache file not found")
        return False
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            all_cards = data["all_cards"]
            # JSON serialises integer dict-keys as strings; convert back to int
            # so that lookup by cardId (always an int) works correctly.
            raw_cpi = data.get("cards_per_id", {})
            cards_per_id = {int(k): v for k, v in raw_cpi.items()}
            words_ids = data.get("words_ids", {})
            who_contain = data.get("who_contain", {})
        return True
    except Exception as e:
        print(f"Failed to load cache: {e}")
        return False


def _anki_request(action, **params):
    return {"action": action, "params": params, "version": 6}


def _anki_invoke(action, **params):
    try:
        requestJson = json.dumps(_anki_request(action, **params)).encode("utf-8")
        response = json.load(
            urllib.request.urlopen(
                urllib.request.Request(config.ANKI_CONNECT_URL, requestJson),
                timeout=5,
            )
        )
        if len(response) != 2:
            raise Exception("response has an unexpected number of fields")
        if "error" not in response:
            raise Exception("response is missing required error field")
        if "result" not in response:
            raise Exception("response is missing required result field")
        if response["error"] is not None:
            raise Exception(response["error"])
        return response["result"]
    except urllib.error.URLError as e:
        _log(f"Failed to connect to Anki: {e}")
        return None
    except Exception as e:
        _log(f"An error occurred: {e}")
        return None


def get_all_cards() -> bool:
    """Fetch all cards from AnkiConnect and build lookup indices."""
    global all_cards, cards_per_id, words_ids, who_contain

    _log("Fetch Anki is set to", config.FETCH_ANKI)
    if not config.FETCH_ANKI:
        return True

    _log("Loading all card ids")
    card_ids = _anki_invoke("findCards", query="deck:*")
    if card_ids is None:
        _log("Failed to load card ids")
        return False
    _log("Loaded all card ids")
    _log("Loading all cards")
    all_cards = _anki_invoke("cardsInfo", cards=card_ids)
    if all_cards is None:
        _log("Failed to load cards")
        return False
    _log("Recieved all cards")

    # Filter and map fields
    all_cards_temp = []
    for card in all_cards:
        # Map user configured fields to standard fields
        if (
            config.ANKI_FIELD_EXPRESSION in card["fields"]
            and config.ANKI_FIELD_EXPRESSION != "Expression"
        ):
            card["fields"]["Expression"] = card["fields"][config.ANKI_FIELD_EXPRESSION]
        if (
            config.ANKI_FIELD_READING in card["fields"]
            and config.ANKI_FIELD_READING != "Reading"
        ):
            card["fields"]["Reading"] = card["fields"][config.ANKI_FIELD_READING]
        if (
            config.ANKI_FIELD_MEANING in card["fields"]
            and config.ANKI_FIELD_MEANING != "Meaning"
        ):
            card["fields"]["Meaning"] = card["fields"][config.ANKI_FIELD_MEANING]

        if "Expression" in card["fields"]:
            all_cards_temp.append(card)
        elif "Front" in card["fields"]:
            if "</intelligent_definition>" in card["fields"]["Front"]["value"]:
                front = re.sub(
                    r"<intelligent_definition\b[^>]*>.*?</intelligent_definition>",
                    "",
                    card["fields"]["Front"]["value"],
                    flags=re.DOTALL,
                )
                card["fields"]["Expression"] = {}
                card["fields"]["Meaning"] = {}
                card["fields"]["Reading"] = {}
                card["fields"]["Reading"]["value"] = ""
                card["fields"]["Expression"]["value"] = front
                match1 = re.search(
                    r"<intelligent_definition\b[^>]*>(.*?)</intelligent_definition>",
                    card["fields"]["Front"]["value"],
                    flags=re.DOTALL,
                )
                if match1:
                    card["fields"]["Meaning"]["value"] = match1.group(1).strip()
                    all_cards_temp.append(card)
                else:
                    if "Back" in card["fields"]:
                        card["fields"]["Meaning"]["value"] = card["fields"]["Back"][
                            "value"
                        ]
                        all_cards_temp.append(card)

    all_cards = all_cards_temp
    all_cards = [card for card in all_cards if "Expression" in card["fields"]]

    if len(all_cards) == 0:
        _log("No valid cards found, maybe you have selected the wrong deck?")
        _log("ANKI_ERROR", "no_valid_cards")
        sys.exit(-1)
        return False

    for card in all_cards:
        words = card["fields"]["Expression"]["value"]
        # trim everything that's ascii
        words = "".join([i for i in words if ord(i) > 128])
        words_ids[words] = card["cardId"]
        cards_per_id[card["cardId"]] = card
    _log("Loaded all cards")
    _log("Loading who_contain")

    # Generate who_contain index
    no_duplicates: dict = {}
    for card in all_cards:
        characters = card["fields"]["Expression"]["value"]
        characters = "".join([i for i in characters if ord(i) > 128])
        for character in list(characters):
            if character in who_contain:
                if characters in no_duplicates[character]:
                    continue
                no_duplicates[character].add(characters)
                who_contain[character].append((characters, card["cardId"]))
            else:
                no_duplicates[character] = set([characters])
                who_contain[character] = [(characters, card["cardId"])]

    _log("Loaded who_contain")

    # Save cache
    with open(
        os.path.join(config.RESPATH, "anki-cache.json"), "w", encoding="utf-8"
    ) as f:
        json.dump(
            {
                "all_cards": all_cards,
                "cards_per_id": cards_per_id,
                "words_ids": words_ids,
                "who_contain": who_contain,
            },
            f,
        )
    return True


# ── Pydantic models ──


class GetCardRequest(BaseModel):
    word: str


class GetCardResponse(BaseModel):
    cards: List
    error: bool
    poor: bool


class ControlRequest(BaseModel):
    function: str


# ── Route handlers ──


@router.post("/getCard", response_model=GetCardResponse)
def get_card(req: GetCardRequest):
    if req.word in getCardCache:
        return getCardCache[req.word]

    word = req.word
    matched = []
    max_score = 0
    for character in word:
        if character in who_contain:
            cards = who_contain[character]
            for card in cards:
                score = 0
                for c in word:
                    if c in card[0]:
                        score += 0.5
                if word in card[0]:
                    score = len(word)
                for c in card[0]:
                    if c not in word:
                        score -= 1
                if score > max_score:
                    max_score = score
                matched.append((score, card[1]))

    matched = list(set(matched))
    matched.sort(reverse=True)
    matched = matched[:5]

    result = []
    for match in matched:
        card_id = match[1]
        current_card = cards_per_id.get(card_id) or cards_per_id.get(str(card_id))
        if current_card is None:
            continue
        result.append(current_card)

    if len(result) == 0:
        getCardCache[req.word] = {"cards": ["No cards found"], "error": True}
        return {"cards": ["No cards found"], "error": True}

    getCardCache[req.word] = {
        "cards": result,
        "error": False,
        "poor": max_score < len(req.word),
    }
    return {"cards": result, "error": False, "poor": max_score < len(req.word)}


@router.post("/control")
def control(req: ControlRequest):
    _log("/control called with function:", req.function)
    if req.function == "ping":
        return {"response": "pong"}
    elif req.function == "reload":
        get_all_cards()
        return {"response": "Reloaded"}
    else:
        return {"response": "Unknown function"}


@router.post("/quit")
def quit_endpoint(
    response: Response, x_quit_token: Optional[str] = Header(default=None)
):
    if x_quit_token != config.QUIT_TOKEN:
        response.status_code = 403
        return {"response": "forbidden"}
    _log("Received /quit; exiting shortly...")

    def _shutdown():
        os._exit(0)

    threading.Timer(0.2, _shutdown).start()
    return {"response": "quitting"}


@router.get("/ankiWords")
def anki_words():
    """Return the set of all expression values loaded in the Anki cache."""
    words = set()
    for card in all_cards:
        val = card.get("fields", {}).get("Expression", {}).get("value", "")
        if val:
            clean = re.sub(r"<[^>]*>", "", val).strip()
            if clean:
                words.add(clean)
    return {"words": list(words)}
