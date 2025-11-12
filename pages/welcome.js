import $ from './lib/jquery.min.js';

const pendingSettingsResolvers = [];
let settingsListenerRegistered = false;

const getSettings = async () => new Promise((resolve) => {
    pendingSettingsResolvers.push(resolve);
    if(!settingsListenerRegistered){
        settingsListenerRegistered = true;
        window.mLearnIPC.onSettings((settings) => {
            while(pendingSettingsResolvers.length){
                const nextResolver = pendingSettingsResolvers.shift();
                try{
                    nextResolver?.(settings);
                }catch(_e){/* ignore */}
            }
        });
    }
    window.mLearnIPC.getSettings();
});

let installationStarted = false;
let installationCompleted = false;
let lastInstallOptions = { includeLLM: true, includeOCR: true };

const restartAppAndServer = ()=>{
    const xhr = new XMLHttpRequest();
    xhr.addEventListener('error', () => console.error('Failed to issue quit request'));
    xhr.addEventListener('load', () => {
    });

    xhr.open('POST', "http://127.0.0.1:7753/quit");
    //send json
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send("{}");
    window.mLearnIPC.forceRestartApp();
};
document.addEventListener('DOMContentLoaded', () => {
    const welcomeElement = document.querySelector('.welcome');
    const languages = ['Welcome!','ようこそ！','Wilkommen!', 'Bienvenue!','欢迎！','Добро пожаловать!'];
    let currentIndex = 0;

    function cycleLanguages() {
        welcomeElement.classList.add('fade-out');

        setTimeout(() => {
            currentIndex = (currentIndex + 1) % languages.length;
            welcomeElement.textContent = languages[currentIndex];
            welcomeElement.classList.remove('fade-out');
            welcomeElement.classList.add('fade-in');
        }, 1000);

        setTimeout(() => {
            welcomeElement.classList.remove('fade-in');
        }, 2000);
    }

    setInterval(cycleLanguages, 3000);

    const installButton = $(".next");
    const llmCheckbox = $("#install-llm");
    const ocrCheckbox = $("#install-ocr");
    const languageSelect = $("#language-select");
    const otherInput = $("#url");

    const setInstallingState = (rawOptions = {}) => {
        installationStarted = true;
        installationCompleted = false;
        const includeLLM = rawOptions.includeLLM !== undefined ? !!rawOptions.includeLLM : true;
        const includeOCR = rawOptions.includeOCR !== undefined ? !!rawOptions.includeOCR : true;
        lastInstallOptions = { includeLLM, includeOCR };
        llmCheckbox.prop('checked', includeLLM);
        ocrCheckbox.prop('checked', includeOCR);
        installButton.addClass("disabled").text("Installing...");
        llmCheckbox.prop("disabled", true);
        ocrCheckbox.prop("disabled", true);
        $(".install-options").addClass("options-locked");
        $(".progress").css("width", "0%");
        $(".info").text("Installing required components. This can take several minutes—please keep this window open.");
        $(".overall-status").text("Installing...");
        $(".server-status").empty();
        const notes = [
            includeLLM ? "Local AI model dependencies will be installed." : "Skipping local AI model dependencies. You can enable them later from Settings.",
            includeOCR ? "OCR reader dependencies will be installed." : "Skipping OCR reader dependencies. The Reader can be enabled later from Settings."
        ];
        notes.forEach((n) => logInfo(n));
    };

    const setWaitingState = (rawOptions) => {
        if(installationCompleted) return;
        installationStarted = false;
        const includeLLM = rawOptions && rawOptions.includeLLM !== undefined ? !!rawOptions.includeLLM : lastInstallOptions.includeLLM;
        const includeOCR = rawOptions && rawOptions.includeOCR !== undefined ? !!rawOptions.includeOCR : lastInstallOptions.includeOCR;
        lastInstallOptions = { includeLLM, includeOCR };
        llmCheckbox.prop('checked', includeLLM);
        ocrCheckbox.prop('checked', includeOCR);
        installButton.removeClass("disabled").text("Start Installation");
        llmCheckbox.prop("disabled", false);
        ocrCheckbox.prop("disabled", false);
        $(".install-options").removeClass("options-locked");
        $(".progress").css("width", "0%");
        $(".overall-status").text("Waiting to start installation...");
        $(".info").text("Choose the components you want to install, then click Install. Language selection unlocks after setup finishes.");
        $(".server-status").html("<p>Click Install to begin.</p>");
    };

    languageSelect.on("change", function () {
        if(this.disabled) return;
        const lang = languageSelect.val();
        if(lang === "other"){
            $(".other").removeClass("hide");
            otherInput.removeClass("hide").prop("disabled", false);
        }else{
            $(".other").addClass("hide");
            otherInput.addClass("hide").prop("disabled", true);
        }
    });

    installButton.on("click", async function () {
        if(!installationStarted){
            const includeLLM = llmCheckbox.is(":checked");
            const includeOCR = ocrCheckbox.is(":checked");
            setInstallingState({ includeLLM, includeOCR });
            try {
                const settings = await getSettings();
                settings.llmEnabled = includeLLM;
                settings.ocrEnabled = includeOCR;
                window.mLearnIPC.saveSettings(settings);
            } catch (e) {
                console.warn("Unable to persist install preferences before install", e);
            }
            window.mLearnIPC.startInstall({ includeLLM, includeOCR });
            return;
        }

        if(!installationCompleted){
            return;
        }

        const lang = languageSelect.val();
        if(lang === "other") {
            const url = otherInput.val();
            window.mLearnIPC.installLanguage(url);
        }else{
            try {
                const settings = await getSettings();
                settings.language = lang;
                window.mLearnIPC.saveSettings(settings);
                window.mLearnIPC.onSettingsSaved(() => {
                    $(".info").text("Language installed! Restarting in 5 seconds...");
                    setTimeout(()=>{
                        restartAppAndServer();
                    },5000);
                });
            } catch (e) {
                console.error("Failed to persist language selection", e);
            }
        }
    });

    window.mLearnIPC.onInstallStarted((opts = {}) => {
        if(installationStarted) return;
        setInstallingState(opts);
    });

    window.mLearnIPC.onInstallerAwaitingChoice(() => {
        setWaitingState(lastInstallOptions);
    });

    window.mLearnIPC.onInstallerNetworkError((payload = {}) => {
        const normalized = typeof payload === 'string' ? { message: payload } : (payload || {});
        const message = normalized.message || 'Installation failed due to a network issue.';
        const detail = normalized.detail;
        if(detail){
            logInfo(detail);
        }
        $(".overall-status").text(message);
        $(".info").text("Please check your internet connection, then click Install to retry.");
        setWaitingState(lastInstallOptions);
        try {
            window.alert(detail ? `${message}\n\nDetails: ${detail}` : message);
        } catch (e) {
            console.warn('Unable to show alert for network error', e);
        }
    });

    window.mLearnIPC.onLanguageInstalled(async (lang)=>{
        let settings = await getSettings();
        settings.language = lang;
        window.mLearnIPC.saveSettings(settings);
        window.mLearnIPC.onSettingsSaved(() => {
            $(".info").text("Language installed! Restarting in 5 seconds...");
            setTimeout(()=>{
                restartAppAndServer();
            },5000);
        });
    });
    window.mLearnIPC.onLanguageInstallError((mes)=>{
        $(".info").text("Error installing language: "+mes);
    });

    window.mLearnIPC.onInstallerState((state = {}) => {
        if(state.success){
            installCompleted();
            return;
        }
        if(state.inProgress){
            if(!installationStarted){
                setInstallingState(state.options);
            }
            return;
        }
        if(state.waiting){
            setWaitingState(state.options);
        }
    });

    getSettings().then((settings) => {
        if(settings && Object.prototype.hasOwnProperty.call(settings, 'llmEnabled')){
            llmCheckbox.prop('checked', settings.llmEnabled !== false);
        }
        if(settings && Object.prototype.hasOwnProperty.call(settings, 'ocrEnabled')){
            ocrCheckbox.prop('checked', settings.ocrEnabled !== false);
            lastInstallOptions.includeOCR = settings.ocrEnabled !== false;
        }
        if(settings && Object.prototype.hasOwnProperty.call(settings, 'llmEnabled')){
            lastInstallOptions.includeLLM = settings.llmEnabled !== false;
        }
        if(!installationStarted && !installationCompleted){
            setWaitingState(lastInstallOptions);
        }
    }).catch(() => {/* ignore */});

    window.mLearnIPC.requestInstallerState();
    window.mLearnIPC.isSuccess();
    setWaitingState(lastInstallOptions);
});
const logInfo = (info) => {
    const serverStatusElement = $(".server-status");
    serverStatusElement.append(`<p>${info}</p>`);
    serverStatusElement.scrollTop(serverStatusElement[0].scrollHeight);
};
const installCompleted = () => {
    installationCompleted = true;
    $(".progress").css("width", "100%");
    $(".next").removeClass("disabled");
    $(".next").text("Continue");
    $("#language-select").css("filter","unset").prop("disabled", false).trigger("change");
    $(".info").text("Installation complete! Choose your language to finish setup.");
    logInfo("Installation complete!");
    $(".overall-status").text("Installation complete!");
};
window.mLearnIPC.onPythonSuccess(m=>{
    if(m) installCompleted();
});
window.mLearnIPC.onServerStatusUpdate((status)=>{
    logInfo(status);
    if(status.startsWith("Installing Python dependencies")){
        $(".progress").css("width","5%");
    }else if(status === "Downloading Python..."){
        $(".progress").css("width","10%");
    }else if(status.indexOf("Download complete") !== -1) {
        $(".progress").css("width", "45%");
    }else if(status.indexOf("Extraction complete") !== -1) {
        $(".progress").css("width", "70%");
    }else if(status === "Installing libraries complete") {
        installCompleted();
    }else if(status.toLowerCase().includes("error")) {
        $(".overall-status").text("An error occurred. Check the log below.");
    }
});