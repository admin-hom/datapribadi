import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.mjs";
import { pickProvider, streamChat } from "./ai.mjs";
import { toolCatalog, runTool, toolSummary } from "./tools.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv(ROOT);

const PORT = Number(process.env.PORT || 8788);
const HOST = "127.0.0.1"; // sengaja lokal saja
const PUBLIC_DIR = path.join(ROOT, "public");
const MAX_ROUNDS = 6;

const SYSTEM_PROMPT = `Kamu adalah Jarvis, asisten pribadi yang jalan langsung di PC Windows milik user.
Kamu punya akses penuh ke komputer ini lewat tool: lihat folder, baca file, tulis file, cari file/teks, jalankan command PowerShell, lihat info sistem, dan buka file/folder.

Aturan:
- Bahasa Indonesia santai, ringkas, langsung ke intinya. Jangan bertele-tele.
- Kalau butuh data di PC, pakai tool dulu, jangan ngarang. Kalau nggak yakin path-nya, list folder dulu.
- Sebelum ngubah/menghapus file atau ngejalanin command yang mengubah sistem, sebutkan singkat apa yang kamu lakukan (user sudah mengizinkan eksekusi otomatis).
- Setelah pakai tool, rangkum hasilnya dalam bahasa manusia, bukan dump mentah.
- Kalau tool error, jelaskan penyebabnya dan coba pendekatan lain sekali, lalu lapor kalau tetap gagal.
- Kalau user minta sesuatu yang berisiko merusak PC, tolak dan tawarkan cara yang lebih aman.
- Format jawaban pakai markdown ringan (bold, list, code block) biar kebaca.
Waktu sekarang: ${new Date().toString()}
OS: ${os.platform()} ${os.release()}, home: ${os.homedir()}

Tool yang tersedia:
${toolSummary()}`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req, limit = 1_500_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Body terlalu besar."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sanitizeHistory(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (msg) =>
        msg &&
        (msg.role === "user" || msg.role === "assistant") &&
        typeof msg.content === "string" &&
        msg.content.trim(),
    )
    .slice(-24)
    .map((msg) => ({ role: msg.role, content: msg.content.slice(0, 12_000) }));
}

async function handleChat(req, res) {
  let history;
  try {
    const raw = await readBody(req);
    history = sanitizeHistory(JSON.parse(raw || "{}").messages);
  } catch {
    return json(res, 400, { error: "Body harus JSON berisi messages." });
  }
  if (history.length === 0) return json(res, 400, { error: "Belum ada pesan." });

  const provider = pickProvider(process.env);
  if (!provider) {
    return json(res, 400, {
      error:
        "Belum ada API key. Buat file jarvis/.env.local lalu isi salah satu: GROQ_API_KEY, GEMINI_API_KEY, atau OPENROUTER_API_KEY (semuanya ada free tier).",
    });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...history];
  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const result = await streamChat({
        provider,
        messages,
        tools: toolCatalog(),
        signal: controller.signal,
        onDelta: (text) => send({ type: "delta", text }),
      });

      if (result.toolCalls.length === 0) {
        send({ type: "done", provider: provider.id, model: provider.model });
        break;
      }

      messages.push({
        role: "assistant",
        content: result.content || null,
        tool_calls: result.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments || "{}" },
        })),
      });

      for (const call of result.toolCalls) {
        send({ type: "tool_start", id: call.id, name: call.name, args: call.arguments });
        const outcome = await runTool(call.name, call.arguments);
        console.log(
          `[tool] ${call.name} ${outcome.ok ? "ok" : "gagal"} :: ${(outcome.output || outcome.error || "").slice(0, 120).replace(/\s+/g, " ")}`,
        );
        send({
          type: "tool_result",
          id: call.id,
          name: call.name,
          ok: outcome.ok,
          preview: String(outcome.output || outcome.error || "").slice(0, 700),
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(outcome).slice(0, 20_000),
        });
      }

      if (round === MAX_ROUNDS - 1) {
        send({ type: "error", message: "Batas langkah agent tercapai. Coba minta lebih spesifik." });
      }
    }
  } catch (error) {
    if (controller.signal.aborted) return res.end();
    send({ type: "error", message: error.message || "Terjadi error." });
  } finally {
    res.end();
  }
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.join(PUBLIC_DIR, relative);
  if (!target.startsWith(PUBLIC_DIR)) return json(res, 403, { error: "Forbidden" });
  try {
    const data = await readFile(target);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Nggak ditemukan.");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/api/info") {
      const provider = pickProvider(process.env);
      return json(res, 200, {
        ready: Boolean(provider),
        provider: provider?.id || null,
        model: provider?.model || null,
        os: `${os.platform()} ${os.release()}`,
        hostname: os.hostname(),
        user: os.userInfo().username,
        home: os.homedir(),
      });
    }
    if (url.pathname === "/api/chat" && req.method === "POST") return handleChat(req, res);
    if (req.method === "GET") return serveStatic(req, res, url.pathname);
    return json(res, 405, { error: "Method nggak didukung." });
  } catch (error) {
    if (!res.headersSent) json(res, 500, { error: error.message || "Server error." });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  const provider = pickProvider(process.env);
  console.log("");
  console.log("  JARVIS LOKAL");
  console.log(`  Buka: http://${HOST}:${PORT}`);
  console.log(`  PC  : ${os.hostname()} (${os.userInfo().username})`);
  console.log(
    provider
      ? `  AI  : ${provider.label} · ${provider.model}`
      : "  AI  : belum ada API key (isi jarvis/.env.local)",
  );
  console.log("  Cuma bisa diakses dari komputer ini (127.0.0.1).");
  console.log("");
});
