import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const IS_WIN = process.platform === "win32";
const MAX_READ = 200 * 1024;
const MAX_WRITE = 200 * 1024;
const MAX_RESULTS = 200;
const SEARCH_DEADLINE = 15_000;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "$recycle.bin",
  "system volume information",
  "windows",
  "program files",
  "program files (x86)",
  "programdata",
]);
const CMD_TIMEOUT = 30_000;
const OUTPUT_LIMIT = 8000;

/** Hal-hal yang nggak boleh dijalankan walau mode akses penuh. */
const BLOCKED_COMMANDS = [
  { label: "format drive", re: /\bformat(?:\.com)?\s+[a-z]:/i },
  { label: "mkfs", re: /\bmkfs(?:\.| )/i },
  { label: "diskpart", re: /\bdiskpart\b/i },
  { label: "bcdedit", re: /\bbcdedit\b/i },
  { label: "hapus shadow copy", re: /\bvssadmin\s+delete\b/i },
  { label: "wipe free space", re: /\bcipher\s+\/w\b/i },
  { label: "rm -rf root", re: /\brm\s+-[a-z]*r[a-z]*f?\s+\/(?:\s|$)/i },
  { label: "hapus isi drive", re: /\b(?:del|rd|rmdir|remove-item)\b[^\n]*(?:\s[a-z]:[\\/](?:\s|$|\*))/i },
  { label: "matikan / restart PC", re: /\b(?:shutdown|restart-computer|stop-computer)\b/i },
  { label: "hapus registry HKLM", re: /\breg(?:\.exe)?\s+delete\s+hklm/i },
  { label: "ubah akun user", re: /\bnet\s+user\b/i },
  { label: "pipe ke shell", re: /\b(?:curl|wget|iwr|invoke-webrequest)\b[^\n]*\|\s*(?:sh|bash|iex|powershell)/i },
  { label: "powershell encoded", re: /-(?:enc|encodedcommand)\b/i },
];

const BLOCKED_WRITE_ROOTS = [
  "c:\\windows",
  "c:\\program files",
  "c:\\program files (x86)",
  "c:\\programdata",
];

function expand(target) {
  if (!target || target === "~") return os.homedir();
  let p = target;
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) {
    p = path.join(os.homedir(), p.slice(2));
  }
  return path.resolve(p);
}

function clip(text, limit = OUTPUT_LIMIT) {
  const str = String(text ?? "");
  if (str.length <= limit) return str;
  return `${str.slice(0, limit)}\n… (dipotong ${str.length - limit} karakter)`;
}

function blockedCommand(command) {
  return BLOCKED_COMMANDS.find((rule) => rule.re.test(command)) || null;
}

function isProtectedWrite(target) {
  if (!IS_WIN) return false;
  const lower = target.toLowerCase();
  return BLOCKED_WRITE_ROOTS.some(
    (root) => lower === root || lower.startsWith(`${root}\\`),
  );
}

async function listDir({ dir, depth = 1 }) {
  const root = expand(dir);
  const maxDepth = Math.min(Math.max(Number(depth) || 1, 1), 3);
  const lines = [];

  async function walk(current, level) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      lines.push(`${current}  -> ERROR: ${error.message}`);
      return;
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()));
    for (const entry of entries.slice(0, MAX_RESULTS)) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        lines.push(`${full}${path.sep}`);
        if (level < maxDepth) await walk(full, level + 1);
      } else {
        let size = "";
        try {
          const stat = await fs.stat(full);
          size = `  (${formatSize(stat.size)})`;
        } catch {
          size = "";
        }
        lines.push(`${full}${size}`);
      }
    }
    if (entries.length > MAX_RESULTS) {
      lines.push(`… dan ${entries.length - MAX_RESULTS} item lain di ${current}`);
    }
  }

  await walk(root, 1);
  return lines.join("\n") || "(folder kosong)";
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function readFile({ path: target, start_line = 1, max_lines = 400 }) {
  const file = expand(target);
  const stat = await fs.stat(file);
  if (stat.size > MAX_READ) {
    throw new Error(
      `File ${formatSize(stat.size)} terlalu besar untuk dibaca langsung (batas ${formatSize(MAX_READ)}). Pakai search_files atau baca sebagian.`,
    );
  }
  const text = await fs.readFile(file, "utf8");
  const lines = text.split(/\r?\n/);
  const start = Math.max(Number(start_line) || 1, 1) - 1;
  const count = Math.min(Math.max(Number(max_lines) || 400, 1), 2000);
  const slice = lines.slice(start, start + count);
  return `${lines.length} baris total. Menampilkan baris ${start + 1}-${start + slice.length} dari ${file}:\n\n${slice.join("\n")}`;
}

async function writeFile({ path: target, content }) {
  const file = expand(target);
  if (isProtectedWrite(file)) {
    throw new Error(`Menulis ke folder sistem diblokir: ${file}`);
  }
  const text = String(content ?? "");
  if (text.length > MAX_WRITE) {
    throw new Error(`Isi file terlalu besar (${formatSize(text.length)}, batas ${formatSize(MAX_WRITE)}).`);
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, "utf8");
  return `OK, ${text.length} karakter ditulis ke ${file}`;
}

async function searchFiles({ query, root, mode = "name" }) {
  const needle = String(query || "").trim();
  if (!needle) throw new Error("query kosong");
  const start = expand(root);
  const hits = [];
  const needleLower = needle.toLowerCase();
  const deadline = Date.now() + SEARCH_DEADLINE;
  let stoppedEarly = false;

  async function walk(current, level) {
    if (hits.length >= MAX_RESULTS) return;
    if (Date.now() > deadline) {
      stoppedEarly = true;
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= MAX_RESULTS) return;
      if (entry.name.startsWith(".") && entry.name !== needle) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (level < 7 && !SKIP_DIRS.has(entry.name.toLowerCase())) {
          await walk(full, level + 1);
        }
        continue;
      }
      if (mode === "name") {
        if (entry.name.toLowerCase().includes(needleLower)) hits.push(full);
        continue;
      }
      try {
        const stat = await fs.stat(full);
        if (stat.size > 1024 * 1024) continue;
        const text = await fs.readFile(full, "utf8");
        const index = text.toLowerCase().indexOf(needleLower);
        if (index !== -1) {
          const lineNo = text.slice(0, index).split(/\r?\n/).length;
          const line = text.split(/\r?\n/)[lineNo - 1]?.trim().slice(0, 160) || "";
          hits.push(`${full}:${lineNo}  ${line}`);
        }
      } catch {
        /* biner atau nggak bisa dibaca */
      }
    }
  }

  await walk(start, 1);
  const note = stoppedEarly
    ? `\n\n(Pencarian dihentikan setelah ${SEARCH_DEADLINE / 1000} detik — coba persempit root atau query.)`
    : "";
  if (hits.length === 0) return `Nggak ada hasil untuk "${needle}" di ${start}.${note}`;
  return `${hits.length} hasil untuk "${needle}" di ${start}:\n${hits.join("\n")}${note}`;
}

async function runCommand({ command, cwd }) {
  const cmd = String(command || "").trim();
  if (!cmd) throw new Error("command kosong");
  const blocked = blockedCommand(cmd);
  if (blocked) throw new Error(`Diblokir oleh pengaman: ${blocked.label}`);

  const workdir = cwd ? expand(cwd) : os.homedir();
  try {
    const { stdout, stderr } = IS_WIN
      ? await execFileAsync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", cmd],
          { cwd: workdir, timeout: CMD_TIMEOUT, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
        )
      : await execFileAsync("/bin/sh", ["-c", cmd], {
          cwd: workdir,
          timeout: CMD_TIMEOUT,
          maxBuffer: 4 * 1024 * 1024,
        });
    return `exit 0\n${clip(stdout)}${stderr ? `\n[stderr]\n${clip(stderr)}` : ""}`;
  } catch (error) {
    const out = clip(error.stdout || "");
    const err = clip(error.stderr || error.message || "");
    return `exit ${error.code ?? 1}\n${out}${err ? `\n[stderr]\n${err}` : ""}`;
  }
}

async function systemInfo() {
  const drives = await runCommand({
    command: IS_WIN
      ? "Get-PSDrive -PSProvider FileSystem | Select-Object Name,@{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}},@{n='UsedGB';e={[math]::Round($_.Used/1GB,1)}} | Format-Table -AutoSize | Out-String"
      : "df -h",
  });
  return [
    `OS: ${os.platform()} ${os.release()} (${process.arch})`,
    `Komputer: ${os.hostname()}`,
    `User: ${os.userInfo().username}`,
    `Home: ${os.homedir()}`,
    `Folder kerja agent: ${process.cwd()}`,
    `CPU: ${os.cpus().length} core`,
    `RAM total: ${formatSize(os.totalmem())} | bebas: ${formatSize(os.freemem())}`,
    `Uptime: ${(os.uptime() / 3600).toFixed(1)} jam`,
    `Waktu: ${new Date().toString()}`,
    `\nDrive:\n${drives}`,
  ].join("\n");
}

async function openPath({ target }) {
  const full = expand(target);
  if (IS_WIN) {
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", `Start-Process '${full.replace(/'/g, "''")}'`], {
      timeout: 10_000,
      windowsHide: true,
    });
  } else {
    await execFileAsync(process.platform === "darwin" ? "open" : "xdg-open", [full], { timeout: 10_000 });
  }
  return `Dibuka: ${full}`;
}

const TOOL_DEFS = {
  list_dir: {
    describe: "Lihat isi folder (rekursif sampai depth 3).",
    params: { dir: "string (opsional, default home)", depth: "number 1-3" },
    run: listDir,
  },
  read_file: {
    describe: "Baca isi file teks, bisa pilih rentang baris.",
    params: { path: "string", start_line: "number", max_lines: "number" },
    run: ({ path: target, start_line, max_lines }) => readFile({ path: target, start_line, max_lines }),
  },
  write_file: {
    describe: "Tulis/buat/timpa file teks (folder dibuat otomatis).",
    params: { path: "string", content: "string" },
    run: ({ path: target, content }) => writeFile({ path: target, content }),
  },
  search_files: {
    describe: "Cari file berdasarkan nama, atau cari teks di dalam file.",
    params: { query: "string", root: "string (opsional)", mode: "'name' | 'content'" },
    run: searchFiles,
  },
  run_command: {
    describe: "Jalankan command shell di PC (PowerShell di Windows), timeout 30 detik.",
    params: { command: "string", cwd: "string (opsional)" },
    run: runCommand,
  },
  system_info: {
    describe: "Info PC: OS, user, RAM, CPU, drive, waktu.",
    params: {},
    run: systemInfo,
  },
  open_path: {
    describe: "Buka file/folder/URL dengan aplikasi default.",
    params: { target: "string" },
    run: openPath,
  },
};

export const toolCatalog = () =>
  Object.entries(TOOL_DEFS).map(([name, def]) => ({
    type: "function",
    function: {
      name,
      description: def.describe,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(def.params).map(([key, hint]) => [key, { type: "string", description: hint }]),
        ),
        required: name === "read_file" ? ["path"] : name === "write_file" ? ["path", "content"] : name === "search_files" ? ["query"] : name === "run_command" ? ["command"] : [],
        additionalProperties: false,
      },
    },
  }));

export async function runTool(name, rawArgs) {
  const def = TOOL_DEFS[name];
  if (!def) return { ok: false, error: `Tool "${name}" nggak dikenal.` };
  let args = {};
  if (typeof rawArgs === "string") {
    try {
      args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
    } catch {
      return { ok: false, error: "Argumen tool bukan JSON yang valid." };
    }
  } else {
    args = rawArgs || {};
  }
  try {
    const output = await def.run(args);
    return { ok: true, output: clip(output) };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

export const toolSummary = () =>
  Object.entries(TOOL_DEFS).map(([name, def]) => `- ${name}(${Object.keys(def.params).join(", ")}): ${def.describe}`).join("\n");

export { blockedCommand, IS_WIN };
