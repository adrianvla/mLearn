import type {
  FlashcardStore,
  Flashcard,
  FlashcardState,
  DailyStudyStats,
  PassiveWordKnowledge,
  GrammarKnowledgeEntry,
  MediaStats,
  MediaSession,
} from '../../shared/types';
import { getBridge } from '../../shared/bridges';
import { hashWordSync } from '../services/srsAlgorithm';
import { getTodayDateString } from '../services/srsAlgorithm';

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function generateUUID(): string {
  return crypto.randomUUID();
}

function getDateString(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function langKey(language: string, hash: string): string {
  return language + ':' + hash;
}

const JA_WORDS = [
  '猫', '犬', '食べる', '飲む', '行く', '来る', '見る', '聞く', '話す', '読む',
  '書く', '買う', '売る', '待つ', '死ぬ', '遊ぶ', '泳ぐ', '起きる', '寝る', '勉強',
  '仕事', '学校', '家', '車', '電車', '友達', '家族', '時間', '今日', '明日',
  '昨日', '好き', '嫌い', '大きい', '小さい', '新しい', '古い', '多い', '少ない', '楽しい',
  '悲しい', '難しい', '易しい', '忙しい', '暇', '暑い', '寒い', '高い', '安い', '長い',
  '短い', '早い', '遅い', '強い', '弱い', '美しい', '醜い', '赤い', '青い', '白い',
  '黒い', '黄色い', '緑', '水', '火', '木', '金', '土', '山', '川',
  '海', '空', '風', '雨', '雪', '花', '草', '鳥', '魚', '虫',
];

const DE_WORDS: string[] = [
  'Haus', 'Auto', 'Hund', 'Katze', 'essen', 'trinken', 'gehen', 'kommen', 'sehen', 'hören',
  'sprechen', 'lesen', 'schreiben', 'kaufen', 'verkaufen', 'warten', 'spielen', 'schwimmen', 'aufstehen', 'schlafen',
  'Arbeit', 'Schule', 'Freund', 'Familie', 'Zeit', 'heute', 'morgen', 'gestern', 'gern', 'nicht',
  'groß', 'klein', 'neu', 'alt', 'viel', 'wenig', 'schwer', 'leicht', 'schön', 'hässlich',
  'rot', 'blau', 'weiß', 'schwarz', 'gelb', 'grün', 'Wasser', 'Feuer', 'Baum', 'Berg',
];

const JA_READINGS: Record<string, string> = {
  '猫': 'ねこ', '犬': 'いぬ', '食べる': 'たべる', '飲む': 'のむ', '行く': 'いく',
  '来る': 'くる', '見る': 'みる', '聞く': 'きく', '話す': 'はなす', '読む': 'よむ',
  '書く': 'かく', '買う': 'かう', '売る': 'うる', '待つ': 'まつ', '死ぬ': 'しぬ',
  '遊ぶ': 'あそぶ', '泳ぐ': 'およぐ', '起きる': 'おきる', '寝る': 'ねる', '勉強': 'べんきょう',
  '仕事': 'しごと', '学校': 'がっこう', '家': 'いえ', '車': 'くるま', '電車': 'でんしゃ',
  '友達': 'ともだち', '家族': 'かぞく', '時間': 'じかん', '今日': 'きょう', '明日': 'あした',
  '昨日': 'きのう', '好き': 'すき', '嫌い': 'きらい', '大きい': 'おおきい', '小さい': 'ちいさい',
  '新しい': 'あたらしい', '古い': 'ふるい', '多い': 'おおい', '少ない': 'すくない', '楽しい': 'たのしい',
  '悲しい': 'かなしい', '難しい': 'むずかしい', '易しい': 'やさしい', '忙しい': 'いそがしい', '暇': 'ひま',
  '暑い': 'あつい', '寒い': 'さむい', '高い': 'たかい', '安い': 'やすい', '長い': 'ながい',
  '短い': 'みじかい', '早い': 'はやい', '遅い': 'おそい', '強い': 'つよい', '弱い': 'よわい',
  '美しい': 'うつくしい', '醜い': 'みにくい', '赤い': 'あかい', '青い': 'あおい', '白い': 'しろい',
  '黒い': 'くろい', '黄色い': 'きいろい', '緑': 'みどり', '水': 'みず', '火': 'ひ',
  '木': 'き', '金': 'かね', '土': 'つち', '山': 'やま', '川': 'かわ',
  '海': 'うみ', '空': 'そら', '風': 'かぜ', '雨': 'あめ', '雪': 'ゆき',
  '花': 'はな', '草': 'くさ', '鳥': 'とり', '魚': 'さかな', '虫': 'むし',
};

function createFlashcard(
  word: string,
  reading: string | undefined,
  back: string,
  state: FlashcardState,
  language: string,
  daysAgoCreated: number,
  reviews: number,
  lapses: number,
  intervalDays: number,
  ease: number,
  suspended: boolean = false,
): Flashcard {
  const now = Date.now();
  const createdAt = now - daysAgoCreated * DAY;
  const lastReviewed = reviews > 0 ? now - Math.floor(Math.random() * intervalDays * DAY) : createdAt;

  let interval = 0;
  let dueDate = now;
  let learningStep = 0;

  if (state === 'new') {
    interval = 0;
    dueDate = now;
  } else if (state === 'learning') {
    const steps = [1 * MINUTE, 10 * MINUTE];
    learningStep = Math.min(reviews, steps.length - 1);
    interval = steps[learningStep] ?? steps[steps.length - 1];
    dueDate = now + interval;
  } else if (state === 'relearning') {
    interval = 10 * MINUTE;
    dueDate = now + interval;
    learningStep = 0;
  } else if (state === 'review') {
    interval = intervalDays * DAY;
    dueDate = now + interval;
  }

  return {
    id: generateUUID(),
    content: {
      type: 'word',
      front: word,
      back,
      reading,
      pos: 'noun',
    },
    state,
    ease: Math.max(1.3, Math.min(5.0, ease)),
    interval,
    dueDate,
    reviews,
    lapses,
    learningStep,
    createdAt,
    lastReviewed,
    lastUpdated: lastReviewed,
    language,
    suspended: suspended || undefined,
  };
}

function generateFlashcardsForLanguage(
  words: string[],
  readings: Record<string, string>,
  language: string,
): Record<string, Flashcard> {
  const cards: Record<string, Flashcard> = {};
  const states: FlashcardState[] = ['new', 'learning', 'review', 'relearning'];
  const stateWeights = [0.25, 0.2, 0.45, 0.1];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const reading = readings[word];
    const back = language === 'ja' ? `${word} definition` : `${word} Bedeutung`;

    const rand = Math.random();
    let cumulative = 0;
    let state: FlashcardState = 'new';
    for (let s = 0; s < states.length; s++) {
      cumulative += stateWeights[s];
      if (rand < cumulative) {
        state = states[s];
        break;
      }
    }

    const suspended = Math.random() < 0.06;
    if (suspended) {
      state = 'review';
    }

    const daysAgoCreated = Math.floor(Math.random() * 90) + 1;
    let reviews = 0;
    let lapses = 0;
    let intervalDays = 0;
    let ease = 2.5;

    if (state === 'new') {
      reviews = 0;
      ease = 2.5;
    } else if (state === 'learning') {
      reviews = Math.floor(Math.random() * 3);
      ease = 2.2 + Math.random() * 0.6;
    } else if (state === 'relearning') {
      reviews = Math.floor(Math.random() * 5) + 3;
      lapses = Math.floor(Math.random() * 2) + 1;
      ease = 1.8 + Math.random() * 0.5;
    } else if (state === 'review') {
      reviews = Math.floor(Math.random() * 15) + 1;
      lapses = Math.floor(Math.random() * 3);
      intervalDays = [1, 3, 7, 14, 30, 60, 120, 365][Math.floor(Math.random() * 8)];
      ease = 2.0 + Math.random() * 1.3;
    }

    const card = createFlashcard(
      word,
      reading,
      back,
      state,
      language,
      daysAgoCreated,
      reviews,
      lapses,
      intervalDays,
      ease,
      suspended,
    );
    cards[card.id] = card;
  }

  return cards;
}

function generateDailyStats(
  days: number,
  language: string,
): Record<string, Record<string, DailyStudyStats>> {
  const result: Record<string, Record<string, DailyStudyStats>> = {};

  for (let i = 0; i < days; i++) {
    const date = getDateString(days - i);
    if (Math.random() < 0.15) continue;

    const dayOfWeek = new Date(Date.now() - (days - i) * DAY).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const baseReviews = isWeekend ? 5 : 20;
    const reviewCardsStudied = Math.max(0, Math.floor(baseReviews + (Math.random() - 0.5) * 20));
    const newCardsStudied = Math.floor(Math.random() * 8);
    const lapses = Math.floor(Math.random() * Math.max(1, reviewCardsStudied * 0.15));
    const timeSpent = (reviewCardsStudied + newCardsStudied) * 12 * 1000 + Math.floor(Math.random() * 60000);
    const graduated = Math.floor(Math.random() * Math.max(1, newCardsStudied * 0.4));

    if (!result[date]) result[date] = {};
    result[date][language] = {
      date,
      newCardsStudied,
      reviewCardsStudied,
      lapses,
      timeSpent,
      graduated,
    };
  }

  return result;
}

function generateWordKnowledge(
  words: string[],
  language: string,
): Record<string, PassiveWordKnowledge> {
  const result: Record<string, PassiveWordKnowledge> = {};
  const now = Date.now();

  for (const word of words) {
    const hash = hashWordSync(word);
    const key = langKey(language, hash);
    const timesSeen = Math.floor(Math.random() * 150) + 1;
    const timesHovered = Math.floor(Math.random() * Math.max(1, timesSeen * 0.3));
    const ease = 1.0 + Math.random() * 3.5;

    const entry: PassiveWordKnowledge = {
      ease,
      lastSeen: now - Math.floor(Math.random() * 30 * DAY),
      timesSeen,
      timesHovered,
      word,
      language,
    };

    if (Math.random() < 0.3) {
      entry.statusChangedAtSeen = Math.floor(Math.random() * timesSeen) + 1;
      entry.lastStatusChange = now - Math.floor(Math.random() * 14 * DAY);
    }

    result[key] = entry;
  }

  return result;
}

function generateGrammarKnowledge(language: string): Record<string, GrammarKnowledgeEntry> {
  const patterns = language === 'ja'
    ? ['〜ても', '〜ば', '〜のに', '〜ように', '〜そうだ', '〜らしい', '〜みたいだ', '〜はずだ', '〜かもしれない', '〜に違いない']
    : ['weil + Nebensatz', 'damit + Nebensatz', 'obwohl + Nebensatz', 'als + Nebensatz', 'wenn + Nebensatz', 'Relative Sätze', 'Konjunktiv II', 'Passiv', 'Modalverben', 'trennbare Verben'];

  const result: Record<string, GrammarKnowledgeEntry> = {};
  const now = Date.now();

  for (const pattern of patterns) {
    const hash = hashWordSync(pattern);
    const key = langKey(language, hash);
    result[key] = {
      pattern,
      ease: 1.0 + Math.random() * 3.0,
      timesEncountered: Math.floor(Math.random() * 80) + 5,
      timesFailed: Math.floor(Math.random() * 10),
      lastSeen: now - Math.floor(Math.random() * 20 * DAY),
      level: Math.floor(Math.random() * 5) + 1,
      language,
    };
  }

  return result;
}

function generateMediaStats(): MediaStats[] {
  const now = Date.now();
  const mediaItems: MediaStats[] = [
    {
      mediaHash: hashWordSync('sample-anime-ep1'),
      mediaName: 'Sample Anime - Episode 1',
      mediaType: 'video',
      language: 'ja',
      wordsEncountered: {},
      grammarEncountered: {},
      assessedLevel: 3,
      sessions: [],
      totalTimeSpent: 0,
      lastAccessed: now,
    },
    {
      mediaHash: hashWordSync('sample-anime-ep2'),
      mediaName: 'Sample Anime - Episode 2',
      mediaType: 'video',
      language: 'ja',
      wordsEncountered: {},
      grammarEncountered: {},
      assessedLevel: 3,
      sessions: [],
      totalTimeSpent: 0,
      lastAccessed: now - 3 * DAY,
    },
    {
      mediaHash: hashWordSync('sample-manga-vol1'),
      mediaName: 'Sample Manga - Volume 1',
      mediaType: 'book',
      language: 'ja',
      wordsEncountered: {},
      grammarEncountered: {},
      assessedLevel: 4,
      sessions: [],
      totalTimeSpent: 0,
      lastAccessed: now - 7 * DAY,
    },
  ];

  for (const media of mediaItems) {
    const sessionCount = Math.floor(Math.random() * 5) + 2;
    for (let i = 0; i < sessionCount; i++) {
      const daysAgo = Math.floor(Math.random() * 20);
      const date = getDateString(daysAgo);
      const duration = (15 + Math.floor(Math.random() * 45)) * MINUTE;
      const startTime = now - daysAgo * DAY - Math.floor(Math.random() * 12 * HOUR);
      const endTime = startTime + duration;

      const session: MediaSession = {
        date,
        duration,
        wordsLearned: Math.floor(Math.random() * 10),
        startTime,
        endTime,
      };
      media.sessions.push(session);
      media.totalTimeSpent += duration;
    }
    media.lastAccessed = now - Math.floor(Math.random() * 10 * DAY);
  }

  return mediaItems;
}

function buildMockFlashcardStore(): FlashcardStore {
  const jaCards = generateFlashcardsForLanguage(JA_WORDS, JA_READINGS, 'ja');
  const deCards = generateFlashcardsForLanguage(DE_WORDS, {}, 'de');

  const allCards: Record<string, Flashcard> = { ...jaCards, ...deCards };

  const wordToCardMap: Record<string, string[]> = {};
  const wordStatsMap: Record<string, { cardCount: number; bestEase: number; totalReviews: number; totalLapses: number; lastReviewed: number; bestInterval: number; bestState: FlashcardState }> = {};

  for (const card of Object.values(allCards)) {
    const hash = hashWordSync(card.content.front);
    const key = langKey(card.language || 'ja', hash);
    if (!wordToCardMap[key]) wordToCardMap[key] = [];
    wordToCardMap[key].push(card.id);
  }

  for (const [key, cardIds] of Object.entries(wordToCardMap)) {
    const cards = cardIds.map(id => allCards[id]).filter(Boolean);
    let bestEase = 0;
    let totalReviews = 0;
    let totalLapses = 0;
    let lastReviewed = 0;
    let bestInterval = 0;
    let bestState: FlashcardState = 'new';

    for (const c of cards) {
      if (c.ease > bestEase) bestEase = c.ease;
      totalReviews += c.reviews || 0;
      totalLapses += c.lapses || 0;
      if (c.lastReviewed > lastReviewed) lastReviewed = c.lastReviewed;
      if (c.interval > bestInterval) bestInterval = c.interval;
      const stateOrder: Record<FlashcardState, number> = { new: 0, learning: 1, relearning: 2, review: 3 };
      if (stateOrder[c.state] > stateOrder[bestState]) bestState = c.state;
    }

    wordStatsMap[key] = {
      cardCount: cards.length,
      bestEase,
      totalReviews,
      totalLapses,
      lastReviewed,
      bestInterval,
      bestState,
    };
  }

  const today = getTodayDateString();
  const dailyStats = {
    ...generateDailyStats(60, 'ja'),
    ...generateDailyStats(60, 'de'),
  };

  return {
    flashcards: allCards,
    wordCandidates: {},
    wordToCardMap,
    wordStatsMap,
    knownUntracked: {},
    ignoredWords: {},
    wordKnowledge: {
      ...generateWordKnowledge(JA_WORDS, 'ja'),
      ...generateWordKnowledge(DE_WORDS, 'de'),
    },
    grammarKnowledge: {
      ...generateGrammarKnowledge('ja'),
      ...generateGrammarKnowledge('de'),
    },
    meta: {
      perLanguage: {
        ja: { newCardsToday: 3, reviewsToday: 12, newCardsDate: today },
        de: { newCardsToday: 2, reviewsToday: 8, newCardsDate: today },
      },
      newCardsToday: 5,
      reviewsToday: 20,
      newCardsDate: today,
      maxNewCardsPerDay: 20,
      maxNewCardsPerDayLearning: 20,
      maxReviewsPerDay: -1,
      learningSteps: [1, 10],
      relearnSteps: [10],
      graduatingInterval: 1,
      easyInterval: 4,
      newIntervalModifier: 100,
      reviewIntervalModifier: 100,
      maxInterval: 36500,
    },
    dailyStats,
    suggestedFlashcards: {},
    wordSyncSeen: {},
    version: 2,
  };
}

export async function populateMockStatsData(): Promise<void> {
  try {
    const mockStore = buildMockFlashcardStore();

    await getBridge().kvStore.kvSet('mlearn-flashcards', JSON.stringify(mockStore));

    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('mlearn-flashcards');
      channel.postMessage({ type: 'update', store: mockStore });
      channel.close();
    }

    const mediaStats = generateMediaStats();
    for (const media of mediaStats) {
      getBridge().mediaStats.saveMediaStats(media.mediaHash, media);
    }

    setTimeout(() => {
      getBridge().mediaStats.listMediaStats();
    }, 100);

    console.log('[MockData] Populated stats dashboard with realistic mock data');
    console.log(`  - ${Object.keys(mockStore.flashcards).length} flashcards`);
    console.log(`  - ${Object.keys(mockStore.dailyStats).length} days of study stats`);
    console.log(`  - ${Object.keys(mockStore.wordKnowledge).length} word knowledge entries`);
    console.log(`  - ${mediaStats.length} media items`);
  } catch (e) {
    console.error('[MockData] Failed to populate mock data:', e);
  }
}
