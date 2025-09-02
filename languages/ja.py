import sudachipy
from sudachipy import tokenizer
from sudachipy import dictionary

from typing import List, Tuple
import json
import urllib.request
from urllib.parse import quote
import re
import os
import pickle
from typing import Optional, Tuple, List as _List

def camel_to_kebab_case(name):
    """Convert camelCase to kebab-case."""
    return re.sub(r'([A-Z])', lambda match: '-' + match.group(1).lower(), name)
tokenizer_obj = dictionary.Dictionary().create()
mode = tokenizer.Tokenizer.SplitMode.C  # Use a coarser split mode

def escape_quotes(value):
    """Escape double quotes in attribute values."""
    return value.replace('"', '&quot;')

def LANGUAGE_TOKENIZE(text):
    global tokenizer_obj
    global mode
    token_list = []
    tokens = tokenizer_obj.tokenize(text, mode)
    for token in tokens:
        surface = token.surface()
        pos = token.part_of_speech()[0]
        actual_word = token.dictionary_form()

        # Skip empty tokens (like empty punctuation) and spaces
        if surface and pos != "空白":
            token_list.append({
                'word': surface,
                'actual_word': actual_word,
                'type': pos
            })
    for token in token_list:
        if token['word'] == 'じゃ' and token['type'] == '助動詞':
            token['type'] = '助詞'  # Fix 'じゃ' to be a particle
        if token['word'] == 'なら' and token['type'] == '助動詞':
            token['type'] = '助詞'  # Fix 'なら' to be a conditional particle
        if token['word'] == 'ただ' and token['type'] == '名詞':
            token['type'] = '副詞'  # Fix 'ただ' to be an adverb

#     return list(zip(tokens.words, tokens.postags))
    return token_list


TranslationCache = {}

dictionary = []
pitch_accent = []
kana_dict = []


# --- Helpers for ranking and Unicode categories ---
def is_hiragana(s: str) -> bool:
    return bool(s) and all('\u3040' <= ch <= '\u309F' for ch in s)


def is_katakana(s: str) -> bool:
    return bool(s) and all('\u30A0' <= ch <= '\u30FF' for ch in s)


def is_kana(s: str) -> bool:
    return bool(s) and all((\
        ('\u3040' <= ch <= '\u309F') or ('\u30A0' <= ch <= '\u30FF') or ch == 'ー'\
    ) for ch in s)


def _rank_entry(e) -> Tuple[int, int, int]:
    """Return a sort key for a Yomichan entry.
    Prefer hiragana readings, then kana readings (to exclude pinyin/latin),
    then higher score (fallback if available).
    """
    try:
        reading = e[1] if len(e) > 1 else ''
    except Exception:
        reading = ''
    # Primary: prefer pure hiragana (native Japanese reading)
    pref_hira = 0 if is_hiragana(reading) else 1
    # Secondary: prefer kana over non-kana (filters out pinyin/latin)
    pref_kana = 0 if is_kana(reading) else 1
    # Tertiary: use score when present; assume higher is better if int
    score_val = 0
    try:
        raw = e[4] if len(e) > 4 else 0
        if isinstance(raw, (int, float)):
            score_val = int(raw)
    except Exception:
        pass
    return (pref_hira, pref_kana, -score_val)


def _collect_by_headword(word: str) -> _List:
    """Collect all entries in `dictionary` whose headword (index 0) == word.
    Assumes `dictionary` is sorted by headword.
    """
    global dictionary
    matches = []
    if not dictionary:
        return matches
    # Binary search for any index where headword == word
    lo, hi = 0, len(dictionary) - 1
    found = -1
    while lo <= hi:
        mid = (lo + hi) // 2
        hw = dictionary[mid][0]
        if hw == word:
            found = mid
            break
        if hw > word:
            hi = mid - 1
        else:
            lo = mid + 1
    if found == -1:
        return matches
    # Expand left/right for contiguous range with same headword
    left = found
    while left - 1 >= 0 and dictionary[left - 1][0] == word:
        left -= 1
    right = found
    n = len(dictionary)
    while right + 1 < n and dictionary[right + 1][0] == word:
        right += 1
    matches = dictionary[left:right + 1]
    return matches


def _collect_by_reading(kana: str) -> _List:
    """Collect all entries in `kana_dict` whose reading (index 1) == kana.
    Assumes `kana_dict` is sorted by reading.
    """
    global kana_dict
    matches = []
    if not kana_dict:
        return matches
    lo, hi = 0, len(kana_dict) - 1
    found = -1
    while lo <= hi:
        mid = (lo + hi) // 2
        rd = kana_dict[mid][1]
        if rd == kana:
            found = mid
            break
        if rd > kana:
            hi = mid - 1
        else:
            lo = mid + 1
    if found == -1:
        return matches
    left = found
    while left - 1 >= 0 and kana_dict[left - 1][1] == kana:
        left -= 1
    right = found
    n = len(kana_dict)
    while right + 1 < n and kana_dict[right + 1][1] == kana:
        right += 1
    matches = kana_dict[left:right + 1]
    return matches


def binary_search(word):
    """Find the best matching dictionary entry for `word`.
    Returns (best_entry, pitch_accent_entry, all_matches) or None.
    """
    global pitch_accent
    # Find pitch accent entry by headword match (if available)
    pitch_accent_entry = None
    lo, hi = 0, len(pitch_accent) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        guess = pitch_accent[mid][0]
        if guess == word:
            pitch_accent_entry = pitch_accent[mid]
            break
        if guess > word:
            hi = mid - 1
        else:
            lo = mid + 1

    # Collect candidates by headword; fallback to kana reading
    matches = _collect_by_headword(word)
    if not matches:
        # If input itself is kana, try reading lookup
        matches = _collect_by_reading(word)

    if not matches:
        return None

    # Rank and pick the best
    best = sorted(matches, key=_rank_entry)[0]
    return best, pitch_accent_entry, matches
def create_html_element(element):
    """Recursively create HTML elements from JSON."""
    oneliner = ""
    if isinstance(element, str):
        return element  # Base case: if the element is a string, just return it

    tag = element.get('tag', 'div')  # Default to 'div' if tag is not specified
    content = element.get('content', '')  # Get the content, or use an empty string if not available

    # Build the opening tag with attributes
    attributes = []
    for key, value in element.items():
        if key not in ('tag', 'content'):  # Exclude tag and content, we handle them separately
            if isinstance(value, dict) and key == 'style':  # Special handling for the 'style' attribute
                # Convert camelCase to kebab-case for CSS properties
                value = '; '.join([f"{camel_to_kebab_case(k)}: {v}" for k, v in value.items()])
                attributes.append(f'style="{escape_quotes(value)}"')
            elif isinstance(value, dict):  # For other dictionary attributes like 'data'
                for data_key, data_value in value.items():
                    attributes.append(f'data-{data_key}="{escape_quotes(str(data_value))}"')
            else:
                # Special handling for list-style-type to avoid quoting numbers
                if key == 'style' and 'listStyleType' in element['style']:
                    value = value.replace('"', '')  # Remove quotes around listStyleType characters
                attributes.append(f'{key}="{escape_quotes(str(value))}"')  # Add attribute as key="value"

    # Handle nested content recursively
    if isinstance(content, list):
        content_html = ''.join([create_html_element(c) for c in content])  # Recursion
    else:
        content_html = create_html_element(content)  # If it's a single item, handle directly

    # Return the complete HTML element
    return f"<{tag} {' '.join(attributes)}>{content_html}</{tag}>"


def load_dictionary(folder):
    global dictionary
    global kana_dict
    global pitch_accent
    cache_file = os.path.join(folder,'dictionary_cache.pkl')

    # Check if the cache file exists
    if os.path.exists(cache_file):
        with open(cache_file, 'rb') as f:
            dictionary, kana_dict, pitch_accent = pickle.load(f)
        print("Loaded dictionary from cache")
    else:
        # Load dictionary from JSON files
        for i in range(1, 150):
            with open(os.path.join(folder,f'dictionaries/jitendex-yomitan/term_bank_{i}.json'), 'r', encoding='utf-8') as f:
                dictionary += json.load(f)
        for i in range(1,14):
            with open(os.path.join(folder,f'dictionaries/jitendex-yomitan/term_meta_bank_{i}.json'), 'r', encoding='utf-8') as f:
                pitch_accent += json.load(f)
        print("Loaded dictionary with", len(dictionary), "entries", len(pitch_accent), "pitch accent entries")

        # Sort the dictionary
        kana_dict = sorted(dictionary, key=lambda x: x[1])
        dictionary.sort(key=lambda x: x[0])
        pitch_accent.sort(key=lambda x: x[0])
        print("Sorted dictionary")

        # Save the dictionary to the cache
        with open(cache_file, 'wb') as f:
            pickle.dump((dictionary, kana_dict, pitch_accent), f)
        print("Saved dictionary to cache")




# load dictionary from file
def LOAD_MODULE(folder):
    load_dictionary(folder)
# test = binary_search("心臓")
# print(test)
# for element in test[5]:
#     html_output = create_html_element(element)
#     print("FIRST HTML OUTPUT:",html_output,"\n")

def LANGUAGE_TRANSLATE(word):
    global TranslationCache
    global getTranslationUrl
    if word in TranslationCache:
        return TranslationCache[word]

    bns = binary_search(word)
    if bns is None:
        TranslationCache[word] = {"data": []}
        return {"data": []}
    result = bns[0]
    pitch_accent_entry = bns[1]
    if pitch_accent_entry is None:
        pitch_accent_entry = {}
    if result is None:
        TranslationCache[word] = {"data": []}
        return {"data": []}
    html_string = ""
    for element in result[5]:
        html_string += create_html_element(element)

    # Use regular expressions to find elements with data-content="glossary"
    glossary_pattern = re.compile(r'<ul[^>]*data-content="glossary"[^>]*>(.*?)</ul>', re.DOTALL)
    glossary_matches = glossary_pattern.findall(html_string)

    # Append the contents of these elements to one_line
    one_line = []
    for match in glossary_matches:
        # Find all <li> elements within the match
        li_pattern = re.compile(r'<li[^>]*>(.*?)</li>', re.DOTALL)
        li_matches = li_pattern.findall(match)
        # Join the contents of <li> elements with a comma
        for li in li_matches:
            one_line.append(re.sub(r'<[^>]+>', '', li))
    one_line = ', '.join(one_line[:3])  # Only keep the first 3 definitions

    data = {
        'data': [{'reading': result[1], 'definitions': one_line}, {'reading': result[1], 'definitions': html_string}, pitch_accent_entry]
    }
    TranslationCache[word] = {"data": data['data']}
    return {"data": data['data']}
