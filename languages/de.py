import spacy
import spacy.cli
import json
import urllib.request
from urllib.parse import quote
from bs4 import BeautifulSoup, NavigableString

try:
    nlp = spacy.load("de_core_news_sm")
except:
    spacy.cli.download("de_core_news_sm")
    nlp = spacy.load("de_core_news_sm")


def LANGUAGE_TOKENIZE(text):
    processed = nlp(text)
    a = [(token.text, token.pos_) for token in processed]
    # add spaces between words
    for i in range(len(a) - 1):
        if a[i + 1][1] != "PUNCT":
            a[i] = (a[i][0] + " ", a[i][1])
    b = []
    for u in a:
        b.append({"word": u[0], "type": u[1],"actual_word":u[0]})
    return b

getTranslationUrl = "https://www.dwds.de/wb/"


def extract_sub_elements(element):
    result = {}

    if element.name in ['span', 'div', 'p']:
        result['class'] = element['class'][0] if 'class' in element.attrs else element.name

    if element.contents:
        result['content'] = []
        for child in element.contents:
            if isinstance(child, NavigableString):
                result['content'].append(child.strip())
            else:
                result['content'].append(extract_sub_elements(child))
    else:
        result['content'] = element.text.strip()

    result['sub_text'] = element.get_text(strip=False)


    return result

TranslationCache = {}

def LANGUAGE_TRANSLATE(text):
    global getTranslationUrl
    global TranslationCache
    if text in TranslationCache:
        return TranslationCache[text]
    # send request to dwds
    encoded_word = quote(text)
    url = getTranslationUrl + encoded_word
    response = urllib.request.urlopen(url)
    data = response.read()
    data = data.decode("utf-8")
    soup = BeautifulSoup(data, 'html.parser')
    h1_element = soup.find('h1', {'class': 'dwdswb-ft-lemmaansatz'})
    if h1_element is None:
        return {"data": []}

    defs = []
    divs = soup.select('.dwdswb-lesarten > .dwdswb-lesart')
    for div in divs:
        defs.append(extract_sub_elements(div))
    to_return = []
    for definition in defs:
        to_return.append({'reading': h1_element.text,
                      'definitions': [definition]})
    sanitized = []
    for result in to_return:
        try:
            first_def_part = result['definitions'][0]['content'][1]['content'][0]['content'][0]['content'][0]['content']
            first_def_part = " ".join(filter(lambda x: type(x)==str, first_def_part))
            print("FIRST_DEF_PART",first_def_part)
            real_defs = {}
            real_defs_string = ""
            try:
                real_defs = result['definitions'][0]['content'][1]['content'][1:]

                print("REAL_DEFS",real_defs)
                real_defs_string = [x['content'][1]['content'][0]['sub_text'] for x in real_defs if 'class' in x and x['class'] != 'dwdswb-verwendungsbeispiele']
                real_defs_string = "<br>\t".join(real_defs_string)
            except:
                pass

            asdf = {'reading': real_defs_string,
                    'definitions': first_def_part} #result['reading']
            sanitized.append(asdf)
        except:
            pass

    sanitized[0]['definitions'] = result['reading'] + "<br><br>" + sanitized[0]['definitions']

    to_return2 = {"data": sanitized}
    TranslationCache[text] = to_return2
    return to_return2

