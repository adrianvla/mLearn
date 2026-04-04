# mLearn
This repo contains the source code for the desktop app [mLearn](https://mlearn.morisinc.net).

# Warning ⚠️
WIP: The app is currently being rewritten in Typescript, which will be v2.0.0. **The current stable version is still v1.4.0**, which is available in the releases tab. To download this one, clone the repository, and run `npm i` and `npm run start`.

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/adrianvla/mLearn)
# Overview

### Supercharge your language learning journey by watching native content

mLearn is an all-in-one immersion app that integrates well with [Anki](https://github.com/ankitects/anki).

# Screenshots
<img src="https://raw.githubusercontent.com/adrianvla/morisinc-cdn/refs/heads/main/mlearn.webp" alt="screenshot1"/>
<img src="https://mlearn.morisinc.net/img/statistics.webp" alt="exam learning features">
<img src="https://mlearn.morisinc.net/img/Screenshot%202025-09-19%20at%2022.03.49.png" alt="character knowledge grid">
<img alt="legends" src="https://morisinc.net/assets/img/mlearn-screenshot.png" />



# Features

<img width="1863" alt="Screenshot 2024-12-12 at 20 41 56" src="https://github.com/user-attachments/assets/c5732d93-6927-426b-bd02-4e23e85ca442" />
<img width="1861" alt="Screenshot 2024-12-12 at 20 42 10" src="https://github.com/user-attachments/assets/3c22f01d-7ebb-4505-95db-f3e4ced921a4" />
# More info
Additional information can be found on [mLearn](https://mlearn.morisinc.net).


# Dependencies
 - Electron.js
 - JQuery.js
 - HLS.js

# FAQ

### Which languages are supported?
mLearn ships with complete German and Japanese support. You can add your own languages too by following the guide on the GitHub page.

### Can the app work offline?
For now, Offline-mode is restricted to Japanese because no free open-source German dictionary was available at the time of writing this.

### Can the app work without Anki?
Yes, you'll just have to disable it by opening the settings menu.

### Which platforms are supported?
macOS on Apple Silicon, macOS on x86, Linux on x86, Windows on x86

### Is it free?
Since we wanted to make education free, mLearn is absolutely free forever and opensource.

### mLearn crashes even if I have opened Anki
If you have restarted the app recently, it may have not closed properly; open your task manager and kill the process named 'python3'.

### How do I stream a video?
By pasting a link to a streaming playlist (e.g. ending in .m3u8 or .mp4 or other video streaming formats), mLearn will automatically start playing that video.

### How do I find the stream link of a video?
To find the URL of a stream, download the [CocoCut video downloader Google Chrome extension](https://chromewebstore.google.com/detail/video-downloader-cococut/ekhbcipncbkfpkaianbjbcbmfehjflpf), then go to the website you want to stream from. CocoCut is going to list you streaming links ending in .m3u8. You can copy and paste them into mLearn.

### I opened Anki, but mLearn cannot see that I have opened it
Install the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) plugin.

### Why does the Japanese version of the app use so much RAM?
Since the Japanese version of mLearn doesn't send requests over the internet for each word definition, it has to load a HUGE dictionary into the computer's RAM for faster word access (which makes it use less power).

### How do I add subtitles to a video?
Just drag'n'drop them onto the mLearn video player.

### I found a bug!
Please open a GitHub issue.



# How to add your own language
The language install URL needs to have the following code (mLearn will parse the contents of it):
```json
{
  "json": {...},
  "lang_py": "https://.../../.py",
  "lang": "LANGUAGE_NAME"
}
```

For example, for Japanese it would be:
```json
{
  "json": {
    "name": "Japanese",
    "translatable": [
      "名詞",
      "動詞",
      "形状詞",
      "副詞",
      "副詞節",
      "形容詞"
    ],
    "name_translated": "日本語",
    "colour_codes": {
      "名詞": "#ebccfd",
      "動詞": "#d6cefd",
      "助詞": "#f5d7b8",
      "助動詞": "#ffefd1",
      "形状詞": "#def6ff",
      "副詞": "#b8cdf5",
      "接尾辞": "#aac8c4",
      "感動詞": "#eacbcb",
      "代名詞": "#f1ccfd",
      "補助記号": "#cccccccc",
      "連体詞": "#def6ff",
      "形容詞": "#def6ff",
      "形容動詞": "#def6ff"
    },
    "fixed_settings": {},
    "freq": [["N5", "N5"],
    ["会う", "あう"],
    ["青", "あお"],
    ["青い", "あおい"], 
      ...(more)...
      ], 
    "freq_level_names": {"5": "JLPT N5", "4": "JLPT N4", "3": "JLPT N3", "2": "JLPT N2", "1": "JLPT N1"}
  },
  "lang_py": "URL THAT POINTS TO THE SOURCE CODE OF JA.PY",
  "lang": "ja"
}
```

The python file must have the following functions:
  - LANGUAGE_TOKENIZE(text):
     This gets raw text and returns a tokenized version of the text. Each token has 3 fields: "word", which is the word in the same form as it is in the text, "actual_word", its original dictionary form, and "type" which is the grammatical type of the word.
     For example, LANGUAGE_TOKENIZE("僕はテープを買ってきた")　would return
      ```python
          [
            {"word": "僕", "actual_word": "僕", "type": "代名詞"},
            {"word": "は", "actual_word": "は", "type": "助詞"},
            {"word": "テープ", "actual_word": "テープ", "type": "名詞"},
            {"word": "を", "actual_word": "を", "type": "助詞"},
            {"word": "買っ", "actual_word": "買う", "type": "動詞"},
            {"word": "て", "actual_word": "て", "type": "助詞"},
            {"word": "き", "actual_word": "くる", "type": "動詞"},
            {"word": "た", "actual_word": "た", "type": "助動詞"}
        ]

      ```
  - LOAD_MODULE(folder), which is called when the module is loaded, where folder is the resources folder of the app. This is mainly used to cache dictionaries
  - LANGUAGE_TRANSLATE(word) returns ```{"data": [{'reading':'','definitions':''},{'reading': '', 'definitions': ''},{'reading':'','definitions':''},{'reading': '', 'definitions': ''},...]}``` that contain the definitions of the word.

Examples of such files can be found in the "languages" directory.

# How to build
```shell
npm run dist:mac
npm run dist:win
npm run dist:linux
```

# How to run in dev mode
```shell
npm install
npm run start
```

# License
Additional licenses for libraries may be found in the "Settings → about" section of the app.

This software is licensed under the **Sustainable Use License v1.0**. See the [LICENSE](LICENSE) file for the full text.

```
Copyright (C) 2024-2026 Adrian Vlasov
  
  Sustainable Use License
  
  Version 1.0
  
  Acceptance
  
  By using the software, you agree to all of the terms and conditions below.
  
  Copyright License
  
  The licensor grants you a non-exclusive, royalty-free, worldwide,
  non-sublicensable, non-transferable license to use, copy,
  distribute, make available, and prepare derivative works of
  the software, in each case subject to the limitations below.
  
  Limitations
  
  You may use or modify the software only for your own internal
  business purposes or for non-commercial or personal use. You
  may distribute the software or provide it to others only if
  you do so free of charge for non-commercial purposes. You
  may not alter, remove, or obscure any licensing, copyright,
  or other notices of the licensor in the software. Any use
  of the licensor's trademarks is subject to applicable law.
  
  Patents
  
  The licensor grants you a license, under any patent claims the
  licensor can license, or becomes able to license, to make, have
  made, use, sell, offer for sale, import and have imported the
  software, in each case subject to the limitations and conditions
  in this license. This license does not cover any patent claims
  that you cause to be infringed by modifications or additions to
  the software. If you or your company make any written claim that
  the software infringes or contributes to infringement of any
  patent, your patent license for the software granted under these
  terms ends immediately. If your company makes such a claim, your
  patent license ends immediately for work on behalf of your company.
  
  Notices
  
  You must ensure that anyone who gets a copy of any part of the
  software from you also gets a copy of these terms. If you modify the
  software, you must include in any modified copies of the software
  a prominent notice stating that you have modified the software.
  
  No Other Rights
  
  These terms do not imply any licenses other
  than those expressly granted in these terms.
  
  Termination
  
  If you use the software in violation of these terms, such use is
  not licensed, and your license will automatically terminate. If
  the licensor provides you with a notice of your violation, and
  you cease all violation of this license no later than 30 days
  after you receive that notice, your license will be reinstated
  retroactively. However, if you violate these terms after such
  reinstatement, any additional violation of these terms will
  cause your license to terminate automatically and permanently.
  
  No Liability
  
  As far as the law allows, the software comes as is, without
  any warranty or condition, and the licensor will not be liable
  to you for any damages arising out of these terms or the use
  or nature of the software, under any kind of legal claim.
  
  Definitions
  
  The "licensor" is the entity offering these terms.
  
  The "software" is the software the licensor makes
  available under these terms, including any portion of it.
  
  "You" refers to the individual or entity agreeing to these terms.
  
  "Your company" is any legal entity, sole proprietorship,
  or other kind of organization that you work for, plus all
  organizations that have control over, are under the control
  of, or are under common control with that organization. Control
  means ownership of substantially all the assets of an entity,
  or the power to direct its management and policies by vote,
  contract, or otherwise. Control can be direct or indirect.
  
  "Your license" is the license granted to
  you for the software under these terms.
  
  "Use" means anything you do with
  the software requiring your license.
  
  "Trademark" means trademarks, service marks, and similar rights.
  ```
