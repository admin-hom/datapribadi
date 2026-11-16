const STORAGE_KEY = "jarvis-chat-v1";

const els = {
  chat: document.getElementById("chat"),
  form: document.getElementById("form"),
  input: document.getElementById("input"),
  send: document.getElementById("sendBtn"),
  clear: document.getElementById("clearBtn"),
  pc: document.getElementById("pcLine"),
  aiChip: document.getElementById("aiChip"),
  suggest: document.getElementById("suggest"),
};

const SUGGESTIONS = [
  "Cek spek PC gw",
  "Isi folder Downloads gw apa aja?",
  "Cari file PDF di Documents",
  "Bikin folder project baru di Desktop",
  "Berapa sisa storage drive C?",
  "Buka folder Documents",
];

let messages = load();
let streaming = false;
let currentAssistant = null;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-30) : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
  } catch {
    /* storage penuh: chat tetap jalan */
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

function renderMarkdown(text) {
  const blocks = [];
  let html = escapeHtml(text).replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });

  html = html
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  const out = [];
  let list = null;
  for (const line of html.split(/\n/)) {
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      list = list || [];
      list.push(`<li>${(bullet || numbered)[1]}</li>`);
      continue;
    }
    if (list) {
      out.push(`<ul>${list.join("")}</ul>`);
      list = null;
    }
    if (line.trim()) out.push(`<p>${line}</p>`);
  }
  if (list) out.push(`<ul>${list.join("")}</ul>`);

  return out.join("").replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)] || "");
}

function toolCard(tool) {
  const card = document.createElement("div");
  card.className = `tool${tool.ok === false ? " fail" : ""}`;

  let args = tool.args || "";
  try {
    const parsed = JSON.parse(args);
    args = Object.entries(parsed)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" · ");
  } catch {
    /* biarkan raw */
  }

  const row = document.createElement("div");
  row.className = "row";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = tool.name;
  const argsEl = document.createElement("span");
  argsEl.className = "args";
  argsEl.textContent = args.slice(0, 180);
  row.append(name, argsEl);
  card.append(row);

  if (tool.preview) {
    const preview = document.createElement("div");
    preview.className = "preview";
    preview.textContent = tool.preview;
    card.append(preview);
  }
  return card;
}

function buildBubble(msg) {
  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (msg.tools?.length) {
    const tools = document.createElement("div");
    tools.className = "tools";
    for (const tool of msg.tools) tools.append(toolCard(tool));
    bubble.append(tools);
  }

  if (msg.content) {
    const content = document.createElement("div");
    content.className = "content";
    content.innerHTML = renderMarkdown(msg.content);
    bubble.append(content);
  }

  if (msg.error) {
    const err = document.createElement("div");
    err.className = "error-box";
    err.textContent = msg.error;
    bubble.append(err);
  }

  if (!msg.content && !msg.error && !msg.tools?.length) {
    bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  }
  return bubble;
}

function messageEl(msg, index) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${msg.role}`;
  wrap.dataset.index = String(index);
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = msg.role === "user" ? "ME" : "AI";
  wrap.append(avatar, buildBubble(msg));
  return wrap;
}

function renderAll() {
  els.chat.replaceChildren();
  if (messages.length === 0) {
    els.chat.append(
      messageEl(
        {
          role: "assistant",
          content:
            "Halo, Jarvis aktif. 🖥️\n\nGw jalan langsung di PC lo: bisa lihat folder, baca/tulis file, cari sesuatu, jalanin PowerShell, dan buka aplikasi. Mau mulai dari mana?",
        },
        -1,
      ),
    );
  } else {
    messages.forEach((msg, i) => els.chat.append(messageEl(msg, i)));
  }
  scrollToEnd();
}

function refreshCurrent() {
  if (!currentAssistant || !currentAssistant.msg) return;
  const fresh = buildBubble(currentAssistant.msg.data);
  currentAssistant.msg.bubble.replaceWith(fresh);
  currentAssistant.msg.bubble = fresh;
  scrollToEnd();
}

function scrollToEnd() {
  els.chat.scrollTop = els.chat.scrollHeight;
}

function renderSuggestions() {
  els.suggest.replaceChildren();
  for (const text of SUGGESTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = text;
    btn.addEventListener("click", () => {
      els.input.value = text;
      send();
    });
    els.suggest.append(btn);
  }
}

function autoGrow() {
  els.input.style.height = "auto";
  els.input.style.height = `${Math.min(els.input.scrollHeight, 150)}px`;
}

function setStreaming(value) {
  streaming = value;
  els.send.disabled = value;
  els.input.disabled = value;
  if (!value) els.input.focus();
}

async function loadInfo() {
  try {
    const res = await fetch("/api/info");
    if (!res.ok) throw new Error();
    const info = await res.json();

    els.pc.textContent = `${info.user}@${info.hostname} · ${info.os}`;
    els.aiChip.className = `chip${info.ready ? " ok" : " bad"}`;
    els.aiChip.querySelector("span").textContent = info.ready
      ? `${info.provider} · ${info.model}`
      : "API key belum diisi";
    els.aiChip.title = info.ready ? `Model: ${info.model}` : "Isi jarvis/.env.local";
  } catch {
    els.pc.textContent = "server lokal nggak nyahut";
    els.aiChip.className = "chip bad";
    els.aiChip.querySelector("span").textContent = "offline";
  }
}

async function send() {
  const text = els.input.value.trim();
  if (!text || streaming) return;

  els.input.value = "";
  autoGrow();
  setStreaming(true);

  // buang sapaan awal dari state supaya nggak ikut ke API
  messages = messages.filter((msg) => !msg.greeting);
  messages.push({ role: "user", content: text });

  const data = { role: "assistant", content: "", tools: [] };
  const placeholderIndex = messages.length;
  messages.push(data);

  renderAll();
  const wrap = els.chat.querySelector(`[data-index="${placeholderIndex}"]`);
  const bubble = wrap?.querySelector(".bubble");
  currentAssistant = { msg: { data, bubble } };
  scrollToEnd();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages
          .filter((msg) => !msg.error && typeof msg.content === "string")
          .slice(0, -1)
          .map((msg) => ({ role: msg.role, content: msg.content })),
      }),
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || `HTTP ${res.status}`);
    }
    if (!res.body) throw new Error("Server nggak mengirim stream.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const line = part.split("\n").find((row) => row.startsWith("data:"));
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }

        if (event.type === "delta") {
          data.content += event.text;
          refreshCurrent();
        } else if (event.type === "tool_start") {
          data.tools.push({ name: event.name, args: event.args, pending: true });
          refreshCurrent();
        } else if (event.type === "tool_result") {
          const tool = data.tools.find((item) => item.name === event.name && item.pending);
          if (tool) {
            tool.ok = event.ok;
            tool.preview = event.preview;
            delete tool.pending;
          }
          refreshCurrent();
        } else if (event.type === "error") {
          data.error = event.message;
          refreshCurrent();
        }
      }
    }
  } catch (error) {
    data.error = error.message || "Gagal ngobrol sama AI.";
    refreshCurrent();
  } finally {
    currentAssistant = null;
    setStreaming(false);
    persist();
    if (!data.content && !data.error && data.tools.length === 0) {
      data.error = "Nggak ada jawaban dari AI. Coba lagi.";
      refreshCurrent();
    }
  }
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  send();
});

els.input.addEventListener("input", autoGrow);
els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    send();
  }
});

els.clear.addEventListener("click", () => {
  messages = [];
  persist();
  renderAll();
  els.input.focus();
});

renderSuggestions();
renderAll();
loadInfo();
els.input.focus();
