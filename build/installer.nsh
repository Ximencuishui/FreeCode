; build/installer.nsh
; electron-builder 26 在 NSIS 编译时把这个文件 include 到 installer.nsi 顶部
;（见 app-builder-lib/out/targets/nsis/NsisTarget.js:600-604，
; scriptGenerator.include() 在原始 installer.nsi 之前被拼装）。
; 因此本文件中的 !define / LangString / Function 都早于默认模板的
; MUI_PAGE_INSTFILES 展开，能在 INSTFILES 页面 SHOW 时插入自定义 UI 控件。
;
; 目的：解决 v0.1.11 反馈——DSH 全家桶约 245 MB 嵌入在 app-64.7z 中，
; 解压过程驱动进度条缓慢推进，但 INSTFILES 页面默认只在顶部显示
; "$(installing)" 一行顶部标题；进度条下方没有副文本控件，
; 非技术用户在 30s~2min 的解压窗口里容易误判为死循环。
;
; 实现：用 NSIS Modern UI 标准扩展点 MUI_PAGE_CUSTOMFUNCTION_SHOW，
; 在页面刚 Show 时（即用户点"下一步"后、Nsis7z::Extract 启动前）
; 通过 Win32 CreateWindowEx 在进度条（Ctrl ID=1016）正下方创建一个
; STATIC Label 显示 DSH 部署说明。不修改 electron-builder 自带模板，
; 升级友好；silent 安装直接 Return，无副作用。
;
; 兼容性：仅 NSIS 安装器生效。Mac dmg / Linux AppImage / Windows portable
; 走不同流程，portable 内部是 silent 安装，MUI_PAGE_INSTFILES 不会被
; 实例化，LangString 与 Function 定义被保留为死代码但无功能影响。

; ${If}/${EndIf} 是 LogicLib.nsh 提供的运行时指令，必须在 Function 中使用前 include
!include "LogicLib.nsh"

; electron-builder 26 把这个文件同时 include 到安装器与卸载器 NSIS 脚本顶部
;（NsisTarget.js:600-604 处 scriptGenerator.include() 无差别 include），
; 卸载器构建时 BUILD_UNINSTALLER 被定义。本文件仅对安装器有意义——
; - LangString 与 Function 只在 INSTFILES 页面被消费
; - MUI_PAGE_CUSTOMFUNCTION_SHOW 这个 define 在卸载器 WELCOMEPAGE 走过
;   MUI_PAGE_FUNCTION_CUSTOM 宏时会触发 "not a valid language id" 类解析错误
;   （嵌套 define MUI_PAGE_CUSTOMFUNCTION_${TYPE} 字面量在卸载器实例里找不到目标）
; 所以用 !ifndef BUILD_UNINSTALLER 严格隔离到安装器一侧，卸载器构建完全不受影响。
!ifndef BUILD_UNINSTALLER

; INSTFILES 页面 Show 时回调本函数
!define MUI_PAGE_CUSTOMFUNCTION_SHOW "freecoderInstFilesShow"

Function freecoderInstFilesShow
  ; silent 安装无窗口，跳过 UI 创建，避免 GetDlgItem 取不到句柄崩溃
  ${If} ${Silent}
    Return
  ${EndIf}

  ; 直接用 StrCpy 字面字符串而不用 LangString：electron-builder 默认开启 26 种
  ; bundledLanguages 的多语言安装器，每种 LangString 都必须为每种语言提供翻译，
  ; 否则触发 warning 6040（NSIS 默认 warningsAsErrors 会升级为 error）。
  ; 我们的目标场景是非技术简体中文用户，硬编码字面字符串最简洁；英文环境
  ; 下也会看到这段中文提示，虽非最佳体验但比"空白标签让用户更困惑"好。
  ; 后续若需 i18n，再拆成 LangString 并为 bundledLanguages 补齐即可。
  StrCpy $R7 "正在部署内置 DSH 智能体引擎（约 300 MB），首次安装需要 1-3 分钟，请耐心等待，勿关闭窗口。"

  ; INSTFILES 页面进度条控件固定 ID = 1016（NSIS Modern UI 模板约定）
  GetDlgItem $0 $HWNDPARENT 1016

  ; 取进度条屏幕矩形 (left, top, right, bottom) → NSIS 自动展开到 $R1-$R4
  ;（RECT = 4 个 LONG，NSIS 遇到 4 字节以上输出时自动占用连续寄存器；
  ;  见 NSIS System Plug-in 文档："use .r1; NSIS increments the register pointer
  ;  automatically when more than 4 bytes are required"）
  ; hwnd 来自 GetDlgItem 写到 NSIS 用户变量 $0（不是 $R0），用 p $0 deref
  System::Call 'user32::GetWindowRect(p $0, i .r1)'

  ; MapWindowPoints 一次调用把 2 个 POINT (left/top, right/bottom) 转 dialog 客户区坐标
  ; hWndFrom=0 (屏幕), hWndTo=$HWNDPARENT, lpPoints=&$R1, cPoints=2
  ; 转后 $R1, $R2 仍是 left, top；$R3, $R4 已是 right, bottom（客户区坐标）
  System::Call 'user32::MapWindowPoints(p 0, p $HWNDPARENT, p r1, i 2)'

  ; 标签放在进度条正下方约 4px 处：top + 进度条高度(~18) + 4
  IntOp $R5 $R2 + 22

  ; 标签宽度 = 进度条宽度 = right - left（客户区坐标内相同公式）
  IntOp $R6 $R3 - $R1

  ; 创建 STATIC 控件：样式 WS_CHILD(0x40000000) | WS_VISIBLE(0x10000000) | SS_LEFT = 0x50010000
  ; 高度 22，单行可完整显示说明；父窗口 $HWNDPARENT 即 INSTFILES dialog
  ; p $HWNDPARENT：HWND 在 NSIS 中作指针传递（NSIS v3 仍是 32-bit，与 i 等价但语义更清晰）
  System::Call 'user32::CreateWindowEx(i 0, t "STATIC", t R7, i 0x50010000, i r1, i R5, i r6, i 22, p $HWNDPARENT, i 0, i 0, i 0) i .r8'
FunctionEnd

; 关闭安装器构建隔离
!endif