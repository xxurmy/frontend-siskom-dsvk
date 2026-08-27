// src/scripts/api/dosen/jadwal-seminar.ts
// Fetch & render tabel "Jadwal Seminar" untuk dosen, dari /auth/seminar/my
// (backend sudah filter: dosen ini sebagai PEMBIMBING atau MODERATOR).
//
// SEARCH: input #search-input dikirim ke backend lewat query param `search`
// (di-debounce 400ms), backend nge-LIKE ke banyak kolom (nama, nim, judul, prodi, dll).
// Kalau hasil kosong SAAT sedang search, tampilkan pesan khusus yang beda
// dari pesan "belum ada data" biasa — sama seperti perilaku admin.
//
// PER PAGE: select #entries-select dikirim ke backend lewat query param
// `per_page` (backend SeminarController::mySeminar sudah validasi
// min:1|max:100, default 10 kalau tidak dikirim/invalid).
//
// STATUS: kolom "Status" menampilkan progres pendaftaran seminar
// (pending/approved/rejected) dengan badge warna yang sama seperti tabel
// admin, supaya dosen bisa memantau perkembangan status pendaftaran
// seminar mahasiswa yang dibimbing/dimoderatori. Karena kolom ini butuh
// menampilkan SEMUA status (bukan cuma approved), filter `status: "approved"`
// yang dulu dikirim ke backend DIHAPUS — dosen sekarang melihat seminar
// dengan status apapun (pending, approved, rejected).
//
// ABSENSI: tombol Absensi hanya aktif kalau dosen yang login adalah
// MODERATOR seminar tsb DAN status seminar sudah "approved" (mengikuti
// aturan yang sama dengan tabel admin — peserta baru bisa absen setelah
// seminar disetujui).
//
// TAMPILAN KOLOM (mengikuti pola yang sama dengan tabel admin):
// - Kolom Nama/NIM/Prodi digabung jadi satu kolom "Pemrasaran": nama (bold)
//   di baris atas, lalu "NIM · Prodi" di baris bawah dengan teks lebih kecil.
// - Kolom Judul dipotong beberapa kata saja, dengan tombol untuk
//   menampilkan/menyembunyikan teks lengkap LANGSUNG di dalam sel yang sama
//   (tanpa modal) — klik tombol lagi untuk mempersingkat kembali.
// - Kolom Dosen Pembimbing selalu ditampilkan penuh apa adanya, tanpa
//   dipotong dan tanpa tombol.
// - Kolom Status menampilkan badge warna (pending = kuning, approved =
//   hijau, rejected = merah), sama seperti tabel admin.
// - Sel-sel tidak dipaksa satu baris (whitespace-nowrap dihapus dari sel
//   berisi teks panjang) supaya baris melebar ke bawah, bukan ke samping,
//   saat teks tidak muat. Kolom Absensi tetap seperti semula.

interface SeminarItem {
  id: number;
  mahasiswa_id: number;
  nama: string;
  nim: string;
  prodi: string;
  namadosenpembimbing: string | null;
  moderator_id: number | null;
  namadosenmoderator: string | null;
  judul: string;
  lokasi: string | null;
  tanggal: string | null;
  waktu: string | null;
  ruangan: string | null;
  status: "pending" | "approved" | "rejected";
  jumlahforum: number;
  [key: string]: unknown;
}

interface PaginatedResponse<T> {
  data: T[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  from: number | null;
  to: number | null;
  [key: string]: unknown;
}

interface StoredUser {
  id: number;
  role: string;
  [key: string]: unknown;
}

const API_BASE_URL = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token";
const SEARCH_DEBOUNCE_MS = 400;
const DEFAULT_PER_PAGE = 10;
const COLSPAN = 11;
const JUDUL_WORD_LIMIT = 4;

// Label & warna badge status — sama persis dengan tabel admin, supaya
// dosen dan admin melihat representasi status yang konsisten.
const STATUS_LABEL: Record<SeminarItem["status"], string> = {
  pending: "Belum diterima",
  approved: "Sudah diterima",
  rejected: "Ditolak",
};

const STATUS_BADGE_CLASS: Record<SeminarItem["status"], string> = {
  pending: "bg-amber-500",
  approved: "bg-green-600",
  rejected: "bg-red-600",
};

let currentPage = 1;
let currentSearch = "";
let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
let lastResponse: PaginatedResponse<SeminarItem> | null = null;

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function getEntriesPerPage(): number {
  const select = document.getElementById("entries-select") as HTMLSelectElement | null;
  const value = select ? parseInt(select.value, 10) : DEFAULT_PER_PAGE;
  return Number.isNaN(value) || value < 1 ? DEFAULT_PER_PAGE : value;
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function formatTanggal(tanggal: string | null): string {
  if (!tanggal) return "-";
  const date = new Date(tanggal);
  if (Number.isNaN(date.getTime())) return tanggal;
  return date.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function getCurrentUserId(): number | null {
  const raw = localStorage.getItem("auth_user");
  if (!raw) return null;
  try {
    const user: StoredUser = JSON.parse(raw);
    return typeof user.id === "number" ? user.id : null;
  } catch {
    return null;
  }
}

// ============================================================
// SEL "PEMRASARAN" (gabungan Nama / NIM / Prodi)
// ============================================================

function renderPemrasaranCell(item: SeminarItem): string {
  const nama = escapeHtml(item.nama ?? "-");
  const nim = escapeHtml(item.nim ?? "-");
  const prodi = escapeHtml(item.prodi ?? "-");
  return `
    <div class="leading-snug">
      <div class="text-body-sm font-bold text-on-surface">${nama}</div>
      <div class="text-xs text-on-surface-variant mt-0.5">${nim} · ${prodi}</div>
    </div>
  `;
}

// ============================================================
// SEL JUDUL: dipotong sebagian kata + tombol untuk membuka teks
// lengkap LANGSUNG DI DALAM BARIS (tanpa modal).
// ============================================================

function truncateWords(text: string, wordLimit: number): { truncated: string; isTruncated: boolean } {
  const words = text.trim().split(/\s+/);
  if (words.length <= wordLimit) {
    return { truncated: text, isTruncated: false };
  }
  return { truncated: `${words.slice(0, wordLimit).join(" ")}...`, isTruncated: true };
}

function renderJudulCell(item: SeminarItem): string {
  const fullText = item.judul;
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
function renderDosenPembimbingCell(item: SeminarItem): string {
  const text = item.namadosenpembimbing;
  if (!text) {
    return `<span class="text-body-sm text-on-surface">-</span>`;
  }
  return `<span class="text-body-sm text-on-surface">${escapeHtml(text)}</span>`;
}

// ============================================================
// SEL STATUS: badge warna, sama seperti tabel admin.
// ============================================================

function renderStatusCell(item: SeminarItem): string {
  const label = STATUS_LABEL[item.status] ?? item.status;
  const badgeClass = STATUS_BADGE_CLASS[item.status] ?? "bg-slate-500";
  return `
    <span class="px-2 py-1 rounded text-white text-xs font-medium ${badgeClass} whitespace-nowrap">
      ${escapeHtml(label)}
    </span>
  `;
}

// ---------- Fetch ----------
async function fetchSeminar(page: number): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/";
    return;
  }

  const tbody = document.getElementById("seminar-table-body");
  if (tbody) {
    tbody.innerHTML = `
      <tr><td colspan="${COLSPAN}" class="px-4 py-6 text-center text-body-sm text-on-surface-variant">Memuat data...</td></tr>
    `;
  }

  // Catatan: parameter `status: "approved"` yang dulu ada di sini SUDAH
  // DIHAPUS. Dosen sekarang perlu melihat seminar dengan status apapun
  // (pending/approved/rejected) supaya kolom Status berguna untuk memantau
  // perkembangan pendaftaran, bukan cuma yang sudah disetujui.
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(getEntriesPerPage()),
  });
  if (currentSearch) {
    params.set("search", currentSearch);
  }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/seminar/my?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401) {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
      window.location.href = "/";
      return;
    }

    if (!res.ok) {
      if (tbody) {
        tbody.innerHTML = `
          <tr><td colspan="${COLSPAN}" class="px-4 py-6 text-center text-body-sm text-error">Gagal memuat data (status ${res.status}).</td></tr>
        `;
      }
      return;
    }

    const data: PaginatedResponse<SeminarItem> = await res.json();
    lastResponse = data;
    currentPage = data.current_page;

    renderTable(data.data);
    renderPaginationInfo(data);
    renderPaginationButtons(data);
  } catch (err) {
    console.error("Gagal fetch jadwal seminar:", err);
    if (tbody) {
      tbody.innerHTML = `
        <tr><td colspan="${COLSPAN}" class="px-4 py-6 text-center text-body-sm text-error">Terjadi kesalahan jaringan.</td></tr>
      `;
    }
  }
}

// ---------- Render tabel ----------
function renderTable(items: SeminarItem[]): void {
  const tbody = document.getElementById("seminar-table-body");
  if (!tbody) return;

  if (items.length === 0) {
    const message = currentSearch
      ? `Tidak ditemukan hasil untuk pencarian "${escapeHtml(currentSearch)}".`
      : "Tidak ada data seminar.";
    tbody.innerHTML = `
      <tr><td colspan="${COLSPAN}" class="px-4 py-6 text-center text-body-sm text-on-surface-variant">${message}</td></tr>
    `;
    return;
  }

  const startNumber = lastResponse?.from ?? 1;
  const currentUserId = getCurrentUserId();

  tbody.innerHTML = items
    .map((item, index) => {
      const isModerator = currentUserId !== null && item.moderator_id === currentUserId;
      const isApproved = item.status === "approved";
      // Absensi hanya boleh dibuka kalau dosen ini moderator DAN seminar
      // sudah approved — sama seperti aturan di tabel admin.
      const canAbsen = isModerator && isApproved;
      const disabledClass = "opacity-40 cursor-not-allowed";

      let absensiTitle: string;
      if (!isApproved) {
        absensiTitle = "Seminar harus berstatus disetujui sebelum bisa diabsen";
      } else if (!isModerator) {
        absensiTitle = "Hanya dosen moderator yang dapat membuka absensi seminar ini";
      } else {
        absensiTitle = "Buka Absensi";
      }

      return `
        <tr class="table-row-hover transition-colors align-top">
          <td class="px-4 py-4 text-body-sm align-top">${startNumber + index}</td>
          <td class="px-4 py-4 text-body-sm align-top break-words">${formatTanggal(item.tanggal ?? "-")}</td>
          <td class="px-4 py-4 text-body-sm align-top">${escapeHtml(item.waktu ?? "-")}</td>
          <td class="px-4 py-4 text-body-sm align-top break-words">${escapeHtml(item.ruangan ?? "-")}</td>
          <td class="px-4 py-4 align-top">${renderPemrasaranCell(item)}</td>
          <td class="px-4 py-4 align-top break-words">${renderJudulCell(item)}</td>
          <td class="px-4 py-4 text-body-sm text-center align-top">${item.jumlahforum}</td>
          <td class="px-4 py-4 align-top break-words">${renderDosenPembimbingCell(item)}</td>
          <td class="px-4 py-4 text-body-sm align-top break-words">${escapeHtml(item.namadosenmoderator ?? "-")}</td>
          <td class="px-4 py-4 align-top whitespace-nowrap">${renderStatusCell(item)}</td>
          <td class="px-4 py-4 text-center whitespace-nowrap">
            <button
              type="button"
              class="seminar-absensi-btn inline-flex items-center gap-1.5 bg-primary-container text-on-primary px-3 py-1.5 rounded-lg text-body-sm font-bold hover:bg-primary transition-all active:scale-95 ${!canAbsen ? disabledClass : ""}"
              data-seminar-id="${item.id}"
              title="${absensiTitle}"
              ${!canAbsen ? "disabled" : ""}
            >
              <span class="material-symbols-outlined text-[18px]">fact_check</span>
              Absensi
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

// ---------- "Showing X to Y of Z entries" ----------
function renderPaginationInfo(data: PaginatedResponse<SeminarItem>): void {
  const el = document.getElementById("pagination-info");
  if (!el) return;

  if (data.total === 0) {
    el.textContent = currentSearch
      ? `Tidak ada hasil untuk "${currentSearch}"`
      : "Tidak ada data.";
    return;
  }

  el.textContent = `Showing ${data.from ?? 0} to ${data.to ?? 0} of ${data.total} entries`;
}

// ---------- Tombol pagination ----------
function renderPaginationButtons(data: PaginatedResponse<SeminarItem>): void {
  const container = document.getElementById("pagination-buttons");
  if (!container) return;

  const { current_page, last_page } = data;

  const btnClass =
    "px-3 py-1 text-body-sm border border-outline-variant rounded hover:bg-surface-container transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent";
  const activeBtnClass = "px-3 py-1 text-body-sm bg-ipb-blue text-white rounded font-bold";

  // Tampilkan maksimal 4 nomor halaman di sekitar halaman aktif
  const pageNumbers: number[] = [];
  const startPage = Math.max(1, current_page - 1);
  const endPage = Math.min(last_page, startPage + 3);
  for (let p = startPage; p <= endPage; p++) pageNumbers.push(p);

  const numberButtons = pageNumbers
    .map((p) =>
      p === current_page
        ? `<button class="${activeBtnClass}" disabled>${p}</button>`
        : `<button class="${btnClass}" data-page="${p}">${p}</button>`
    )
    .join("");

  container.innerHTML = `
    <button class="${btnClass}" data-page="1" ${current_page === 1 ? "disabled" : ""}>First</button>
    <button class="${btnClass}" data-page="${current_page - 1}" ${current_page === 1 ? "disabled" : ""}>&laquo;</button>
    ${numberButtons}
    <button class="${btnClass}" data-page="${current_page + 1}" ${current_page === last_page ? "disabled" : ""}>&raquo;</button>
    <button class="${btnClass}" data-page="${last_page}" ${current_page === last_page ? "disabled" : ""}>Last</button>
  `;

  container.querySelectorAll<HTMLButtonElement>("button[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = Number(btn.dataset.page);
      if (!Number.isNaN(page) && page >= 1 && page <= last_page) {
        fetchSeminar(page);
      }
    });
  });
}

// ---------- Search (debounce ke backend, sama seperti admin) ----------
function initSearch(): void {
  const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
  if (!searchInput) return;
  if (searchInput.dataset.bound === "true") return;
  searchInput.dataset.bound = "true";

  searchInput.addEventListener("input", () => {
    const value = searchInput.value.trim();

    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }

    searchDebounceTimer = setTimeout(() => {
      currentSearch = value;
      fetchSeminar(1); // reset ke halaman 1 tiap kali kata kunci berubah
    }, SEARCH_DEBOUNCE_MS);
  });
}

// ---------- Per page (dikirim ke backend) ----------
function initPerPage(): void {
  const select = document.getElementById("entries-select") as HTMLSelectElement | null;
  if (!select) return;
  if (select.dataset.bound === "true") return;
  select.dataset.bound = "true";

  select.addEventListener("change", () => {
    fetchSeminar(1); // reset ke halaman 1 tiap kali per_page berubah
  });
}

// ---------- Tombol Absensi ----------
function initAbsensiButtons(): void {
  const tbody = document.getElementById("seminar-table-body");
  if (!tbody) return;
  if (tbody.dataset.absensiBound === "true") return;
  tbody.dataset.absensiBound = "true";

  tbody.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>(".seminar-absensi-btn");
    if (!btn) return;
    if (btn.hasAttribute("disabled")) return;

    const seminarId = btn.dataset.seminarId;
    if (!seminarId) return;

    window.location.href = `/dosen/absensi-seminar?seminar_id=${seminarId}`;
  });
}

// ---------- Toggle Judul (expand/collapse inline, tanpa modal) ----------
function initJudulToggleButtons(): void {
  const tbody = document.getElementById("seminar-table-body");
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

function initJadwalSeminarPage(): void {
  initSearch();
  initPerPage();
  initAbsensiButtons();
  initJudulToggleButtons();
  fetchSeminar(currentPage);
}

initJadwalSeminarPage();
document.addEventListener("astro:page-load", initJadwalSeminarPage);