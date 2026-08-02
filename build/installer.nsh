; mLearn custom NSIS include (picked up automatically by electron-builder as build/installer.nsh).
;
; Self-heal broken shortcuts on install/update.
;
; electron-builder's keepShortcuts mechanism preserves existing .lnk files
; untouched (and its obsolete-location path RENAMES them, keeping the original
; target). If a shortcut's target no longer exists — files removed outside the
; uninstaller, AV quarantine, install folder moved, an earlier install in a
; different directory — setup finishes "successfully" but leaves a broken
; shortcut, and the finish page's "Run mLearn" shows Windows' "Missing
; Shortcut" dialog ("Windows is searching for mLearn.exe").
;
; Fix: after electron-builder's own shortcut handling, rewrite any EXISTING
; shortcut with the correct target ($appExe). This repairs broken links without
; resurrecting shortcuts the user deliberately deleted, and also runs during
; silent auto-updates.
!macro customInstall
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${if} ${FileExists} "$newStartMenuLink"
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${endIf}
  !endif
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${ifNot} ${isNoDesktopShortcut}
      ${if} ${FileExists} "$newDesktopLink"
        CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
        ClearErrors
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      ${endIf}
    ${endIf}
  !endif
!macroend
