const getSettings = async () => new Promise((resolve) => {
    window.electron_settings.getSettings();
    window.electron_settings.onSettings((settings) => {
        resolve(settings);
    });
});

const restartAppAndServer = ()=>{
    const xhr = new XMLHttpRequest();
    xhr.addEventListener('error', () => reject('failed to issue request'));
    xhr.addEventListener('load', () => {
    });

    xhr.open('POST', "http://127.0.0.1:8000/quit");
    //send json
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send("{}");
    window.electron_settings.forceRestartApp();
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

    $("#language-select").on("change", function () {
        const lang = $("#language-select").val();
        if(lang === "other"){
            $(".other").removeClass("hide");
            $("#url").removeClass("hide");
        }else{
            $(".other").addClass("hide");
            $("#url").addClass("hide");
        }
    });

    $(".next").on("click", async function () {
        const lang = $("#language-select").val();
        if(lang === "other") {
            const url = $("#url").val();
            window.electron_settings.installLanguage(url);
        }else{
            let settings = await getSettings();
            settings.language = lang;
            window.electron_settings.saveSettings(settings);
            window.electron_settings.onSettingsSaved(() => {
                $(".info").text("Language installed! Restarting in 5 seconds...");
                setTimeout(()=>{
                    restartAppAndServer();
                },5000);
            });

        }
    });
    window.electron_settings.onLanguageInstalled(async (lang)=>{
        let settings = await getSettings();
        settings.language = lang;
        window.electron_settings.saveSettings(settings);
        window.electron_settings.onSettingsSaved(() => {
            $(".info").text("Language installed! Restarting in 5 seconds...");
            setTimeout(()=>{
                restartAppAndServer();
            },5000);
        });
    });
    window.electron_settings.onLanguageInstallError((mes)=>{
        $(".info").text("Error installing language: "+mes);
    });
    window.electron_settings.isSuccess();
});
const logInfo = (info) => {
    const serverStatusElement = $(".server-status");
    serverStatusElement.append(`<p>${info}</p>`);
    serverStatusElement.scrollTop(serverStatusElement[0].scrollHeight);
};
const installCompleted = () => {
    $(".progress").css("width", "100%");
    $(".next").removeClass("disabled");
    $(".next").text("Next");
    logInfo("Installation complete!");
    $(".overall-status").text("Installation complete!");
};
window.electron_settings.onPythonSuccess(m=>{
    if(m) installCompleted();
});
window.electron_settings.onServerStatusUpdate((status)=>{
    logInfo(status);
    if(status === "Downloading Python..."){
        $(".progress").css("width","5%");
    }else if(status === "Download complete") {
        $(".progress").css("width", "50%");
    }else if(status === "Installing libraries complete") {
        installCompleted();
    }
});