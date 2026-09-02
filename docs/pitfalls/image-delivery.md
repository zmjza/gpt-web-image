# 图片交付与实时回显

## 不要用截图、历史图片或终态清单替代逐张原图交付

**现象**：网页可能先显示占位图、历史图片或部分结果；批量任务仍在生成时，用户要求每张合格图片下载后立即在当前 Codex 对话中显示。

**根因**：如果没有把本次用户消息与唯一助手回复绑定，监控器可能串入历史图片；如果没有等待下载完成、真实解码、尺寸检查和哈希去重，就可能把临时文件、截图或重复结果误报为成功；如果只在终态输出清单，就失去实时回显顺序。

**正确做法**：先建立本次回复锚点，只消费该区域的新图片。优先捕获网页下载事件，必要时只使用页面已经暴露的本次原始资源；文件写入临时路径后完成解码、尺寸、字节数和 SHA-256 校验，再原子转正。每个唯一结果立即发出 JSONL `image_ready`，Codex 立即使用 `previewPath || originalPath` 的绝对路径渲染；同一 `resultId` 或哈希只显示一次，后续失败不撤回已成功图片。

**验证方式**：运行本地 Chrome 夹具的 1 张、2 张、10 张、部分成功、下载失败和超时测试，确认第一条 `image_ready` 早于 `terminal`；检查 `task.json`、图片可解码、路径为绝对路径且哈希唯一。夹具通过只能证明控制逻辑，真实 ChatGPT 和 Codex 宿主回显必须按真机清单单独验证。

**禁止事项**：不得只回显 URL 或路径文本；不得把截图当作原图；不得等待整批完成后统一展示；不得消费历史回复图片；不得在文件未校验、重复或下载失败时发出成功事件；不得把本地夹具结果写成真实 ChatGPT 成功。

**相关文件或命令**：`src/chatgpt/response-anchor.ts`、`src/chatgpt/web-flow.ts`、`src/images/discovery.ts`、`src/images/download.ts`、`src/images/validate.ts`、`src/events/image-ready.ts`、`src/events/writer.ts`、`liran_docs/07-API文档.md`、`liran_docs/09-真机实测.md`、`npm test`。

**适用范围**：文字生图、参考图改图、连续修改、1–10 张批量任务、补图、部分成功和 Codex 实时回显。

## ChatGPT 图片回复应锚定稳定的 turn 容器

**现象**：图片请求已确认提交并进入生成，但监听 `[data-message-author-role="assistant"]` 超时；真实页面稍后能看到图片，任务却没有下载或发出 `image_ready`。另一次请求因读取整个用户 turn 的操作区文本而进入 `SUBMISSION_UNCERTAIN`。

**根因**：ChatGPT 图片任务会从临时 `WEB:` 会话切换到正式会话。路由切换后，稳定的外层节点是 `[data-turn="assistant"]`，旧的内层作者属性可能被移除；用户 turn 外层还可能包含编辑操作文本。真实生成图没有 `data-result-id`，并同时存在一个可见主图和两个 `aria-hidden` 同源副本。

**正确做法**：优先用 `[data-turn]` 绑定用户和助手 turn，旧属性只作兼容回退；用户提交指纹只读取 turn 内层真实用户消息；图片发现只接收非隐藏且具有非空替代文本的主图，无结果 ID 时生成本轮稳定标识，并继续用资源 URL、解码和 SHA-256 去重。

**验证方式**：运行包含 `dom=modern` 的 T40 Chrome 夹具回归，确认路由切换后仍锚定同一回复且三个渲染节点只交付一张；真实任务 `task_ms8zt15x_jebj658t` 的 `image_ready` 序号 4 早于终态序号 5，原图为可解码的 1254×1254 PNG。

**禁止事项**：不得把临时路由中的内层作者节点当作永久锚点；不得用整个 turn 的混合文本确认提交；不得把隐藏副本重复计数；`SUBMISSION_UNCERTAIN` 时不得自动重提。

**相关文件或命令**：`src/chatgpt/web-flow.ts`、`src/images/discovery.ts`、`tests/fixtures/chatgpt-page/index.html`、`tests/integration/web-flow.test.ts`、`npm test`。

**适用范围**：真实 ChatGPT 图片任务的提交确认、路由切换、回复绑定、图片发现、下载和逐张回显。

## 中断恢复不得把临时 WEB 会话当作稳定锚点

**现象**：任务已经确认提交，但中断后 `resume` 重开专用 Profile 只能进入 `result_uncertain`，无法找到原助手回合；没有图片文件，也没有第二次提交。

**根因**：任务记录的 `chatUrl` 仍是 `https://chatgpt.com/c/WEB:...` 临时地址，浏览器重启后该地址不保证对应正式会话；即使 `assistantTurnOrdinal` 已存在，也不能据此在错误页面上继续观察。

**正确做法**：只有稳定 UUID 会话 URL 与提交确认、响应锚点同时存在时才执行恢复观察；临时 `WEB:` 地址必须保持不确定并停止网页写操作，不得自动新建任务或重提提示词。稳定地址未落盘时，将这次结果记录为恢复失败并用新的唯一任务重新验证。

**验证方式**：真实任务 `task_msdjxoti_el12dplo` 的 `resume` 输出 `recovering` 后为 `PAGE_STRUCTURE_CHANGED: assistant turn`，`task.json` 结果仍为 0、没有 `image_ready` 和原图，且没有第二次提交；此前稳定 UUID 的恢复任务仍按 4.2 证据单独记录。

**禁止事项**：不得把 `WEB:` URL 写成稳定恢复证据；不得通过枚举旧标签页、读取完整聊天历史或盲目发送相同提示词来“找回”结果；不得将 `result_uncertain` 改写成成功。

**相关文件或命令**：`src/cli.ts`、`src/chatgpt/web-flow.ts`、`src/persistence/recover.ts`、`node dist/src/cli.js resume --task-id <taskId>`、`liran_docs/09-真机实测.md`。

**适用范围**：macOS/Windows 真实 ChatGPT 提交后中断、恢复观察、图片下载和实时回显。

## 提交指纹必须剥离中文展示控件文本

**现象**：真实 ChatGPT 中文界面已经把 refine 用户消息提交到会话，但确认阶段返回 `SUBMISSION_UNCERTAIN`；页面中的用户回合文本形如 `你说：<真实提示词>展开收起`。

**根因**：页面把“你说：”前缀和“展开收起”折叠控件文本挂在用户回合 DOM 中；如果提交指纹只做空白压缩，UI 包装会使它与发送前提示词哈希不一致。

**正确做法**：提交指纹比较前先压缩空白，并只移除已确认的 ChatGPT 展示包装（`你说：`/`你说:` 前缀和末尾 `展开收起`），再执行原有哈希比较。该规范化只用于确认，不改变实际发送的提示词。

**验证方式**：`tests/chatgpt/adapter.test.ts` 的 T22 回归断言 `你说：画一张海报展开收起` 被确认；真实任务 `task_msc2fm9i_4ccldpea` 的初次不确定提交未被重提，随后在稳定会话第二助手回合恢复下载 1448×1086 PNG，`image_ready` seq 6 早于 terminal seq 7，任务终态 `succeeded`。

**禁止事项**：不得把整个用户 turn 的操作区文本直接当作原始提示词；不得因包装文本不匹配就盲目重提；不得用该修复绕过 `uncertain` 安全门禁或记录账号凭据。

**相关文件或命令**：`src/chatgpt/submit.ts`、`tests/chatgpt/adapter.test.ts`、`node dist/src/cli.js resume`、`npm test`。

**适用范围**：ChatGPT 中文界面的文字生图、改图、refine 和提交后恢复确认。

## 多图请求必须禁止附件式伪交付

**现象**：请求 10 张图片时，网页可能回复 PNG 文件清单、附件卡片或打包下载，而不是在回复正文中直接展示图片；监控若只看可见 `<img>`，会误算或漏算结果。

**根因**：原始提示词没有明确要求使用 ChatGPT 内置图像生成能力，也没有禁止 Python/代码解释器、Canvas、附件、ZIP、文件清单和下载链接，网页因此选择了文件生成工作流。

**正确做法**：CLI 自动追加硬约束：使用内置图像生成、每张独立、正文内逐张可见展示、禁止程序生成和附件式交付。只有真实图片资源经过解码、尺寸和哈希校验后才发 `image_ready`；附件清单不能作为成功证据。

**验证方式**：自动化断言提示词包含这些约束；macOS 真实任务 `task_ms906816_fyuvnmqq`（2 张）和 `task_ms90soxs_c4lbh48d`（10 张）均逐张 `image_ready` 且终态成功。首次附件型任务 `task_ms907uhh_fvbg4etq` 只保留已成功的 3 张并安全取消，不计入通过。

**禁止事项**：不得把附件名称、ZIP、下载清单、截图或网页说明当作图片交付；不得因为网页声称“已生成”就跳过原图解码和事件顺序校验；多图少产时只能按受控补图策略继续。

**相关文件或命令**：`src/chatgpt/conversation.ts`、`src/cli.ts`、`src/chatgpt/web-flow.ts`、`src/chatgpt/submit.ts`、`liran_docs/09-真机实测.md`。

**适用范围**：1–10 张文字生图、参考图改图和补图任务的提示词交付约束与结果验收。

**补充边界**：即使回复声称“已生成”，也可能实际进入批量文件导出流程，表现为 PNG 文件名列表、附件卡片、“下载全部”或代码图标，而不是图片正文。提示词必须明确要求逐张内联渲染，并明确禁止网页、表格、文件列表和打包下载；监控仍以真实图片资源的解码校验为唯一成功证据。

## 改图上传控件可能有多个响应式实例

**现象**：真实改图页面存在通用文件 input 和多个 `accept="image/*"` input，按“必须恰好一个 input”判断会在上传前报结构异常。

**根因**：ChatGPT 为桌面/移动布局保留多个图片上传控件，其中部分是 1px 或不可见实例；控件数量不是唯一性条件。

**正确做法**：优先选择带 `accept="image/*"` 的图片 input，并使用第一个稳定实例设置参考文件；上传后仍需等待用户消息确认、原图校验和新结果独立保存。

**验证方式**：真实任务 `task_ms917xsb_4ry0xdyi` 改图成功，源文件哈希未变，结果文件为独立 PNG；自动化上传回归继续覆盖文件边界。

**禁止事项**：不得把通用 input、响应式重复 input 的数量当作结构冲突；不得覆盖源图片；上传失败不得提交网页任务。

**相关文件或命令**：`src/chatgpt/web-flow.ts`、`liran_docs/09-真机实测.md`。

**适用范围**：参考图改图和需要本地附件的 ChatGPT 网页任务。

## 取消必须合并磁盘状态并检查候选边界

**现象**：用户取消多图任务后，正在运行的进程仍处理同一批候选图，旧内存任务对象还可能把 `cancelRequestedAt` 覆盖为空并最终误报 `succeeded`。

**根因**：取消命令与生成进程是两个执行者；只在轮询循环开头读取取消标记不够，单轮候选循环和结果写回仍可能使用旧快照。

**正确做法**：每张候选图前检查取消；写入结果和最终终态前从磁盘合并最新 `cancelRequestedAt`；只要取消标记存在，终态优先为 `cancelled`，已校验图片保留，不再补图或重复提交。

**验证方式**：夹具取消回归在第一张交付后第二张前停止；真实任务 `task_ms91v98r_q8ybbrl2` 在 9/10 时取消，`task.json` 保留 `cancelRequestedAt`、终态 `cancelled`，未交付第 10 张。

**禁止事项**：不得用旧内存任务对象覆盖取消字段；不得在取消后把任务改回成功；不得删除取消前已校验的结果。

**相关文件或命令**：`src/cli.ts`、`src/chatgpt/web-flow.ts`、`tests/integration/web-flow.test.ts`、`node dist/src/cli.js cancel --task-id ...`。

**适用范围**：1–10 张生图、补图、改图和恢复任务的取消处理。

## 生成图片必须通过唯一媒体查看器下载事件绑定

**现象**：真实 ChatGPT 助手回合内没有原图下载链接；点击生成图后才挂载媒体查看器，主图先出现，“保存”按钮稍后才完成 hydration。若立即检查按钮会误报失败，若直接使用 `currentSrc` 又可能下载缩略图、历史图或签名临时资源。

**根因**：真实网页把生成卡、查看器主图和下载事件分成异步阶段；同一查看器还可能带轮播缩略图。页面资源 URL 不能单独证明它属于当前任务和当前助手回合。

**正确做法**：先把当前用户回合绑定到紧邻助手回合和唯一可见媒体卡；点击该卡后要求唯一语义化 dialog、面积显著更大的主图和一致自然尺寸，再有界等待唯一“保存”控件并捕获浏览器 download 事件。查看器未唯一匹配或保存控件未稳定出现时安全失败，恢复只能观察原回合。

**验证方式**：延迟查看器夹具回归通过；真实任务 `task_msiq8jlw_k1xot6vo` 首次安全失败后只读恢复，最终媒体卡、下载事件、PNG 解码和 SHA-256 一致，没有重复提交。

**禁止事项**：不得整页扫描图片；不得使用 `currentSrc`、缩略图、用户附件、隐藏副本或历史卡作为下载兜底；不得把同卡轮播缩略图计作多个结果。

**相关文件或命令**：`src/chatgpt/media-binding.ts`、`src/chatgpt/web-flow.ts`、`tests/chatgpt/media-binding.test.ts`、`tests/integration/web-flow.test.ts`、`node dist/src/cli.js resume --task-id <taskId>`。

**适用范围**：文生图、图生图、图改图、补图和提交后恢复。

## 提交后的稳定会话不能从历史侧栏猜测

**现象**：新任务已经在网页生成完成，但任务记录可能写入侧栏中的旧会话 UUID，恢复后从旧对话拿到与提示词无关的历史图片。

**根因**：提交后扫描整个侧栏并取第一个 UUID 链接，无法证明该链接由本次提交产生；Profile 中已有历史会话时会稳定串图。

**正确做法**：提交前记录全部会话链接基线；提交后只接受当前页面稳定 UUID URL，或明确新增且不在基线内的唯一 UUID 链接。恢复模式必须使用已落盘的稳定 URL，禁止再从侧栏推断。

**验证方式**：带历史链接的受控夹具回归通过；0.3.0 文生图、图改图、图生图和双任务并发的稳定 URL、回合锚点、媒体卡与结果哈希均各自对应。

**禁止事项**：不得取第一个、最后一个或文本最相似的侧栏会话作为当前任务；不得保存 `WEB:` 临时 URL；恢复缺少稳定 URL 时不得新建会话或重发。

**相关文件或命令**：`src/chatgpt/web-flow.ts`、`src/persistence/recover.ts`、`tests/integration/web-flow.test.ts`、`liran_docs/09-真机实测.md`。

**适用范围**：新会话生成、图改图、提交后恢复和同 Profile 多任务队列。

## 附件确认不能在 Composer 不唯一时退回整页扫描

**现象**：当前输入区没有上传完成的参考图，但页面历史区域存在同名附件；如果附件识别退回扫描整个 `body`，图生图可能错误通过上传门禁。

**根因**：响应式或 hydration 阶段可能暂时出现多个可见 textbox。将“当前 Composer 不能唯一定位”解释成“扫描全页”会失去任务边界，并把历史附件纳入候选。

**正确做法**：只在唯一可见 Composer 及其唯一祖先 `form` 内扫描附件。Composer 或表单不唯一时保持待定，超过有界预算返回 `ATTACHMENT_UPLOAD_UNCONFIRMED`；同名历史附件不能改变结果。

**验证方式**：受控浏览器夹具同时放置重复 Composer、当前表单缺失附件和表单外同名历史附件；旧实现错误接受，修复后明确拒绝。

**禁止事项**：不得退回 `body`、conversation、侧栏或历史消息扫描；不得用文件名相同替代当前输入区的打开/移除控件和数量证据。

**相关文件或命令**：`src/chatgpt/attachments.ts`、`tests/fixtures/chatgpt-page/index.html`、`tests/integration/web-flow.test.ts`。

**适用范围**：本地参考图图生图、多附件上传和 ChatGPT Composer hydration。

## 当前照片入口不能被更早出现的通用文件 input 抢占

**现象**：页面同时存在表单内通用 `#upload-files`、专用 `data-testid=upload-photos-input` 和相机 input；对联合选择器直接 `.first()` 后，通用 input 收到本地文件但连续 10 秒没有生成附件卡片，随后发送点击没有提交，草稿仍留在 Composer。

**根因**：CSS 联合选择器按 DOM 顺序返回节点，不按选择器书写优先级返回。当前 ChatGPT 的可靠照片入口是专用 `upload-photos-input`；通用 input 虽带 `data-photo-upload-enabled`，直接设置文件并不等价于当前照片上传流程。

**正确做法**：优先要求唯一 `input[data-testid=upload-photos-input][accept*=image]`；仅当该入口不存在时，回退到唯一 Composer 表单内、非相机的 `accept=image` input。上传后仍只在当前表单验证精确文件名、数量、打开和移除控件。

**验证方式**：夹具把无事件的通用 input 放在专用照片 input 之前；旧实现返回 `ATTACHMENT_UPLOAD_UNCONFIRMED`，修复后 T03 生成和交付成功。真实专用入口在 0.5 秒内出现精确附件卡片，任务 `task_mt78uzxk_xu73ll7q` 持久化 `reference_attachment_visible` 和精确文件名。

**禁止事项**：不得假设 CSS 联合选择器的第一段优先；不得使用相机 input；不得把历史或旧草稿附件当成本轮上传；不得在附件证据缺失时提交。

**相关文件或命令**：`src/chatgpt/web-flow.ts`、`src/chatgpt/attachments.ts`、`tests/fixtures/chatgpt-page/index.html`、`tests/integration/web-flow.test.ts`。

**适用范围**：本地参考图图生图、照片上传入口改版和多 input 响应式页面。

## 附件卡瞬时未挂载时必须在提交前停止

**现象**：0.5.0 真实验收的首次任务已找到专用照片 input，但 15 秒内没有取得可验证附件卡，以 `ATTACHMENT_UPLOAD_UNCONFIRMED` 停止；随后独立探针在 142ms 内取得相同文件的完整打开/移除证据，第二次任务成功。

**根因**：信息不全，现有证据只能确认为 ChatGPT 上传控件的瞬时 hydration 或会话状态问题；不是模型菜单或额度失败。

**正确做法**：附件名、打开和移除控件不完整时继续在提交前安全停止。只有任务记录明确 `clickedAt=null` 和 `confirmedAt=null` 时，才可由操作者新建一次任务；已有任何提交迹象则禁止重提。

**验证方式**：检查 `task_mtkai0x5_kx449wex` 无 attempt/click/confirm/chatUrl；独立探针返回精确文件名且 `ready=true`；`task_mtkamt5z_yhoxhmui` 最终 `succeeded` 并持久化完整附件证据。

**禁止事项**：不得在附件证据缺失时发送；不得把一次瞬时失败误报为登录失效、额度耗尽或模型不可用；不得在提交状态不明时重试。

**相关文件或命令**：`src/chatgpt/web-flow.ts`、`src/chatgpt/attachments.ts`、`node dist/src/cli.js edit`、`liran_docs/09-真机实测.md`。

**适用范围**：真实 ChatGPT 参考图上传、SPA hydration 和提交前安全门禁。

## 发送点击无效时只能在确定未派发后键盘回退一次

**现象**：发送按钮 click 返回成功，但 10 秒后提示词仍完整保留，当前页面没有新用户回合、没有新增稳定会话，最近 15 个会话也没有提示词指纹；任务进入 `SUBMISSION_UNCERTAIN`。

**根因**：ChatGPT SPA 在 Composer/附件 hydration 期间可能接受自动化点击动作但不派发表单。仅凭 click API 成功不能证明消息已经离开输入区。

**正确做法**：点击后等待短窗口；只有当前 Composer 仍精确等于待提交提示词、用户回合数量未增加、当前 URL 和会话链接均没有新增稳定会话，且发送按钮仍可用时，才在同一 attempt 内对 Composer 发送一次 Enter。任一派发迹象存在都禁止回退。

**验证方式**：夹具让第一次按钮 click 无效、Enter 才触发表单；修复前 `SUBMISSION_UNCERTAIN`，修复后只有一个用户回合。真实 `task_mt78uzxk_xu73ll7q` 在修复后获得 `clickedAt/confirmedAt`、稳定 URL 和 1/1 回合锚点。

**禁止事项**：不得定时无条件重按 Enter；不得在 Composer 已清空、已有用户回合、已有新会话或状态未知时再次派发；不得创建第二个任务规避恢复流程。

**相关文件或命令**：`src/chatgpt/web-flow.ts`、`src/chatgpt/submit.ts`、`tests/integration/web-flow.test.ts`。

**适用范围**：新会话文生图、图生图、图改图和 ChatGPT Composer SPA hydration。

## 查看器保存控件等待必须覆盖真实 hydration

**现象**：生成图及唯一查看器主图已出现，但“保存”按钮在 5 秒预算后仍未挂载；工具安全失败，稍后人工只读打开同一查看器可见唯一保存按钮。

**根因**：媒体主图、查看器壳层和顶部操作栏分阶段 hydration；图片可见不代表下载控件已稳定。

**正确做法**：保持唯一 dialog、唯一主图及自然尺寸一致的前置门禁，再有界等待唯一保存按钮 15 秒并捕获 download 事件。超时仍失败；已确认提交且具备稳定会话/回合锚点时使用 `resume` 继续同一结果。

**验证方式**：6.5 秒延迟保存按钮夹具修复前失败、修复后通过；真实 `task_mt78uzxk_xu73ll7q` 从 `seq=5 recovering` 恢复到 `seq=9 succeeded`，媒体卡 `image-f6b4070b-b23d-41a8-b3db-cfbdfdd0110d`，未新增用户回合。

**禁止事项**：不得改用 `currentSrc`、截图或任意缩略图；不得无限等待；不得为恢复下载重新提交生成请求。

**相关文件或命令**：`src/chatgpt/web-flow.ts`、`src/persistence/recover.ts`、`tests/integration/web-flow.test.ts`、`node dist/src/cli.js resume --task-id <taskId>`。

**适用范围**：生成媒体查看器、原图下载、提交后恢复和实时 `image_ready`。
