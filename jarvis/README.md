# Jarvis lokal — asisten pribadi di PC lo

Chat ala Jarvis yang **jalan di komputer lo sendiri** dan bisa benar-benar
mengakses isi PC: lihat folder, baca/tulis file, cari file/teks, jalankan
PowerShell, dan buka aplikasi. Tanpa dependency npm. Butuh Node.js 18+.

Preview di cloud cuma nampilin tampilan chat-nya. Akses PC baru hidup kalau
lo jalanin ini di komputer lo.

## Jalankan (Windows)

```bat
cd jarvis
copy .env.example .env.local
```

Buka `.env.local`, isi **satu** API key gratis:

| Provider | Free tier | Ambil key |
| --- | --- | --- |
| Groq | 30 req/menit, 1.000/hari | https://console.groq.com/keys |
| Google Gemini | free tier per project | https://aistudio.google.com/apikey |
| OpenRouter | model `:free`, 50/hari | https://openrouter.ai/keys |

Lalu:

```bat
node server.mjs
```

Buka `http://127.0.0.1:8788`. Server sengaja cuma listen di localhost.

## Yang bisa dilakuin agent

| Tool | Fungsi |
| --- | --- |
| `list_dir` | isi folder, rekursif sampai 3 level |
| `read_file` | baca file teks, bisa pilih baris |
| `write_file` | buat/timpa file, folder otomatis dibuat |
| `search_files` | cari nama file atau teks di dalam file |
| `run_command` | jalankan perintah PowerShell (timeout 30 detik) |
| `system_info` | OS, user, RAM, CPU, drive, waktu |
| `open_path` | buka file/folder/URL di aplikasi default |

## Pengaman yang tetap aktif

Walau mode akses penuh, server memblokir: `format`, `diskpart`, `bcdedit`,
`vssadmin delete`, `cipher /w`, `shutdown`/`restart`, `reg delete HKLM`,
`net user`, `rm -rf /`, pipe ke shell, dan PowerShell `-EncodedCommand`.
Nulis ke `C:\Windows`, `C:\Program Files`, dan `C:\ProgramData` juga ditolak.
Semua tool call ditampilkan di chat dan dicatat di terminal.

## Test

```bat
node selftest.mjs
```

## Catatan

- Riwayat chat disimpan di `localStorage` browser lo, bukan di server.
- Karena pakai free tier, prompt lo bisa dipakai untuk training oleh provider.
  Jangan kirim data sensitif kalau nggak nyaman.
- Butuh akses dari HP di jaringan yang sama? Ganti `HOST` di `server.mjs`
  jadi `0.0.0.0` — tapi sadar risikonya: siapa pun di WiFi itu bisa akses PC lo.
