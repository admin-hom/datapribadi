import { readFileSync } from "node:fs";
import path from "node:path";

/** Baca .env.local lalu .env. Nilai yang sudah ada di process.env tidak ditimpa. */
export function loadEnv(dir) {
  for (const file of [".env.local", ".env"]) {
    let text;
    try {
      text = readFileSync(path.join(dir, file), "utf8");
    } catch {
      continue;
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}
