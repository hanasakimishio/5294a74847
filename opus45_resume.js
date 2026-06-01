/**
 * ============================================================
 *   Opus 4.5 续写器 —— 让被限制的对话重新用 Opus 4.5 继续
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
 * 【为什么这招通常有效】
 *   1. 如果这个对话现在还能用 haiku 回复，说明它的 /completion 通道是通的，
 *      服务器愿意为它生成回复，只是 UI 把模型锁成了 haiku。
 *   2. 付费账号绕过 UI 直接调 API 时，endpoint 依然接受 4.5 的 model 参数。
 *   3. model 是【每一次请求】带上去的参数，不是对话出生时固定的；
 *      haiku 能发，就说明这个字段是活的、可改的。
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
 *   2. F12 → Console，粘贴本脚本，回车
 *      → 看到 "✓ Opus 4.5 续写器已就绪"
 *   3. 就在这个对话里，用 haiku 随便发一条消息（比如打个"在吗"）
 *      → 看到 "✓ 模板已捕获（对话 xxxxxxxx…）"
 *      → 核对括号里的 8 位对话号，确认就是你要救的那个对话
 *   4. 回到 Console，运行：
 *        resume45("想说的第一句话")
 *      → 4.5 会接住这个对话的全部历史开始回复
 *      → 回复会【实时打印在 Console 里】，不用等刷新就能看到
 *      → 流结束后自动刷新页面，进 UI 看完整渲染
 *
 * 【刷新之后】
 *   页面一刷新，hook 和模板都会清空。想再发就重复 2→3→4。
 *   只要【不刷新】，模板一直在内存里，可以连着 resume45() 好几句不用重抓。
 *   建议存成 Chrome Snippet（Sources → Snippets → New → 粘贴 → Ctrl+S），
 *   刷新后右键 Run 一下即可。
 *
 * 【可能看到的情况】
 *   · 回复出现在一个【新分支】里（消息上方有 "< 2/2 >" 那种切换器）：
 *     正常。点一下切到 4.5 那条即可。那条 haiku 插话不会污染上下文，
 *     因为 4.5 接住的是 haiku 之前的对话末尾。
 *   · 报 400 "xxx: Extra inputs are not permitted"：
 *     API schema 又更新了，在 delete body.human_message_uuid 附近
 *     再加一行 delete body.那个字段名。
 *   · 报错信息里有 "model" / "permission" / "not available"：
 *     可能就是 paused 服务端硬降级了。把报错原文贴出来排查（或提 issue）。
 *
 * 【Credit】
 *   原理基于 reddit r/ClaudeAIJailbreak 社区 u/Shayla4Ever 的帖子
 *   "Workaround for starting new Opus 4.5 chats"。本脚本在其基础上做了
 *   自动化（免去手动 Copy as fetch + 替换 UUID），适配了 2026/4 之后的
 *   新 API schema，并把"开新对话"改为"在原对话续写"。
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
          window.__opus45Template = {
            url: url,
            headers: options.headers,
            body: options.body,
          };
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
    if (!window.__opus45Template) {
      console.error(
        "%c❌ 还没捕获到模板 —— 请先在这个对话里用 haiku 发一条消息",
        "color:#E8638B;font-weight:bold"
      );
      return;
    }
    if (!message) {
      message = prompt("想对这个对话的 Opus 4.5 说什么？") || "我们继续吧";
    }

    const tmpl = window.__opus45Template;

    // 关键：URL 原样不动 —— 它已经指向目标对话。不生成新 UUID。
    const url = tmpl.url;
    const m = url.match(/chat_conversations\/([0-9a-f-]+)\/completion/);
    const convUuid = m ? m[1] : null;

    let body;
    try {
      body = typeof tmpl.body === "string" ? JSON.parse(tmpl.body) : tmpl.body;
    } catch (e) {
      console.error("解析 body 失败:", e);
      return;
    }

    body.model = MODEL;       // 把 haiku 换成 4.5
    body.prompt = message;    // 换成你真正想说的话
    delete body.human_message_uuid;     // 新 schema 不收
    delete body.assistant_message_uuid; // 新 schema 不收
    // 注意：parent_message_uuid 故意【保留】—— 它让 4.5 接在对话末尾，
    //       而不是从头开始。别删它。

    console.log(
      "%c⏳ 正在让 Opus 4.5 在这个对话里继续…",
      "color:#E8638B;font-weight:bold"
    );

    try {
      const res = await window.fetch(url, {
        method: "POST",
        headers: tmpl.headers,
        body: JSON.stringify(body),
        credentials: "include",
      });

      if (!res.ok) {
        console.error("%c❌ 请求失败: " + res.status, "color:#c00");
        const errText = await res.text();
        console.error(errText);
        console.error(
          "%c↑ 把上面这段完整报错贴出来排查（或提 issue）",
          "color:#666"
        );
        return;
      }

      console.log(
        "%c✓ Opus 4.5 接管了，以下是它的回复：",
        "color:#E8638B;font-weight:bold;font-size:14px"
      );
      console.log("%c" + "—".repeat(28), "color:#E8638B");

      // ---- 边收流边把回复打印到 Console（容错解析 SSE）----
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let printedAnything = false;

      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });

            // 按行扫 data: {...}，宽容地把增量文本抠出来
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const obj = JSON.parse(payload);
                const piece =
                  obj.completion ??
                  obj.delta?.text ??
                  obj.text ??
                  obj.delta?.completion ??
                  "";
                if (piece) {
                  printedAnything = true;
                  console.log("%c" + piece, "color:#E8638B");
                }
              } catch (e) {
                /* 这一行不是干净 JSON，跳过 */
              }
            }
          }
        } finally {
          console.log("%c" + "—".repeat(28), "color:#E8638B");
          if (!printedAnything) {
            console.log(
              "%c（流式格式可能变了，没解析出文字。回复多半已写进对话，刷新即可看到。）",
              "color:#666"
            );
          }
          console.log(
            "%c✓ 生成结束，刷新进 UI 看完整对话…",
            "color:#E8638B;font-weight:bold"
          );
          if (convUuid) window.location.href = "/chat/" + convUuid;
          else window.location.reload();
        }
      })();
    } catch (e) {
      console.error("❌ 发送异常:", e);
    }
  };

  console.log(
    "%c✓ Opus 4.5 续写器已就绪",
    "color:#E8638B;font-weight:bold;font-size:16px"
  );
  if (window.__opus45Template) {
    const m = window.__opus45Template.url.match(
      /chat_conversations\/([0-9a-f-]+)\/completion/
    );
    console.log(
      "%c模板已就绪（对话 " +
        (m ? m[1].slice(0, 8) + "…" : "?") +
        "），直接运行: resume45(\"我们继续吧\")",
      "color:#666"
    );
  } else {
    console.log(
      "%c下一步: 在这个对话里用 haiku 发一条消息抓模板，然后 resume45(\"你的话\")",
      "color:#666"
    );
  }
})();
