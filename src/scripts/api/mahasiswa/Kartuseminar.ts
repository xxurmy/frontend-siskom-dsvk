// src/scripts/api/mahasiswa/Kartuseminar.ts
// Logic untuk halaman "Kartu Seminar" (role: mahasiswa):
// 1) fetch daftar kartu seminar milik mahasiswa login (GET /auth/kartu-seminar/my)
// 2) render tabel + pagination
// 3) search & "show entries" -> filter + slice client-side
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
// PENTING: nama env HARUS berprefix PUBLIC_ (mis. PUBLIC_BASE_URL) supaya
// terbaca di client-side. Astro hanya meng-expose env yang berprefix
// PUBLIC_ ke kode yang berjalan di browser. Jika tetap memakai VITE_BASE_URL,
// tambahkan `envPrefix: ["VITE_", "PUBLIC_"]` di astro.config.mjs.
const API_BASE: string = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token"; // sesuaikan kalau key token localStorage Anda beda

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

interface KartuSeminarListResponse {
  message: string;
  kartu_seminars: KartuSeminar[];
}

interface ApiErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

// ------------------------------------------------------------------
// State halaman
// ------------------------------------------------------------------
let allData: KartuSeminar[] = [];
let filteredData: KartuSeminar[] = [];
let currentPage = 1;
let searchTerm = "";

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
// Muat daftar kartu seminar milik mahasiswa login
// ------------------------------------------------------------------
async function loadKartuSeminar(): Promise<void> {
  const tbody = document.getElementById("kartu-tbody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-6 text-center text-body-sm text-on-surface-variant">Memuat data...</td></tr>`;
  }

  try {
    const json = await apiFetch<KartuSeminarListResponse>("/auth/kartu-seminar/my");
    if (!json) return;

    allData = json.kartu_seminars ?? [];
    filteredData = [...allData];
    currentPage = 1;
    renderTable();
    renderPaginationInfo();
    renderPaginationButtons();
  } catch (err) {
    console.error("Gagal memuat kartu seminar:", err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-6 text-center text-body-sm text-red-700">Gagal memuat data. Coba muat ulang halaman.</td></tr>`;
    }
  }
}

// ------------------------------------------------------------------
// Render isi tabel (dengan search & pagination client-side)
// ------------------------------------------------------------------
function getEntriesPerPage(): number {
  const select = document.getElementById("entries-per-page") as HTMLSelectElement | null;
  return select ? parseInt(select.value, 10) : 10;
}

function getPageRows(): KartuSeminar[] {
  const perPage = getEntriesPerPage();
  const start = (currentPage - 1) * perPage;
  return filteredData.slice(start, start + perPage);
}

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

function renderTable(): void {
  const tbody = document.getElementById("kartu-tbody");
  if (!tbody) return;

  const rows = getPageRows();

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-6 text-center text-body-sm text-on-surface-variant">Tidak ada data.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
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
function renderPaginationInfo(): void {
  const el = document.getElementById("entries-info");
  if (!el) return;

  const perPage = getEntriesPerPage();
  const total = filteredData.length;
  const from = total === 0 ? 0 : (currentPage - 1) * perPage + 1;
  const to = Math.min(currentPage * perPage, total);

  el.textContent = total === 0 ? "Tidak ada data" : `Showing ${from} to ${to} of ${total} entries`;
}

// ------------------------------------------------------------------
// Tombol pagination (First, «, nomor halaman, », Last)
// ------------------------------------------------------------------
function renderPaginationButtons(): void {
  const container = document.getElementById("pagination-buttons");
  if (!container) return;

  const perPage = getEntriesPerPage();
  const lastPage = Math.max(1, Math.ceil(filteredData.length / perPage));
  if (currentPage > lastPage) currentPage = lastPage;

  const btnClass =
    "px-3 py-1 text-body-sm border border-outline-variant rounded hover:bg-surface-container transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent";
  const activeClass = "px-3 py-1 text-body-sm bg-ipb-blue text-white rounded font-bold";

  const pageButtons: string[] = [];
  const startPage = Math.max(1, currentPage - 1);
  const endPage = Math.min(lastPage, currentPage + 1);

  for (let page = startPage; page <= endPage; page++) {
    pageButtons.push(
      page === currentPage
        ? `<button type="button" class="${activeClass}" disabled>${page}</button>`
        : `<button type="button" class="${btnClass} page-btn" data-page="${page}">${page}</button>`
    );
  }

  container.innerHTML = `
    <button type="button" class="${btnClass} page-btn" data-page="1" ${currentPage === 1 ? "disabled" : ""}>First</button>
    <button type="button" class="${btnClass} page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>&laquo;</button>
    ${pageButtons.join("")}
    <button type="button" class="${btnClass} page-btn" data-page="${currentPage + 1}" ${currentPage === lastPage ? "disabled" : ""}>&raquo;</button>
    <button type="button" class="${btnClass} page-btn" data-page="${lastPage}" ${currentPage === lastPage ? "disabled" : ""}>Last</button>
  `;

  container.querySelectorAll<HTMLButtonElement>(".page-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = parseInt(btn.dataset.page ?? "1", 10);
      if (!Number.isNaN(page) && page >= 1 && page <= lastPage) {
        currentPage = page;
        renderTable();
        renderPaginationInfo();
        renderPaginationButtons();
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
    await loadKartuSeminar();
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
// Search & entries-per-page (client-side)
// ------------------------------------------------------------------
function applySearch(): void {
  const term = searchTerm.trim().toLowerCase();
  filteredData = !term
    ? [...allData]
    : allData.filter((kartu) =>
        [kartu.namapemrasaran, kartu.nimpemrasaran, kartu.prodi, kartu.moderator]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term)
      );
  currentPage = 1;
  renderTable();
  renderPaginationInfo();
  renderPaginationButtons();
}

function initSearchAndEntries(): void {
  const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
  const entriesSelect = document.getElementById("entries-per-page") as HTMLSelectElement | null;
  const downloadBtn = document.getElementById("download-btn") as HTMLButtonElement | null;

  searchInput?.addEventListener("input", () => {
    searchTerm = searchInput.value;
    applySearch();
  });

  entriesSelect?.addEventListener("change", () => {
    currentPage = 1;
    renderTable();
    renderPaginationInfo();
    renderPaginationButtons();
  });

  downloadBtn?.addEventListener("click", handleDownload);
}

// ------------------------------------------------------------------
// Jalankan saat halaman siap
// ------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  clearMessage();
  initSearchAndEntries();
  await loadKartuSeminar();
});