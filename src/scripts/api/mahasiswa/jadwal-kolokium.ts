// src/scripts/api/mahasiswa/jadwal-kolokium.ts
// Logic untuk halaman "Jadwal Kolokium" (role: mahasiswa):
// 1) fetch daftar kolokium yang approved (GET /auth/kolokium?status=approved&search=...&per_page=...)
// 2) fetch status kehadiran mahasiswa login, SISI PESERTA:
//    kolokium yang saya ikuti + status kehadiran saya
//    (GET /auth/peserta-kolokium/my-kolokium)
// 3) render tabel + pagination dari Laravel paginator
// 4) tombol "Kehadiran" punya 4 state:
//    - Belum pernah ada record PesertaKolokium sama sekali -> tombol "Hadir"
//      (POST /peserta-kolokium, status dibuat "hadir")
//    - Record ada tapi status "batal" -> tombol "Hadir Ulang"
//      (PATCH /peserta-kolokium/{id}/status, status diubah jadi "hadir")
//    - Record ada dan status "hadir" -> TIDAK ADA tombol apapun, cuma badge "Hadir"
//    - Tanggal kolokium SUDAH LEWAT (dan belum/sedang batal, bukan status
//      "hadir") -> tombol "Hadir"/"Hadir Ulang" tetap tampil tapi disabled,
//      abu-abu, cursor jadi ikon "block" saat hover (bawaan browser dari
//      kombinasi disabled + cursor-not-allowed).
// 5) SEARCH: disamakan polanya dengan admin & dosen — dikirim ke backend lewat
//    query param `search` (di-debounce), BUKAN cuma filter di data yang sedang
//    tampil di halaman itu.
// 6) "show entries" (select #entries-per-page) sekarang dikirim ke backend
//    lewat query param `per_page` (backend KolokiumController::index sudah
//    validasi min:1|max:100, default 10). Tidak lagi slicing client-side.
//
// KONFIRMASI HADIR / HADIR ULANG: menggunakan ConfirmModal
// (src/components/ConfirmModal.astro) lewat helper confirmDialog() di
// src/scripts/lib/confirm-dialog.ts, bukan window.confirm() bawaan browser.
// Bukan aksi destruktif (masih bisa dibatalkan lewat halaman Kartu Kolokium
// selama belum hari-H), jadi pakai variant "primary" (biru), bukan "danger".
//
// TAMPILAN KOLOM (mengikuti pola yang sama dengan tabel admin & dosen):
// - Kolom Nama/NIM/Prodi digabung jadi satu kolom "Pemrasaran": nama (bold)
//   di baris atas, lalu "NIM · Prodi" di baris bawah dengan teks lebih kecil.
// - Kolom Judul dipotong beberapa kata saja, dengan tombol untuk
//   menampilkan/menyembunyikan teks lengkap LANGSUNG di dalam sel yang sama
//   (tanpa modal) — klik tombol lagi untuk mempersingkat kembali.
// - Kolom Dosen Pembimbing selalu ditampilkan penuh apa adanya, tanpa
//   dipotong dan tanpa tombol.
// - Sel-sel tidak dipaksa satu baris (whitespace-nowrap dihapus dari sel
//   berisi teks panjang) supaya baris melebar ke bawah, bukan ke samping,
//   saat teks tidak muat. Kolom Kehadiran tetap seperti semula.

import { confirmDialog } from "../../lib/confirm-dialog";

const API_BASE: string = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token";
const SEARCH_DEBOUNCE_MS = 400;
const DEFAULT_PER_PAGE = 10;
const COLSPAN = 10;
const JUDUL_WORD_LIMIT = 4;

// ------------------------------------------------------------------
// Tipe data (disesuaikan dengan KolokiumController & PesertaKolokiumController)
// ------------------------------------------------------------------
type StatusPengajuan = "pending" | "approved" | "rejected";
type StatusPeserta = "hadir" | "batal";

interface UserProfil {
  id: number;
  nama: string;
  nim?: string | null;
  prodi?: string | null;
  role: "mahasiswa" | "dosen" | "admin";
}

type ProfilResponse = UserProfil | { user: UserProfil } | { data: UserProfil };

interface Kolokium {
  id: number;
  mahasiswa_id: number;
  nama: string;
  nim: string;
  prodi: string;
  namadosenpembimbing: string | null;
  moderator_id: number | null;
  judul: string;
  lokasi: string | null;
  tanggal: string | null;
  waktu: string | null;
  namadosenmoderator: string | null;
  ruangan: string | null;
  status: StatusPengajuan;
  jumlahforum: number;
}

interface LaravelPaginator<T> {
  current_page: number;
  data: T[];
  from: number | null;
  last_page: number;
  per_page: number;
  to: number | null;
  total: number;
}

// Record ringkas status kehadiran milik saya untuk satu kolokium
// (di-derive dari response /auth/peserta-kolokium/my-kolokium)
interface MyPesertaStatus {
  id: number; // peserta_kolokium_id
  kolokium_id: number;
  status: StatusPeserta;
}

// SISI PESERTA: kolokium yang saya ikuti + peserta_kolokium_id & status_kehadiran saya
// GET /auth/peserta-kolokium/my-kolokium
// Response backend:
// {
//   "message": "...",
//   "kolokiums": [
//     {
//       "id": 5,                         <- kolokium_id
//       "peserta_kolokium_id": 5,        <- dipakai sebagai key untuk PATCH status
//       "status_kehadiran": "hadir",     <- status kehadiran saya
//       ...
//     }
//   ]
// }
interface MyKolokiumPesertaItem {
  id: number;                    // kolokium_id
  peserta_kolokium_id: number;   // dipakai sebagai target PATCH /peserta-kolokium/{id}/status
  status_kehadiran: StatusPeserta;
}

interface MyKolokiumPesertaResponse {
  message: string;
  kolokiums: MyKolokiumPesertaItem[];
}

interface StorePesertaKolokiumResponse {
  message: string;
  peserta_kolokium: {
    id: number;
    kolokium_id: number;
    mahasiswa_id: number;
    status: StatusPeserta;
  };
  jumlahforum: number;
}

interface ApiErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

// ------------------------------------------------------------------
// State halaman
// ------------------------------------------------------------------
let currentUser: UserProfil | null = null;
let currentPage = 1;
let currentSearch = "";
let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
let lastPaginator: LaravelPaginator<Kolokium> | null = null;
let currentKolokiums: Kolokium[] = [];
// map kolokium_id -> status kehadiran saya (kalau pernah ada record)
let myPesertaMap: Map<number, MyPesertaStatus> = new Map();

// ------------------------------------------------------------------
// Helper fetch
// ------------------------------------------------------------------
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token ?? ""}`,
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 401) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.href = "/";
    return null;
  }

  const json = await res.json();

  if (!res.ok) {
    const err = json as ApiErrorResponse;
    throw new Error(err.message ?? `Request ke ${path} gagal (status ${res.status})`);
  }

  return json as T;
}

function extractUser(json: ProfilResponse): UserProfil {
  if ("user" in json) return json.user;
  if ("data" in json) return json.data;
  return json;
}

function getEntriesPerPage(): number {
  const select = document.getElementById("entries-per-page") as HTMLSelectElement | null;
  const value = select ? parseInt(select.value, 10) : DEFAULT_PER_PAGE;
  return Number.isNaN(value) || value < 1 ? DEFAULT_PER_PAGE : value;
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

// ------------------------------------------------------------------
// Pesan status
// ------------------------------------------------------------------
function showMessage(text: string, variant: "success" | "error"): void {
  const el = document.getElementById("jadwal-message");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden", "bg-green-100", "text-green-800", "bg-red-100", "text-red-800");
  if (variant === "success") {
    el.classList.add("bg-green-100", "text-green-800");
  } else {
    el.classList.add("bg-red-100", "text-red-800");
  }
}

function clearMessage(): void {
  const el = document.getElementById("jadwal-message");
  if (!el) return;
  el.classList.add("hidden");
  el.textContent = "";
}

// ------------------------------------------------------------------
// Format tanggal & waktu untuk tampilan
// ------------------------------------------------------------------
function formatTanggal(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value); // parse UTC → lokal browser
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function todayLocalISO(): string {
  // Pakai date lokal browser (bukan UTC) supaya konsisten dengan
  // konversi tanggal dari backend yang di-parse ke lokal di bawah.
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Konversi tanggal dari backend (bisa berupa string UTC seperti
// "2026-07-30T17:00:00.000000Z") ke tanggal lokal browser (WIB),
// lalu format ke "YYYY-MM-DD". Ini penting karena backend menyimpan
// tanggal sebagai UTC, tapi secara semantik tanggalnya adalah tanggal
// lokal (30 Juli UTC+7 = "2026-07-30T17:00:00.000000Z" dalam UTC).
// Slice langsung dari string UTC akan menghasilkan tanggal yang salah
// (kelihatan "2026-07-30" padahal di WIB sudah masuk 31 Juli, atau
// sebaliknya seperti kasus ini: backend kirim "2026-07-30T17:00:00Z"
// tapi user WIB membacanya sebagai 31 Juli jam 00:00).
function toLocalDateISO(tanggal: string): string {
  const d = new Date(tanggal); // parse UTC string ke objek Date lokal
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Sudah hari H atau lewat (>=)? Dipakai buat nge-disable tombol Hadir/Hadir
// Ulang — konsisten dengan validasi backend (PesertaKolokiumController)
// yang juga menolak pendaftaran mulai hari H itu sendiri.
function isTanggalLewat(tanggal: string | null): boolean {
  if (!tanggal) return false;
  const tanggalLokal = toLocalDateISO(tanggal);
  return tanggalLokal <= todayLocalISO();
}

// ------------------------------------------------------------------
// SEL "PEMRASARAN" (gabungan Nama / NIM / Prodi)
// ------------------------------------------------------------------
function renderPemrasaranCell(kolokium: Kolokium): string {
  const nama = escapeHtml(kolokium.nama ?? "-");
  const nim = escapeHtml(kolokium.nim ?? "-");
  const prodi = escapeHtml(kolokium.prodi ?? "-");
  return `
    <div class="leading-snug">
      <div class="text-body-sm font-bold text-on-surface">${nama}</div>
      <div class="text-xs text-on-surface-variant mt-0.5">${nim} · ${prodi}</div>
    </div>
  `;
}

// ------------------------------------------------------------------
// SEL JUDUL: dipotong sebagian kata + tombol untuk membuka teks
// lengkap LANGSUNG DI DALAM BARIS (tanpa modal).
// ------------------------------------------------------------------
function truncateWords(text: string, wordLimit: number): { truncated: string; isTruncated: boolean } {
  const words = text.trim().split(/\s+/);
  if (words.length <= wordLimit) {
    return { truncated: text, isTruncated: false };
  }
  return { truncated: `${words.slice(0, wordLimit).join(" ")}...`, isTruncated: true };
}

function renderJudulCell(kolokium: Kolokium): string {
  const fullText = kolokium.judul;
  if (!fullText) {
    return `<span class="text-body-sm text-on-surface">-</span>`;
  }

  const { truncated, isTruncated } = truncateWords(fullText, JUDUL_WORD_LIMIT);

  if (!isTruncated) {
    return `<span class="text-body-sm text-on-surface">${escapeHtml(fullText)}</span>`;
  }

  const safeFull = escapeHtml(fullText);
  const safeTruncated = escapeHtml(truncated);

  return `
    <div class="flex items-start gap-1.5">
      <span
        class="text-body-sm text-on-surface expandable-judul-text"
        data-full-text="${safeFull}"
        data-truncated-text="${safeTruncated}"
        data-expanded="false"
      >${safeTruncated}</span>
      <button
        type="button"
        class="judul-toggle-btn shrink-0 mt-0.5 text-primary hover:text-primary/70 transition-colors"
        title="Lihat selengkapnya"
      >
        <span class="material-symbols-outlined text-[18px]">unfold_more</span>
      </button>
    </div>
  `;
}

// Dosen pembimbing: selalu tampil penuh, tanpa dipotong dan tanpa tombol.
function renderDosenPembimbingCell(kolokium: Kolokium): string {
  const text = kolokium.namadosenpembimbing;
  if (!text) {
    return `<span class="text-body-sm text-on-surface">-</span>`;
  }
  return `<span class="text-body-sm text-on-surface">${escapeHtml(text)}</span>`;
}

// ------------------------------------------------------------------
// Muat data profil (sekali di awal, untuk tahu siapa yang login)
// ------------------------------------------------------------------
async function loadProfil(): Promise<void> {
  const json = await apiFetch<ProfilResponse>("/auth/profile");
  if (json) {
    currentUser = extractUser(json);
  }
}

// ------------------------------------------------------------------
// Muat status kehadiran mahasiswa login untuk semua kolokium
// (SISI PESERTA: kolokium yang saya ikuti + status kehadiran saya,
// termasuk yang "batal" — supaya tombol "Hadir Ulang" bisa dibangun)
// ------------------------------------------------------------------
async function loadMyPeserta(): Promise<void> {
  const json = await apiFetch<MyKolokiumPesertaResponse>("/auth/peserta-kolokium/my-kolokium");
  myPesertaMap = new Map();
  if (json?.kolokiums) {
    for (const item of json.kolokiums) {
      myPesertaMap.set(item.id, {
        id: item.peserta_kolokium_id,   // id PesertaKolokium, dipakai buat PATCH
        kolokium_id: item.id,
        status: item.status_kehadiran,
      });
    }
  }
}

// ------------------------------------------------------------------
// Muat daftar kolokium (halaman tertentu), ikut kirim `search` & `per_page`
// ------------------------------------------------------------------
async function loadKolokium(page: number): Promise<void> {
  const tbody = document.getElementById("kolokium-tbody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="${COLSPAN}" class="px-4 py-6 text-center text-body-sm text-on-surface-variant">Memuat data...</td></tr>`;
  }

  const params = new URLSearchParams({
    status: "approved",
    page: String(page),
    per_page: String(getEntriesPerPage()),
  });
  if (currentSearch) {
    params.set("search", currentSearch);
  }

  try {
    const json = await apiFetch<LaravelPaginator<Kolokium>>(`/auth/kolokium?${params.toString()}`);
    if (!json) return;

    lastPaginator = json;
    currentPage = json.current_page;
    currentKolokiums = json.data;

    await loadMyPeserta();
    renderTable();
    renderPaginationInfo();
    renderPaginationButtons();
  } catch (err) {
    console.error("Gagal memuat jadwal kolokium:", err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="${COLSPAN}" class="px-4 py-6 text-center text-body-sm text-red-700">Gagal memuat data. Coba muat ulang halaman.</td></tr>`;
    }
  }
}

// ------------------------------------------------------------------
// Render badge / tombol kolom Kehadiran — 4 state:
// 1. Belum ada record sama sekali      -> tombol "Hadir" (POST, buat baru)
// 2. Record ada, status "batal"        -> tombol "Hadir Ulang" (PATCH -> hadir)
// 3. Record ada, status "hadir"        -> tidak ada tombol, cuma badge
// 4. Tanggal kolokium sudah lewat (dan bukan status "hadir") -> tombol
//    Hadir/Hadir Ulang tetap tampil tapi disabled & abu-abu
// ------------------------------------------------------------------
function renderKehadiranCell(kolokium: Kolokium): string {
  // mahasiswa pemilik kolokium tidak bisa mendaftar jadi peserta di kolokiumnya sendiri
  if (currentUser && kolokium.mahasiswa_id === currentUser.id) {
    return `<span class="text-body-sm text-on-surface-variant italic">Kolokium Anda</span>`;
  }

  const peserta = myPesertaMap.get(kolokium.id);

  // State 3: sudah hadir -> tidak ada tombol sama sekali
  if (peserta && peserta.status === "hadir") {
    return `
      <span class="bg-secondary/10 text-secondary px-3 py-1 rounded-full text-[12px] font-bold flex items-center gap-1 w-fit">
        <span class="material-symbols-outlined text-[14px]">check_circle</span> Hadir
      </span>
    `;
  }

  const lewat = isTanggalLewat(kolokium.tanggal);
  const isHadirUlang = !!peserta && peserta.status === "batal";
  const label = isHadirUlang ? "Hadir Ulang" : "Hadir";

  // State 4: tanggal sudah lewat -> tombol disabled, abu-abu, cursor "block" saat hover
  if (lewat) {
    return `
      <button
        type="button"
        disabled
        title="Jadwal kolokium ini sudah lewat"
        class="bg-outline/20 text-on-surface-variant/60 px-3 py-1 rounded-full text-[12px] font-bold cursor-not-allowed"
      >
        ${label}
      </button>
    `;
  }

  // State 2: record ada tapi statusnya "batal" -> tombol "Hadir Ulang"
  if (isHadirUlang && peserta) {
    return `
      <button
        type="button"
        class="btn-hadir-ulang bg-primary-container text-on-primary px-3 py-1 rounded-full text-[12px] font-bold hover:bg-primary transition-colors"
        data-peserta-id="${peserta.id}"
        data-kolokium-id="${kolokium.id}"
      >
        Hadir Ulang
      </button>
    `;
  }

  // State 1: belum pernah ada record sama sekali -> tombol "Hadir" (buat baru)
  return `
    <button
      type="button"
      class="btn-hadir-baru bg-primary-container text-on-primary px-3 py-1 rounded-full text-[12px] font-bold hover:bg-primary transition-colors"
      data-kolokium-id="${kolokium.id}"
    >
      Hadir
    </button>
  `;
}

// ------------------------------------------------------------------
// Render isi tabel — search & jumlah baris sekarang sepenuhnya
// ditentukan backend (query param search & per_page), jadi di sini
// tinggal render currentKolokiums apa adanya.
// ------------------------------------------------------------------
function renderTable(): void {
  const tbody = document.getElementById("kolokium-tbody");
  if (!tbody) return;

  if (currentKolokiums.length === 0) {
    const message = currentSearch
      ? `Tidak ditemukan hasil untuk pencarian "${escapeHtml(currentSearch)}".`
      : "Tidak ada jadwal kolokium ditemukan.";
    tbody.innerHTML = `<tr><td colspan="${COLSPAN}" class="px-4 py-6 text-center text-body-sm text-on-surface-variant">${message}</td></tr>`;
    return;
  }

  const startNumber = lastPaginator?.from ?? 1;

  tbody.innerHTML = currentKolokiums
    .map(
      (kolokium, index) => `
        <tr class="table-row-hover transition-colors align-top">
          <td class="px-4 py-4 text-body-sm align-top">${startNumber + index}</td>
          <td class="px-4 py-4 align-top whitespace-nowrap">${renderKehadiranCell(kolokium)}</td>
          <td class="px-4 py-4 text-body-sm align-top break-words">${formatTanggal(kolokium.tanggal)}</td>
          <td class="px-4 py-4 text-body-sm align-top">${escapeHtml(kolokium.waktu ?? "-")}</td>
          <td class="px-4 py-4 text-body-sm align-top break-words">${escapeHtml(kolokium.ruangan ?? kolokium.lokasi ?? "-")}</td>
          <td class="px-4 py-4 align-top">${renderPemrasaranCell(kolokium)}</td>
          <td class="px-4 py-4 align-top break-words">${renderJudulCell(kolokium)}</td>
          <td class="px-4 py-4 text-body-sm text-center align-top">${kolokium.jumlahforum}</td>
          <td class="px-4 py-4 align-top break-words">${renderDosenPembimbingCell(kolokium)}</td>
          <td class="px-4 py-4 text-body-sm align-top break-words">${escapeHtml(kolokium.namadosenmoderator ?? "-")}</td>
        </tr>
      `
    )
    .join("");

  attachRowActionListeners();
}

// ------------------------------------------------------------------
// Info "Showing X to Y of Z entries"
// ------------------------------------------------------------------
function renderPaginationInfo(): void {
  const el = document.getElementById("entries-info");
  if (!el || !lastPaginator) return;

  const { from, to, total } = lastPaginator;
  if (total === 0) {
    el.textContent = currentSearch ? `Tidak ada hasil untuk "${currentSearch}"` : "Tidak ada data";
    return;
  }
  el.textContent = `Showing ${from ?? 0} to ${to ?? 0} of ${total} entries`;
}

// ------------------------------------------------------------------
// Tombol pagination (First, «, nomor halaman, », Last)
// ------------------------------------------------------------------
function renderPaginationButtons(): void {
  const container = document.getElementById("pagination-buttons");
  if (!container || !lastPaginator) return;

  const { current_page, last_page } = lastPaginator;

  const btnClass =
    "px-3 py-1 text-body-sm border border-outline-variant rounded hover:bg-surface-container transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent";
  const activeClass = "px-3 py-1 text-body-sm bg-ipb-blue text-white rounded font-bold";

  const pageButtons: string[] = [];
  const startPage = Math.max(1, current_page - 1);
  const endPage = Math.min(last_page, current_page + 1);

  for (let page = startPage; page <= endPage; page++) {
    pageButtons.push(
      page === current_page
        ? `<button type="button" class="${activeClass}" disabled>${page}</button>`
        : `<button type="button" class="${btnClass} page-btn" data-page="${page}">${page}</button>`
    );
  }

  container.innerHTML = `
    <button type="button" class="${btnClass} page-btn" data-page="1" ${current_page === 1 ? "disabled" : ""}>First</button>
    <button type="button" class="${btnClass} page-btn" data-page="${current_page - 1}" ${current_page === 1 ? "disabled" : ""}>&laquo;</button>
    ${pageButtons.join("")}
    <button type="button" class="${btnClass} page-btn" data-page="${current_page + 1}" ${current_page === last_page ? "disabled" : ""}>&raquo;</button>
    <button type="button" class="${btnClass} page-btn" data-page="${last_page}" ${current_page === last_page ? "disabled" : ""}>Last</button>
  `;

  container.querySelectorAll<HTMLButtonElement>(".page-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = parseInt(btn.dataset.page ?? "1", 10);
      if (!Number.isNaN(page) && page >= 1 && page <= last_page) {
        loadKolokium(page);
      }
    });
  });
}

// ------------------------------------------------------------------
// Aksi: Hadir (baru) & Hadir Ulang
// ------------------------------------------------------------------
function attachRowActionListeners(): void {
  document.querySelectorAll<HTMLButtonElement>(".btn-hadir-baru").forEach((btn) => {
    btn.addEventListener("click", () => handleHadirBaru(btn));
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-hadir-ulang").forEach((btn) => {
    btn.addEventListener("click", () => handleHadirUlang(btn));
  });
}

// State 1 -> 3: belum ada record sama sekali, buat baru lewat POST
async function handleHadirBaru(btn: HTMLButtonElement): Promise<void> {
  const kolokiumId = parseInt(btn.dataset.kolokiumId ?? "", 10);
  if (Number.isNaN(kolokiumId)) return;

  const ok = await confirmDialog({
    title: "Daftar Hadir Kolokium?",
    message: "Anda akan didaftarkan sebagai peserta hadir pada kolokium ini.",
    variant: "primary",
    confirmText: "Ya, Hadir",
    icon: "event_available",
  });
  if (!ok) return;

  clearMessage();
  btn.disabled = true;
  btn.textContent = "Memproses...";

  try {
    await apiFetch<StorePesertaKolokiumResponse>("/auth/peserta-kolokium", {
      method: "POST",
      body: JSON.stringify({ kolokium_id: kolokiumId }),
    });

    showMessage("Berhasil mendaftar hadir kolokium.", "success");
    await loadKolokium(currentPage);
  } catch (err) {
    console.error("Gagal mendaftar kolokium:", err);
    showMessage(err instanceof Error ? err.message : "Gagal mendaftar kolokium.", "error");
    btn.disabled = false;
    btn.textContent = "Hadir";
  }
}

// State 2 -> 3: record ada dengan status "batal", ubah lagi jadi "hadir" lewat PATCH
async function handleHadirUlang(btn: HTMLButtonElement): Promise<void> {
  const pesertaId = parseInt(btn.dataset.pesertaId ?? "", 10);
  if (Number.isNaN(pesertaId)) return;

  const ok = await confirmDialog({
    title: "Daftar Hadir Ulang Kolokium?",
    message: "Status kehadiran Anda pada kolokium ini akan diaktifkan kembali menjadi hadir.",
    variant: "primary",
    confirmText: "Ya, Hadir Ulang",
    icon: "event_available",
  });
  if (!ok) return;

  clearMessage();
  btn.disabled = true;
  btn.textContent = "Memproses...";

  try {
    await apiFetch<{ message: string }>(`/auth/peserta-kolokium/${pesertaId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "hadir" }),
    });

    showMessage("Berhasil mendaftar hadir ulang kolokium.", "success");
    await loadKolokium(currentPage);
  } catch (err) {
    console.error("Gagal mendaftar hadir ulang kolokium:", err);
    showMessage(err instanceof Error ? err.message : "Gagal mendaftar hadir ulang kolokium.", "error");
    btn.disabled = false;
    btn.textContent = "Hadir Ulang";
  }
}

// ------------------------------------------------------------------
// Toggle Judul (expand/collapse inline, tanpa modal)
// ------------------------------------------------------------------
function initJudulToggleButtons(): void {
  const tbody = document.getElementById("kolokium-tbody");
  if (!tbody) return;
  if (tbody.dataset.judulToggleBound === "true") return;
  tbody.dataset.judulToggleBound = "true";

  tbody.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>(".judul-toggle-btn");
    if (!btn) return;

    const textSpan = btn.parentElement?.querySelector<HTMLElement>(".expandable-judul-text");
    const icon = btn.querySelector<HTMLElement>(".material-symbols-outlined");
    if (!textSpan) return;

    const isExpanded = textSpan.dataset.expanded === "true";
    const fullText = textSpan.dataset.fullText ?? "";
    const truncatedText = textSpan.dataset.truncatedText ?? "";

    if (isExpanded) {
      textSpan.textContent = truncatedText;
      textSpan.dataset.expanded = "false";
      if (icon) icon.textContent = "unfold_more";
      btn.title = "Lihat selengkapnya";
    } else {
      textSpan.textContent = fullText;
      textSpan.dataset.expanded = "true";
      if (icon) icon.textContent = "unfold_less";
      btn.title = "Sembunyikan";
    }
  });
}

// ------------------------------------------------------------------
// Search & per_page — keduanya dikirim ke backend (sama seperti pola
// admin & dosen), reset ke halaman 1 setiap kali berubah.
// ------------------------------------------------------------------
function initSearchAndEntries(): void {
  const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
  const entriesSelect = document.getElementById("entries-per-page") as HTMLSelectElement | null;

  if (searchInput && searchInput.dataset.bound !== "true") {
    searchInput.dataset.bound = "true";
    searchInput.addEventListener("input", () => {
      const value = searchInput.value.trim();

      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
      }

      searchDebounceTimer = setTimeout(() => {
        currentSearch = value;
        loadKolokium(1); // reset ke halaman 1 tiap kali kata kunci berubah
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  if (entriesSelect && entriesSelect.dataset.bound !== "true") {
    entriesSelect.dataset.bound = "true";
    entriesSelect.addEventListener("change", () => {
      loadKolokium(1); // reset ke halaman 1 tiap kali per_page berubah
    });
  }
}

// ------------------------------------------------------------------
// Jalankan saat halaman siap
// ------------------------------------------------------------------
async function initJadwalKolokiumPage(): Promise<void> {
  clearMessage();
  initSearchAndEntries();
  initJudulToggleButtons();
  await loadProfil();
  await loadKolokium(1);
}

initJadwalKolokiumPage();
document.addEventListener("astro:page-load", initJadwalKolokiumPage);