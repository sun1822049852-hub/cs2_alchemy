!macro customInstall
  Var /GLOBAL shortcutIcon
  StrCpy $shortcutIcon "$INSTDIR\resources\app-icon.ico"

  ${if} ${FileExists} "$shortcutIcon"
    ${if} ${FileExists} "$newDesktopLink"
      Delete "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$shortcutIcon" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${endif}

    ${if} ${FileExists} "$newStartMenuLink"
      Delete "$newStartMenuLink"
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$shortcutIcon" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${endif}
  ${endif}
!macroend
