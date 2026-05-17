type HostApi = {
  kvGet: (key: string) => Promise<string | null>;
  kvSet: (key: string, value: string) => Promise<void>;
  closeWindow: () => void;
  translate: (word: string) => Promise<{ data: Array<unknown> }>;
};

type GameState = {
  words: WordEntry[];
  currentPlayer: 'user' | 'computer';
  gameOver: boolean;
  winner: 'user' | 'computer' | null;
  lastKana: string | null;
  errorMessage: string | null;
  computerThinking: boolean;
};

type WordEntry = {
  word: string;
  reading: string;
  player: 'user' | 'computer';
};

const HIRAGANA_START = 0x3041;
const HIRAGANA_END = 0x3096;
const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;

const SMALL_KANA = new Set([
  'ゃ', 'ゅ', 'ょ', 'っ',
  'ャ', 'ュ', 'ョ', 'ッ',
]);

const PROLONGED_SOUND = 'ー';

function isHiragana(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= HIRAGANA_START && code <= HIRAGANA_END;
}

function isKatakana(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= KATAKANA_START && code <= KATAKANA_END;
}

function isKana(char: string): boolean {
  return isHiragana(char) || isKatakana(char);
}

function katakanaToHiragana(str: string): string {
  return str.replace(/[\u30a1-\u30f6]/g, (ch) => {
    const code = ch.charCodeAt(0) - 0x60;
    return String.fromCharCode(code);
  });
}

function getLastKana(reading: string): string | null {
  if (!reading || reading.length === 0) {
    return null;
  }

  const normalized = katakanaToHiragana(reading);

  for (let i = normalized.length - 1; i >= 0; i--) {
    const char = normalized[i];

    if (char === PROLONGED_SOUND) {
      continue;
    }

    if (SMALL_KANA.has(char) && i > 0) {
      const prevChar = normalized[i - 1];
      if (isKana(prevChar)) {
        return prevChar + char;
      }
    }

    if (isKana(char)) {
      return char;
    }
  }

  return null;
}

function getFirstKana(reading: string): string | null {
  if (!reading || reading.length === 0) {
    return null;
  }

  const normalized = katakanaToHiragana(reading);
  const firstChar = normalized[0];

  if (!isKana(firstChar)) {
    return null;
  }

  if (normalized.length > 1 && SMALL_KANA.has(normalized[1])) {
    return firstChar + normalized[1];
  }

  return firstChar;
}

function endsWithN(reading: string): boolean {
  const normalized = katakanaToHiragana(reading);
  const lastKana = getLastKana(normalized);
  return lastKana === 'ん';
}

function normalizeForComparison(word: string): string {
  return katakanaToHiragana(word).replace(/[\sー]/g, '');
}

const COMPUTER_DICTIONARY: Array<{ word: string; reading: string }> = [
  { word: 'あさ', reading: 'あさ' },
  { word: 'あひる', reading: 'あひる' },
  { word: 'あめ', reading: 'あめ' },
  { word: 'あし', reading: 'あし' },
  { word: 'あたま', reading: 'あたま' },
  { word: 'あつさ', reading: 'あつさ' },
  { word: 'あに', reading: 'あに' },
  { word: 'あね', reading: 'あね' },
  { word: 'あらし', reading: 'あらし' },
  { word: 'あか', reading: 'あか' },
  { word: 'あお', reading: 'あお' },
  { word: 'あき', reading: 'あき' },
  { word: 'あさぎ', reading: 'あさぎ' },
  { word: 'いぬ', reading: 'いぬ' },
  { word: 'いす', reading: 'いす' },
  { word: 'いえ', reading: 'いえ' },
  { word: 'いし', reading: 'いし' },
  { word: 'いもうと', reading: 'いもうと' },
  { word: 'いろ', reading: 'いろ' },
  { word: 'いちご', reading: 'いちご' },
  { word: 'いと', reading: 'いと' },
  { word: 'いけ', reading: 'いけ' },
  { word: 'いま', reading: 'いま' },
  { word: 'いぬ', reading: 'いぬ' },
  { word: 'いも', reading: 'いも' },
  { word: 'いしゃ', reading: 'いしゃ' },
  { word: 'うさぎ', reading: 'うさぎ' },
  { word: 'うみ', reading: 'うみ' },
  { word: 'うし', reading: 'うし' },
  { word: 'うた', reading: 'うた' },
  { word: 'うで', reading: 'うで' },
  { word: 'うま', reading: 'うま' },
  { word: 'うめ', reading: 'うめ' },
  { word: 'うさぎ', reading: 'うさぎ' },
  { word: 'うどん', reading: 'うどん' },
  { word: 'うそ', reading: 'うそ' },
  { word: 'うわぎ', reading: 'うわぎ' },
  { word: 'うなぎ', reading: 'うなぎ' },
  { word: 'えき', reading: 'えき' },
  { word: 'えんぴつ', reading: 'えんぴつ' },
  { word: 'え', reading: 'え' },
  { word: 'えさ', reading: 'えさ' },
  { word: 'えだ', reading: 'えだ' },
  { word: 'えほん', reading: 'えほん' },
  { word: 'えび', reading: 'えび' },
  { word: 'えら', reading: 'えら' },
  { word: 'えき', reading: 'えき' },
  { word: 'えいが', reading: 'えいが' },
  { word: 'えきしゃ', reading: 'えきしゃ' },
  { word: 'おかね', reading: 'おかね' },
  { word: 'おんがく', reading: 'おんがく' },
  { word: 'おとうと', reading: 'おとうと' },
  { word: 'おかあさん', reading: 'おかあさん' },
  { word: 'おとうさん', reading: 'おとうさん' },
  { word: 'おおかみ', reading: 'おおかみ' },
  { word: 'おちゃ', reading: 'おちゃ' },
  { word: 'おにぎり', reading: 'おにぎり' },
  { word: 'おひさま', reading: 'おひさま' },
  { word: 'おふろ', reading: 'おふろ' },
  { word: 'おもちゃ', reading: 'おもちゃ' },
  { word: 'おかし', reading: 'おかし' },
  { word: 'おさけ', reading: 'おさけ' },
  { word: 'おわり', reading: 'おわり' },
  { word: 'かさ', reading: 'かさ' },
  { word: 'かばん', reading: 'かばん' },
  { word: 'かぜ', reading: 'かぜ' },
  { word: 'かぎ', reading: 'かぎ' },
  { word: 'かた', reading: 'かた' },
  { word: 'かち', reading: 'かち' },
  { word: 'かみ', reading: 'かみ' },
  { word: 'かお', reading: 'かお' },
  { word: 'かき', reading: 'かき' },
  { word: 'かさ', reading: 'かさ' },
  { word: 'かに', reading: 'かに' },
  { word: 'かえる', reading: 'かえる' },
  { word: 'かぞく', reading: 'かぞく' },
  { word: 'かわ', reading: 'かわ' },
  { word: 'かびん', reading: 'かびん' },
  { word: 'きつね', reading: 'きつね' },
  { word: 'きょうと', reading: 'きょうと' },
  { word: 'き', reading: 'き' },
  { word: 'きかい', reading: 'きかい' },
  { word: 'きく', reading: 'きく' },
  { word: 'きし', reading: 'きし' },
  { word: 'きた', reading: 'きた' },
  { word: 'きっさ', reading: 'きっさ' },
  { word: 'きぬ', reading: 'きぬ' },
  { word: 'きょうと', reading: 'きょうと' },
  { word: 'きょうし', reading: 'きょうし' },
  { word: 'きょうりゅう', reading: 'きょうりゅう' },
  { word: 'くるま', reading: 'くるま' },
  { word: 'くじら', reading: 'くじら' },
  { word: 'くち', reading: 'くち' },
  { word: 'くさ', reading: 'くさ' },
  { word: 'くすり', reading: 'くすり' },
  { word: 'くつ', reading: 'くつ' },
  { word: 'くも', reading: 'くも' },
  { word: 'くま', reading: 'くま' },
  { word: 'くじ', reading: 'くじ' },
  { word: 'くず', reading: 'くず' },
  { word: 'くび', reading: 'くび' },
  { word: 'けさ', reading: 'けさ' },
  { word: 'げんかん', reading: 'げんかん' },
  { word: 'け', reading: 'け' },
  { word: 'けが', reading: 'けが' },
  { word: 'けしき', reading: 'けしき' },
  { word: 'けっこん', reading: 'けっこん' },
  { word: 'けむり', reading: 'けむり' },
  { word: 'けんきゅう', reading: 'けんきゅう' },
  { word: 'けいさつ', reading: 'けいさつ' },
  { word: 'けんとう', reading: 'けんとう' },
  { word: 'けがわ', reading: 'けがわ' },
  { word: 'こども', reading: 'こども' },
  { word: 'ごはん', reading: 'ごはん' },
  { word: 'こころ', reading: 'こころ' },
  { word: 'こえ', reading: 'こえ' },
  { word: 'こおり', reading: 'こおり' },
  { word: 'こうえん', reading: 'こうえん' },
  { word: 'こうさてん', reading: 'こうさてん' },
  { word: 'こし', reading: 'こし' },
  { word: 'ごみ', reading: 'ごみ' },
  { word: 'こうちゃ', reading: 'こうちゃ' },
  { word: 'こうもり', reading: 'こうもり' },
  { word: 'こぶた', reading: 'こぶた' },
  { word: 'こい', reading: 'こい' },
  { word: 'さかな', reading: 'さかな' },
  { word: 'さくら', reading: 'さくら' },
  { word: 'さか', reading: 'さか' },
  { word: 'さく', reading: 'さく' },
  { word: 'さけ', reading: 'さけ' },
  { word: 'さとう', reading: 'さとう' },
  { word: 'さみしい', reading: 'さみしい' },
  { word: 'さる', reading: 'さる' },
  { word: 'さば', reading: 'さば' },
  { word: 'さかな', reading: 'さかな' },
  { word: 'さくらんぼ', reading: 'さくらんぼ' },
  { word: 'さけ', reading: 'さけ' },
  { word: 'しお', reading: 'しお' },
  { word: 'しま', reading: 'しま' },
  { word: 'しろ', reading: 'しろ' },
  { word: 'しごと', reading: 'しごと' },
  { word: 'しあわせ', reading: 'しあわせ' },
  { word: 'しけん', reading: 'しけん' },
  { word: 'しずか', reading: 'しずか' },
  { word: 'しろくま', reading: 'しろくま' },
  { word: 'しお', reading: 'しお' },
  { word: 'しっぽ', reading: 'しっぽ' },
  { word: 'しゃしん', reading: 'しゃしん' },
  { word: 'しんごう', reading: 'しんごう' },
  { word: 'しょうゆ', reading: 'しょうゆ' },
  { word: 'すし', reading: 'すし' },
  { word: 'すいか', reading: 'すいか' },
  { word: 'す', reading: 'す' },
  { word: 'すいそ', reading: 'すいそ' },
  { word: 'すき', reading: 'すき' },
  { word: 'すみ', reading: 'すみ' },
  { word: 'すな', reading: 'すな' },
  { word: 'せんせい', reading: 'せんせい' },
  { word: 'すずめ', reading: 'すずめ' },
  { word: 'すいとう', reading: 'すいとう' },
  { word: 'すきま', reading: 'すきま' },
  { word: 'そら', reading: 'そら' },
  { word: 'そと', reading: 'そと' },
  { word: 'そうじ', reading: 'そうじ' },
  { word: 'そこ', reading: 'そこ' },
  { word: 'そぼ', reading: 'そぼ' },
  { word: 'そば', reading: 'そば' },
  { word: 'そつぎょう', reading: 'そつぎょう' },
  { word: 'そふ', reading: 'そふ' },
  { word: 'たぬき', reading: 'たぬき' },
  { word: 'たまご', reading: 'たまご' },
  { word: 'た', reading: 'た' },
  { word: 'たいよう', reading: 'たいよう' },
  { word: 'たけ', reading: 'たけ' },
  { word: 'たまご', reading: 'たまご' },
  { word: 'たてもの', reading: 'たてもの' },
  { word: 'たいや', reading: 'たいや' },
  { word: 'たこ', reading: 'たこ' },
  { word: 'たに', reading: 'たに' },
  { word: 'たぬき', reading: 'たぬき' },
  { word: 'ちず', reading: 'ちず' },
  { word: 'ちから', reading: 'ちから' },
  { word: 'ちち', reading: 'ちち' },
  { word: 'ちゃわん', reading: 'ちゃわん' },
  { word: 'ちかてつ', reading: 'ちかてつ' },
  { word: 'ちか', reading: 'ちか' },
  { word: 'ちぎり', reading: 'ちぎり' },
  { word: 'ちび', reading: 'ちび' },
  { word: 'ちくわ', reading: 'ちくわ' },
  { word: 'つき', reading: 'つき' },
  { word: 'つくえ', reading: 'つくえ' },
  { word: 'つめ', reading: 'つめ' },
  { word: 'つゆ', reading: 'つゆ' },
  { word: 'つくえ', reading: 'つくえ' },
  { word: 'つぼ', reading: 'つぼ' },
  { word: 'つみき', reading: 'つみき' },
  { word: 'つづき', reading: 'つづき' },
  { word: 'てがみ', reading: 'てがみ' },
  { word: 'でんわ', reading: 'でんわ' },
  { word: 'て', reading: 'て' },
  { word: 'てんき', reading: 'てんき' },
  { word: 'てつ', reading: 'てつ' },
  { word: 'とけい', reading: 'とけい' },
  { word: 'どうぶつ', reading: 'どうぶつ' },
  { word: 'とおい', reading: 'とおい' },
  { word: 'とき', reading: 'とき' },
  { word: 'とし', reading: 'とし' },
  { word: 'となり', reading: 'となり' },
  { word: 'どく', reading: 'どく' },
  { word: 'とうがらし', reading: 'とうがらし' },
  { word: 'とり', reading: 'とり' },
  { word: 'とびら', reading: 'とびら' },
  { word: 'なつ', reading: 'なつ' },
  { word: 'なみ', reading: 'なみ' },
  { word: 'ながい', reading: 'ながい' },
  { word: 'なか', reading: 'なか' },
  { word: 'なべ', reading: 'なべ' },
  { word: 'なみだ', reading: 'なみだ' },
  { word: 'なわ', reading: 'なわ' },
  { word: 'ながさき', reading: 'ながさき' },
  { word: 'なす', reading: 'なす' },
  { word: 'ながれ', reading: 'ながれ' },
  { word: 'なかよし', reading: 'なかよし' },
  { word: 'にほん', reading: 'にほん' },
  { word: 'にわ', reading: 'にわ' },
  { word: 'にく', reading: 'にく' },
  { word: 'にんぎょう', reading: 'にんぎょう' },
  { word: 'にわとり', reading: 'にわとり' },
  { word: 'にし', reading: 'にし' },
  { word: 'にんじん', reading: 'にんじん' },
  { word: 'ぬま', reading: 'ぬま' },
  { word: 'ぬの', reading: 'ぬの' },
  { word: 'ぬりえ', reading: 'ぬりえ' },
  { word: 'ぬりえ', reading: 'ぬりえ' },
  { word: 'ねこ', reading: 'ねこ' },
  { word: 'ねる', reading: 'ねる' },
  { word: 'ねずみ', reading: 'ねずみ' },
  { word: 'ねっこ', reading: 'ねっこ' },
  { word: 'ねだん', reading: 'ねだん' },
  { word: 'ねぎ', reading: 'ねぎ' },
  { word: 'ねこ', reading: 'ねこ' },
  { word: 'のり', reading: 'のり' },
  { word: 'のど', reading: 'のど' },
  { word: 'のはら', reading: 'のはら' },
  { word: 'のみもの', reading: 'のみもの' },
  { word: 'のこぎり', reading: 'のこぎり' },
  { word: 'はな', reading: 'はな' },
  { word: 'はし', reading: 'はし' },
  { word: 'はがき', reading: 'はがき' },
  { word: 'はこ', reading: 'はこ' },
  { word: 'はし', reading: 'はし' },
  { word: 'はた', reading: 'はた' },
  { word: 'はなび', reading: 'はなび' },
  { word: 'はる', reading: 'はる' },
  { word: 'はがき', reading: 'はがき' },
  { word: 'はだ', reading: 'はだ' },
  { word: 'はち', reading: 'はち' },
  { word: 'ひこうき', reading: 'ひこうき' },
  { word: 'ひと', reading: 'ひと' },
  { word: 'ひ', reading: 'ひ' },
  { word: 'ひがし', reading: 'ひがし' },
  { word: 'ひげ', reading: 'ひげ' },
  { word: 'ひこうき', reading: 'ひこうき' },
  { word: 'ひだり', reading: 'ひだり' },
  { word: 'ひみつ', reading: 'ひみつ' },
  { word: 'ひのき', reading: 'ひのき' },
  { word: 'ひやけ', reading: 'ひやけ' },
  { word: 'ひふ', reading: 'ひふ' },
  { word: 'ふゆ', reading: 'ふゆ' },
  { word: 'ふね', reading: 'ふね' },
  { word: 'ふうとう', reading: 'ふうとう' },
  { word: 'ふく', reading: 'ふく' },
  { word: 'ふくろ', reading: 'ふくろ' },
  { word: 'ふた', reading: 'ふた' },
  { word: 'ふくろう', reading: 'ふくろう' },
  { word: 'ふたり', reading: 'ふたり' },
  { word: 'ふしぎ', reading: 'ふしぎ' },
  { word: 'ふじさん', reading: 'ふじさん' },
  { word: 'へや', reading: 'へや' },
  { word: 'へそ', reading: 'へそ' },
  { word: 'へいわ', reading: 'へいわ' },
  { word: 'へた', reading: 'へた' },
  { word: 'へり', reading: 'へり' },
  { word: 'へそ', reading: 'へそ' },
  { word: 'へいそ', reading: 'へいそ' },
  { word: 'ほん', reading: 'ほん' },
  { word: 'ほし', reading: 'ほし' },
  { word: 'ほうそう', reading: 'ほうそう' },
  { word: 'ほたる', reading: 'ほたる' },
  { word: 'ほね', reading: 'ほね' },
  { word: 'ほうき', reading: 'ほうき' },
  { word: 'ほしぞら', reading: 'ほしぞら' },
  { word: 'ほたて', reading: 'ほたて' },
  { word: 'ほうちょう', reading: 'ほうちょう' },
  { word: 'まど', reading: 'まど' },
  { word: 'まつり', reading: 'まつり' },
  { word: 'まえ', reading: 'まえ' },
  { word: 'まくら', reading: 'まくら' },
  { word: 'まつり', reading: 'まつり' },
  { word: 'まんが', reading: 'まんが' },
  { word: 'まる', reading: 'まる' },
  { word: 'まち', reading: 'まち' },
  { word: 'まゆ', reading: 'まゆ' },
  { word: 'みず', reading: 'みず' },
  { word: 'みち', reading: 'みち' },
  { word: 'みぎ', reading: 'みぎ' },
  { word: 'みずうみ', reading: 'みずうみ' },
  { word: 'みみ', reading: 'みみ' },
  { word: 'みらい', reading: 'みらい' },
  { word: 'みせ', reading: 'みせ' },
  { word: 'みどり', reading: 'みどり' },
  { word: 'むし', reading: 'むし' },
  { word: 'むこう', reading: 'むこう' },
  { word: 'むこう', reading: 'むこう' },
  { word: 'むすめ', reading: 'むすめ' },
  { word: 'むし', reading: 'むし' },
  { word: 'むね', reading: 'むね' },
  { word: 'むらさき', reading: 'むらさき' },
  { word: 'めがね', reading: 'めがね' },
  { word: 'めん', reading: 'めん' },
  { word: 'め', reading: 'め' },
  { word: 'めいし', reading: 'めいし' },
  { word: 'めし', reading: 'めし' },
  { word: 'もも', reading: 'もも' },
  { word: 'もり', reading: 'もり' },
  { word: 'もじ', reading: 'もじ' },
  { word: 'もち', reading: 'もち' },
  { word: 'もも', reading: 'もも' },
  { word: 'もやし', reading: 'もやし' },
  { word: 'やま', reading: 'やま' },
  { word: 'やさい', reading: 'やさい' },
  { word: 'やま', reading: 'やま' },
  { word: 'やくそく', reading: 'やくそく' },
  { word: 'やる', reading: 'やる' },
  { word: 'やさい', reading: 'やさい' },
  { word: 'やね', reading: 'やね' },
  { word: 'ゆき', reading: 'ゆき' },
  { word: 'ゆめ', reading: 'ゆめ' },
  { word: 'ゆび', reading: 'ゆび' },
  { word: 'ゆうがた', reading: 'ゆうがた' },
  { word: 'ようふく', reading: 'ようふく' },
  { word: 'よる', reading: 'よる' },
  { word: 'ようちえん', reading: 'ようちえん' },
  { word: 'よわい', reading: 'よわい' },
  { word: 'ようふく', reading: 'ようふく' },
  { word: 'よあけ', reading: 'よあけ' },
  { word: 'らいおん', reading: 'らいおん' },
  { word: 'らく', reading: 'らく' },
  { word: 'らいねん', reading: 'らいねん' },
  { word: 'らくだ', reading: 'らくだ' },
  { word: 'らっぱ', reading: 'らっぱ' },
  { word: 'りんご', reading: 'りんご' },
  { word: 'りゅう', reading: 'りゅう' },
  { word: 'りか', reading: 'りか' },
  { word: 'りそう', reading: 'りそう' },
  { word: 'りょうり', reading: 'りょうり' },
  { word: 'るす', reading: 'るす' },
  { word: 'るいけい', reading: 'るいけい' },
  { word: 'るすばん', reading: 'るすばん' },
  { word: 'るい', reading: 'るい' },
  { word: 'れいぞうこ', reading: 'れいぞうこ' },
  { word: 'れきし', reading: 'れきし' },
  { word: 'れんが', reading: 'れんが' },
  { word: 'れい', reading: 'れい' },
  { word: 'ろうそく', reading: 'ろうそく' },
  { word: 'ろうじん', reading: 'ろうじん' },
  { word: 'ろく', reading: 'ろく' },
  { word: 'ろく', reading: 'ろく' },
  { word: 'わに', reading: 'わに' },
  { word: 'わたし', reading: 'わたし' },
  { word: 'わらい', reading: 'わらい' },
  { word: 'わし', reading: 'わし' },
  { word: 'わたあめ', reading: 'わたあめ' },
  { word: 'わに', reading: 'わに' },
];

let computerUsedWords = new Set<string>();

function resetComputerMemory(): void {
  computerUsedWords = new Set<string>();
}

function getComputerWord(requiredKana: string, usedWords: Set<string>): { word: string; reading: string } | null {
  const validCandidates = COMPUTER_DICTIONARY.filter((entry) => {
    const firstKana = getFirstKana(entry.reading);
    return firstKana === requiredKana && !endsWithN(entry.reading);
  });

  if (validCandidates.length === 0) {
    return null;
  }

  const shuffled = [...validCandidates].sort(() => Math.random() - 0.5);

  for (const candidate of shuffled) {
    const normalized = normalizeForComparison(candidate.word);
    if (!usedWords.has(normalized) && !computerUsedWords.has(normalized)) {
      computerUsedWords.add(normalized);
      return candidate;
    }
  }

  for (const candidate of shuffled) {
    const normalized = normalizeForComparison(candidate.word);
    if (!usedWords.has(normalized)) {
      return candidate;
    }
  }

  return null;
}

function getInitialState(): GameState {
  resetComputerMemory();
  return {
    words: [],
    currentPlayer: 'user',
    gameOver: false,
    winner: null,
    lastKana: null,
    errorMessage: null,
    computerThinking: false,
  };
}

async function validateUserWord(
  word: string,
  host: HostApi,
  usedWords: Set<string>,
  expectedKana: string | null,
): Promise<{ valid: boolean; reading: string | null; error: string | null }> {
  if (!word || word.trim().length === 0) {
    return { valid: false, reading: null, error: 'Please enter a word.' };
  }

  const trimmed = word.trim();
  const normalized = normalizeForComparison(trimmed);

  if (usedWords.has(normalized)) {
    return { valid: false, reading: null, error: 'You cannot use a word twice.' };
  }

  const translation = await host.translate(trimmed);
  const hasDefinition = translation.data && translation.data.length > 0;

  if (!hasDefinition) {
    return { valid: false, reading: null, error: 'That word was not found in the dictionary.' };
  }

  let reading = trimmed;
  if (
    translation.data[0] &&
    typeof translation.data[0] === 'object' &&
    translation.data[0] !== null &&
    'reading' in translation.data[0] &&
    typeof translation.data[0].reading === 'string'
  ) {
    reading = translation.data[0].reading;
  }

  const firstKana = getFirstKana(reading);
  if (!firstKana) {
    return { valid: false, reading: null, error: 'Could not determine the reading of that word.' };
  }

  if (expectedKana && firstKana !== expectedKana) {
    return { valid: false, reading: null, error: `That word must start with "${expectedKana}".` };
  }

  if (endsWithN(reading)) {
    return { valid: false, reading, error: 'Word ends in ん — you lose!' };
  }

  return { valid: true, reading, error: null };
}

async function processComputerTurn(
  state: GameState,
): Promise<GameState> {
  if (state.gameOver || !state.lastKana) {
    return state;
  }

  const usedWords = new Set(state.words.map((w) => normalizeForComparison(w.word)));
  const computerWord = getComputerWord(state.lastKana, usedWords);

  if (!computerWord) {
    return {
      ...state,
      gameOver: true,
      winner: 'user',
      computerThinking: false,
      errorMessage: null,
    };
  }

  const newWords: WordEntry[] = [
    ...state.words,
    { word: computerWord.word, reading: computerWord.reading, player: 'computer' as const },
  ];

  const lastKana = getLastKana(computerWord.reading);

  if (endsWithN(computerWord.reading)) {
    return {
      ...state,
      words: newWords,
      gameOver: true,
      winner: 'user',
      currentPlayer: 'user',
      computerThinking: false,
      lastKana,
      errorMessage: null,
    };
  }

  return {
    ...state,
    words: newWords,
    currentPlayer: 'user',
    computerThinking: false,
    lastKana,
    errorMessage: null,
  };
}

export type { GameState, WordEntry, HostApi };
export {
  getInitialState,
  validateUserWord,
  processComputerTurn,
  getLastKana,
  getFirstKana,
  endsWithN,
  normalizeForComparison,
  katakanaToHiragana,
  isKana,
  isHiragana,
  isKatakana,
  getComputerWord,
  resetComputerMemory,
  COMPUTER_DICTIONARY,
};
