; Registers Tarnel as a browser for Windows "Default apps" and "Open with" (included via nsis.include).
;
; electron-builder registers nothing for `protocols` on Windows, and its fileAssociations would set
; the `.ext` default value (taking over a type without asking), so on Windows everything is
; written here instead, the way Chrome and Firefox do it: ProgIDs + OpenWithProgids + Capabilities.
; Windows then lists Tarnel and the user picks it in Settings → Default apps.
;
; SHELL_CONTEXT is HKCU for a per-user install and HKLM for "all users" (assisted installer choice).
; The portable build never includes this file and writes nothing to the registry.
;
; The `--` before "%1" ends Chromium's switch parsing, so a crafted URL or file name is never read
; as a command-line switch (the same idea as Chrome's --single-argument).
;
; Keep the names in sync with src/shared/default-browser.ts (REGISTERED_APP_NAME).
;
; Tarnel was called Vela up to 0.9. Install and uninstall also remove the old Vela registration
; (ProgIDs Vela*, StartMenuInternet\Vela, RegisteredApplications\Vela, the OpenWithProgids values)
; so Windows never lists two browsers for one app. Old "Vela" shortcuts are renamed to "Tarnel" by
; electron-builder itself (ShortcutName in the install key, keepShortcuts). Windows drops a default that
; pointed at a removed ProgID, so someone who had picked Vela picks Tarnel once in Default apps.

!define TARNEL_CLIENT_KEY "Software\Clients\StartMenuInternet\Tarnel"
!define TARNEL_CAPS_KEY "${TARNEL_CLIENT_KEY}\Capabilities"

!macro tarnelWriteProgId PROGID DESCRIPTION
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}" "" "${DESCRIPTION}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}" "FriendlyTypeName" "${DESCRIPTION}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\Application" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\Application" "ApplicationIcon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell\open\command" "" '"$appExe" -- "%1"'
!macroend

!macro tarnelAssociateFile EXT PROGID
  WriteRegStr SHELL_CONTEXT "${TARNEL_CAPS_KEY}\FileAssociations" ".${EXT}" "${PROGID}"
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
!macroend

; Removes the browser registration written under the name NAME (Tarnel, or Vela before the rename):
; RegisteredApplications value, StartMenuInternet key, OpenWithProgids values and the ProgIDs.
!macro tarnelUnregisterBrowser NAME
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "${NAME}"
  DeleteRegKey SHELL_CONTEXT "Software\Clients\StartMenuInternet\${NAME}"

  DeleteRegValue SHELL_CONTEXT "Software\Classes\.html\OpenWithProgids" "${NAME}HTML"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.htm\OpenWithProgids" "${NAME}HTML"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.shtml\OpenWithProgids" "${NAME}HTML"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.xhtml\OpenWithProgids" "${NAME}HTML"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.xht\OpenWithProgids" "${NAME}HTML"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.pdf\OpenWithProgids" "${NAME}PDF"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.svg\OpenWithProgids" "${NAME}SVG"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.webp\OpenWithProgids" "${NAME}WebP"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.mht\OpenWithProgids" "${NAME}MHTML"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.mhtml\OpenWithProgids" "${NAME}MHTML"

  DeleteRegKey SHELL_CONTEXT "Software\Classes\${NAME}URL"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${NAME}HTML"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${NAME}PDF"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${NAME}SVG"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${NAME}WebP"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${NAME}MHTML"
!macroend

; Vela <= 0.9 let electron-builder register .html/.htm with the ProgID "HTML document", which also
; set the `.ext` default. Undo that where the ProgID still points at this executable, or is already
; gone (the previous version's uninstaller removes it on update and leaves the `.ext` default).
!macro tarnelForgetLegacyHtmlAssociation
  Push $0
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\HTML document\shell\open\command" ""
  ${if} $0 == '"$appExe" "%1"'
  ${orIf} $0 == '$appExe "%1"'
  ${orIf} $0 == ""
    !insertmacro tarnelForgetLegacyHtmlExt "html"
    !insertmacro tarnelForgetLegacyHtmlExt "htm"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\HTML document"
  ${endIf}
  Pop $0
!macroend

!macro tarnelForgetLegacyHtmlExt EXT
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${if} $0 == "HTML document"
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${endIf}
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "HTML document"
!macroend

!macro customInstall
  !insertmacro tarnelForgetLegacyHtmlAssociation
  !insertmacro tarnelUnregisterBrowser "Vela"

  !insertmacro tarnelWriteProgId "TarnelURL" "Tarnel URL"
  WriteRegStr SHELL_CONTEXT "Software\Classes\TarnelURL" "URL Protocol" ""
  !insertmacro tarnelWriteProgId "TarnelHTML" "Tarnel HTML Document"
  !insertmacro tarnelWriteProgId "TarnelPDF" "Tarnel PDF Document"
  !insertmacro tarnelWriteProgId "TarnelSVG" "Tarnel SVG Image"
  !insertmacro tarnelWriteProgId "TarnelWebP" "Tarnel WebP Image"
  !insertmacro tarnelWriteProgId "TarnelMHTML" "Tarnel Web Archive"

  WriteRegStr SHELL_CONTEXT "${TARNEL_CLIENT_KEY}" "" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "${TARNEL_CLIENT_KEY}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "${TARNEL_CLIENT_KEY}\shell\open\command" "" '"$appExe"'

  WriteRegStr SHELL_CONTEXT "${TARNEL_CAPS_KEY}" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "${TARNEL_CAPS_KEY}" "ApplicationDescription" "A fast, quiet browser with isolated Spaces."
  WriteRegStr SHELL_CONTEXT "${TARNEL_CAPS_KEY}" "ApplicationIcon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "${TARNEL_CAPS_KEY}\StartMenu" "StartMenuInternet" "Tarnel"
  WriteRegStr SHELL_CONTEXT "${TARNEL_CAPS_KEY}\URLAssociations" "http" "TarnelURL"
  WriteRegStr SHELL_CONTEXT "${TARNEL_CAPS_KEY}\URLAssociations" "https" "TarnelURL"

  !insertmacro tarnelAssociateFile "html" "TarnelHTML"
  !insertmacro tarnelAssociateFile "htm" "TarnelHTML"
  !insertmacro tarnelAssociateFile "shtml" "TarnelHTML"
  !insertmacro tarnelAssociateFile "xhtml" "TarnelHTML"
  !insertmacro tarnelAssociateFile "xht" "TarnelHTML"
  !insertmacro tarnelAssociateFile "pdf" "TarnelPDF"
  !insertmacro tarnelAssociateFile "svg" "TarnelSVG"
  !insertmacro tarnelAssociateFile "webp" "TarnelWebP"
  !insertmacro tarnelAssociateFile "mht" "TarnelMHTML"
  !insertmacro tarnelAssociateFile "mhtml" "TarnelMHTML"

  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "Tarnel" "${TARNEL_CAPS_KEY}"

  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
!macroend

!macro customUnInstall
  !insertmacro tarnelUnregisterBrowser "Tarnel"
  !insertmacro tarnelUnregisterBrowser "Vela"

  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
!macroend
