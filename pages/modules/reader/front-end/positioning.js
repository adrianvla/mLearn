import {debounce, scheduleRefreshOCRPositions} from "../ocr/read.js";
let doc = null;
let isSidebarOpen = true;
export function initPositioning(d) {
    doc = d;
    // Sidebar toggle
    $(".sidebar-btn", d).on("click", () => {
        $(".main-content", d).toggleClass("show-sidebar");
        isSidebarOpen = !isSidebarOpen;
        // Re-apply fit after sidebar animation (matches CSS 0.5s)
        setTimeout(() => {
            const mode = getCurrentMode(d);
            setFitMode(d, mode);
        }, 550);
    });

    // Auto-hide/show top nav by cursor proximity
    initAutoHideNav(d);

    // Bind mode selector (dropdown) if present
    const $modeSelect = $(".mode-selector select#fit-select", d);
    if ($modeSelect.length) {
        const applyFromSelect = () => {
            const val = String($modeSelect.val() || "fit-width").toLowerCase();
            const mode = (val === "height" || val === "fit-height") ? "fit-height" : "fit-width";
            setFitMode(d, mode);
        };
        $modeSelect.on("change", applyFromSelect);
        // Initialize once on load
        applyFromSelect();
    }

    // Re-apply on window resize to maintain fit
    if (d && d.defaultView) {
        let hasBeenExecuted = false;
        let resizeTimeout = null;
        $(d.defaultView).on("resize", () => {
            const mode = getCurrentMode(d);
            debounce(()=>{
                if(hasBeenExecuted) return;
                clearTimeout(resizeTimeout);
                setFitMode(d, mode);
                scheduleRefreshOCRPositions();
                console.log("Resized");
                hasBeenExecuted = true;
                resizeTimeout = setTimeout(()=>{
                    hasBeenExecuted = false;
                }, 1000);
            },550)();
        });
    }
}
export const refreshFitMode = ()=>{
    const mode = getCurrentMode(doc);
    setFitMode(doc, mode);
};
function initAutoHideNav(d){
    const $nav = $(".nav", d);
    if(!$nav.length) return;

    // Start hidden, then show on proximity
    $nav.addClass("auto-hide");

    const $win = $(d.defaultView || window);
    let hoverLock = false; // prevent hide while actually hovering nav

    // If mouse over nav, force visible
    $nav.on("mouseenter", () => {
        hoverLock = true;
        $nav.removeClass("auto-hide").addClass("nav-visible");
    });
    $nav.on("mouseleave", () => {
        hoverLock = false;
    });

    // Show nav when cursor is near the top (e.g., within 80px)
    $win.on("mousemove", (e) => {
        const y = e.clientY;
        if (y <= 80) {
            $nav.removeClass("auto-hide").addClass("nav-visible");
        } else if (!hoverLock) {
            $nav.removeClass("nav-visible").addClass("auto-hide");
        }
    });

    // Also show when focusing inputs in the nav (keyboard users)
    $nav.find("input, select, button, a").on("focus", () => {
        $nav.removeClass("auto-hide").addClass("nav-visible");
    });
}

function getCurrentMode(d) {
    const $modeSelect = $(".mode-selector select", d);
    if ($modeSelect.length) {
        const val = String($modeSelect.val() || "fit-width").toLowerCase();
        return (val === "height" || val === "fit-height") ? "fit-height" : "fit-width";
    }
    // Fallback to body attribute
    return $("body", d).attr("data-fit-mode") === "height" ? "fit-height" : "fit-width";
}

function setFitMode(...args){
    $(".main-content .main-page",args[0]).css("width",""); // Clear any inline width to allow recalculation
    _setFitMode(...args);
    // After mode change, recalc OCR overlays (debounced)
    try{ scheduleRefreshOCRPositions(); }catch(_e){}
}

function _setFitMode(d, mode) {
    const $body = $("body", d);
    const $mainPage = $(".main-content .main-page", d);
    const $imgs = $(".main-content .main-page img", d);
    const $mainContent = $(".main-content", d);
    const $pages = $(".main-content .main-page .page-left, .main-content .main-page .page-right", d);

    // Keep the select UI in sync, if present
    const $modeSelect = $(".mode-selector select", d);
    if ($modeSelect.length) {
        const selectVal = mode === "fit-height" ? "fit-height" : "fit-width";
        if (String($modeSelect.val()).toLowerCase() !== selectVal) {
            $modeSelect.val(selectVal);
        }
    }

    if (mode === "fit-height") {
        // Fill available vertical space; let width adjust automatically
        $body.attr("data-fit-mode", "height");
        let sum = 0;
        $mainPage.css({ height:"unset", marginLeft: "auto", marginRight: "auto", maxHeight: "calc(100% - 32px)"});
        $mainContent.css("alignItems","center");
        $imgs.css({
            width: "auto",
            height: "100%",
            maxWidth: "",
            maxHeight: "100%",
            objectFit: "contain"
        });
        // setTimeout(() => {
            // $imgs.each((i, img) => {sum += $(img).width()});
            // $mainPage.css({ width: `${sum}px`});
            const ctHeight = $mainContent.height()-(isSidebarOpen ? 32 : 0);
            $pages.each((i, page) => {
                const EL = $(page).find("img")[0];
                const scaleRatio = ctHeight / EL.naturalHeight;
                $(page).css({
                    width: `${EL.naturalWidth * scaleRatio}px`,
                    height: "unset"
                });
            });
            // Width adjustment after image measurement may shift pages; refresh overlays
            try{ scheduleRefreshOCRPositions(); }catch(_e){}
        // },1000/60);
    } else {
        $pages.css("width","unset");
        $body.attr("data-fit-mode", "width");
        $mainPage.css({ height: "max-content", width: "100%", marginLeft:"16px", marginRight:"16px", maxHeight: "unset"});
        $mainContent.css("alignItems","start");
        $imgs.css({
            width: "100%",
            height: "auto",
            maxWidth: "100%",
            maxHeight: "",
            objectFit: "contain"
        });
        try{ scheduleRefreshOCRPositions(); }catch(_e){}
    }
}