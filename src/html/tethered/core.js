/**
 * core.js — mLearn Tethered Mode Script
 *
 * Injected into external pages (via userscript or console injector) to provide
 * subtitle overlay, tokenisation, word-hover translations, flashcard creation,
 * and watch-together functionality.
 *
 * Depends on globals set by settings.js:
 *   globalThis.settings       — app settings
 *   globalThis.lang_data      — per-language config
 *   globalThis.lS             — localStorage mirror
 *   globalThis.easeHashmap    — word→ease quick lookup
 *   globalThis.wordKnowledgeMap — word→{hasFlashcard,bestEase,bestState,cardCount,totalReviews,bestInterval}
 *   globalThis.knownUntrackedHashes — hash→true for words marked known but without flashcards
 *   globalThis.knownEaseThreshold — threshold for considering a word "known"
 *   globalThis.serverProtocol — 'http' or 'https'
 */

/* ═══════════════════════════════════════════════════════════
   Tethered IP detection — resolve from multiple sources
   ═══════════════════════════════════════════════════════════ */

(function resolveTetheredGlobals() {
  if (window.mLearnTetheredIP) return;

  // Fallback 1: DOM data attribute set by the userscript
  var ds = document.documentElement.dataset.mlearnTetheredIp;
  if (ds) {
    window.mLearnTetheredIP = ds;
    window.mLearnTethered = true;
    return;
  }

  // Fallback 2: infer from the <script> element that loaded this file
  try {
    var scripts = document.querySelectorAll('script[src]');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || '';
      if (src.indexOf('core.js') !== -1) {
        var base = src.replace(/core\.js.*$/, '');
        if (base) {
          window.mLearnTetheredIP = base;
          window.mLearnTethered = true;
          return;
        }
      }
    }
  } catch (_e) { /* ignore */ }

  // Fallback 3: check globalThis (may differ from window in sandboxed contexts)
  if (typeof globalThis !== 'undefined' && globalThis.mLearnTetheredIP) {
    window.mLearnTetheredIP = globalThis.mLearnTetheredIP;
    window.mLearnTethered = true;
  }
})();

/* ═══════════════════════════════════════════════════════════
   CSS & HTML templates
   ═══════════════════════════════════════════════════════════ */

const CSSInjectable = `
  #context-menu {
    position: absolute;
    backdrop-filter: blur(20px) saturate(180%);
    background: rgba(60,60,60,0.5);
    border: 1px solid #444;
    box-sizing: border-box;
    box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    display: none;
    z-index: 10000;
    border-radius: 10px;
    min-width: 150px;
    overflow: hidden;
    color: #aaa;
    user-select: none;
  }
  #context-menu .menu-item {
    padding: 5px;
    padding-inline: 10px;
    cursor: pointer;
  }
  #context-menu .menu-item:hover {
    background-color: #333;
  }
`;

const CSSifSafariFix = `
  .mLearn-pitch-accent {
    position: absolute;
    bottom: 3em !important;
    left: 0; right: 0;
    top: -1.5em !important;
  }
`;

function isSafari() {
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/chrome|crios|crmo/i.test(ua) && !/edg/i.test(ua) && !/opr\//i.test(ua);
}

/* ═══════════════════════════════════════════════════════════
   Server URL helpers
   ═══════════════════════════════════════════════════════════ */

function srvUrl() {
  return window.mLearnTetheredIP || '';
}

function adaptAllURLs() {
  if (!globalThis.settings) return;
  const settingsToChange = ["tokeniserUrl", "getCardUrl", "getTranslationUrl", "ankiUrl"];
  settingsToChange.forEach((setting) => {
    let value = globalThis.settings[setting];
    if (!value) return;
    value = value.replace("http://127.0.0.1:7752/", srvUrl() + "forward/");
    globalThis.settings[setting] = value;
  });
}

adaptAllURLs();

const HTMLInjectable = `
  <div class="subtitles"></div>
  <div class="aside">
    <div class="header">
      <div class="btn close"><img src="${srvUrl()}pages/assets/icons/cross.svg"></div>
    </div>
    <div class="c"></div>
  </div>
  <div id="context-menu"></div>
  <div class="sync-subs not-shown">
    <div class="header">
      <div class="btn close"><img src="${srvUrl()}pages/assets/icons/cross.svg"></div>
    </div>
    <div class="controls">
      <button class="backward"><img src="${srvUrl()}pages/assets/icons/fast-forward.svg"></button>
      <input type="text" class="">
      <button class="forward"><img src="${srvUrl()}pages/assets/icons/fast-forward.svg"></button>
    </div>
  </div>
  <iframe src="" frameborder="0" hidden id="mlearn-frame"></iframe>
`;

/* ═══════════════════════════════════════════════════════════
   State variables
   ═══════════════════════════════════════════════════════════ */

const SUBTITLE_THEMES = ["marker", "background", "shadow"];
let subs = null;
let alreadyDisplayingCards = {};
let asideTimeout = null;
let TRANSLATABLE;
let last_lastIndex = 0;
let lastIndex = 0;
let lastSub = null;
let isLoaded = false;
let hoveredWordsCount = 0;
let hoveredWords = {};
let hoveredIds = {};
let wordFreq = {};
let foundFreq = {};
let knownAdjustment = {};
let wordUUIDs = {};
let wordPosByUUID = {};
let isWatchTogether = false;
let webSocket = null;
let videoTimeUpdateCallback = null;
let lastParsedSubtitleName = "";

/* ═══════════════════════════════════════════════════════════
   Word knowledge helpers
   ═══════════════════════════════════════════════════════════ */

function getWordKnowledgeMap() {
  return globalThis.wordKnowledgeMap || {};
}

function getEaseByWord() {
  return globalThis.easeHashmap || {};
}

function wordHasFlashcard(word) {
  const km = getWordKnowledgeMap();
  return !!(km[word] && km[word].hasFlashcard);
}

/**
 * Determine the known status of a word.
 * 0 = unknown, 1 = learning, 2 = known
 *
 * Priority:
 *  1. Manual override from knownAdjustment (localStorage)
 *  2. Word knowledge map (from flashcard store)
 *  3. Ease hashmap fallback
 */
function getKnownStatus(word) {
  if (word in knownAdjustment) return knownAdjustment[word];

  const km = getWordKnowledgeMap();
  const entry = km[word];

  if (entry && entry.hasFlashcard) {
    if (entry.bestState === 'review' && entry.bestEase >= (globalThis.knownEaseThreshold / 1000)) {
      return 2;
    }
    if (entry.bestState === 'review' || entry.bestState === 'relearning' || entry.bestState === 'learning') {
      return 1;
    }
    return 1;
  }

  const easeMap = getEaseByWord();
  if (word in easeMap) {
    if (easeMap[word] >= (globalThis.knownEaseThreshold / 1000)) return 2;
    return 1;
  }

  return 0;
}

function defaultEaseForStatus(status) {
  if (status === 2) return 2.5;
  if (status === 1) return 2.0;
  return 2.5;
}

/* ═══════════════════════════════════════════════════════════
   Subtitle name parsing
   ═══════════════════════════════════════════════════════════ */

function parseSubtitleName(filename) {
  if (!filename) return "";
  let name = filename.replace(/\.[^.]{1,3}$/, "");
  name = name.replace(/[._]/g, " ");
  name = name.replace(/\b(WEBRip|BluRay|HDTV|Netflix|AMZN|x264|x265|1080p|720p|480p|Subtitles)\b/gi, "");
  name = name.replace(/S(\d{1,2})E0?(\d{1,2})/gi, (_, s, e) => `S${s}E${parseInt(e)}`);
  name = name.replace(/\b(ja|en|fr|es|de|it|pt|ru|zh|ko)\b/gi, "");
  name = name.replace(/\[[^\]]*\]|\{[^}]*\}|\([^)]*\)/g, "");
  return name.replace(/ {2,}/g, " ").trim();
}

/* ═══════════════════════════════════════════════════════════
   Communication helpers
   ═══════════════════════════════════════════════════════════ */

lS.setItem = function (key, value) { lS[key] = value; };
lS.getItem = function (key) { return lS[key]; };

function sendLastWatchedUpdateViaHTTP(payload) {
  try {
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    fetch(srvUrl() + `api/update-last-watched?payload=${encodeURIComponent(encoded)}`, {
      method: 'GET', mode: 'cors',
    }).catch(e => console.warn('HTTP fallback for last-watched failed', e));
  } catch (e) { console.warn('HTTP fallback for last-watched failed', e); }
}

function sendLastWatchedUpdate(name, screenshotUrl, videoUrl) {
  if (!window.mLearnTethered) return;
  const payload = { action: 'update-last-watched', name, screenshotUrl, videoUrl };
  try {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
      webSocket.send(JSON.stringify(payload));
      return;
    }
  } catch (e) { /* fallback below */ }
  sendLastWatchedUpdateViaHTTP(payload);
}

function sendPill(key, value) {
  if (!window.mLearnTethered) return;
  fetch(srvUrl() + `api/pills?key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`, {
    method: 'GET', mode: 'cors',
  }).catch(e => console.warn('sendPill failed', e));
}

function trackWordAppearance(word) {
  if (!window.mLearnTethered) return;
  fetch(srvUrl() + `api/word-appearance?word=${encodeURIComponent(word)}`, {
    method: 'GET', mode: 'cors',
  }).catch(e => console.warn('trackWordAppearance failed', e));
}

function attemptFlashcardCreation(word, content) {
  if (!window.mLearnTethered) return;
  try {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
      webSocket.send(JSON.stringify({ action: 'attempt-flashcard-creation', word, content }));
      return;
    }
  } catch (e) { /* fallback below */ }
  fetch(srvUrl() + `api/attempt-flashcard-creation?word=${encodeURIComponent(word)}&content=${encodeURIComponent(JSON.stringify(content))}`, {
    method: 'GET', mode: 'cors',
  }).catch(e => console.warn('attemptFlashcardCreation HTTP fallback failed', e));
}

function createNewFlashcard(content) {
  if (!window.mLearnTethered) return;
  try {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
      webSocket.send(JSON.stringify({ action: 'create-new-flashcard', content }));
      return;
    }
  } catch (e) { /* fallback below */ }
  fetch(srvUrl() + 'api/create-flashcard', {
    method: 'POST', mode: 'cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }).catch(e => console.warn('createNewFlashcard HTTP fallback failed', e));
}

/* ═══════════════════════════════════════════════════════════
   Settings application
   ═══════════════════════════════════════════════════════════ */

const applySettings = () => {
  document.documentElement.style.setProperty('--subtitle-font-size', `${settings.subtitle_font_size}px`);
  document.documentElement.style.setProperty('--subtitle-font-weight', `${settings.subtitle_font_weight}`);
  document.documentElement.style.setProperty('--word-blur-amount', `${settings.blur_amount}px`);
  SUBTITLE_THEMES.forEach((theme) => { $(".subtitles").removeClass("theme-" + theme); });
  $(".subtitles").addClass("theme-" + settings.subtitleTheme);
};

/* ═══════════════════════════════════════════════════════════
   Notifications
   ═══════════════════════════════════════════════════════════ */

const show_notification = (m, autoclose = true) => {
  let notification = $(`<div class="custom-notification">
    <div class="header">
      <div class="btn close"><img src="${srvUrl()}pages/assets/icons/cross.svg"></div>
    </div>
    <div class="content"><span>${m}</span></div>
  </div>`);
  notification.css("right", "-100%");
  $("body").append(notification);
  notification.animate({ right: 10 });
  const closeNotif = () => { notification.animate({ right: "-100%" }, () => { notification.remove(); }); };
  notification.find(".close").click(closeNotif);
  if (autoclose) setTimeout(closeNotif, 3000);
};

/* ═══════════════════════════════════════════════════════════
   Context menu
   ═══════════════════════════════════════════════════════════ */

function initCTXMenu() {
  const contextMenu = document.getElementById('context-menu');
  const globalMenuItems = [];

  window.addContextMenuItem = function (name, callback) {
    globalMenuItems.push({ name, callback });
  };
  window.clearContextMenuItems = function () {
    globalMenuItems.length = 0;
  };

  function showContextMenu(items, x, y) {
    contextMenu.innerHTML = '';
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'menu-item';
      div.textContent = item.name;
      div.onclick = () => {
        try { item.callback(); } catch (e) { console.warn(e); }
        hideContextMenu();
      };
      contextMenu.appendChild(div);
    });
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.style.display = 'block';
  }

  function hideContextMenu() {
    contextMenu.style.display = 'none';
  }

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (globalMenuItems.length > 0) showContextMenu(globalMenuItems, e.pageX, e.pageY);
  });

  let touchTimer = null;
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchTimer = setTimeout(() => {
        const touch = e.touches[0];
        if (globalMenuItems.length > 0) showContextMenu(globalMenuItems, touch.pageX, touch.pageY);
      }, 500);
    }
  });
  document.addEventListener('touchend', () => { clearTimeout(touchTimer); });
  document.addEventListener('touchmove', () => { clearTimeout(touchTimer); });
  document.addEventListener('click', hideContextMenu);
  window.addEventListener('blur', hideContextMenu);
}

/* ═══════════════════════════════════════════════════════════
   CSS injection
   ═══════════════════════════════════════════════════════════ */

function injectCSS(cssText) {
  const style = document.createElement('style');
  style.type = 'text/css';
  style.textContent = cssText;
  document.head.appendChild(style);
}

/* ═══════════════════════════════════════════════════════════
   Language data + frequency
   ═══════════════════════════════════════════════════════════ */

const load_lang_data = () => {
  const ld = lang_data[settings.language];
  if (!ld) return;
  TRANSLATABLE = ld.translatable || [];
  settings.colour_codes = ld.colour_codes || {};
};

const parseWordFrequency = () => {
  const ld = lang_data[settings.language];
  if (!ld || !ld.freq) return;
  const freq = ld.freq;
  for (let wordi in freq) {
    if (!freq[wordi] || freq[wordi].length < 2) continue;
    let level = 1;
    const idx = parseInt(wordi, 10);
    if (idx <= 1500 && idx >= 0) level = 5;
    else if (idx > 1500 && idx <= 5000) level = 4;
    else if (idx > 5000 && idx <= 15000) level = 3;
    else if (idx > 15000 && idx <= 30000) level = 2;

    let lvlName = "";
    if (ld.freq_level_names) {
      lvlName = ld.freq_level_names[String(level)];
    }
    if (!lvlName) lvlName = "Level " + level;
    wordFreq[freq[wordi][0]] = { reading: freq[wordi][1], level: lvlName, raw_level: level };
  }
};

/* ═══════════════════════════════════════════════════════════
   Hover tracking
   ═══════════════════════════════════════════════════════════ */

const hoveredWordTracker = (word, uuid) => {
  if (hoveredIds[uuid]) return;
  hoveredIds[uuid] = true;
  hoveredWordsCount++;
  hoveredWords[word] = (hoveredWords[word] || 0) + 1;
};

/* ═══════════════════════════════════════════════════════════
   URL rewriting for API calls
   ═══════════════════════════════════════════════════════════ */

function replaceLocalhostEndpointURL(str) {
  if (!window.mLearnTethered) return str;
  let newBaseURL = window.mLearnTetheredIP || '';
  if (!newBaseURL) return str;
  if (!newBaseURL.endsWith('/')) newBaseURL += '/';
  newBaseURL += "forward/";
  return str.replace(/http:\/\/127\.0\.0\.1:\d+\/([a-zA-Z0-9-_]+)/g, (_, endpoint) => newBaseURL + endpoint);
}

/* ═══════════════════════════════════════════════════════════
   API calls (tokenise, translate, getCards)
   ═══════════════════════════════════════════════════════════ */

function tokenise(text) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.addEventListener('error', () => reject('failed to issue request'));
    xhr.addEventListener('load', () => {
      try { resolve(JSON.parse(xhr.responseText).tokens); }
      catch (e) { reject(e); }
    });
    xhr.open('POST', replaceLocalhostEndpointURL(settings.tokeniserUrl));
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({ "text": text }));
  });
}

function getCards(text) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.addEventListener('error', () => reject('failed to issue request'));
    xhr.addEventListener('load', () => {
      try { resolve(JSON.parse(xhr.responseText)); }
      catch (e) { reject(e); }
    });
    xhr.open('POST', replaceLocalhostEndpointURL(settings.getCardUrl));
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({ "word": text }));
  });
}

function getTranslation(text) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.addEventListener('error', () => reject('failed to issue request'));
    xhr.addEventListener('load', () => {
      try { resolve(JSON.parse(xhr.responseText)); }
      catch (e) { reject(e); }
    });
    xhr.open('POST', replaceLocalhostEndpointURL(settings.getTranslationUrl));
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({ "word": text }));
  });
}

/* ═══════════════════════════════════════════════════════════
   UUID (for DOM IDs only)
   ═══════════════════════════════════════════════════════════ */

const randomUUID = () => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

/* ═══════════════════════════════════════════════════════════
   Aside / translation cards
   ═══════════════════════════════════════════════════════════ */

const addTranslationCard = async (translation, reading) => {
  const cardId = "card_" + randomUUID();
  if ($(".aside .c .mLearn-card").length === 0) {
    $(".aside .c").append(`<div class="mLearn-card" id="${cardId}"><h1>${translation}</h1><p>${reading}</p></div>`);
  } else {
    $(".aside .c .mLearn-card").first().before(`<div class="mLearn-card" id="${cardId}"><h1>${translation}</h1><p>${reading}</p></div>`);
  }
  if ($(".aside .c .mLearn-card").length > 6) {
    $(".aside .c .mLearn-card").last().remove();
  }
  if (asideTimeout) clearTimeout(asideTimeout);
  $(".aside").removeClass("opacity0");
  asideTimeout = setTimeout(() => {
    $(".aside").addClass("opacity0");
    alreadyDisplayingCards = {};
  }, 5000);
  return () => { $(`#${cardId}`).remove(); };
};

/* ═══════════════════════════════════════════════════════════
   Language-aware helpers
   ═══════════════════════════════════════════════════════════ */

function langHasFurigana() {
  const ld = lang_data[settings.language];
  return !!(ld && ld.hasFurigana);
}

function wordNeedsReading(word) {
  if (!langHasFurigana()) return false;
  const phoneticOnly = /^[\u3040-\u30FF\uFF65-\uFF9F]+$/;
  return !phoneticOnly.test(word);
}

function langSupportsPitchAccent() {
  return !!settings.showPitchAccent;
}

/* ═══════════════════════════════════════════════════════════
   Known status management (localStorage overrides)
   ═══════════════════════════════════════════════════════════ */

const saveKnownAdjustment = () => { lS.setItem("knownAdjustment", JSON.stringify(knownAdjustment)); };
const loadKnownAdjustment = () => {
  let data = lS.getItem("knownAdjustment");
  knownAdjustment = data ? JSON.parse(data) : {};
};

const changeKnownStatus = (word, status) => {
  knownAdjustment[word] = status;
  saveKnownAdjustment();
  sendPill(word, status);
  const km = getWordKnowledgeMap();
  if (status === 2 && km[word]) {
    km[word].bestState = 'review';
    km[word].bestEase = Math.max(km[word].bestEase || 0, globalThis.knownEaseThreshold / 1000);
  }
};

/* ═══════════════════════════════════════════════════════════
   Status pill HTML generators
   ═══════════════════════════════════════════════════════════ */

const unknownStatusPillHTML = (uuid) => `
  <div class="pill pill-btn red" onclick='changeKnownBtnStatus("${uuid}", 1);' id="status-pill-${uuid}">
    <span class="icon"><img src="${srvUrl()}pages/assets/icons/cross2.svg" alt=""></span>
    <span>Unknown</span>
  </div>`;

const learningStatusPillHTML = (uuid) => `
  <div class="pill pill-btn orange" onclick='changeKnownBtnStatus("${uuid}", 2);' id="status-pill-${uuid}">
    <span class="icon"><img src="${srvUrl()}pages/assets/icons/check.svg" alt=""></span>
    <span>Learning</span>
  </div>`;

const knownStatusPillHTML = (uuid) => `
  <div class="pill pill-btn green" onclick='changeKnownBtnStatus("${uuid}", 0);' id="status-pill-${uuid}">
    <span class="icon"><img src="${srvUrl()}pages/assets/icons/check.svg" alt=""></span>
    <span>Known</span>
  </div>`;

const addToFlashcardsPillHTML = (uuid) => `
  <div class="pill pill-btn blue" onclick='clickAddToFlashcards("${uuid}");' id="add-to-srs-pill-${uuid}">
    <span class="icon"><img src="${srvUrl()}pages/assets/icons/cross2.svg" alt="" style="transform: rotate(45deg);"></span>
    <span>Flashcard</span>
  </div>`;

const checkMarkFlashcardPillHTML = () => `
  <div class="pill pill-btn green">
    <span class="icon"><img src="${srvUrl()}pages/assets/icons/check.svg" alt=""></span>
    <span>Tracked</span>
  </div>`;

const easePillHTML = (ease) => `<div class="pill yellow"><span>Ease: ${ease}</span></div>`;

const addEasePill = (word) => {
  const easeMap = getEaseByWord();
  const km = getWordKnowledgeMap();
  let easeVal = easeMap[word];
  if (easeVal === undefined && km[word]) {
    easeVal = km[word].bestEase;
  }
  const display = (easeVal !== undefined && easeVal !== null) ? (Math.round(easeVal * 100) / 100) : "?";
  return easePillHTML(display);
};

/* ═══════════════════════════════════════════════════════════
   Status pill generation and cycling
   ═══════════════════════════════════════════════════════════ */

const generateStatusPillHTML = (word, status, uuid) => {
  wordUUIDs[uuid] = word;
  if (status === 0) return unknownStatusPillHTML(uuid);
  if (status === 1) return learningStatusPillHTML(uuid);
  if (status === 2) return knownStatusPillHTML(uuid);
  return "";
};

const changeKnownBtnStatus = async (uuid, status) => {
  const el = document.getElementById(`status-pill-${uuid}`);
  const word = wordUUIDs[uuid];
  if (!word || !el) return;
  el.outerHTML = generateStatusPillHTML(word, status, uuid);
  changeKnownStatus(word, status);
};

const changeKnownStatusButtonHTML = (word, uuid) => {
  const status = getKnownStatus(word);
  return generateStatusPillHTML(word, status, uuid);
};

/* ═══════════════════════════════════════════════════════════
   Screenshot
   ═══════════════════════════════════════════════════════════ */

const screenshotVideo = () => {
  try {
    let video = $("video").get(0);
    if (!video) return "";
    let canvas = document.createElement("canvas");
    let ctx = canvas.getContext("2d");
    let width = 480;
    let height = video.videoHeight * (width / video.videoWidth);
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.5);
  } catch (e) {
    console.warn('screenshotVideo failed', e);
    return "";
  }
};

/* ═══════════════════════════════════════════════════════════
   Blur
   ═══════════════════════════════════════════════════════════ */

const blurWord = (newEl) => {
  if (settings.blur_words) newEl.addClass("blur");
};

const countFreq = (freq) => {
  foundFreq[freq] = (foundFreq[freq] || 0) + 1;
};

/* ═══════════════════════════════════════════════════════════
   Pill assembly
   ═══════════════════════════════════════════════════════════ */

const addPills = (word, pos, uuid) => {
  let s = `<div class="footer"><div class="pills">`;

  if (word in wordFreq) {
    countFreq(wordFreq[word].raw_level);
    s += `<div class="pill" level="${wordFreq[word].raw_level}">${wordFreq[word].level}</div>`;
  }

  if (settings.show_pos) {
    s += `<div class="pill">${pos}</div>`;
  }

  s += changeKnownStatusButtonHTML(word, uuid);

  if (window.mLearnTethered) {
    wordUUIDs[uuid] = word;
    wordPosByUUID[uuid] = pos;
    const isTracked = wordHasFlashcard(word);
    if (isTracked) {
      s += checkMarkFlashcardPillHTML();
      s += addEasePill(word);
    } else {
      s += addToFlashcardsPillHTML(uuid);
    }
  }

  s += `</div></div>`;
  return s;
};

/* ═══════════════════════════════════════════════════════════
   Flashcard creation from tethered mode
   ═══════════════════════════════════════════════════════════ */

async function clickAddToFlashcards(uuid) {
  try {
    const word = wordUUIDs[uuid];
    if (!word) return;
    const pos = wordPosByUUID[uuid] || "";
    const translation_data = await getTranslation(word);
    if (!translation_data || !translation_data.data || translation_data.data.length === 0) return;

    let exampleHtml = "";
    try {
      const $iframe = $("iframe#mlearn-frame");
      if ($iframe && $iframe.length) {
        const body = $iframe[0].contentWindow.document.body;
        body.innerHTML = $(".subtitles").html();
        $iframe.contents().find(".subtitle_hover").remove();
        $iframe.contents().find(`.subtitle_word.word_${uuid}`).addClass("defined");
        exampleHtml = body.innerHTML || "";
        body.innerHTML = "";
      }
    } catch (_e) { /* ignore snapshot failures */ }

    const content = {
      word: word,
      pitchAccent: translation_data.data[2] && translation_data.data[2].pitches && translation_data.data[2].pitches[0] ? translation_data.data[2].pitches[0].position : undefined,
      pronunciation: translation_data.data[0] ? translation_data.data[0].reading : "",
      translation: translation_data.data[0] ? translation_data.data[0].definitions : "",
      definition: translation_data.data[1] ? translation_data.data[1].definitions : "",
      example: exampleHtml,
      exampleMeaning: "",
      screenshotUrl: screenshotVideo(),
      pos: pos,
      level: (word in wordFreq ? (wordFreq[word].raw_level || -1) : -1),
    };

    createNewFlashcard(content);

    const km = getWordKnowledgeMap();
    km[word] = {
      hasFlashcard: true,
      bestEase: defaultEaseForStatus(getKnownStatus(word)),
      bestState: 'new',
      cardCount: (km[word] ? km[word].cardCount || 0 : 0) + 1,
      totalReviews: km[word] ? km[word].totalReviews || 0 : 0,
      bestInterval: km[word] ? km[word].bestInterval || 0 : 0,
    };

    const easeMap = getEaseByWord();
    if (!(word in easeMap)) {
      easeMap[word] = defaultEaseForStatus(getKnownStatus(word));
    }

    const pillEl = document.getElementById(`add-to-srs-pill-${uuid}`);
    if (pillEl) {
      pillEl.insertAdjacentHTML('afterend', addEasePill(word));
      pillEl.outerHTML = checkMarkFlashcardPillHTML();
    }
  } catch (e) {
    console.error("Failed to add flashcard:", e);
  }
}
window.clickAddToFlashcards = clickAddToFlashcards;
window.changeKnownBtnStatus = changeKnownBtnStatus;

/* ═══════════════════════════════════════════════════════════
   Pitch accent rendering (language-agnostic)
   ═══════════════════════════════════════════════════════════ */

function addPitchAccent(accentData, reading, realWord, lookAheadPos, newEl, currentPos) {
  if (!langSupportsPitchAccent()) return;
  if (!accentData || !accentData.pitches || accentData.pitches.length === 0) return;
  if (!reading || reading.length <= 1) return;
  if (realWord.length <= 1) return;

  const accent_type = accentData.pitches[0].position;
  const wordLen = reading.length;

  let arr = [];
  let particle_accent = accent_type === 0;

  for (let i = 0; i < wordLen; i++) {
    switch (accent_type) {
      case 0: arr.push(i !== 0); break;
      case 1: arr.push(i === 0); break;
      case 2: arr.push(i === 1); break;
      case 3: arr.push(i !== 0); break;
      default: arr.push(i !== 0 && i < accent_type); break;
    }
  }

  let el = $('<div class="mLearn-pitch-accent"></div>');
  let html_string = "";

  for (let i = 0; i < wordLen; i++) {
    let classString = "box";
    if (!arr[i]) classString += " bottom";
    if (arr[i]) classString += " top";
    if (i >= 1 && arr[i - 1] !== arr[i]) classString += " left";
    html_string += `<div class="${classString}"></div>`;
  }

  if (lookAheadPos !== currentPos) {
    let classString = "box particle-box";
    if (!particle_accent) classString += " bottom";
    if (particle_accent) classString += " top";
    if (arr[wordLen - 1] !== particle_accent) classString += " left";
    html_string += `<div class="${classString}" style="margin-right:${-100 / wordLen}%;"></div>`;
  }

  for (let i = wordLen; i < realWord.length; i++) {
    html_string += `<div class="box"></div>`;
  }

  el.html(html_string);

  if (wordNeedsReading(realWord)) {
    let furigana_rt = newEl.find("ruby rt");
    if (furigana_rt.length > 0) {
      furigana_rt.append(el);
      newEl.css("--pitch-accent-height", "2px");
    }
  } else {
    newEl.append(el);
    newEl.css("--pitch-accent-height", "5px");
  }
}

/* ═══════════════════════════════════════════════════════════
   Subtitle processing
   ═══════════════════════════════════════════════════════════ */

const modify_sub = async (subtitle) => {
  if (last_lastIndex === lastIndex) return;
  last_lastIndex = lastIndex;

  $(".subtitles").addClass("quick-transition").addClass("not-shown");
  subtitle = subtitle.replace(/(<([^>]+)>)/gi, "");

  let tokens = await tokenise(subtitle);
  hoveredIds = {};
  wordUUIDs = {};
  wordPosByUUID = {};

  let show_subtitle = false;

  const addFrequencyStars = (word) => {
    if (word in wordFreq) {
      let level = wordFreq[word].raw_level;
      let s = `<span class="frequency" level="${level}">`;
      for (let i = 0; i < level; i++) s += `<span class="star"></span>`;
      s += `</span>`;
      return s;
    }
    return "";
  };

  const processToken = async (token, look_ahead_token) => {
    let word = token.actual_word;
    let pos = token.type;
    let real_word = token.word;
    let uuid = randomUUID();
    let newEl = $(`<span class="subtitle_word word_${uuid}">${real_word}</span>`);
    let hoverEl = $(`<div class="subtitle_hover hover_${uuid}"></div>`);
    let hoverEl_html = "";
    let pill_html = "";
    let doAppend = false;
    let doAppendHoverLazy = false;

    const addFurigana = (reading_text) => {
      if (!langHasFurigana() || !settings.furigana) return reading_text;
      if (!wordNeedsReading(real_word)) return reading_text;

      let cleanReading = reading_text;
      let accent_start = cleanReading.indexOf("<!-- accent_start -->");
      if (accent_start !== -1) cleanReading = cleanReading.substring(0, accent_start);

      let correction = "";
      for (let i = cleanReading.length; i < real_word.length; i++) correction += "&nbsp;";
      newEl.html(`<ruby>${real_word}<rt>${cleanReading}${correction}</rt></ruby>`);
      return cleanReading;
    };

    const generateTranslationHTML = (translation_html, reading_html) => {
      if (translation_html) hoverEl_html += `<div class="hover_translation">${translation_html}</div>`;
      if (reading_html) hoverEl_html += `<div class="hover_reading">${reading_html}</div>`;
    };

    const updateHoverElHTML = () => {
      hoverEl.html(`<div class='subtitle_hover_relative'><div class='subtitle_hover_content'>${hoverEl_html}</div>${pill_html}</div>`);
    };

    const hoverElState = (state) => {
      if (state === "loading") { hoverEl.html("Loading..."); return; }
      if (state === "not_found") {
        pill_html = addPills(word, pos, uuid);
        updateHoverElHTML();
        return;
      }
    };

    const cardNotFound = async (isWordKnown) => {
      if (isWordKnown === undefined) isWordKnown = false;
      if (!(settings.immediateFetch || settings.openAside)) return;

      let translation_data = await getTranslation(word);
      if (!translation_data || !translation_data.data || translation_data.data.length === 0) return;

      let flashcardContent = {
        word: word,
        pitchAccent: translation_data.data[2] && translation_data.data[2].pitches && translation_data.data[2].pitches[0] ? translation_data.data[2].pitches[0].position : undefined,
        pronunciation: translation_data.data[0] ? translation_data.data[0].reading : "",
        translation: translation_data.data[0] ? translation_data.data[0].definitions : "",
        definition: translation_data.data[1] ? translation_data.data[1].definitions : "",
        example: "",
        exampleMeaning: "",
        screenshotUrl: screenshotVideo(),
        pos: pos,
        level: word in wordFreq ? wordFreq[word].raw_level : -1,
      };

      if (!isWordKnown) {
        try {
          const $iframe = $("iframe#mlearn-frame");
          if ($iframe.length) {
            $iframe[0].contentWindow.document.body.innerHTML = $(".subtitles").html();
            $iframe.contents().find(".subtitle_hover").remove();
            $iframe.contents().find(`.subtitle_word.word_${uuid}`).addClass("defined");
            flashcardContent.example = $iframe[0].contentWindow.document.body.innerHTML;
            $iframe[0].contentWindow.document.body.innerHTML = "";
          }
        } catch (_e) { /* ignore */ }
      }

      if (settings.openAside && !isWordKnown) {
        const first_meaning = translation_data.data[0];
        if (first_meaning) addTranslationCard(first_meaning.definitions, first_meaning.reading);
      }

      if ((settings.immediateFetch || settings.openAside) && !isWordKnown) {
        if (settings.furigana && wordNeedsReading(real_word)) {
          let rd = translation_data.data[0] ? translation_data.data[0].reading || "" : "";
          addFurigana(rd);
        }

        if (langSupportsPitchAccent() && translation_data.data[2]) {
          addPitchAccent(
            translation_data.data[2],
            translation_data.data[0] ? translation_data.data[0].reading || "" : "",
            real_word,
            look_ahead_token,
            newEl,
            pos
          );
        }
      }

      if (!isWordKnown) attemptFlashcardCreation(word, flashcardContent);
    };

    let processingDB = {};
    let hasBeenLoadedDB = {};

    async function showHoverEl() {
      hoveredWordTracker(word, uuid);
      let $hover = $(`.hover_${uuid}`);
      const $word = $(`.word_${uuid}`);
      $hover.addClass("show-hover");
      if (processingDB[uuid] || hasBeenLoadedDB[uuid]) return;
      processingDB[uuid] = true;

      let translation_data = await getTranslation(word);
      hasBeenLoadedDB[uuid] = true;

      if (!translation_data || !translation_data.data || translation_data.data.length === 0) {
        hoverElState("not_found");
        return;
      }

      translation_data.data.forEach((meaning) => {
        if (!meaning) return;
        generateTranslationHTML(meaning.definitions, meaning.reading);
      });

      pill_html = addPills(word, pos, uuid);
      updateHoverElHTML();

      $hover.ready(() => {
        let calcW = 600;
        $hover.find(".footer").css("width", "100%");
        $hover.css("width", `${calcW}px`);
        let hover_left = -(calcW - $word.width()) / 2;
        $hover.css("left", `${hover_left}px`);
      });
    }

    if (TRANSLATABLE.includes(pos)) {
      const isWordKnown = getKnownStatus(word) === 2;

      let card_data = {};
      if (settings.use_anki) {
        try { card_data = await getCards(word); } catch (e) { card_data.poor = true; }
      } else {
        card_data.poor = true;
      }

      if (card_data.poor) {
        show_subtitle = true;
        doAppendHoverLazy = true;
        newEl.attr("known", isWordKnown ? "true" : "false");
        newEl.on("customLoaded", () => { cardNotFound(isWordKnown); });
        trackWordAppearance(word);
      } else {
        let current_card = card_data.cards[0];
        if (current_card.factor < settings.known_ease_threshold && !isWordKnown) {
          show_subtitle = true;
          doAppend = true;
          let translation_html = current_card.fields && current_card.fields.Meaning ? current_card.fields.Meaning.value || "" : "";
          let reading_html = current_card.fields && current_card.fields.Reading ? current_card.fields.Reading.value || "" : "";
          generateTranslationHTML(translation_html, reading_html);
          newEl.attr("known", "false");
          if (settings.openAside) addTranslationCard(translation_html, reading_html);
          if (settings.furigana && wordNeedsReading(real_word)) addFurigana(reading_html);
          if (langSupportsPitchAccent()) {
            let translation_data = await getTranslation(word);
            if (translation_data && translation_data.data && translation_data.data[2]) {
              addPitchAccent(translation_data.data[2], translation_data.data[0] ? translation_data.data[0].reading || "" : "", real_word, look_ahead_token, newEl, pos);
            }
          }
        } else {
          newEl.attr("known", "true");
          changeKnownStatus(word, 2);
          blurWord(newEl);
          if (settings.hover_known_get_from_dictionary) {
            doAppendHoverLazy = true;
          } else {
            doAppend = true;
            let translation_html = current_card.fields && current_card.fields.Meaning ? current_card.fields.Meaning.value || "" : "";
            let reading_html = current_card.fields && current_card.fields.Reading ? current_card.fields.Reading.value || "" : "";
            generateTranslationHTML(translation_html, reading_html);
            hoverEl.addClass("known");
          }
        }
      }
    }

    pill_html = addPills(word, pos, uuid);
    updateHoverElHTML();

    if (doAppendHoverLazy) {
      newEl.append(hoverEl);
      newEl.addClass("has-hover");
      hoverElState("loading");
      hasBeenLoadedDB[uuid] = false;
      processingDB[uuid] = false;

      const delayHideHoverEl = (hoverEl, newEl) => {
        setTimeout(() => {
          if (!hoverEl[0].matches(':hover') && !newEl[0].matches(':hover')) {
            hoverEl.removeClass('show-hover');
          }
        }, 300);
      };
      newEl.hover(showHoverEl, function () { delayHideHoverEl(hoverEl, newEl); });
    }

    if (doAppend) {
      if (settings.colour_codes[pos]) {
        hoverEl.css("border", `${settings.colour_codes[pos]} 3px solid`);
      }
      newEl.append(hoverEl);
      newEl.addClass("has-hover");
      newEl.hover(function () {
        let $hover = $(`.hover_${uuid}`);
        let $word = $(`.word_${uuid}`);
        $hover.addClass("show-hover");
        hoveredWordTracker(word, uuid);
        $hover.ready(() => {
          let calcW = $hover.find(".footer").width() + 26;
          if (calcW < 250) {
            calcW = 250;
            $hover.find(".footer").css("width", "100%");
          }
          $hover.css("width", `${calcW}px`);
          let hover_left = -(calcW - $word.width()) / 2;
          $hover.css("left", `${hover_left}px`);
        });
      }, function () {
        $(`.hover_${uuid}`).removeClass("show-hover");
      });
    } else {
      if (settings.do_colour_known) newEl.css("color", settings.colour_known);
    }

    if (settings.do_colour_codes && settings.colour_codes[pos]) {
      newEl.css("color", settings.colour_codes[pos]);
    }

    newEl.attr("grammar", pos);
    newEl.append($(addFrequencyStars(word)));
    $(".subtitles").append(newEl);
    newEl.trigger("customLoaded");
  };

  for (let i = 0; i < tokens.length; i++) {
    await processToken(tokens[i], i < tokens.length - 1 ? tokens[i + 1].type : null);
  }

  if (!show_subtitle && settings.blur_known_subtitles) {
    $(".subtitles").css("filter", `blur(${settings.blur_amount}px)`);
  }
  $(".subtitles").removeClass("quick-transition").removeClass("not-shown");
};

/* ═══════════════════════════════════════════════════════════
   Initialization
   ═══════════════════════════════════════════════════════════ */

(async function () {
  parseWordFrequency();
  load_lang_data();
  show_notification("mLearn loaded");
})();

/* ═══════════════════════════════════════════════════════════
   Subtitle navigation
   ═══════════════════════════════════════════════════════════ */

const findCurrentSub = (currentTime) => {
  if (!subs || subs.length === 0) return null;
  if (currentTime >= subs[lastIndex].start && currentTime <= subs[lastIndex].end) return subs[lastIndex];
  for (let i = lastIndex; i < subs.length; i++) {
    if (currentTime >= subs[i].start && currentTime <= subs[i].end) { lastIndex = i; return subs[i]; }
  }
  for (let i = 0; i < lastIndex; i++) {
    if (currentTime >= subs[i].start && currentTime <= subs[i].end) { lastIndex = i; return subs[i]; }
  }
  return null;
};

const findSub = (time) => {
  if (!subs || subs.length === 0) return null;
  for (let i = lastIndex; i < subs.length; i++) {
    if (time >= subs[i].start && time <= subs[i].end) return i;
  }
  for (let i = 0; i < lastIndex; i++) {
    if (time >= subs[i].start && time <= subs[i].end) return i;
  }
  let closestIndex = 0;
  let closestTimeDiff = Math.min(Math.abs(time - subs[0].start), Math.abs(time - subs[0].end));
  for (let i = 1; i < subs.length; i++) {
    let timeDiff = Math.min(Math.abs(time - subs[i].start), Math.abs(time - subs[i].end));
    if (timeDiff < closestTimeDiff) { closestTimeDiff = timeDiff; closestIndex = i; }
  }
  return closestIndex;
};

const updateVideo = async (time) => {
  if (subs == null) return;
  let currentSub = findCurrentSub(time);
  if (!currentSub) { $(".subtitles").addClass("not-shown"); return; }
  if (currentSub === lastSub) return;
  $(".subtitles").html("");
  await modify_sub(currentSub.text);
  lastSub = currentSub;
};

/* ═══════════════════════════════════════════════════════════
   Subtitle parsing (SRT / ASS)
   ═══════════════════════════════════════════════════════════ */

const parseTime = (timeString, type) => {
  let timeRegex = type === "." ? /(\d+):(\d{2}):(\d{2}\.\d{2})/ : /(\d+):(\d{2}):(\d{2},\d{3})/;
  const match = timeRegex.exec(timeString);
  if (!match) throw new Error('Invalid time format');
  return (parseInt(match[1], 10) * 3600) + (parseInt(match[2], 10) * 60) + parseFloat(match[3].replace(",", "."));
};

const readSubtitleRaw = (o) => {
  return new Promise((resolve, reject) => {
    lastIndex = 0;
    const content = o.content;
    if (o.name.endsWith('.srt')) {
      let parsed = parseSRT(content);
      parsed.forEach((sub) => { sub.start = parseTime(sub.start, ","); sub.end = parseTime(sub.end, ","); });
      resolve(parsed);
    } else if (o.name.endsWith('.ass')) {
      let parsed = parseASS(content);
      parsed.forEach((sub) => { sub.start = parseTime(sub.start, "."); sub.end = parseTime(sub.end, "."); });
      resolve(parsed);
    } else {
      reject('Unsupported file type');
    }
  });
};

const parseSRT = (content) => {
  const subtitles = [];
  const srtRegex = /(\d+)(?:\r?\n)(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})(?:\r?\n)([\s\S]*?)(?=\r?\n\d|\r?\n*$)/g;
  let match;
  while ((match = srtRegex.exec(content)) !== null) {
    subtitles.push({ start: match[2], end: match[3], text: match[4].replace(/(?:\r?\n)/g, ' ') });
  }
  return subtitles;
};

const parseASS = (content) => {
  const subtitles = [];
  const assRegex = /Dialogue:\s*(\d+),(\d+:\d+:\d+\.\d+),(\d+:\d+:\d+\.\d+),([^,]*),([^,]*),(\d+),(\d+),(\d+),([^,]*),(.+)/g;
  let match;
  while ((match = assRegex.exec(content)) !== null) {
    const text = match[10].replace(/\\N/g, ' ').replace(/{.*?}/g, '');
    subtitles.push({ start: match[2], end: match[3], text });
  }
  return subtitles;
};

/* ═══════════════════════════════════════════════════════════
   Watch together
   ═══════════════════════════════════════════════════════════ */

function getElementTopOffset(el) {
  if (!(el instanceof Element)) return null;
  const rect = el.getBoundingClientRect();
  return rect.top + (window.pageYOffset || document.documentElement.scrollTop);
}

function watchTogetherSend(data) {
  const message = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  fetch(srvUrl() + 'api/watch-together?message=' + encodeURIComponent(message), {
    method: 'GET', mode: 'cors',
  }).catch(e => console.warn('watchTogetherSend failed', e));
}

function calculateSubtitleOffset() {
  const video = document.querySelector("video");
  if (!video) return;
  const offset = getElementTopOffset(video);
  const rect = video.getBoundingClientRect();
  let offset1 = offset + rect.height - 10;
  $(".subtitles").css("bottom", `${window.innerHeight - offset1}px`).css("left", `${rect.left}px`).css("transform", "none").css("width", `${rect.width}px`);
  $(".aside, .sync-subs").css("top", `${offset + 38}px`);
}

/* ═══════════════════════════════════════════════════════════
   Main initialization (IIFE)
   ═══════════════════════════════════════════════════════════ */

(function () {
  if (isLoaded) return;
  isLoaded = true;

  loadKnownAdjustment();

  document.body.insertAdjacentHTML('beforeend', HTMLInjectable);

  const video = document.querySelector("video");
  let loadSubWindow = null;
  injectCSS(CSSInjectable);
  if (isSafari()) injectCSS(CSSifSafariFix);

  {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = srvUrl() + 'pages/assets/light_style.css';
    document.head.appendChild(style);
  }

  initCTXMenu();
  document.body.classList.add("dark");
  applySettings();
  setInterval(calculateSubtitleOffset, 500);

  $(".aside").on("mouseover", () => {
    if (asideTimeout) clearTimeout(asideTimeout);
    $(".aside").removeClass("opacity0");
    asideTimeout = setTimeout(() => {
      $(".aside").addClass("opacity0");
      alreadyDisplayingCards = {};
    }, 5000);
  });

  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && document.activeElement.tagName === 'BUTTON') event.preventDefault();
  });

  videoTimeUpdateCallback = () => {
    updateVideo(video.currentTime + settings.subsOffsetTime);
  };
  video.addEventListener('timeupdate', videoTimeUpdateCallback);

  video.addEventListener('play', () => {
    if (isWatchTogether) watchTogetherSend({ action: "play", time: video.currentTime });
  });

  video.addEventListener('pause', () => {
    if (isWatchTogether) watchTogetherSend({ action: "pause", time: video.currentTime });
    try {
      const name = lastParsedSubtitleName || parseSubtitleName(document.title) || '';
      const screenshot = screenshotVideo();
      const videoUrl = (video.currentSrc || video.src || window.location.href || '') + '';
      if (screenshot && name) sendLastWatchedUpdate(name, screenshot, videoUrl);
    } catch (e) { console.warn('Failed to send last-watched update', e); }
  });

  video.addEventListener('seeked', () => {
    if (isWatchTogether) watchTogetherSend({ action: "sync", time: video.currentTime });
  });

  addContextMenuItem("Load Subtitles", () => {
    try {
      loadSubWindow = window.open("", "Load Subtitles", "width=400,height=300");
    } catch (e) {
      const iframe = document.createElement('iframe');
      iframe.src = 'about:blank';
      document.body.appendChild(iframe);
      const realOpen = iframe.contentWindow.open.bind(window);
      loadSubWindow = realOpen("", "Load Subtitles", "width=400,height=300");
      iframe.remove();
    }
    if (loadSubWindow) {
      try { loadSubWindow.mLearnOpener = window; } catch (_) { }
      loadSubWindow.document.write('<!DOCTYPE html><html lang="en"><head><style>body{font-family:Arial,sans-serif;margin:0;padding:0;display:flex;justify-content:center;align-items:center;height:100%;background-color:#f0f0f0}.drop-zone{width:100vw;height:100vh;margin:0;border:2px dashed #aaa;display:flex;justify-content:center;align-items:center;text-align:center;color:#555;background-color:#fff}.drop-zone.dragging{border-color:#333;background-color:#e0e0e0}</style></head><body><div class="drop-zone"><span>Drop your .srt or .ass files here</span><input type="file" accept=".srt,.ass" style="display:none" id="fileInput"></div><script>function postToParent(p){var t=null;try{if(window.opener&&window.opener.top)t=window.opener.top}catch(e){}if(!t&&window.opener)t=window.opener;if(!t&&window.mLearnOpener)t=window.mLearnOpener;if(!t&&window.parent)t=window.parent;if(!t){alert("Unable to communicate with parent window.");return}try{t.postMessage(p,"*")}catch(e){console.error("postMessage failed",e)}}var readFile=function(f){return new Promise(function(res,rej){var r=new FileReader();r.onload=function(e){res(e.target.result)};r.onerror=function(){rej("Error")};r.readAsText(f)})};var dz=document.querySelector(".drop-zone");var fi=document.getElementById("fileInput");dz.addEventListener("dragover",function(e){e.preventDefault();dz.classList.add("dragging")});dz.addEventListener("dragleave",function(){dz.classList.remove("dragging")});dz.addEventListener("drop",function(e){e.preventDefault();dz.classList.remove("dragging");var f=e.dataTransfer.files;if(f.length>0){var file=f[0];if(file.name.endsWith(".srt")||file.name.endsWith(".ass")){readFile(file).then(function(c){postToParent({file:{name:file.name,content:c}})})}else{alert("Please drop a .srt or .ass file")}}});dz.addEventListener("click",function(){fi.value="";fi.click()});fi.addEventListener("change",function(e){var f=e.target.files[0];if(f){if(f.name.endsWith(".srt")||f.name.endsWith(".ass")){readFile(f).then(function(c){postToParent({file:{name:f.name,content:c}})})}else{alert("Please select a .srt or .ass file")}}})<\/script></body></html>');
    } else {
      alert("Failed to open the window.");
    }
  });

  addContextMenuItem("Sync Subtitles With Video", () => {
    $(".sync-subs").removeClass("not-shown");
    $(".sync-subs input").val(settings.subsOffsetTime.toFixed(2));
  });

  addContextMenuItem("Open Live Word Translator", () => {
    $(".aside").show();
    settings.openAside = true;
  });

  addContextMenuItem("Show Last Subtitle Raw Text", () => {
    if (lastSub) alert(lastSub.text);
  });

  addContextMenuItem("Enter Fullscreen", () => {
    let elToFullscreen = document.documentElement;
    if (elToFullscreen.requestFullscreen) elToFullscreen.requestFullscreen();
    else if (elToFullscreen.webkitRequestFullscreen) elToFullscreen.webkitRequestFullscreen();
    else if (elToFullscreen.msRequestFullscreen) elToFullscreen.msRequestFullscreen();

    $('body').append($(`<div class="mlearn-page-blocker" style="position:fixed;background:#000;top:0;left:0;width:100%;height:100%;z-index:9998"></div>`));
    const arr = [document.querySelector("video"), document.querySelector("video") ? document.querySelector("video").parentElement : null, document.querySelector("video") && document.querySelector("video").parentElement ? document.querySelector("video").parentElement.parentElement : null];
    arr.forEach(el => {
      if (el) $(el).css("position", "fixed").css("width", "100%").css("height", "100%").css("top", 0).css("left", 0).css("z-index", 9999);
    });
    $('.subtitles').css("bottom", "10px");
  });

  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) {
      $(".mlearn-page-blocker").remove();
      const arr = [document.querySelector("video"), document.querySelector("video") ? document.querySelector("video").parentElement : null, document.querySelector("video") && document.querySelector("video").parentElement ? document.querySelector("video").parentElement.parentElement : null];
      arr.forEach(el => {
        if (el) $(el).css("position", "unset").css("width", "unset").css("height", "unset").css("top", "unset").css("left", "unset").css("z-index", "unset");
      });
      calculateSubtitleOffset();
    }
  });

  addContextMenuItem("Become Watch Together Master", () => { isWatchTogether = true; });

  if (settings.openAside) $(".aside").show();
  else $(".aside").hide();

  $(".aside .close").click(() => { $(".aside").hide(); settings.openAside = false; });

  $(".sync-subs .close").click(() => { $(".sync-subs").addClass("not-shown"); });
  $(".sync-subs .backward").click(() => {
    let current_time = video.currentTime + settings.subsOffsetTime;
    let current_sub_idx = findSub(current_time);
    if (current_sub_idx !== null && current_sub_idx > 0) {
      let prev_sub = subs[current_sub_idx - 1];
      if (prev_sub) settings.subsOffsetTime = prev_sub.start - video.currentTime;
    }
    $(".sync-subs input").val(settings.subsOffsetTime.toFixed(2));
    if (isNaN(settings.subsOffsetTime)) settings.subsOffsetTime = 0;
    videoTimeUpdateCallback();
  });
  $(".sync-subs .forward").click(() => {
    let current_time = video.currentTime + settings.subsOffsetTime;
    let current_sub_idx = findSub(current_time);
    if (current_sub_idx !== null && current_sub_idx < subs.length - 1) {
      let next_sub = subs[current_sub_idx + 1];
      if (next_sub) settings.subsOffsetTime = next_sub.start - video.currentTime;
    }
    $(".sync-subs input").val(settings.subsOffsetTime.toFixed(2));
    if (isNaN(settings.subsOffsetTime)) settings.subsOffsetTime = 0;
    videoTimeUpdateCallback();
  });
  $(".sync-subs input").change(() => {
    let val = parseFloat($(".sync-subs input").val());
    if (isNaN(val)) return;
    settings.subsOffsetTime = val;
    $(".sync-subs input").val(val.toFixed(2));
    videoTimeUpdateCallback();
  });

  const manageRawSub = async (o) => {
    try { lastParsedSubtitleName = parseSubtitleName(o.name); } catch (_e) { lastParsedSubtitleName = o.name || ''; }
    let temp = await readSubtitleRaw(o);
    subs = temp.sort((a, b) => a.start - b.start);
  };

  window.addEventListener('message', async (event) => {
    if (event.data && event.data.file) {
      await manageRawSub(event.data.file);
      if (loadSubWindow) { loadSubWindow.close(); loadSubWindow = null; }
      show_notification("Subtitles loaded successfully");
    }
  });

  var tetheredIP = window.mLearnTetheredIP || '';
  if (!tetheredIP) {
    console.warn('mLearn: mLearnTetheredIP not set, skipping WebSocket connection.');
    return;
  }
  let serverURL = tetheredIP.replaceAll("https", "").replaceAll("://", "").replaceAll("http", "").replaceAll("//", "");
  const wsProto = (serverURL.includes("localhost") || serverURL.includes("127.0.0.1")) ? "ws" : "wss";
  webSocket = new WebSocket(wsProto + "://" + serverURL);
  webSocket.onopen = () => {
    $(".recently-c").remove();
    webSocket.send("{}");
  };
  webSocket.onmessage = (message) => {
    try {
      let msg = JSON.parse(message.data);
      switch (msg.action) {
        case "play": video.play(); if (msg.time) video.currentTime = msg.time; break;
        case "pause": video.pause(); if (msg.time) video.currentTime = msg.time; break;
        case "start": if (typeof loadStream === 'function') loadStream(msg.url); break;
        case "request-response":
          if (typeof loadStream === 'function') loadStream(msg.url);
          video.currentTime = msg.time;
          if (msg.video_playing) video.play();
          break;
        case "sync": video.currentTime = msg.time; break;
        case "subtitles":
          $(".subtitles").html(msg.subtitle);
          document.body.style.setProperty('--subtitle-font-size', `${msg.size}px`);
          document.body.style.setProperty('--subtitle-font-weight', `${msg.weight}`);
          break;
      }
    } catch (e) { console.warn('WebSocket message parse error', e); }
  };
  webSocket.onclose = () => { console.log("WebSocket connection closed."); };
})();
