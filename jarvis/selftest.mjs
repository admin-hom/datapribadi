import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runTool, blockedCommand } from "./tools.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;

const show = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` :: ${detail}` : ""}`);
};

const call = (name, args) => runTool(name, JSON.stringify(args));
const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-selftest-"));

try {
  const list = await call("list_dir", { dir: here });
  show("list_dir", list.ok && list.output.includes("server.mjs"));

  const target = path.join(sandbox, "catatan", "hari-ini.txt");
  const write = await call("write_file", { path: target, content: "halo jarvis\nbaris kedua\n" });
  show("write_file", write.ok);

  const read = await call("read_file", { path: target });
  show("read_file", read.ok && read.output.includes("baris kedua"));

  const byName = await call("search_files", { query: "hari-ini", root: sandbox, mode: "name" });
  show("search_files (name)", byName.ok && byName.output.includes("hari-ini.txt"));

  const byContent = await call("search_files", { query: "baris kedua", root: sandbox, mode: "content" });
  show("search_files (content)", byContent.ok && byContent.output.includes("hari-ini.txt:2"));

  const missing = await call("read_file", { path: path.join(sandbox, "gak-ada.txt") });
  show("error file hilang ditangani", missing.ok === false);

  const cmd = await call("run_command", { command: "echo hai" });
  show("run_command", cmd.ok && /hai/.test(cmd.output));

  for (const dangerous of ["format c:", "diskpart", "shutdown /s /t 0", "rm -rf /", "bcdedit"]) {
    show(`blocklist "${dangerous}"`, Boolean(blockedCommand(dangerous)));
  }
  show("command biasa nggak diblokir", blockedCommand("dir C:\\Users") === null);

  if (process.platform === "win32") {
    const protectedWrite = await call("write_file", {
      path: "C:\\Windows\\jarvis-test.txt",
      content: "x",
    });
    show("tolak tulis ke C:\\Windows", protectedWrite.ok === false);
  }

  const info = await call("system_info", {});
  show("system_info", info.ok && info.output.includes("OS:"));
} finally {
  await fs.rm(sandbox, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nSemua test lolos." : `\n${failures} test gagal.`);
process.exit(failures === 0 ? 0 : 1);
