// src/scripts/api/mahasiswa/Kartuseminar.ts
// Logic untuk halaman "Kartu Seminar" (role: mahasiswa):
// 1) fetch daftar kartu seminar milik mahasiswa login, paginated
//    (GET /auth/kartu-seminar/my?page=N&search=...)
// 2) render tabel + pagination (server-side, sinkron dengan
//    KartuSeminarController::my yang sudah paginate(10) & dukung `search`)
// 3) search -> dikirim ke backend via query param `search`, debounce 400ms
// 4) tombol "Batalkan":
//    - AKTIF jika masih H-1 atau lebih awal dari tanggal seminar
//    - NONAKTIF (disabled) jika sudah hari-H atau lewat
//    - Saat diklik & dikonfirmasi -> PATCH /auth/peserta-seminar/{peserta_seminar_id}/status
//      dengan body { status: "batal" } (sesuai PesertaSeminarController::updateStatus,
//      yang juga sudah menolak permintaan jika sudah hari-H di sisi backend)
// 5) Download (endpoint belum tersedia di controller -> stub)

// ------------------------------------------------------------------
// Konfigurasi
// ------------------------------------------------------------------
const API_BASE: string = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token"; // sesuaikan kalau key token localStorage Anda beda
const SEARCH_DEBOUNCE_MS = 400;
const COLSPAN = 8;

// ------------------------------------------------------------------
// Tipe data (disesuaikan dengan KartuSeminarController)
// ------------------------------------------------------------------
type StatusParaf = "signed" | "absent" | string;

interface KartuSeminar {
  id: number;
  seminar_id: number;
  pemrasaran_id: number;
  moderator_id: number;
  peserta_seminar_id: number; // dipakai sebagai target PATCH status "batal"
  forum_id: number;
  tanggal: string | null; // dipakai untuk menentukan H-1 / hari-H
  waktu: string | null;
  namapemrasaran: string | null;
  nimpemrasaran: string | null;
  prodi: string | null;
  moderator: string | null;
  tandatangandosen: string | null;
  statusparaf: StatusParaf | null;
}

interface PaginatedResponse<T> {
  current_page: number;
  data: T[];
  from: number | null;
  to: number | null;
  last_page: number;
  per_page: number;
  total: number;
}

interface KartuSeminarListResponse {
  message: string;
  kartu_seminars: PaginatedResponse<KartuSeminar>;
}

interface ApiErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

// ------------------------------------------------------------------
// State halaman
// ------------------------------------------------------------------
let currentPage = 1;
let currentSearch = "";
let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;

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
    window.location.href = "/denied";
    return null;
  }

  const json = await res.json();

  if (!res.ok) {
    const err = json as ApiErrorResponse;
    throw new Error(err.message ?? `Request ke ${path} gagal (status ${res.status})`);
  }

  return json as T;
}

// ------------------------------------------------------------------
// Pesan status
// ------------------------------------------------------------------
function showMessage(text: string, variant: "success" | "error"): void {
  const el = document.getElementById("kartu-message");
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
  const el = document.getElementById("kartu-message");
  if (!el) return;
  el.classList.add("hidden");
  el.textContent = "";
}

// ------------------------------------------------------------------
// Format tanggal, waktu & status untuk tampilan
// ------------------------------------------------------------------
function formatTanggal(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatWaktu(value: string | null): string {
  if (!value) return "-";
  return value.slice(0, 5); // "14:00:00" -> "14:00"
}

function statusBadge(status: StatusParaf | null): string {
  if (status === "signed") {
    return `<span class="bg-secondary/10 text-secondary border border-secondary/20 px-3 py-1 rounded-full text-[12px] font-bold whitespace-nowrap">Sudah ditanda tangan</span>`;
  }
  if (status === "absent") {
    return `<span class="bg-error/10 text-error border border-error/20 px-3 py-1 rounded-full text-[12px] font-bold whitespace-nowrap">Dosen tidak hadir</span>`;
  }
  return `<span class="bg-outline/10 text-on-surface-variant border border-outline/20 px-3 py-1 rounded-full text-[12px] font-bold whitespace-nowrap">Menunggu tanda tangan</span>`;
}

function escapeHtml(value: string | null): string {
  if (!value) return "-";
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

// ------------------------------------------------------------------
// Aturan aktif/nonaktif tombol Batalkan
// - Aktif  : hari ini < tanggal seminar (masih H-1 atau lebih awal)
// - Nonaktif: hari ini >= tanggal seminar (sudah hari-H atau lewat),
//   atau tanggal tidak diketahui (untuk berjaga-jaga)
// Catatan: aturan ini mencerminkan validasi yang sama di
// PesertaSeminarController::updateStatus (backend juga menolak jika
// sudah hari-H), jadi tombol di UI sudah konsisten dengan backend.
// ------------------------------------------------------------------
function isBatalDisabled(tanggal: string | null): boolean {
  if (!tanggal) return true;

  const tanggalSeminar = new Date(tanggal);
  if (Number.isNaN(tanggalSeminar.getTime())) return true;
  tanggalSeminar.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return today.getTime() >= tanggalSeminar.getTime();
}

// ------------------------------------------------------------------
// Muat daftar kartu seminar milik mahasiswa login (server-side paginated)
// ------------------------------------------------------------------
async function loadKartuSeminar(page = 1): Promise<void> {
  const tbody = document.getElementById("kartu-tbody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="${COLSPAN}" class="px-4 py-6 text-center text-body-sm text-on-surface-variant">Memuat data...</td></tr>`;
  }

  const params = new URLSearchParams({ page: String(page) });
  if (currentSearch) {
    params.set("search", currentSearch);
  }

  try {
    const json = await apiFetch<KartuSeminarListResponse>(
      `/auth/kartu-seminar/my?${params.toString()}`
    );
    if (!json) return;

    const data = json.kartu_seminars;
    currentPage = data.current_page;

    renderTable(data);
    renderPaginationInfo(data);
    renderPaginationButtons(data);
  } catch (err) {
    console.error("Gagal memuat kartu seminar:", err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="${COLSPAN}" class="px-4 py-6 text-center text-body-sm text-red-700">Gagal memuat data. Coba muat ulang halaman.</td></tr>`;
    }
  }
}

// ------------------------------------------------------------------
// Render isi tabel
// ------------------------------------------------------------------
function renderBatalkanCell(kartu: KartuSeminar): string {
  const disabled = isBatalDisabled(kartu.tanggal);

  const baseClass = "transition-transform";
  const activeClass = "text-error hover:scale-110 btn-batalkan-kartu";
  const disabledClass = "text-on-surface-variant/40 cursor-not-allowed";

  const title = disabled
    ? "Tidak bisa dibatalkan karena sudah hari-H"
    : "Batalkan kehadiran seminar";

  return `
    <button
      type="button"
      class="${baseClass} ${disabled ? disabledClass : activeClass}"
      data-peserta-id="${kartu.peserta_seminar_id}"
      aria-label="Batalkan kartu seminar"
      title="${title}"
      ${disabled ? "disabled" : ""}
    >
      <span class="material-symbols-outlined">delete</span>
    </button>
  `;
}

function renderTable(data: PaginatedResponse<KartuSeminar>): void {
  const tbody = document.getElementById("kartu-tbody");
  if (!tbody) return;

  if (data.data.length === 0) {
    const message = currentSearch
      ? `Tidak ditemukan hasil untuk pencarian "${escapeHtml(currentSearch)}".`
      : "Tidak ada data.";
    tbody.innerHTML = `<tr><td colspan="${COLSPAN}" class="px-4 py-6 text-center text-body-sm text-on-surface-variant">${message}</td></tr>`;
    return;
  }

  tbody.innerHTML = data.data
    .map(
      (kartu) => `
        <tr class="table-row-hover transition-colors">
          <td class="px-4 py-4 text-body-sm whitespace-nowrap">${formatTanggal(kartu.tanggal)}</td>
          <td class="px-4 py-4 text-body-sm">${formatWaktu(kartu.waktu)}</td>
          <td class="px-4 py-4 text-body-sm font-medium">${escapeHtml(kartu.namapemrasaran)}</td>
          <td class="px-4 py-4 text-body-sm">${escapeHtml(kartu.nimpemrasaran)}</td>
          <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(kartu.prodi)}</td>
          <td class="px-4 py-4 text-body-sm">${escapeHtml(kartu.moderator)}</td>
          <td class="px-4 py-4">${statusBadge(kartu.statusparaf)}</td>
          <td class="px-4 py-4 text-center">${renderBatalkanCell(kartu)}</td>
        </tr>
      `
    )
    .join("");

  attachRowActionListeners();
}

// ------------------------------------------------------------------
// Info "Showing X to Y of Z entries"
// ------------------------------------------------------------------
function renderPaginationInfo(data: PaginatedResponse<KartuSeminar>): void {
  const el = document.getElementById("entries-info");
  if (!el) return;

  if (data.total === 0) {
    el.textContent = currentSearch ? `Tidak ada hasil untuk "${currentSearch}"` : "Tidak ada data.";
    return;
  }

  el.textContent = `Showing ${data.from ?? 0} to ${data.to ?? 0} of ${data.total} entries`;
}

// ------------------------------------------------------------------
// Tombol pagination (First, «, nomor halaman, », Last)
// ------------------------------------------------------------------
function renderPaginationButtons(data: PaginatedResponse<KartuSeminar>): void {
  const container = document.getElementById("pagination-buttons");
  if (!container) return;

  const { current_page, last_page } = data;

  const btnClass =
    "px-3 py-1 text-body-sm border border-outline-variant rounded hover:bg-surface-container transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent";
  const activeClass = "px-3 py-1 text-body-sm bg-ipb-blue text-white rounded font-bold";

  const pageButtons: string[] = [];
  const startPage = Math.max(1, current_page - 1);
  const endPage = Math.min(last_page, startPage + 3);

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
        loadKartuSeminar(page);
      }
    });
  });
}

// ------------------------------------------------------------------
// Aksi Batalkan & Download
// ------------------------------------------------------------------
function attachRowActionListeners(): void {
  document.querySelectorAll<HTMLButtonElement>(".btn-batalkan-kartu").forEach((btn) => {
    btn.addEventListener("click", () => handleBatalkan(btn));
  });
}

// Menjalankan PATCH /auth/peserta-seminar/{peserta_seminar_id}/status
// dengan body { status: "batal" }. Tombol ini hanya bisa diklik selama
// belum hari-H (lihat isBatalDisabled & renderBatalkanCell) — dan sebagai
// lapis kedua, backend (PesertaSeminarController::updateStatus) juga
// akan menolak permintaan jika ternyata sudah hari-H.
async function handleBatalkan(btn: HTMLButtonElement): Promise<void> {
  const pesertaId = btn.dataset.pesertaId;
  if (!pesertaId) return;

  const confirmed = window.confirm(
    "Apakah Anda yakin ingin membatalkan kehadiran seminar ini?"
  );
  if (!confirmed) return;

  clearMessage();
  btn.disabled = true;

  try {
    await apiFetch<{ message: string }>(`/auth/peserta-seminar/${pesertaId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "batal" }),
    });

    showMessage("Berhasil membatalkan kehadiran seminar.", "success");
    // Refresh halaman yang sedang aktif biar mahasiswa tidak "terlempar" ke halaman 1
    await loadKartuSeminar(currentPage);
  } catch (err) {
    console.error("Gagal membatalkan kartu seminar:", err);
    showMessage(
      err instanceof Error ? err.message : "Gagal membatalkan kehadiran seminar.",
      "error"
    );
    btn.disabled = false;
  }
}

function handleDownload(): void {
  // TODO: controller yang diberikan belum punya endpoint untuk download kartu
  // seminar (mis. PDF). Tambahkan endpoint di backend lalu panggil
  // fetch/window.open di sini.
  showMessage("Fitur download belum tersedia.", "error");
}

// ------------------------------------------------------------------
// Search (server-side, debounce 400ms)
// ------------------------------------------------------------------
function initSearchAndActions(): void {
  const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
  const downloadBtn = document.getElementById("download-btn") as HTMLButtonElement | null;

  if (searchInput && searchInput.dataset.bound !== "true") {
    searchInput.dataset.bound = "true";
    searchInput.addEventListener("input", () => {
      const value = searchInput.value.trim();

      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
      }

      searchDebounceTimer = setTimeout(() => {
        currentSearch = value;
        loadKartuSeminar(1); // reset ke halaman 1 tiap kali kata kunci berubah
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  if (downloadBtn && downloadBtn.dataset.bound !== "true") {
    downloadBtn.dataset.bound = "true";
    downloadBtn.addEventListener("click", handleDownload);
  }
}

// ------------------------------------------------------------------
// Jalankan saat halaman siap
// ------------------------------------------------------------------
function initKartuSeminarPage(): void {
  clearMessage();
  initSearchAndActions();
  loadKartuSeminar(1);
}

initKartuSeminarPage();
document.addEventListener("astro:page-load", initKartuSeminarPage);