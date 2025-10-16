// ==UserScript==
// @name         mLearn Injector
// @description  This script will inject the mLearn core into the page, to allow the mLearn app to run in Tethered mode.
// @author       Adrian Vlasov
// @version      0.0.1
// @match        *://*/*
// @grant        none
// @inject-into  content
// ==/UserScript==

(function () {
    let video = null;
    function genClassUUID(prefix = 'mLearn') {
        return prefix + '_' + Math.random().toString(36).slice(2, 10);
    }
    const popupId = genClassUUID();
    const mLearnBtnName = genClassUUID("mLearnInject");
    const mLearnInputId = genClassUUID("mLearnInput");
    const CSSstr = `
.mLearn-1 {
  position: fixed;
  top: 20px;
  right: 20px;
  backdrop-filter: blur(20px) saturate(180%);
  background: rgba(60,60,60,0.5);
  border: 1px solid #444;
  box-sizing: border-box;
  box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  padding: 16px;
  z-index: 1000;
  border-radius: 10px;
  width: 300px;
  font-family: "Helvetica Neue", sans-serif;
}

.mLearn-2 {
  opacity: 0.5;
  margin-bottom: 16px;
  pointer-events: none;
  user-select: none;
}

.mLearn-3 {
  font-size: 16px;
  margin-bottom: 3px;
  user-select: none;
}

.mLearn-4 {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
}

.mLearn-4 button {
  padding: 8px 14px;
  user-select: none;
  font-size: 14px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.mLearn-5 {
  background-color: #28a745;
  color: white;
}

.mLearn-6 {
  background-color: #dc3545;
  color: white;
}

.mLearn-1 button:hover {
  opacity: 0.9;
  transition: opacity 0.3s ease-in-out;
}

.mLearn-1 button:active {
  transform: scale(0.98);
  transition: transform 0.1s ease-in-out;
}

#${mLearnInputId} {
  border: 0;
  border-bottom: 1px solid #444;
  outline: none;
  background: transparent;
  font-size: 13px;
  width: 100%;
  color: #ccc;
  padding: 5px;
  box-sizing: border-box;
  transition: border-color 0.3s ease-in-out;
}

.mLearn-1 input:focus {
  border-color: #28a745;
}

.mLearn-1 input::placeholder {
  color: #888;
  opacity: 0.8;
}

/* Tooltip styling */
.mLearn-tooltip {
  display: inline-block;
  position: relative;
  cursor: pointer;
  margin-left: 6px;
  color: #ccc;
}

.mLearn-tooltip:hover .mLearn-tooltiptext {
  visibility: visible;
  opacity: 1;
}

.mLearn-tooltiptext {
  visibility: hidden;
  width: 260px;
  backdrop-filter: blur(20px) saturate(180%);
  background: rgba(60,60,60,0.5);
  border: 1px solid #444;
  color: #fff;
  text-align: left;
  border-radius: 6px;
  padding: 10px;
  position: absolute;
  z-index: 1001;
  left: -100px;
  transform: translateX(-50%);
  opacity: 0;
  transition: opacity 0.3s;
  font-size: 12px;
  pointer-events: none;
  line-height: 1.4;
}
`;

    const HTMLstr = `
<div class="mLearn-1" id="${popupId}">
  <div class="mLearn-3">
    <span id="mLearn-info">Would you like to use mLearn?</span>
    <span class="mLearn-tooltip">ℹ️
      <div class="mLearn-tooltiptext">
        A video has been detected.<br><br>
        If so, please write the IP/URL of the host computer.<br><br>
        The IP should follow the format:<br>
        <code>http://&lt;url&gt;:&lt;port&gt;/</code><br>
        For example:<br>
        <code>http://192.168.1.1:7753/</code><br>
        or<br>
        <code>http://tunnel.example.com:&lt;some port&gt;</code>
      </div>
    </span>
  </div>
  <input type="text" id="${mLearnInputId}" placeholder="https://192.168.1.1:7753/ or https://tunnel.example.com:<some port>/">
  <div class="mLearn-4">
    <button class="mLearn-5" id="${mLearnBtnName}">Yes</button>
    <button class="mLearn-6" onclick="(function(){document.getElementById('${popupId}').remove();})();">No</button>
  </div>
</div>
`;
    function isValidHttpUrlWithPort(url) {
        const regex = /^https:\/\/[^:\s\/]+(?::\d+)?\/$/;
        return regex.test(url);
    }
    function createAndAppendScript(content, parent = document.body) {
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.textContent = content;
        parent.appendChild(script);
        return script;
    }
    function createScriptFromSRC(src,parent = document.body, isModule = false){
        const e = document.createElement('script');
        e.src = src;
        e.type = isModule ? 'module' : 'text/javascript';
        parent.appendChild(e);
        return e;
    }
    let ip = "";
    let isLocal = false;
    const inj = (logger,scriptName = 'core.js',isModule = false, requireVideo = true)=>{
        return new Promise((resolve, reject)=>{
            createAndAppendScript(`
                globalThis.mLearnTethered = true;
                globalThis.mLearnTetheredIP = '${ip}';
            `);

            !function(m,L,E,A,R,N,_){
                if(N[L]) {
                    R("mLearn is already loaded.");
                    return;
                }
                if((!m.querySelector("video")) && requireVideo) {
                    R("Cannot find video element. Maybe you forgot to select the video element in the DevTools?");
                    return;
                }

                createScriptFromSRC("https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js",m.head);
                let o = createScriptFromSRC(_+"settings.js",m.body);
                o.onerror = ()=>{
                    R("Failed to load settings.js. Please check the URL/IP and try again.");
                    alert("Failed to load settings.js. Please check the URL/IP and try again.");
                }
                o.onload = ()=>{
                    createScriptFromSRC(_+scriptName,m.body, isModule);
                    N[L] = true;
                    resolve();
                };
            }(document, "mLearnOnlineAgentLoaded", "bUxlYXJuIGRpZCBub3QgbG9hZCBwcm9wZXJseS4gUGxlYXNlIGNoZWNrIGlmIHRoZSBhcHBsaWNhdGlvbiBsb2FkZWQgc3VjY2Vzc2Z1bGx5IGFuZCBpcyBydW5uaW5nLiBJZiB0aGUgcHJvYmxlbSBwZXJzaXN0cywgdHJ5IHJlbG9hZGluZyB0aGUgcGFnZSBhbmQgdHJ5aW5nIGFnYWluLiBJZiB0aGUgcHJvYmxlbSBzdGlsbCBwZXJzaXN0cywgcGxlYXNlIHJlc3RhcnQgbUxlYXJuLg==", atob, logger, window, ip);
        });
    };
    (async function(){
        //ping server at localhost:7753
        try {
            const response = await fetch("http://localhost:7753/");
            if (response.ok) {
                console.log("Server is running.");
            } else {
                console.error("Server is not running.");
            }
        } catch (error) {}
        console.log("mLearn app detected at localhost:7753.");
        isLocal = true;
        ip = "http://localhost:7753/";
        await inj(console.log,"quick-lookup.js",true,false);
        console.log("mLearn quick-lookup.js injected.");
    })();
    const B = () => {
        const isClickedFn = async () => {
            ip = document.getElementById(mLearnInputId).value.trim();
            if(isLocal) ip = "http://localhost:7753/";
            if (!ip || !isValidHttpUrlWithPort(ip)) {
                document.getElementById("mLearn-info").innerText = "Please enter a valid URL/IP.";
                return;
            }
            const info = m=>{
                document.getElementById("mLearn-info").innerText = m;
            };
            info("Working...");
            console.log(`mLearn: Injecting core with URL/IP: ${ip}`);
            await inj(info);
            document.getElementById(popupId).remove();
        };
        clearInterval(I);
        const style = document.createElement('style');
        style.textContent = CSSstr;
        document.head.appendChild(style);
        const container = document.createElement('div');
        container.innerHTML = HTMLstr;
        document.body.appendChild(container);
        document.getElementById(mLearnBtnName).onclick = isClickedFn;
        if(isLocal) isClickedFn();
    };
    let I = setInterval(()=>{
        video = document.querySelector("video");
        if(video) B();
    },100);
})();
