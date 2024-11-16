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
kana_dict = []
def binary_search(word):
    global dictionary
    global kana_dict
    """
    Perform a binary search to find the word in the dictionary.

    :param dictionary: List of tuples (word, reading) sorted by word.
    :param word: Word to search for.
    :return: Tuple (word, reading) if found, otherwise None.
    """
    low = 0
    high = len(dictionary) - 1

    while low <= high:
        mid = (low + high) // 2
        guess = dictionary[mid][0]

        if guess == word:
            return dictionary[mid]
        if guess > word:
            high = mid - 1
        else:
            low = mid + 1

    # If the word is not found, try to find it in the kana dictionary
    low = 0
    high = len(kana_dict) - 1
    while low <= high:
        mid = (low + high) // 2
        guess = kana_dict[mid][1]

        if guess == word:
            return kana_dict[mid]
        if guess > word:
            high = mid - 1
        else:
            low = mid + 1

    return None
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
    cache_file = os.path.join(folder,'dictionary_cache.pkl')

    # Check if the cache file exists
    if os.path.exists(cache_file):
        with open(cache_file, 'rb') as f:
            dictionary, kana_dict = pickle.load(f)
        print("Loaded dictionary from cache")
    else:
        # Load dictionary from JSON files
        for i in range(1, 150):
            with open(os.path.join(folder,f'dictionaries/jitendex-yomitan/term_bank_{i}.json'), 'r') as f:
                dictionary += json.load(f)
        print("Loaded dictionary with", len(dictionary), "entries")

        # Sort the dictionary
        kana_dict = sorted(dictionary, key=lambda x: x[1])
        dictionary.sort(key=lambda x: x[0])
        print("Sorted dictionary")

        # Save the dictionary to the cache
        with open(cache_file, 'wb') as f:
            pickle.dump((dictionary, kana_dict), f)
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

    result = binary_search(word)
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

    data = {}
    data['data'] = [{'reading':result[1],'definitions':one_line},{'reading': result[1], 'definitions': html_string}]
    TranslationCache[word] = {"data": data['data']}
    return {"data": data['data']}
