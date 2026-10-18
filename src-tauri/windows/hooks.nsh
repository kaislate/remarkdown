; remarkdown NSIS installer hooks (bundle.windows.nsis.installerHooks).
;
; Tauri's APP_ASSOCIATE (from bundle.fileAssociations) already writes the
; remarkdown.Markdown ProgID and points .md / .markdown at it. These hooks
; add what makes Windows treat remarkdown as a proper default-app candidate:
;   - OpenWithProgids, so it's listed under "Open with" even after the user
;     picks another default;
;   - Capabilities + RegisteredApplications, which Settings → Default apps
;     (and our Settings button's deep link) use to find the app.
; Keep in sync with registry_plan() in src-tauri/src/default_app.rs.
; SHCTX is HKCU for per-user installs (the default) and HKLM for per-machine.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\.md\OpenWithProgids" "remarkdown.Markdown" ""
  WriteRegStr SHCTX "Software\Classes\.markdown\OpenWithProgids" "remarkdown.Markdown" ""
  WriteRegStr SHCTX "Software\remarkdown\Capabilities" "ApplicationName" "remarkdown"
  WriteRegStr SHCTX "Software\remarkdown\Capabilities" "ApplicationDescription" "Read and annotate Markdown documents"
  WriteRegStr SHCTX "Software\remarkdown\Capabilities\FileAssociations" ".md" "remarkdown.Markdown"
  WriteRegStr SHCTX "Software\remarkdown\Capabilities\FileAssociations" ".markdown" "remarkdown.Markdown"
  WriteRegStr SHCTX "Software\RegisteredApplications" "remarkdown" "Software\remarkdown\Capabilities"
  ; SHCNE_ASSOCCHANGED, SHCNF_FLUSH
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\Classes\.md\OpenWithProgids" "remarkdown.Markdown"
  DeleteRegValue SHCTX "Software\Classes\.markdown\OpenWithProgids" "remarkdown.Markdown"
  DeleteRegKey SHCTX "Software\remarkdown\Capabilities"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "remarkdown"
  ; The app may also have registered itself per-user at runtime (Settings →
  ; "Make remarkdown the default"); clean that up too.
  DeleteRegValue HKCU "Software\Classes\.md\OpenWithProgids" "remarkdown.Markdown"
  DeleteRegValue HKCU "Software\Classes\.markdown\OpenWithProgids" "remarkdown.Markdown"
  DeleteRegKey HKCU "Software\Classes\remarkdown.Markdown"
  DeleteRegKey HKCU "Software\remarkdown\Capabilities"
  DeleteRegValue HKCU "Software\RegisteredApplications" "remarkdown"
  ; Drop the now-empty parent keys (no-op if anything else lives there).
  DeleteRegKey /ifempty SHCTX "Software\remarkdown"
  DeleteRegKey /ifempty HKCU "Software\remarkdown"
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
!macroend
