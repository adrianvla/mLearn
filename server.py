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
import threading

# Ensure printing non-ASCII (e.g., Japanese) won't crash on Windows consoles
try:
    # Python 3.7+ TextIOWrapper exposes reconfigure
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    # As a fallback, attempt to replace the streams entirely (rarely needed in our packaging)
    try:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')  # type: ignore[attr-defined]
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')  # type: ignore[attr-defined]
    except Exception:
        # Last resort: do nothing; individual prints may still succeed for ASCII
        pass


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
from fastapi import UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from typing import List
from fastapi.middleware.cors import CORSMiddleware
import base64
import io
from PIL import Image
import numpy as np
import statistics
import math

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
    # print("requested card: ", req.word)
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
    # print(matched)
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
    print("Received /quit; exiting shortly...")
    # Delay hard-exit slightly so the HTTP response doesn't get stream-closed prematurely
    def _shutdown():
        os._exit(0)
    threading.Timer(0.2, _shutdown).start()
    return {"response": "quitting"}


# --- OCR Support (PaddleOCR + MangaOCR) ---
_paddle_ocr = None
_manga_ocr = None


def _get_paddle_ocr():
    global _paddle_ocr
    if _paddle_ocr is not None:
        return _paddle_ocr
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except Exception as e:
        print("PaddleOCR import error:", e)
        return None
    # Use Japanese models if LANGUAGE == 'ja', else default to 'en'
    langs = {
        "de": "german",
        "ja": "japan",
        "en": "en",
        "ch": "ch",
        "ko": "korean",
        "fr": "french",
        "es": "spanish",
        "ru": "russian"
    }
    lang_code = langs.get(LANGUAGE, 'en')  # Default to 'en' if language not found
    _paddle_ocr = PaddleOCR(lang=lang_code, use_angle_cls=True, use_doc_orientation_classify=False, use_doc_unwarping=False)
    return _paddle_ocr


def _paddle_run_ocr(paddle_inst, img):
    """Call paddle.ocr with broad compatibility."""
    try:
        return paddle_inst.ocr(img, cls=False)
    except TypeError:
        # Older signatures may not accept cls
        return paddle_inst.ocr(img)


def _get_manga_ocr():
    global _manga_ocr
    if _manga_ocr is not None:
        return _manga_ocr
    try:
        from manga_ocr import MangaOcr  # type: ignore
    except Exception as e:
        print("MangaOCR import error:", e)
        return None
    try:
        _manga_ocr = MangaOcr()
    except Exception as e:
        print("Failed to initialize MangaOCR:", e)
        _manga_ocr = None
    return _manga_ocr


def _load_image_from_inputs(file_bytes: bytes | None, image_base64: str | None) -> Image.Image:
    if file_bytes is None and not image_base64:
        raise HTTPException(status_code=400, detail="No image provided. Send 'file' or 'image_base64'.")
    try:
        if file_bytes is not None:
            return Image.open(io.BytesIO(file_bytes)).convert('RGB')
        else:
            raw = base64.b64decode(image_base64.split(',')[-1])  # support data URLs
            return Image.open(io.BytesIO(raw)).convert('RGB')
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image data.")


def _extract_lines_from_paddle_result(result):
    """Normalize PaddleOCR result to a flat list of (box, text, score).
    Supports legacy list-based output and newer dict-based outputs that contain
    keys such as 'rec_texts', 'rec_scores', and (ideally) some polygon boxes.
    """
    if not result:
        print("_extract_lines_from_paddle_result: Empty result")
        return []

    # Use global numpy alias 'np' imported at module level

    # If it's a batch-of-one list, unwrap
    if isinstance(result, list) and len(result) == 1 and not isinstance(result[0], (list, tuple)):
        # Could be a dict inside
        result = result[0]

    # Handle dict-based output
    if isinstance(result, dict):
        print("_extract_lines_from_paddle_result: Detected dict-based output. Keys:", list(result.keys()))
        # Common fields
        texts = result.get('rec_texts') or result.get('texts')
        scores = result.get('rec_scores') or result.get('scores')

        # Try common box keys in order
        box_keys = [
            'text_det_polys', 'det_polys', 'dt_polys', 'polys',
            'text_region_polys', 'boxes', 'dt_boxes', 'det_boxes'
        ]
        boxes = None
        for k in box_keys:
            if k in result:
                boxes = result[k]
                print(f"_extract_lines_from_paddle_result: Found boxes under key '{k}' with count:", (len(boxes) if isinstance(boxes, (list, tuple)) else 'n/a'))
                break

        # If boxes not found, attempt to heuristically locate a list of polygon-like arrays
        if boxes is None:
            for k, v in result.items():
                if isinstance(v, (list, tuple)) and len(v) > 0:
                    first = v[0]
                    try:
                        arr = np.array(first)
                        if arr.ndim == 2 and arr.shape[1] == 2 and arr.shape[0] >= 4:
                            boxes = v
                            print(f"_extract_lines_from_paddle_result: Heuristically using key '{k}' for boxes; count:", len(v))
                            break
                    except Exception:
                        pass

        if texts is None:
            print("_extract_lines_from_paddle_result: No 'rec_texts'/'texts' found.")
        else:
            print("_extract_lines_from_paddle_result: Text count:", len(texts))
        if isinstance(boxes, (list, tuple)):
            print("_extract_lines_from_paddle_result: Box count:", len(boxes))
        else:
            print("_extract_lines_from_paddle_result: Boxes missing or not a sequence.")

        # If we have both texts and boxes, pair them by index
        flat: list[tuple] = []
        try:
            if texts is not None and isinstance(boxes, (list, tuple)) and len(boxes) > 0:
                n = min(len(texts), len(boxes))
                for i in range(n):
                    pts = boxes[i]
                    # normalize to list of [x,y]
                    if isinstance(pts, np.ndarray):
                        pts = pts.tolist()
                    # Some formats might be [[x1,y1,x2,y2,...]] -> convert to [[x,y],...]
                    if pts and isinstance(pts[0], (int, float)) and len(pts) % 2 == 0:
                        pts = [[float(pts[j]), float(pts[j+1])] for j in range(0, len(pts), 2)]
                    # Ensure it's a list of pairs
                    pts = [[float(x), float(y)] for x, y in pts]
                    txt = str(texts[i])
                    scr = float(scores[i]) if scores is not None and i < len(scores) else None
                    flat.append((pts, txt, scr))
                return flat
            # If we only have texts, return without boxes (caller can decide fallback)
            if texts is not None:
                return [(None, str(t), float(scores[i]) if scores is not None and i < len(scores) else None) for i, t in enumerate(texts)]
        except Exception as e:
            print("_extract_lines_from_paddle_result: Exception while pairing dict-based output:", e)
            return []

        return []

    # Handle legacy list-based outputs
    lines = result
    if isinstance(result, list) and len(result) > 0 and isinstance(result[0], list) and (
        len(result) == 1 or (result and isinstance(result[0][0], (list, tuple)))
    ):
        lines = result[0]

    flat = []
    try:
        for item in lines:
            if not item:
                continue
            # Expected: item[0] = points, item[1] = (text, score)
            pts = item[0]
            txt, scr = None, None
            if len(item) > 1 and isinstance(item[1], (list, tuple)) and len(item[1]) >= 2:
                txt, scr = item[1][0], float(item[1][1])
            flat.append((pts, txt, scr))
    except Exception as e:
        print(f"Failed to parse PaddleOCR lines. Error: {e}. Data was: {lines}")
        return []
    return flat


def _box_width(pts) -> float:
    try:
        xs = [p[0] for p in pts]
        return max(xs) - min(xs)
    except Exception:
        return 0.0


def _box_height(pts) -> float:
    try:
        ys = [p[1] for p in pts]
        return max(ys) - min(ys)
    except Exception:
        return 0.0


def _filter_furigana_boxes(boxes: list[list[list[float]]]) -> list[list[list[float]]]:
    """Remove boxes whose width is drastically different from the typical width (heuristic).
    We consider widths close to the median as typical; drop boxes outside [0.6, 1.8] * median.
    """
    if not boxes:
        return boxes
    widths = [max(1.0, _box_width(b)) for b in boxes]
    try:
        med = statistics.median(widths)
    except statistics.StatisticsError:
        med = sum(widths) / max(1, len(widths))
    lo, hi = 0.6 * med, 1.8 * med
    filtered = []
    for b, w in zip(boxes, widths):
        h = _box_height(b)
        # Also drop extremely tiny height (noise)
        if h < 5:
            continue
        if lo <= w <= hi:
            filtered.append(b)
    return filtered


def _crop_by_box(image: Image.Image, pts) -> Image.Image:
    # Use the bounding rectangle of the quad for simplicity
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    left, upper, right, lower = max(0, int(min(xs))), max(0, int(min(ys))), int(max(xs)), int(max(ys))
    # Ensure non-empty crop
    if right <= left:
        right = left + 1
    if lower <= upper:
        lower = upper + 1
    return image.crop((left, upper, right, lower))


class OcrBox(BaseModel):
    box: List[List[float]]  # 4x2 points
    text: str
    score: float | None = None


class OcrResponse(BaseModel):
    boxes: List[OcrBox]


@app.post("/ocr", response_model=OcrResponse)
async def ocr_endpoint(
    file: UploadFile | None = File(None),
    image_base64: str | None = Form(None)
):
    # Load image
    file_bytes = await file.read() if file is not None else None
    image = _load_image_from_inputs(file_bytes, image_base64)
    np_img = np.array(image)

    # Initialize OCR backends
    paddle = _get_paddle_ocr()
    if paddle is None:
        raise HTTPException(status_code=500, detail="PaddleOCR is not available. Please install dependencies.")

    results: list[OcrBox] = []

    print(f"OCR requested for language: {LANGUAGE}")

    if LANGUAGE == 'ja':
        # Use Paddle for detection (boxes), MangaOCR for recognition
        print("Running PaddleOCR for detection...")
        det = _paddle_run_ocr(paddle, np_img)
        print(f"PaddleOCR raw detection result: {det}")

        lines = _extract_lines_from_paddle_result(det)
        print(f"Extracted {len(lines)} lines from PaddleOCR result.")
        
        initial_boxes = [item[0] for item in lines if item and item[0] is not None]
        print(f"Found {len(initial_boxes)} initial bounding boxes.")

        boxes_only = _filter_furigana_boxes(initial_boxes)
        print(f"Filtered boxes, {len(boxes_only)} remaining after furigana filter.")

        mocr = _get_manga_ocr()
        if mocr is None:
            raise HTTPException(status_code=500, detail="MangaOCR is not available. Please install dependencies.")

        if len(boxes_only) == 0:
            print("No boxes detected for JA with Paddle; falling back to MangaOCR on full image.")
            try:
                full_txt = mocr(image)
                print(f"MangaOCR full-image text: '{full_txt}'")
                # Use full image bounds as a single box
                w, h = image.size
                full_box = [[0.0, 0.0], [float(w), 0.0], [float(w), float(h)], [0.0, float(h)]]
                results.append(OcrBox(box=full_box, text=full_txt or '', score=None))
            except Exception as e:
                print("MangaOCR full-image fallback error:", e)
        else:
            print(f"Processing {len(boxes_only)} boxes with MangaOCR...")
            for i, pts in enumerate(boxes_only):
                crop = _crop_by_box(image, pts)
                try:
                    # MangaOCR returns string; no score provided
                    txt = mocr(crop)
                    print(f"  Box {i+1}/{len(boxes_only)}: Recognized text: '{txt}'")
                except Exception as e:
                    print(f"  Box {i+1}/{len(boxes_only)}: MangaOCR error on crop: {e}")
                    txt = ""
                results.append(OcrBox(box=[[float(x), float(y)] for x, y in pts], text=txt, score=None))
    else:
        # Use PaddleOCR for both detection and recognition
        print("Running PaddleOCR for detection and recognition...")
        out = _paddle_run_ocr(paddle, np_img)
        print(f"PaddleOCR raw output: {out}")
        lines = _extract_lines_from_paddle_result(out)
        print(f"Extracted {len(lines)} lines from PaddleOCR result.")
        for i, (pts, txt, scr) in enumerate(lines):
            print(f"  Box {i+1}/{len(lines)}: Text='{txt}', Score={scr}")
            results.append(OcrBox(box=[[float(x), float(y)] for x, y in pts], text=str(txt or ''), score=(float(scr) if scr is not None else None)))

    print(f"Final number of boxes returned: {len(results)}")
    # Exclude fields that are None (e.g., score for MangaOCR) to reduce noise
    return {"boxes": [r.dict(exclude_none=True) for r in results]}


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=7752, log_level="debug")
