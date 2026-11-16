import "./style.css";

const STORAGE_KEY = "jadwal-harian-v1";

const DAYS = [
  { key: "senin", label: "Senin" },
  { key: "selasa", label: "Selasa" },
  { key: "rabu", label: "Rabu" },
  { key: "kamis", label: "Kamis" },
  { key: "jumat", label: "Jumat" },
  { key: "sabtu", label: "Sabtu" },
  { key: "minggu", label: "Minggu" },
];

const CATEGORIES = {
  kerja: { label: "Kerja", color: "var(--kerja)" },
  belajar: { label: "Belajar", color: "var(--belajar)" },
  olahraga: { label: "Olahraga", color: "var(--olahraga)" },
  istirahat: { label: "Istirahat", color: "var(--istirahat)" },
  pribadi: { label: "Pribadi", color: "var(--pribadi)" },
  lainnya: { label: "Lainnya", color: "var(--lainnya)" },
};

let idCounter = 0;
const nextId = () => `a${Date.now().toString(36)}${(idCounter++).toString(36)}`;

const RAW_WEEK = {
  senin: [
    ["06:00", "Bangun, ibadah, minum air", "pribadi"],
    ["06:30", "Olahraga pagi / stretching", "olahraga"],
    ["07:30", "Mandi & sarapan", "pribadi"],
    ["08:30", "Cek agenda & rencanain hari ini", "kerja"],
    ["09:00", "Deep work: coding tanpa distraksi", "kerja"],
    ["12:00", "Ishoma & scroll santai", "istirahat"],
    ["13:30", "Meeting / kolaborasi tim", "kerja"],
    ["15:30", "Rapihin PR & balas chat", "kerja"],
    ["18:00", "Jalan santai / gym", "olahraga"],
    ["19:30", "Belajar hal baru", "belajar"],
    ["21:30", "Wind down: baca / nonton", "istirahat"],
    ["22:30", "Tidur", "istirahat"],
  ],
  selasa: [
    ["06:00", "Bangun, ibadah, minum air", "pribadi"],
    ["06:30", "Jogging ringan", "olahraga"],
    ["07:30", "Mandi & sarapan", "pribadi"],
    ["09:00", "Deep work: fitur utama", "kerja"],
    ["12:00", "Ishoma", "istirahat"],
    ["13:30", "Review kode / testing", "kerja"],
    ["16:00", "Belajar 1 bab materi", "belajar"],
    ["18:30", "Olahraga ringan", "olahraga"],
    ["20:00", "Waktu bebas / keluarga", "pribadi"],
    ["22:30", "Tidur", "istirahat"],
  ],
  rabu: [
    ["06:00", "Bangun, ibadah, minum air", "pribadi"],
    ["06:30", "Olahraga pagi", "olahraga"],
    ["07:30", "Mandi & sarapan", "pribadi"],
    ["09:00", "Deep work: lanjut project", "kerja"],
    ["12:00", "Ishoma", "istirahat"],
    ["13:30", "Sync tim & unblocking", "kerja"],
    ["15:30", "Rapihin dokumentasi", "kerja"],
    ["19:00", "Belajar / baca artikel teknis", "belajar"],
    ["21:00", "Nonton santai", "istirahat"],
    ["22:30", "Tidur", "istirahat"],
  ],
  kamis: [
    ["06:00", "Bangun, ibadah, minum air", "pribadi"],
    ["06:30", "Olahraga pagi / gym", "olahraga"],
    ["07:30", "Mandi & sarapan", "pribadi"],
    ["09:00", "Deep work: coding", "kerja"],
    ["12:00", "Ishoma", "istirahat"],
    ["13:30", "Meeting client / demo", "kerja"],
    ["16:00", "Beresin bug & PR kecil", "kerja"],
    ["18:30", "Jalan sore", "olahraga"],
    ["19:30", "Belajar hal baru", "belajar"],
    ["22:30", "Tidur", "istirahat"],
  ],
  jumat: [
    ["06:00", "Bangun, ibadah, minum air", "pribadi"],
    ["07:30", "Sarapan & beres-beres", "pribadi"],
    ["09:00", "Deep work: selesaikan target minggu", "kerja"],
    ["11:30", "Weekly review & rencana minggu depan", "kerja"],
    ["13:00", "Ishoma & olahraga", "istirahat"],
    ["16:00", "Bebasin tugas kecil", "kerja"],
    ["19:00", "Hangout / me time", "pribadi"],
    ["22:30", "Tidur", "istirahat"],
  ],
  sabtu: [
    ["07:00", "Bangun santai & sarapan", "pribadi"],
    ["08:30", "Olahraga lebih lama", "olahraga"],
    ["10:00", "Beresin project pribadi", "belajar"],
    ["12:30", "Makan siang & istirahat", "istirahat"],
    ["15:00", "Jalan-jalan / ketemu teman", "pribadi"],
    ["19:00", "Nonton film / game", "istirahat"],
    ["23:00", "Tidur", "istirahat"],
  ],
  minggu: [
    ["07:30", "Bangun santai", "pribadi"],
    ["09:00", "Beresin kamar & cucian", "pribadi"],
    ["11:00", "Review target minggu lalu", "kerja"],
    ["12:30", "Makan siang", "istirahat"],
    ["14:00", "Belajar ringan / baca buku", "belajar"],
    ["17:00", "Olahraga sore", "olahraga"],
    ["19:30", "Siapin rencana Senin", "kerja"],
    ["22:00", "Wind down & tidur", "istirahat"],
  ],
};

const defaultWeek = () =>
  Object.fromEntries(
    Object.entries(RAW_WEEK).map(([day, items]) => [
      day,
      items.map(([time, title, category]) => ({ time, title, category })),
    ]),
  );

const seed = () => {
  const week = defaultWeek();
  const out = {};
  for (const day of DAYS) {
    out[day.key] = week[day.key].map((item) => ({
      id: nextId(),
      time: item.time,
      title: item.title,
      category: item.category,
      done: false,
    }));
  }
  return out;
};

const load = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw);
    const out = {};
    for (const day of DAYS) {
      const items = Array.isArray(parsed?.[day.key]) ? parsed[day.key] : [];
      out[day.key] = items
        .filter((item) => item && typeof item.title === "string" && typeof item.time === "string")
        .map((item) => ({
          id: item.id || nextId(),
          time: item.time,
          title: item.title,
          category: CATEGORIES[item.category] ? item.category : "lainnya",
          done: Boolean(item.done),
        }));
    }
    return out;
  } catch {
    return seed();
  }
};

const todayKey = () => {
  const index = new Date().getDay(); // 0 = Minggu
  return DAYS[(index + 6) % 7].key;
};

const state = {
  activeDay: todayKey(),
  data: load(),
};

const els = {
  days: document.getElementById("days"),
  timeline: document.getElementById("timeline"),
  empty: document.getElementById("emptyState"),
  dayTitle: document.getElementById("dayTitle"),
  daySub: document.getElementById("daySub"),
  progressText: document.getElementById("progressText"),
  progressBar: document.getElementById("progressBar"),
  form: document.getElementById("addForm"),
  start: document.getElementById("startInput"),
  title: document.getElementById("titleInput"),
  category: document.getElementById("categoryInput"),
  reset: document.getElementById("resetBtn"),
  todayLabel: document.getElementById("todayLabel"),
};

const save = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  } catch {
    /* storage penuh atau dimatikan: jadwal tetap jalan di sesi ini */
  }
};

const dateLabel = () => {
  return new Date().toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
};

const renderDays = () => {
  els.days.replaceChildren();
  for (const day of DAYS) {
    const items = state.data[day.key] || [];
    const unfinished = items.filter((item) => !item.done).length;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day";
    btn.setAttribute("aria-pressed", String(day.key === state.activeDay));
    btn.textContent = day.label;
    if (items.length > 0 && unfinished > 0) {
      const dot = document.createElement("span");
      dot.className = "dot";
      btn.append(dot);
    }
    btn.addEventListener("click", () => {
      state.activeDay = day.key;
      render();
    });
    els.days.append(btn);
  }
};

const checkIcon = () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M2 6.2 4.7 9 10 3.2");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
};

const renderTimeline = () => {
  const items = [...(state.data[state.activeDay] || [])].sort((a, b) =>
    a.time.localeCompare(b.time),
  );
  const day = DAYS.find((d) => d.key === state.activeDay);
  const doneCount = items.filter((item) => item.done).length;

  els.dayTitle.textContent = day ? day.label : "";
  els.daySub.textContent =
    items.length === 0
      ? "Kosong, belum ada rencana."
      : `${items.length} kegiatan${items.length === doneCount ? " — semua beres!" : ""}`;
  els.progressText.textContent = `${doneCount}/${items.length}`;
  els.progressBar.style.width = items.length ? `${(doneCount / items.length) * 100}%` : "0%";
  els.empty.hidden = items.length > 0;
  els.timeline.replaceChildren();

  for (const item of items) {
    const li = document.createElement("li");
    li.className = `slot${item.done ? " done" : ""}`;

    const check = document.createElement("button");
    check.type = "button";
    check.className = "check";
    check.setAttribute("aria-pressed", String(item.done));
    check.setAttribute("aria-label", `Tandai "${item.title}" ${item.done ? "belum" : "selesai"}`);
    check.append(checkIcon());
    check.addEventListener("click", () => {
      item.done = !item.done;
      save();
      render();
    });

    const clock = document.createElement("span");
    clock.className = "clock";
    clock.textContent = item.time;

    const body = document.createElement("div");
    body.className = "slot-body";

    const title = document.createElement("div");
    title.className = "slot-title";
    title.textContent = item.title;

    const cat = CATEGORIES[item.category] || CATEGORIES.lainnya;
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.style.setProperty("--cat", cat.color);
    tag.textContent = cat.label;

    body.append(title, tag);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Hapus "${item.title}"`);
    remove.addEventListener("click", () => {
      state.data[state.activeDay] = (state.data[state.activeDay] || []).filter(
        (row) => row.id !== item.id,
      );
      save();
      render();
    });

    li.append(clock, check, body, remove);
    els.timeline.append(li);
  }
};

const render = () => {
  renderDays();
  renderTimeline();
};

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const time = els.start.value;
  const title = els.title.value.trim();
  if (!time || !title) return;

  state.data[state.activeDay] = [
    ...(state.data[state.activeDay] || []),
    {
      id: nextId(),
      time,
      title,
      category: els.category.value,
      done: false,
    },
  ];
  save();
  els.form.reset();
  els.start.value = time;
  els.title.focus();
  render();
});

els.reset.addEventListener("click", () => {
  state.data[state.activeDay] = (state.data[state.activeDay] || []).map((item) => ({
    ...item,
    done: false,
  }));
  save();
  render();
});

els.todayLabel.textContent = dateLabel();
render();
