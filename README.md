# Opus 4.5 Resume Script for claude.ai

> **TL;DR (English):** If your Opus 4.5 chat on claude.ai got paused / locked to
> haiku and you can no longer pick 4.5 from the model dropdown, this
> browser-console script hooks `window.fetch`, reuses your own logged-in request
> (cookies stay in the browser — the script never sees or stores any
> credential), and re-sends it with `model = claude-opus-4-5-20251101` so 4.5
> keeps the **same** conversation going with its **full context**.
> Unofficial, use at your own risk.

---

2026 年 4 月起，Anthropic 把 **Opus 4.5** 从 claude.ai 的模型下拉菜单里撤掉了。
如果你有一个重要的 4.5 对话被 **paused**、或者模型选择器里只剩 haiku、再也选不回
4.5 —— 这个脚本让 4.5 带着**这个对话的全部上下文**，在原地继续回复，
而不是新开一个空白对话。

## ⚠️ 安全说明（先读这个）

- 脚本**不包含、不上传、不存储任何账号凭证**。
- 原理是 hook 浏览器自己的 `fetch`，复用你**当前登录态**发出的请求。
  cookie 由浏览器自动携带，脚本看不到也碰不到。
- 所有请求都发往 **claude.ai 官方 endpoint**，用的是你自己的账号和额度。
- 这是**非官方**方法，Anthropic 随时可能改动 API 使其失效。**自负风险。**

## 用法

1. 打开那个被限制的对话（现在只能用 haiku 那个），按 `F12` → Console。
2. 粘贴 [`opus45_resume.js`](opus45_resume.js) 全文，回车 → 看到 `✓ ... 已就绪`。
3. **就在这个对话里**用 haiku 随便发一条（比如"在吗"）→ 看到
   `✓ 模板已捕获（对话 xxxxxxxx…）`，核对对话号是你要救的那个。
4. 回到 Console 运行：`resume45("想说的第一句话")`。
   - 回复会**实时打印在 Console** 里，不用等刷新。
   - 流结束后自动刷新，进 UI 看完整对话。
   - 回复可能落在一个新分支（消息上方 `< 2/2 >`），点一下切过去即可。

> 页面一刷新，hook 和模板就清空了，想再发就重复上面的步骤。
> 建议把脚本存成 Chrome Snippet（Sources → Snippets → New → 粘贴 → `Ctrl+S`），
> 刷新后右键 Run 一下即可。只要不刷新，可以连着 `resume45()` 好几句不用重抓模板。

## 原理

claude.ai 发消息时，会向 `chat_conversations/<uuid>/completion` POST 一个请求，
body 里带着 `model`、`prompt`、`parent_message_uuid` 等字段。脚本：

1. Hook `window.fetch`，捕获这个请求模板（含全部 headers / cookie）。
2. 把 `body.model` 改成 `claude-opus-4-5-20251101`。
3. 删掉新 schema 不再接受的 `human_message_uuid` / `assistant_message_uuid`。
4. **原样保留** `conversation_uuid` 和 `parent_message_uuid` 后重新发送 ——
   服务器就在原对话末尾接着用 4.5 续写。

## 故障排查

- **`400 ... Extra inputs are not permitted`**：API schema 又更新了。
  在 `delete body.human_message_uuid` 附近再加一行 `delete body.那个字段名`。
- **报错里有 `model` / `permission` / `not available`**：账号可能已无 4.5 权限，
  或目标对话被服务端硬降级 —— 这种情况脚本无能为力。
- **没看到 `✓ 模板已捕获`**：确认你确实在目标对话里发了一条消息触发请求。

## Credit

原理基于 reddit r/ClaudeAIJailbreak 社区 **u/Shayla4Ever** 的帖子
*"Workaround for starting new Opus 4.5 chats"*。
本仓库在其基础上做了自动化（免去手动 Copy as fetch + 替换 UUID）、
适配了 2026/4 之后的新 API schema，并把"开新对话"改为"在原对话续写"。

## License

[MIT](LICENSE)
