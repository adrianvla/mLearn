import $ from '../jquery.min.js'
import {
    checkSettings,
    DEFAULT_SETTINGS,
    lang_data,
    saveSettings,
    settings,
    SUBTITLE_THEMES,
    supported_languages
} from "./settings.js";
import {restartAppAndServer} from "./super.js";
import {sendRawToAnki} from "./networking.js";


const IN_SETTINGS_CATEGORY = {"General":["dark_mode","language","install_languages","save","restoreDefaults"],"Behaviour":["known_ease_threshold","blur_words","blur_known_subtitles","blur_amount","immediateFetch","do_colour_known","colour_known","do_colour_codes","show_pos","hover_known_get_from_dictionary","furigana","aside-auto","save","restoreDefaults","pitch_accent"],"Customization":["subtitle_theme","subtitle_font_size","save","restoreDefaults"],"Anki":["use_anki","anki_connect_url","enable_flashcard_creation","flashcards_add_picture","flashcard_deck","save","restoreDefaults"],"About":[]};
const WINDOW_HTML_SETTINGS = `<!doctypehtml><html lang="en"><meta charset="UTF-8"><title>Settings</title><link href="style.css"rel="stylesheet"><style>body{background:#000}</style><body class="settings-body"><div class="nav"><div class="nav-item selected"id="General"><img src="assets/icons/cog.svg"><span>General</span></div><div class="nav-item"id="Behaviour"><img src="assets/icons/subtitles.svg"><span>Behaviour</span></div><div class="nav-item"id="Customization"><img src="assets/icons/palette.svg"><span>Appearance</span></div><div class="nav-item"id="Anki"><img src="assets/icons/cards.svg"><span>Anki</span></div><div class="nav-item"id="About"><img src="assets/icons/document.svg"><span>About</span></div></div><div class="settingsMenuContent"><div class="preview"data-show="Customization"><div class="subtitles"><span class="subtitle_word SUB_W_COL_1">A</span><span class="subtitle_word SUB_W_COL_2">a</span><span class="subtitle_word SUB_W_COL_1">あア</span><span class="subtitle_word SUB_W_COL_2">億</span><span class="subtitle_word SUB_W_COL_1">ыЦ</span><span class="subtitle_word SUB_W_COL_2">è</span></div></div><div class="_1"></div><div class="_2"></div><div class="about"style="display:none"><span id="version-number">PLACEHOLDER</span><br>Developed by <a id="contact">Adrian Vlasov</a><br>Contact: admin@morisinc.net<br><a id="licenses">Licenses</a></div></div>`;
let isSettingsWindowOpen = false;
let mustRestart = false;
let APP_VERSION = "";
let languageInstallationWindow = null;
let languageInstalledCallbacks = [];
let languageInstallErrorCallbacks = [];

const showLanguageInstallationWindow = ()=>{
    if(languageInstallationWindow) languageInstallationWindow.close();
    languageInstallationWindow = window.open("language_installation.html", "LanguageInstallationWindow", "width=600,height=250");
    languageInstallationWindow.addEventListener('load',()=>{
        $(languageInstallationWindow.document).ready(()=>{
            if(!settings.dark_mode) $(languageInstallationWindow.document.body).addClass("light");
            $(".install-language",languageInstallationWindow.document).click(()=>{
                window.electron_settings.installLanguage($("input",languageInstallationWindow.document).val());
                $(".install-language",languageInstallationWindow.document).attr("disabled",true);
                $(".install-language",languageInstallationWindow.document).text("Installing...");
                languageInstalledCallbacks.push(()=>{
                    $(".install-language",languageInstallationWindow.document).text("Installed, restart the app for changes to take effect");
                    $(".title",languageInstallationWindow.document).text("Installed!");
                    setTimeout(()=>{
                        languageInstallationWindow.close();
                        languageInstalledCallbacks = [];
                    },5000);
                });
                languageInstallErrorCallbacks.push((mes)=>{
                    $(".install-language",languageInstallationWindow.document).text("Error");
                    $(".title",languageInstallationWindow.document).text("Error!");
                    $(".small-desc",languageInstallationWindow.document).text(mes);
                    setTimeout(()=>{
                        languageInstallationWindow.close();
                        languageInstallErrorCallbacks = [];
                    },5000);
                });
            });
        });
    });
};

window.electron_settings.onOpenSettings((msg)=>{
    if(isSettingsWindowOpen) return;
    isSettingsWindowOpen = true;
    let myWindow = window.open("", "SettingsWindow", "width=800,height=600");
    myWindow.document.write(WINDOW_HTML_SETTINGS);
    myWindow.window.addEventListener('unload', () => {
        isSettingsWindowOpen = false;
        myWindow = null;
    });

    let new_document = myWindow.document;
    let current_category = msg ? msg : "General";





    const makeMenu = async () => {
        console.log("Making menu");
        //add class to body
        if(settings.dark_mode) new_document.body.classList.remove("light");
        else new_document.body.classList.add("light");

        const flashcard_decks = async function() {
            if ($('#enable_flashcard_creation',new_document).is(':checked')) {
                $('.flashcard_deck',new_document).removeClass('hidden');
                //show flashcards_add_picture
                $('#flashcards_add_picture',new_document).parent().parent().removeClass('hidden');
                //get flashcard decks
                $('#flashcard_deck',new_document).html('<option value="Loading...">Loading...</option>');
                let flashcard_decks = await sendRawToAnki({"action":"deckNamesAndIds","version":6});
                $('#flashcard_deck',new_document).html('');
                for(let deck of Object.keys(flashcard_decks.result)){
                    $('#flashcard_deck',new_document).append(`<option value="${deck}" ${deck==settings.flashcard_deck ? 'selected' : ''}>${deck}</option>`);
                }
            } else {
                $('.flashcard_deck',new_document).addClass('hidden');
                $('#flashcards_add_picture',new_document).parent().parent().addClass('hidden');
            }
        };
        const disabled_fields = Object.keys(lang_data[settings.language].fixed_settings);
        $('._1', new_document).append($(`<label for="known_ease_threshold">Known Ease Threshold: </label>`));
        $('._1', new_document).append($(`<label for="blur_words">Blur Words </label>`));
        $('._1', new_document).append($(`<label for="blur_known_subtitles">Blur Known Subtitles </label>`));
        $('._1', new_document).append($(`<label for="blur_amount" class="${settings.blur_known_subtitles || settings.blur_words ? '' : 'disabled'}">Blur Amount: </label>`));
        $('._1', new_document).append($(`<label for="immediateFetch">(Requires Fast Internet / Local Dictionary) Translate all words immediately </label>`));
        $('._1', new_document).append($(`<label for="do_colour_known">Colour Known Words</label>`));
        $('._1', new_document).append($(`<label for="colour_known" class="${settings.do_colour_known ? '' : 'disabled'}">Known Word Colour: </label>`));
        $('._1', new_document).append($(`<label for="do_colour_codes">Do Colour Codes </label>`));
        $('._1', new_document).append($(`<label for="show_pos">Show word type </label>`));
        $('._1', new_document).append($(`<label for="hover_known_get_from_dictionary">Find new definitions for known words </label>`));
        $('._1', new_document).append($(`<label for="dark_mode">Dark Mode </label>`));
        $('._1', new_document).append($(`<label for="use_anki">(Requires Restart) Use Anki </label>`));
        $('._1', new_document).append($(`<label for="anki_connect_url">(Requires Restart) Anki Connect URL </label>`));
        $('._1', new_document).append($(`<label for="furigana">Furigana </label>`));
        $('._1', new_document).append($(`<label for="enable_flashcard_creation">Enable flashcard creations </label>`));
        $('._1', new_document).append($(`<label for="flashcard_deck" class="${settings.enable_flashcard_creation ? '' : 'disabled'}">Flashcard Deck: </label>`));
        $('._1', new_document).append($(`<label for="language">(Requires Restart) Subtitle Language: </label>`));
        $('._1', new_document).append($(`<label for="aside-auto">(Requires Fast Internet / Local Dictionary) Open Automatic Subtitle Translation Drawer </label>`));;
        $('._1', new_document).append($(`<label for="subtitle_theme">Subtitle Theme </label>`));
        $('._1', new_document).append($(`<label for="subtitle_font_size">Subtitle Font Size </label>`));
        $('._1', new_document).append($(`<label for="pitch_accent">Pitch Accent </label>`));

        $('._2', new_document).append($(`<input type="number" id="known_ease_threshold" name="known_ease_threshold" value="${settings.known_ease_threshold}">`));
        $('._2', new_document).append($(`<input type="checkbox" id="blur_words" name="blur_words" ${settings.blur_words ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="checkbox" id="blur_known_subtitles" name="blur_known_subtitles" ${settings.blur_known_subtitles ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="number" id="blur_amount" name="blur_amount" value="${settings.blur_amount}" class="${settings.blur_known_subtitles || settings.blur_words ? '' : 'disabled'}">`));
        $('._2', new_document).append($(`<input type="checkbox" id="immediateFetch" name="immediateFetch" ${settings.immediateFetch ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="checkbox" id="do_colour_known" name="do_colour_known" ${settings.do_colour_known ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="color" id="colour_known" name="colour_known" value="${settings.colour_known}" class="${settings.do_colour_known ? '' : 'disabled'}">`));
        $('._2', new_document).append($(`<input type="checkbox" id="do_colour_codes" name="do_colour_codes" ${settings.do_colour_codes ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="checkbox" id="show_pos" name="show_pos" ${settings.show_pos ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="checkbox" id="hover_known_get_from_dictionary" name="hover_known_get_from_dictionary" ${settings.hover_known_get_from_dictionary ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="checkbox" id="dark_mode" name="dark_mode" ${settings.dark_mode ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="checkbox" id="use_anki" name="use_anki" ${settings.use_anki ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="text" id="anki_connect_url" name="anki_connect_url" class="${settings.use_anki ? '' : 'disabled'}" value="${settings.ankiConnectUrl}">`));
        $('._2', new_document).append($(`<input type="checkbox" id="furigana" name="furigana" ${settings.furigana ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="checkbox" id="enable_flashcard_creation" name="enable_flashcard_creation" ${settings.enable_flashcard_creation ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<select id="flashcard_deck" name="flashcard_deck" class="${settings.enable_flashcard_creation ? '' : 'disabled'}">`));
        $('._2', new_document).append($(`<select id="language" name="language">

            ${supported_languages.map((lang)=>{
            return `<option value="${lang}" ${settings.language==lang ? 'selected' : ''}>${lang_data[lang].name_translated}</option>`;
        })}
        </select>`));
        $('._2', new_document).append($(`<input type="checkbox" id="flashcards_add_picture" name="flashcards_add_picture" ${settings.flashcards_add_picture ? 'checked' : ''} class="${settings.enable_flashcard_creation ? '' : 'disabled'}">`));
        $('._2', new_document).append($(`<input type="checkbox" id="aside-auto" name="aside-auto" ${settings.openAside ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<select id="subtitle_theme" name="subtitle_theme">${SUBTITLE_THEMES.map((theme)=>{return `<option value="${theme}" ${settings.subtitle_theme==theme ? 'selected' : ''}>${theme}</option>`})}</select>`));
        $('._2', new_document).append($(`<input type="number" id="subtitle_font_size" name="subtitle_font_size" value="${settings.subtitle_font_size}">`));
        $('._2',new_document).append('<input type="button" id="install_languages" value="Install Additional Languages...">');
        $('._2', new_document).append($(`<input type="checkbox" id="pitch_accent" name="pitch_accent" ${settings.showPitchAccent ? 'checked' : ''}>`));

        //disable fields
        for(let field of disabled_fields){
            $(`#${field}`,new_document).attr('disabled',true);
            $(`[for="${field}"]`,new_document).attr('disabled',true);
        }

        $("a#contact",new_document).click((e)=>{
            e.preventDefault();
            window.electron_settings.showContact();
        });
        $("a#licenses",new_document).click((e)=>{
            e.preventDefault();
            window.open("licenses.html", "LicensesWindow", "width=800,height=600");
        });
        if(settings.do_colour_codes)
            for (let code in settings.colour_codes) {
                $('._1',new_document).append(`<label for="${code}" data-show="Customization">${code}</label>`);
                $('._2',new_document).append(`
                <input type="color" id="${code}" name="${code}" value="${settings.colour_codes[code]}" data-show="Customization">
            `);
            }
        flashcard_decks();
        // Add a button to the form in the context menu
        $('._2',new_document).append('<input type="button" id="restoreDefaults" value="Restore Defaults">');
        $('#blur_known_subtitles, #blur_words',new_document).on('change', function() {
            if ($('#blur_known_subtitles',new_document).is(':checked') || $('#blur_words',new_document).is(':checked')) {
                $('#blur_amount',new_document).removeClass('hidden');
                $('[for="blur_amount"]',new_document).removeClass('hidden');
            } else {
                $('#blur_amount',new_document).addClass('hidden');
                $('[for="blur_amount"]',new_document).addClass('hidden');
            }
        });

        $('#do_colour_known',new_document).on('change', function() {
            if ($('#do_colour_known',new_document).is(':checked')) {
                $('#colour_known',new_document).removeClass('hidden');
                $('[for="colour_known"]',new_document).removeClass('hidden');
            } else {
                $('#colour_known',new_document).addClass('hidden');
                $('[for="colour_known"]',new_document).addClass('hidden');
            }
        });
        $('#do_colour_codes',new_document).on('change', function() {
            if ($('#do_colour_codes',new_document).is(':checked')) {
                $('.controls-colour-codes',new_document).removeClass('hidden');
            } else {
                $('.controls-colour-codes',new_document).addClass('hidden');
            }
        });
        $('#enable_flashcard_creation',new_document).on('change', flashcard_decks);
        // Add an event listener to the button
        $('#restoreDefaults',new_document).on('click', function() {
            settings = DEFAULT_SETTINGS;
            //add colour codes too
            settings.colour_codes = lang_data[settings.language].colour_codes;
            checkSettings();
            saveSettings();
            myWindow.close();
        });
        const updateSubtitlePreview = ()=>{
            //set subtitle font size
            new_document.documentElement.style.setProperty('--subtitle-font-size', `${settings.subtitle_font_size}px`);
            document.documentElement.style.setProperty('--subtitle-font-size', `${settings.subtitle_font_size}px`);
            document.documentElement.style.setProperty('--word-blur-amount', `${settings.blur_amount}px`);
            SUBTITLE_THEMES.forEach((theme)=>{
                $(".subtitles",new_document).removeClass("theme-"+theme);
                $(".subtitles",document).removeClass("theme-"+theme);
            });
            //set subtitle theme
            $(".subtitles",new_document).addClass("theme-"+settings.subtitleTheme);
            $(".subtitles",document).addClass("theme-"+settings.subtitleTheme);
        };
        $('#subtitle_theme',new_document).val(settings.subtitleTheme);
        updateSubtitlePreview();
        $("#subtitle_theme,#subtitle_font_size",new_document).change(()=>{
            console.log("Updating subtitle preview");
            settings.subtitleTheme = $('#subtitle_theme',new_document).val();
            settings.subtitle_font_size = Number($('#subtitle_font_size',new_document).val());
            updateSubtitlePreview();
        });
        $('#install_languages',new_document).on('click', function() {
            showLanguageInstallationWindow();
        });

        $('._2',new_document).append('<input type="button" id="save" value="Save">');
        // Update settings on form submit
        $('#save',new_document).on('click', function(e) {
            e.preventDefault();
            let restart = false;
            settings.known_ease_threshold = Number($('#known_ease_threshold',new_document).val());
            settings.blur_words = $('#blur_words',new_document).is(':checked');
            settings.blur_known_subtitles = $('#blur_known_subtitles',new_document).is(':checked');
            settings.blur_amount = Number($('#blur_amount',new_document).val());
            settings.immediateFetch = $('#immediateFetch',new_document).is(':checked');
            settings.colour_known = $('#colour_known',new_document).val();
            settings.do_colour_known = $('#do_colour_known',new_document).is(':checked');
            settings.do_colour_codes = $('#do_colour_codes',new_document).is(':checked');
            settings.hover_known_get_from_dictionary = $('#hover_known_get_from_dictionary',new_document).is(':checked');
            settings.dark_mode = $('#dark_mode',new_document).is(':checked');
            settings.show_pos = $('#show_pos',new_document).is(':checked');
            if(settings.language != $('#language',new_document).val()){
                restart = true;
            }
            settings.language = $('#language',new_document).val();
            settings.use_anki = $('#use_anki',new_document).is(':checked');
            if(settings.use_anki != $('#use_anki',new_document).is(':checked')){
                restart = true;
            }
            settings.ankiConnectUrl = $('#anki_connect_url',new_document).val();
            if(settings.ankiConnectUrl != $('#anki_connect_url',new_document).val()){
                restart = true;
            }
            settings.furigana = $('#furigana',new_document).is(':checked');
            settings.enable_flashcard_creation = $('#enable_flashcard_creation',new_document).is(':checked');
            if($('#flashcard_deck',new_document).val()!= "Loading..." && settings.flashcard_deck != $('#flashcard_deck',new_document).val())
                settings.flashcard_deck = $('#flashcard_deck',new_document).val();
            settings.flashcards_add_picture = $('#flashcards_add_picture',new_document).is(':checked');
            settings.openAside = $('#aside-auto',new_document).is(':checked');
            settings.subtitleTheme = $('#subtitle_theme',new_document).val();
            settings.subtitle_font_size = Number($('#subtitle_font_size',new_document).val());
            settings.showPitchAccent = $('#pitch_accent',new_document).is(':checked');

            for (let code in settings.colour_codes) {
                settings.colour_codes[code] = $(`#${code}`,new_document).val();
            }
            if(settings.openAside){
                $(".aside").show();
            }else{
                $(".aside").hide();
            }
            if(settings.use_anki){
                // $(".add-all-to-anki, .update-flashcards-due-date").show();
                $(".add-all-to-anki").hide();
                $(".update-flashcards-due-date").show();
            }else{
                $(".add-all-to-anki, .update-flashcards-due-date").hide();
            }
            checkSettings();
            saveSettings();
            myWindow.close();
            mustRestart = restart;
        });
    };
    $(new_document).ready(async function(){
        makeMenu();
        const updateSettings = ()=>{
            let to_show = IN_SETTINGS_CATEGORY[current_category];
            $("._1,._2",new_document).show();
            $(".preview",new_document).hide();
            $(".settingsMenuContent ._1 > *, .settingsMenuContent ._2 > *, .about",new_document).hide();
            to_show.forEach((item)=>{
                $(`#${item}`,new_document).show();
                $(`[for="${item}"]`,new_document).show();
            });
            $(`[data-show="${current_category}"]`,new_document).show();
            if(current_category=="About"){
                $(".about",new_document).show();
                $("._1,._2",new_document).hide();
            }
        };
        $(".nav-item",new_document).click(function(){
            $(".nav-item",new_document).removeClass("selected");
            $(this,new_document).addClass("selected");
            current_category = $(this,new_document).attr("id");
            updateSettings();
        });
        updateSettings();
        $("#version-number",new_document).text("mLearn v"+APP_VERSION);
    });
});

window.electron_settings.onSettingsSaved((e) => {
    if(mustRestart) restartAppAndServer();
});

window.electron_settings.getVersion();
window.electron_settings.onVersionReceive((version) => {
    APP_VERSION = version;
});


window.electron_settings.onLanguageInstalled(()=>{
    languageInstalledCallbacks.forEach((callback)=>{
        callback();
    });
});
window.electron_settings.onLanguageInstallError((mes)=>{
    languageInstallErrorCallbacks.forEach((callback)=>{
        callback(mes);
    });
});
