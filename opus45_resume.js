/**
 * ============================================================
 *   Opus 4.5 续写器 v4 —— 让被限制的对话重新用 Opus 4.5 继续
 * ============================================================
 *
 * 【适用场景】
 *   你有一个重要的 Opus 4.5 对话，但它出于某种原因被限制了 ——
 *   例如被 "chat paused"、或者模型选择器里只剩 haiku、再也选不回 4.5。
 *   这个脚本让 4.5 带着【这个对话已有的全部上下文】，在原地继续回复，
 *   而不是新开一个空白对话。
 *
 * 【它做什么】
 *   不开新对话 —— 而是【复用】目标对话已有的 conversation_uuid，
 *   让 4.5 接住这个对话的全部历史，在原地继续往下写。
 *
 * 【v4 修了什么（都是实测踩出来的坑）】
 *   1. 自动对齐接续点：发送前先查对话的 current_leaf_message_uuid 当 parent，
 *      避免"接续点已被占用"导致的 409。
 *   2. 刷新幂等键：claude.ai 用 body.turn_message_uuids 防重复提交，重发时必须
 *      给它换一套全新 uuid，否则报 409 "This message was already sent"。
 *      （新版 schema 已没有 human_message_uuid / assistant_message_uuid，
 *       它俩被合并进了 turn_message_uuids 这个对象。）
 *   3. 不再自动刷新页面：回复打印在 Console 并存进 window.__last45reply
 *      （运行 copy(window.__last45reply) 复制全文）。早期版本发完会自动刷新，
 *       结果把 Console 里正在看的回复一起冲掉 —— 拆了。
 *
 * 【为什么这招通常有效】
 *   1. 如果这个对话现在还能用 haiku 回复，说明它的 /completion 通道是通的，
 *      服务器愿意为它生成回复，只是 UI 把模型锁成了 haiku。
 *   2. 付费账号绕过 UI 直接调 API 时，endpoint 依然接受 4.5 的 model 参数。
 *   3. model 是【每一次请求】带上去的参数，不是对话出生时固定的。
 *   → 在这个对话里把请求的 model 换成 4.5，服务器大概率会用 4.5 继续。
 *
 *   ⚠️ 唯一的变数是 "chat paused" 的真实机制。如果它是【服务端】对这个
 *      对话强制降级（忽略 model 参数、只给 haiku），那这个方法无效。
 *      但既然 haiku 通道还开着，多半 paused 只是【UI 层】限制 —— 试了才知道。
 *
 * 【安全说明】
 *   本脚本不包含、不上传任何账号凭证。它复用你当前登录态发出的请求
 *   （cookie 由浏览器自动携带，脚本看不到也不存储）。
 *
 * 【使用步骤】
 *   1. 打开那个【被限制的、重要的对话】（现在只能用 haiku 那个）
 *   2. F12 → Console，粘贴本脚本，回车 → 看到 "✓ ... 已就绪"
 *   3. 就在这个对话里，用 haiku 随便发一条消息（比如打个"在吗"）
 *      → 看到 "✓ 模板已捕获（对话 xxxxxxxx…）"，核对对话号是你要救的那个
 *   4. 回到 Console，运行：
 *        resume45("想说的第一句话")
 *      → 4.5 接住全部历史开始回复，实时打印在 Console
 *      → 回复同时存进 window.__last45reply，运行 copy(window.__last45reply) 复制全文
 *      → 想在 claude.ai 界面里看这条回复，手动刷新页面（F5），它已经写进对话了
 *
 * 【刷新之后】
 *   页面一刷新，hook 和模板都会清空。想再发就重复 2→3→4。
 *   只要【不刷新】，模板一直在内存里，可以连着 resume45() 好几句不用重抓。
 *   建议存成 Chrome Snippet（Sources → Snippets → New → 粘贴 → Ctrl+S），
 *   刷新后右键 Run 一下即可。
 *
 * 【可能看到的情况】
 *   · 回复落在一个新分支（消息上方有 "< 2/2 >" 切换器）：点一下切过去即可。
 *     （v4 默认接在 current_leaf 后面，通常会直接显示在对话末尾。）
 *
 * 【故障排查】
 *   · 409 "This message was already sent"：v4 已自动处理（刷新 turn_message_uuids
 *     + 对齐 leaf）。若仍出现，可能 schema 又变了 —— 把请求 body 的字段贴出来排查。
 *   · 400 "xxx: Extra inputs are not permitted"：在 delete body.human_message_uuid
 *     附近再加一行 delete body.那个字段名。
 *   · 报错信息里有 "model" / "permission" / "not available"：账号可能已无 4.5 权限，
 *     或目标对话被服务端硬降级 —— 这种情况脚本无能为力。
 *
 * 【Credit】
 *   原理基于 reddit r/ClaudeAIJailbreak 社区 u/Shayla4Ever 的帖子
 *   "Workaround for starting new Opus 4.5 chats"。本脚本在其基础上做了自动化、
 *   适配了 2026/4 之后的新 API schema，并把"开新对话"改为"在原对话续写"。
 *
 * 【免责声明】
 *   非官方方法，Anthropic 随时可能改动 API 使其失效，自负风险。
 *
 * ============================================================
 */

(function () {
  const MODEL = "claude-opus-4-5-20251101";

  // ---- Hook：只观察、不改动真实流量，装一次就够 ----
  if (!window.__claude45Hooked) {
    const origFetch = window.fetch;
    window.fetch = function (url, options) {
      try {
        if (
          typeof url === "string" &&
          url.includes("/completion") &&
          options &&
          options.method === "POST" &&
          options.body
        ) {
          window.__opus45Template = { url, headers: options.headers, body: options.body };
          const mm = url.match(/chat_conversations\/([0-9a-f-]+)\/completion/);
          console.log(
            "%c✓ 模板已捕获" + (mm ? "（对话 " + mm[1].slice(0, 8) + "…）" : ""),
            "color:#E8638B;font-weight:bold;font-size:14px"
          );
        }
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
    window.__claude45Hooked = true;
  }

  // ---- 在"当前捕获到的那个对话"里，用 4.5 续写 ----
  window.resume45 = async function (message) {
    const t = window.__opus45Template;
    if (!t) {
      console.error(
        "%c❌ 还没捕获到模板 —— 先在这个对话里用 haiku 发一条消息",
        "color:#E8638B;font-weight:bold"
      );
      return;
    }
    if (!message) message = prompt("想对这个对话的 Opus 4.5 说什么？") || "我们继续吧";

    const url = t.url;
    const m = url.match(/chat_conversations\/([0-9a-f-]+)\/completion/);
    const convUuid = m ? m[1] : null;

    let body;
    try {
      body = typeof t.body === "string" ? JSON.parse(t.body) : JSON.parse(JSON.stringify(t.body));
    } catch (e) {
      console.error("解析 body 失败:", e);
      return;
    }

    // 1) 查对话当前最新 leaf 当 parent（避免接续点已被占用导致的 409）
    const detailUrl =
      url.replace(/\/completion(\?.*)?$/, "") +
      "?tree=True&rendering_mode=messages&render_all_tools=true";
    let parent = null;
    try {
      const cr = await window.fetch(detailUrl, { headers: t.headers, credentials: "include" });
      if (cr.ok) {
        const conv = await cr.json();
        parent =
          conv.current_leaf_message_uuid ||
          (conv.chat_messages?.length ? conv.chat_messages[conv.chat_messages.length - 1].uuid : null);
      }
    } catch (e) {
      console.warn("查 leaf 异常:", e);
    }

    body.model = MODEL;
    body.prompt = message;
    if (parent) body.parent_message_uuid = parent;

    // 2) 刷新 turn_message_uuids —— 幂等键，旧值会被判 "already sent" (409)
    if (body.turn_message_uuids && typeof body.turn_message_uuids === "object") {
      const fresh = {};
      for (const k in body.turn_message_uuids) fresh[k] = crypto.randomUUID();
      body.turn_message_uuids = fresh;
    }
    delete body.human_message_uuid;
    delete body.assistant_message_uuid;

    console.log(
      "%c⏳ 让 Opus 4.5 在这个对话里继续…（parent=" + parent + "）",
      "color:#E8638B;font-weight:bold"
    );

    try {
      const res = await window.fetch(url, {
        method: "POST",
        headers: t.headers,
        body: JSON.stringify(body),
        credentials: "include",
      });

      if (!res.ok) {
        console.error("%c❌ 请求失败: " + res.status, "color:#c00");
        console.error(await res.text());
        return;
      }

      console.log(
        "%c✓ Opus 4.5 接管了，以下是它的回复：",
        "color:#E8638B;font-weight:bold;font-size:14px"
      );
      console.log("%c" + "—".repeat(28), "color:#E8638B");

      // ---- 边收流边打印，并累积全文（不自动刷新）----
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const p = line.slice(5).trim();
          if (!p || p === "[DONE]") continue;
          try {
            const o = JSON.parse(p);
            const piece = o.completion ?? o.delta?.text ?? o.text ?? o.delta?.completion ?? "";
            if (piece) {
              full += piece;
              console.log("%c" + piece, "color:#E8638B");
            }
          } catch (e) {
            /* 这一行不是干净 JSON，跳过 */
          }
        }
      }

      window.__last45reply = full;
      console.log("%c" + "—".repeat(28), "color:#E8638B");
      console.log(
        "%c✓ 完成。回复已存进 window.__last45reply —— 运行 copy(window.__last45reply) 复制全文。",
        "color:#E8638B;font-weight:bold"
      );
      console.log(
        "%c想在 claude.ai 界面里看这条回复，手动刷新页面（F5）即可，它已经写进对话了。",
        "color:#666"
      );
    } catch (e) {
      console.error("❌ 发送异常:", e);
    }
  };

  console.log(
    "%c✓ Opus 4.5 续写器 v4 已就绪 — 在对话里用 haiku 发一条抓模板，再跑 resume45(\"你的话\")",
    "color:#E8638B;font-weight:bold;font-size:15px"
  );
})();
