// src/scripts/api/mahasiswa/riwayat-kolokium.ts
// Logic untuk halaman "Riwayat Kehadiran Kolokium" (role: mahasiswa):
// 1) fetch daftar kartu kolokium milik mahasiswa login, paginated
//    (GET /auth/kartu-kolokium/my?page=N&search=...&per_page=N)
// 2) render tabel + pagination (server-side, sinkron dengan
//    KartuKolokiumController::my yang sudah paginate() & dukung `search`/`per_page`)
// 3) search -> dikirim ke backend via query param `search`, debounce 400ms
// 4) per_page -> select #entries-per-page dikirim ke backend via query param
//    `per_page` (backend validasi min:1|max:100, default 10)
// 5) tombol "Batalkan":
//    - AKTIF jika masih H-1 atau lebih awal dari tanggal kolokium
//    - NONAKTIF (disabled) jika sudah hari-H atau lewat
//    - Saat diklik & dikonfirmasi (via ConfirmModal) -> PATCH /auth/peserta-kolokium/{peserta_kolokium_id}/status
//      dengan body { status: "batal" } (sesuai PesertaKolokiumController::updateStatus,
//      yang juga sudah menolak permintaan jika sudah hari-H di sisi backend)
//
// CATATAN: Fitur export PDF & kolom status paraf/tanda tangan SUDAH DIHAPUS
// dari halaman ini (backend juga sudah tidak mengirim field tersebut).
//
// KONFIRMASI BATALKAN: menggunakan ConfirmModal (src/components/ConfirmModal.astro)
// lewat helper confirmDialog() di src/scripts/lib/confirm-dialog.ts, bukan
// window.confirm() bawaan browser.
//
// TAMPILAN KOLOM (disamakan dengan pola tabel jadwal-kolokium & kartu-kolokium dosen):
// - Kolom Nama Pemrasaran/NIM/Prodi digabung jadi satu kolom "Pemrasaran":
//   nama (bold) di baris atas, lalu "NIM · Prodi" di baris bawah dengan
//   teks lebih kecil.
// - Kolom Hari/Tanggal tetap whitespace-nowrap (satu baris) seperti semula.
// - Kolom Moderator diberi lebar lebih besar (w-56) supaya nama moderator
//   tetap muat dalam satu baris (whitespace-nowrap).

import { confirmDialog } from "../../lib/confirm-dialog";

// ------------------------------------------------------------------
// Konfigurasi
// ------------------------------------------------------------------
const API_BASE: string = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token"; // sesuaikan kalau key token localStorage Anda beda
const SEARCH_DEBOUNCE_MS = 400;
const COLSPAN = 5;
const DEFAULT_PER_PAGE = 10;

// ------------------------------------------------------------------
// Tipe data (disesuaikan dengan KartuKolokiumController — tanpa
// statusparaf/tandatangandosen karena field ini sudah dihapus dari backend)
// ------------------------------------------------------------------
interface KartuKolokium {
  id: number;
  kolokium_id: number;
  pemrasaran_id: number;
  moderator_id: number;
  peserta_kolokium_id: number; // dipakai sebagai target PATCH status "batal"
  forum_id: number;
  tanggal: string | null; // dipakai untuk menentukan H-1 / hari-H
  waktu: string | null;
  namapemrasaran: string | null;
  nimpemrasaran: string | null;
  prodi: string | null;
  moderator: string | null;
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

interface KartuKolokiumListResponse {
  message: string;
  kartu_kolokiums: PaginatedResponse<KartuKolokium>;
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

function getEntriesPerPage(): number {
  const select = document.getElementById("entries-per-page") as HTMLSelectElement | null;
  const value = select ? parseInt(select.value, 10) : DEFAULT_PER_PAGE;
  return Number.isNaN(value) || value < 1 ? DEFAULT_PER_PAGE : value;
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
// Format tanggal & waktu untuk tampilan
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

function escapeHtml(value: string | null): string {
  if (!value) return "-";
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

// ------------------------------------------------------------------
// SEL "PEMRASARAN" (gabungan Nama / NIM / Prodi) — sama seperti
// tabel jadwal-kolokium & kartu-kolokium (dosen).
// ------------------------------------------------------------------
function renderPemrasaranCell(kartu: KartuKolokium): string {
  const nama = escapeHtml(kartu.namapemrasaran);
  const nim = escapeHtml(kartu.nimpemrasaran);
  const prodi = escapeHtml(kartu.prodi);
  return `
    <div class="leading-snug">
      <div class="text-body-sm font-bold text-on-surface">${nama}</div>
      <div class="text-xs text-on-surface-variant mt-0.5">${nim} · ${prodi}</div>
    </div>
  `;
}

// ------------------------------------------------------------------
// Aturan aktif/nonaktif tombol Batalkan
// - Aktif  : hari ini < tanggal kolokium (masih H-1 atau lebih awal)
// - Nonaktif: hari ini >= tanggal kolokium (sudah hari-H atau lewat),
//   atau tanggal tidak diketahui (untuk berjaga-jaga)
// Catatan: aturan ini mencerminkan validasi yang sama di
// PesertaKolokiumController::updateStatus (backend juga menolak jika
// sudah hari-H), jadi tombol di UI sudah konsisten dengan backend.
// ------------------------------------------------------------------
function isBatalDisabled(tanggal: string | null): boolean {
  if (!tanggal) return true;

  const tanggalKolokium = new Date(tanggal);
  if (Number.isNaN(tanggalKolokium.getTime())) return true;
  tanggalKolokium.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return today.getTime() >= tanggalKolokium.getTime();
}

// ------------------------------------------------------------------
// Muat daftar kartu kolokium milik mahasiswa login (server-side paginated)
// ------------------------------------------------------------------
async function loadKartuKolokium(page = 1): Promise<void> {
  const tbody = document.getElementById("kartu-tbody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="${COLSPAN}" class="px-4 py-6 text-center text-body-sm text-on-surface-variant">Memuat data...</td></tr>`;
  }

  const params = new URLSearchParams({
    page: String(page),
    per_page: String(getEntriesPerPage()),
  });
  if (currentSearch) {
    params.set("search", currentSearch);
  }

  try {
    const json = await apiFetch<KartuKolokiumListResponse>(
      `/auth/kartu-kolokium/my?${params.toString()}`
    );
    if (!json) return;

    const data = json.kartu_kolokiums;
    currentPage = data.current_page;

    renderTable(data);
    renderPaginationInfo(data);
    renderPaginationButtons(data);
  } catch (err) {
    console.error("Gagal memuat kartu kolokium:", err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="${COLSPAN}" class="px-4 py-6 text-center text-body-sm text-red-700">Gagal memuat data. Coba muat ulang halaman.</td></tr>`;
    }
  }
}

// ------------------------------------------------------------------
// Render isi tabel
// ------------------------------------------------------------------
function renderBatalkanCell(kartu: KartuKolokium): string {
  const disabled = isBatalDisabled(kartu.tanggal);

  const baseClass = "transition-transform";
  const activeClass = "text-error hover:scale-110 btn-batalkan-kartu";
  const disabledClass = "text-on-surface-variant/40 cursor-not-allowed";

  const title = disabled
    ? "Tidak bisa dibatalkan karena sudah hari-H"
    : "Batalkan kehadiran kolokium";

  return `
    <button
      type="button"
      class="${baseClass} ${disabled ? disabledClass : activeClass}"
      data-peserta-id="${kartu.peserta_kolokium_id}"
      aria-label="Batalkan kartu kolokium"
      title="${title}"
      ${disabled ? "disabled" : ""}
    >
      <span class="material-symbols-outlined">delete</span>
    </button>
  `;
}

function renderTable(data: PaginatedResponse<KartuKolokium>): void {
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
        <tr class="table-row-hover transition-colors align-top">
          <td class="px-4 py-4 text-body-sm align-top whitespace-nowrap">${formatTanggal(kartu.tanggal)}</td>
          <td class="px-4 py-4 text-body-sm align-top">${formatWaktu(kartu.waktu)}</td>
          <td class="px-4 py-4 align-top">${renderPemrasaranCell(kartu)}</td>
          <td class="px-4 py-4 text-body-sm align-top whitespace-nowrap">${escapeHtml(kartu.moderator)}</td>
          <td class="px-4 py-4 text-center align-top">${renderBatalkanCell(kartu)}</td>
        </tr>
      `
    )
    .join("");

  attachRowActionListeners();
}

// ------------------------------------------------------------------
// Info "Showing X to Y of Z entries"
// ------------------------------------------------------------------
function renderPaginationInfo(data: PaginatedResponse<KartuKolokium>): void {
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
function renderPaginationButtons(data: PaginatedResponse<KartuKolokium>): void {
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
        loadKartuKolokium(page);
      }
    });
  });
}

// ------------------------------------------------------------------
// Aksi Batalkan
// ------------------------------------------------------------------
function attachRowActionListeners(): void {
  document.querySelectorAll<HTMLButtonElement>(".btn-batalkan-kartu").forEach((btn) => {
    btn.addEventListener("click", () => handleBatalkan(btn));
  });
}

// Menjalankan PATCH /auth/peserta-kolokium/{peserta_kolokium_id}/status
// dengan body { status: "batal" }. Tombol ini hanya bisa diklik selama
// belum hari-H (lihat isBatalDisabled & renderBatalkanCell) — dan sebagai
// lapis kedua, backend (PesertaKolokiumController::updateStatus) juga
// akan menolak permintaan jika ternyata sudah hari-H.
async function handleBatalkan(btn: HTMLButtonElement): Promise<void> {
  const pesertaId = btn.dataset.pesertaId;
  if (!pesertaId) return;

  const confirmed = await confirmDialog({
    title: "Batalkan Kolokium?",
    message: "Apakah Anda yakin ingin membatalkan kehadiran kolokium ini? Tindakan ini tidak bisa dibatalkan.",
    variant: "danger",
    confirmText: "Ya, Batalkan",
  });
  if (!confirmed) return;

  clearMessage();
  btn.disabled = true;

  try {
    await apiFetch<{ message: string }>(`/auth/peserta-kolokium/${pesertaId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "batal" }),
    });

    showMessage("Berhasil membatalkan kehadiran kolokium.", "success");
    // Refresh halaman yang sedang aktif biar mahasiswa tidak "terlempar" ke halaman 1
    await loadKartuKolokium(currentPage);
  } catch (err) {
    console.error("Gagal membatalkan kartu kolokium:", err);
    showMessage(
      err instanceof Error ? err.message : "Gagal membatalkan kehadiran kolokium.",
      "error"
    );
    btn.disabled = false;
  }
}

// ------------------------------------------------------------------
// Search & per_page (server-side)
// ------------------------------------------------------------------
function initSearchAndActions(): void {
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
        loadKartuKolokium(1); // reset ke halaman 1 tiap kali kata kunci berubah
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  if (entriesSelect && entriesSelect.dataset.bound !== "true") {
    entriesSelect.dataset.bound = "true";
    entriesSelect.addEventListener("change", () => {
      loadKartuKolokium(1); // reset ke halaman 1 tiap kali per_page berubah
    });
  }
}

// ------------------------------------------------------------------
// Jalankan saat halaman siap
// ------------------------------------------------------------------
function initKartuKolokiumPage(): void {
  clearMessage();
  initSearchAndActions();
  loadKartuKolokium(1);
}

initKartuKolokiumPage();
document.addEventListener("astro:page-load", initKartuKolokiumPage);