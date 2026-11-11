; Registers Vela as a browser for Windows "Default apps" and "Open with" (included via nsis.include).
;
; electron-builder registers nothing for `protocols` on Windows, and its fileAssociations would set
; the `.ext` default value (taking over a type without asking), so on Windows everything is
; written here instead, the way Chrome and Firefox do it: ProgIDs + OpenWithProgids + Capabilities.
; Windows then lists Vela and the user picks it in Settings → Default apps.
;
; SHELL_CONTEXT is HKCU for a per-user install and HKLM for "all users" (assisted installer choice).
; The portable build never includes this file and writes nothing to the registry.
;
; The `--` before "%1" ends Chromium's switch parsing, so a crafted URL or file name is never read
; as a command-line switch (the same idea as Chrome's --single-argument).
;
; Keep the names in sync with src/shared/default-browser.ts (REGISTERED_APP_NAME).

!define VELA_CLIENT_KEY "Software\Clients\StartMenuInternet\Vela"
!define VELA_CAPS_KEY "${VELA_CLIENT_KEY}\Capabilities"

!macro velaWriteProgId PROGID DESCRIPTION
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}" "" "${DESCRIPTION}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}" "FriendlyTypeName" "${DESCRIPTION}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\Application" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\Application" "ApplicationIcon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell\open\command" "" '"$appExe" -- "%1"'
!macroend

!macro velaAssociateFile EXT PROGID
  WriteRegStr SHELL_CONTEXT "${VELA_CAPS_KEY}\FileAssociations" ".${EXT}" "${PROGID}"
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
!macroend

!macro velaUnassociateFile EXT PROGID
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
!macroend

; Vela <= 0.9 let electron-builder register .html/.htm with the ProgID "HTML document", which also
; set the `.ext` default. Undo that where the ProgID still points at this Vela.exe, or is already
; gone (the previous version's uninstaller removes it on update and leaves the `.ext` default).
!macro velaForgetLegacyHtmlAssociation
  Push $0
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\HTML document\shell\open\command" ""
  ${if} $0 == '"$appExe" "%1"'
  ${orIf} $0 == '$appExe "%1"'
  ${orIf} $0 == ""
    !insertmacro velaForgetLegacyHtmlExt "html"
    !insertmacro velaForgetLegacyHtmlExt "htm"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\HTML document"
  ${endIf}
  Pop $0
!macroend

!macro velaForgetLegacyHtmlExt EXT
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${if} $0 == "HTML document"
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${endIf}
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "HTML document"
!macroend

!macro customInstall
  !insertmacro velaForgetLegacyHtmlAssociation

  !insertmacro velaWriteProgId "VelaURL" "Vela URL"
  WriteRegStr SHELL_CONTEXT "Software\Classes\VelaURL" "URL Protocol" ""
  !insertmacro velaWriteProgId "VelaHTML" "Vela HTML Document"
  !insertmacro velaWriteProgId "VelaPDF" "Vela PDF Document"
  !insertmacro velaWriteProgId "VelaSVG" "Vela SVG Image"
  !insertmacro velaWriteProgId "VelaWebP" "Vela WebP Image"
  !insertmacro velaWriteProgId "VelaMHTML" "Vela Web Archive"

  WriteRegStr SHELL_CONTEXT "${VELA_CLIENT_KEY}" "" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "${VELA_CLIENT_KEY}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "${VELA_CLIENT_KEY}\shell\open\command" "" '"$appExe"'

  WriteRegStr SHELL_CONTEXT "${VELA_CAPS_KEY}" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "${VELA_CAPS_KEY}" "ApplicationDescription" "A fast, quiet browser with isolated Spaces."
  WriteRegStr SHELL_CONTEXT "${VELA_CAPS_KEY}" "ApplicationIcon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "${VELA_CAPS_KEY}\StartMenu" "StartMenuInternet" "Vela"
  WriteRegStr SHELL_CONTEXT "${VELA_CAPS_KEY}\URLAssociations" "http" "VelaURL"
  WriteRegStr SHELL_CONTEXT "${VELA_CAPS_KEY}\URLAssociations" "https" "VelaURL"

  !insertmacro velaAssociateFile "html" "VelaHTML"
  !insertmacro velaAssociateFile "htm" "VelaHTML"
  !insertmacro velaAssociateFile "shtml" "VelaHTML"
  !insertmacro velaAssociateFile "xhtml" "VelaHTML"
  !insertmacro velaAssociateFile "xht" "VelaHTML"
  !insertmacro velaAssociateFile "pdf" "VelaPDF"
  !insertmacro velaAssociateFile "svg" "VelaSVG"
  !insertmacro velaAssociateFile "webp" "VelaWebP"
  !insertmacro velaAssociateFile "mht" "VelaMHTML"
  !insertmacro velaAssociateFile "mhtml" "VelaMHTML"

  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "Vela" "${VELA_CAPS_KEY}"

  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
!macroend

!macro customUnInstall
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Vela"
  DeleteRegKey SHELL_CONTEXT "${VELA_CLIENT_KEY}"

  !insertmacro velaUnassociateFile "html" "VelaHTML"
  !insertmacro velaUnassociateFile "htm" "VelaHTML"
  !insertmacro velaUnassociateFile "shtml" "VelaHTML"
  !insertmacro velaUnassociateFile "xhtml" "VelaHTML"
  !insertmacro velaUnassociateFile "xht" "VelaHTML"
  !insertmacro velaUnassociateFile "pdf" "VelaPDF"
  !insertmacro velaUnassociateFile "svg" "VelaSVG"
  !insertmacro velaUnassociateFile "webp" "VelaWebP"
  !insertmacro velaUnassociateFile "mht" "VelaMHTML"
  !insertmacro velaUnassociateFile "mhtml" "VelaMHTML"

  DeleteRegKey SHELL_CONTEXT "Software\Classes\VelaURL"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\VelaHTML"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\VelaPDF"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\VelaSVG"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\VelaWebP"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\VelaMHTML"

  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
!macroend
