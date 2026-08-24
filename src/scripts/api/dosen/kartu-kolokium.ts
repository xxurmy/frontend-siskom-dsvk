// src/scripts/api/dosen/kartu-kolokium.ts
// GET   /auth/kartu-kolokium/my?page=N&search=...&per_page=N  -> daftar kartu kolokium yang dimoderatori dosen ini (paginated)
// PATCH /auth/kartu-kolokium/{id}/status-paraf                -> ubah status jadi 'signed' atau 'absent'
//
// Aturan tombol aksi (sesuai status & tanggal):
// - Kolokium belum hari-H (tanggal > hari ini) -> tombol "Tandatangani" & "Tidak
//   Hadir" SAMA-SAMA disabled, apapun statusparaf-nya, karena backend
//   (KartuKolokiumController::updateStatusParaf) menolak permintaan sebelum
//   hari-H lewat pengecekan Carbon::today()->lt(tanggal). Tombol di UI
//   sengaja dibuat konsisten dengan validasi ini.
// - Sudah hari-H atau setelahnya, mengikuti statusparaf:
//   - pending -> tombol "Tandatangani" & "Tidak Hadir" sama-sama muncul (aktif)
//   - absent  -> tombol "Tidak Hadir" hilang (sudah absent), "Tandatangani" tetap ada
//                (dosen masih bisa mengubah dari absent -> signed)
//   - signed  -> kedua tombol hilang (status final, tidak bisa diubah lagi;
//                backend juga sudah menolak perubahan lain saat statusparaf sudah signed)
//
// SEARCH: input #kartu-kolokium-search dikirim ke backend lewat query param
// `search` (di-debounce 400ms), backend nge-LIKE ke nama/nim pemrasaran,
// prodi, moderator, serta nama/nim forum. Kalau hasil kosong SAAT sedang
// search, tampilkan pesan khusus yang beda dari pesan "belum ada data" biasa.
//
// PER PAGE: select #entries-per-page dikirim ke backend lewat query param
// `per_page` (backend KartuKolokiumController::my sudah validasi
// min:1|max:100, default 10 kalau tidak dikirim/invalid).
//
// KONFIRMASI TANDATANGANI / TIDAK HADIR: menggunakan ConfirmModal
// (src/components/ConfirmModal.astro) lewat helper confirmDialog() di
// src/scripts/lib/confirm-dialog.ts, bukan window.confirm() bawaan browser.
// Ikon & warna modal disesuaikan dengan tombol yang memicunya:
// - Tandatangani -> ikon "draw", variant "primary"
// - Tidak Hadir   -> ikon "person_off", variant "danger"
//
// PESAN STATUS: menggunakan showMessage()/clearMessage() ke elemen
// #kartu-message (strukturnya disamakan dengan halaman mahasiswa
// src/scripts/api/mahasiswa/KartuKolokium.ts & jadwal-kolokium.ts),
// dipakai untuk pesan berhasil/gagal setelah Tandatangani / Tidak Hadir.
//
// TAMPILAN KOLOM (disamakan dengan pola tabel jadwal-kolokium dosen):
// - Kolom Nama Pemrasaran/NIM/Prodi digabung jadi satu kolom "Pemrasaran":
//   nama (bold) di baris atas, lalu "NIM · Prodi" di baris bawah dengan
//   teks lebih kecil.
// - Kolom Nama Forum/NIM Forum digabung jadi satu kolom "Forum": pola yang
//   sama seperti Pemrasaran (nama di atas, NIM di bawah), tapi TANPA prodi
//   karena forum tidak punya data prodi.
// - Kolom lain (Moderator, Paraf, Aksi) tidak berubah.

import { confirmDialog } from "../../lib/confirm-dialog";

interface KartuKolokium {
  id: number;
  kolokium_id: number;
  pemrasaran_id: number;
  moderator_id: number;
  peserta_kolokium_id: number;
  forum_id: number;
  tanggal: string | null;
  waktu: string | null;
  namapemrasaran: string | null;
  nimpemrasaran: string | null;
  prodi: string | null;
  moderator: string | null;
  namaforum?: string | null;
  nimforum?: string | null;
  tandatangandosen: string | null;
  statusparaf: "pending" | "signed" | "absent";
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

interface UpdateStatusParafResponse {
  message: string;
  kartu_kolokium: KartuKolokium;
}

interface ApiErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

const API_BASE_URL = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token";
const TBODY_ID = "kartu-kolokium-tbody";
const COLSPAN = 7;
const SEARCH_DEBOUNCE_MS = 400;
const DEFAULT_PER_PAGE = 10;

const STATUS_LABEL: Record<KartuKolokium["statusparaf"], string> = {
  pending: "Belum ditanda tangani",
  signed: "Sudah ditanda tangan",
  absent: "Tidak Hadir",
};

const STATUS_BADGE_CLASS: Record<KartuKolokium["statusparaf"], string> = {
  pending: "bg-outline/10 text-on-surface-variant border border-outline/20",
  signed: "bg-secondary/10 text-secondary border border-secondary/20",
  absent: "bg-error/10 text-error border border-error/20",
};

let currentPage = 1;
let currentSearch = "";
let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function redirectIfUnauthorized(status: number): boolean {
  if (status === 401) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.href = "/";
    return true;
  }
  return false;
}

function getEntriesPerPage(): number {
  const select = document.getElementById("entries-per-page") as HTMLSelectElement | null;
  const value = select ? parseInt(select.value, 10) : DEFAULT_PER_PAGE;
  return Number.isNaN(value) || value < 1 ? DEFAULT_PER_PAGE : value;
}

// ------------------------------------------------------------------
// Pesan status (samakan strukturnya dengan halaman mahasiswa)
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
// Aturan aktif/nonaktif tombol Tandatangani & Tidak Hadir
// - Aktif  : hari ini >= tanggal kolokium (sudah hari-H atau setelahnya)
// - Nonaktif: hari ini < tanggal kolokium (masih sebelum hari-H),
//   atau tanggal tidak diketahui (untuk berjaga-jaga)
// Catatan: aturan ini mencerminkan validasi yang sama di
// KartuKolokiumController::updateStatusParaf (backend juga menolak jika
// belum hari-H via Carbon::today()->lt(...)), jadi tombol di UI sudah
// konsisten dengan backend.
// ------------------------------------------------------------------
function isBeforeHariH(tanggal: string | null): boolean {
  if (!tanggal) return true;

  const tanggalKolokium = new Date(tanggal);
  if (Number.isNaN(tanggalKolokium.getTime())) return true;
  tanggalKolokium.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return today.getTime() < tanggalKolokium.getTime();
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function formatTanggal(dateStr: string | null): string {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatWaktu(waktu: string | null): string {
  if (!waktu) return "-";
  return waktu.slice(0, 5); // "14:00:00" -> "14:00"
}

// ------------------------------------------------------------------
// SEL "PEMRASARAN" (gabungan Nama / NIM / Prodi) — sama seperti
// tabel jadwal-kolokium.
// ------------------------------------------------------------------
function renderPemrasaranCell(item: KartuKolokium): string {
  const nama = escapeHtml(item.namapemrasaran ?? "-");
  const nim = escapeHtml(item.nimpemrasaran ?? "-");
  const prodi = escapeHtml(item.prodi ?? "-");
  return `
    <div class="leading-snug">
      <div class="text-body-sm font-bold text-on-surface">${nama}</div>
      <div class="text-xs text-on-surface-variant mt-0.5">${nim} · ${prodi}</div>
    </div>
  `;
}

// ------------------------------------------------------------------
// SEL "FORUM" (gabungan Nama Forum / NIM Forum) — pola sama seperti
// Pemrasaran, tapi TANPA baris prodi karena forum tidak punya data prodi.
// ------------------------------------------------------------------
function renderForumCell(item: KartuKolokium): string {
  const namaForum = item.namaforum;
  const nimForum = item.nimforum;

  if (!namaForum && !nimForum) {
    return `<span class="text-body-sm text-on-surface">-</span>`;
  }

  const nama = escapeHtml(namaForum ?? "-");
  const nim = escapeHtml(nimForum ?? "-");
  return `
    <div class="leading-snug">
      <div class="text-body-sm font-bold text-on-surface">${nama}</div>
      <div class="text-xs text-on-surface-variant mt-0.5">${nim}</div>
    </div>
  `;
}

function renderActionButtons(item: KartuKolokium): string {
  if (item.statusparaf === "signed") {
    return `<span class="text-body-sm text-on-surface-variant">-</span>`;
  }

  const belumHariH = isBeforeHariH(item.tanggal);
  const disabledClass = "opacity-40 cursor-not-allowed";

  const signTitle = belumHariH
    ? "Belum bisa ditandatangani — tunggu sampai hari-H kolokium"
    : "Tandatangani";

  let html = `
    <button
      type="button"
      class="kartu-sign-btn text-secondary hover:bg-secondary/10 rounded-lg p-2 transition-colors ${belumHariH ? disabledClass : ""}"
      title="${signTitle}"
      data-id="${item.id}"
      ${belumHariH ? "disabled" : ""}
    >
      <span class="material-symbols-outlined">draw</span>
    </button>
  `;

  if (item.statusparaf !== "absent") {
    const absentTitle = belumHariH
      ? "Belum bisa ditandai — tunggu sampai hari-H kolokium"
      : "Tidak Hadir";

    html += `
      <button
        type="button"
        class="kartu-absent-btn text-error hover:bg-error/10 rounded-lg p-2 transition-colors ${belumHariH ? disabledClass : ""}"
        title="${absentTitle}"
        data-id="${item.id}"
        ${belumHariH ? "disabled" : ""}
      >
        <span class="material-symbols-outlined">person_off</span>
      </button>
    `;
  }

  return html;
}

function renderRow(item: KartuKolokium): string {
  return `
    <tr class="table-row-hover transition-colors align-top" data-row-id="${item.id}">
      <td class="px-4 py-4 text-body-sm align-top break-words">${formatTanggal(item.tanggal)}</td>
      <td class="px-4 py-4 text-body-sm align-top">${formatWaktu(item.waktu)}</td>
      <td class="px-4 py-4 align-top">${renderPemrasaranCell(item)}</td>
      <td class="px-4 py-4 text-body-sm align-top break-words">${escapeHtml(item.moderator ?? "-")}</td>
      <td class="px-4 py-4 align-top">${renderForumCell(item)}</td>
      <td class="px-4 py-4 align-top">
        <span class="${STATUS_BADGE_CLASS[item.statusparaf]} px-3 py-1 rounded-full text-[12px] font-bold whitespace-nowrap">
          ${STATUS_LABEL[item.statusparaf]}
        </span>
      </td>
      <td class="px-4 py-4 align-top">
        <div class="flex justify-center gap-2">
          ${renderActionButtons(item)}
        </div>
      </td>
    </tr>
  `;
}

function renderMessageRow(message: string, variant: "info" | "error" = "info"): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;
  const colorClass = variant === "error" ? "text-error" : "text-on-surface-variant";
  tbody.innerHTML = `
    <tr>
      <td colspan="${COLSPAN}" class="px-4 py-8 text-center text-body-sm ${colorClass}">
        ${escapeHtml(message)}
      </td>
    </tr>
  `;
}

function renderTable(data: PaginatedResponse<KartuKolokium>): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;

  if (data.data.length === 0) {
    if (currentSearch) {
      renderMessageRow(`Tidak ditemukan hasil untuk pencarian "${currentSearch}".`);
    } else {
      renderMessageRow("Belum ada data kartu kolokium.");
    }
    return;
  }

  tbody.innerHTML = data.data.map(renderRow).join("");
}

function renderPaginationInfo(data: PaginatedResponse<KartuKolokium>): void {
  const infoEl = document.getElementById("kartu-kolokium-pagination-info");
  if (infoEl) {
    if (data.total === 0) {
      infoEl.textContent = currentSearch
        ? `Tidak ada hasil untuk "${currentSearch}"`
        : "Tidak ada data.";
    } else {
      infoEl.textContent = `Showing ${data.from ?? 0} to ${data.to ?? 0} of ${data.total} entries`;
    }
  }

  const container = document.getElementById("kartu-kolokium-pagination-buttons");
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
        loadKartuKolokium(page);
      }
    });
  });
}

async function loadKartuKolokium(page = 1): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/";
    return;
  }

  renderMessageRow("Memuat data...");

  const params = new URLSearchParams({
    page: String(page),
    per_page: String(getEntriesPerPage()),
  });
  if (currentSearch) {
    params.set("search", currentSearch);
  }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/kartu-kolokium/my?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (redirectIfUnauthorized(res.status)) return;

    if (!res.ok) {
      renderMessageRow("Gagal memuat data kartu kolokium.", "error");
      return;
    }

    const json: KartuKolokiumListResponse = await res.json();
    const data = json.kartu_kolokiums;
    currentPage = data.current_page;

    renderTable(data);
    renderPaginationInfo(data);
  } catch (err) {
    console.error("Gagal ambil kartu kolokium:", err);
    renderMessageRow("Terjadi kesalahan jaringan.", "error");
  }
}

async function updateStatusParaf(id: number, statusparaf: "signed" | "absent"): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/";
    return;
  }

  clearMessage();

  try {
    const res = await fetch(`${API_BASE_URL}/auth/kartu-kolokium/${id}/status-paraf`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ statusparaf }),
    });

    if (redirectIfUnauthorized(res.status)) return;

    const json = (await res.json()) as UpdateStatusParafResponse | ApiErrorResponse;

    if (!res.ok) {
      const errJson = json as ApiErrorResponse;
      showMessage(errJson.message ?? "Gagal memperbarui status paraf.", "error");
      return;
    }

    const successText =
      statusparaf === "signed"
        ? "Berhasil menandatangani kartu kolokium."
        : "Berhasil menandai mahasiswa tidak hadir.";
    showMessage(successText, "success");

    // Refresh halaman yang sedang aktif biar data & tombol aksi tetap konsisten dengan server
    await loadKartuKolokium(currentPage);
  } catch (err) {
    console.error("Gagal update status paraf kartu kolokium:", err);
    showMessage("Terjadi kesalahan jaringan. Coba lagi.", "error");
  }
}

function initActionButtons(): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;
  if (tbody.dataset.bound === "true") return;
  tbody.dataset.bound = "true";

  tbody.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;

    const signBtn = target.closest<HTMLElement>(".kartu-sign-btn");
    if (signBtn) {
      if (signBtn.hasAttribute("disabled")) return;
      const id = Number(signBtn.dataset.id);
      if (!id) return;

      const ok = await confirmDialog({
        title: "Tandatangani Kolokium?",
        message: "Kartu kolokium ini akan ditandai sebagai sudah ditandatangani.",
        variant: "primary",
        confirmText: "Ya, Tandatangani",
        icon: "draw", // menimpa icon default "help" milik variant primary
      });
      if (!ok) return;

      updateStatusParaf(id, "signed");
      return;
    }

    const absentBtn = target.closest<HTMLElement>(".kartu-absent-btn");
    if (absentBtn) {
      if (absentBtn.hasAttribute("disabled")) return;
      const id = Number(absentBtn.dataset.id);
      if (!id) return;

      const ok = await confirmDialog({
        title: "Tandai Tidak Hadir?",
        message: "Mahasiswa ini akan ditandai tidak hadir pada kolokium ini.",
        variant: "danger",
        confirmText: "Ya, Tidak Hadir",
        icon: "person_off", // menimpa icon default "delete" milik variant danger
      });
      if (!ok) return;

      updateStatusParaf(id, "absent");
    }
  });
}

function initSearch(): void {
  const searchInput = document.getElementById("kartu-kolokium-search") as HTMLInputElement | null;
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
      loadKartuKolokium(1); // reset ke halaman 1 tiap kali kata kunci berubah
    }, SEARCH_DEBOUNCE_MS);
  });
}

function initPerPage(): void {
  const select = document.getElementById("entries-per-page") as HTMLSelectElement | null;
  if (!select) return;
  if (select.dataset.bound === "true") return;
  select.dataset.bound = "true";

  select.addEventListener("change", () => {
    loadKartuKolokium(1); // reset ke halaman 1 tiap kali per_page berubah
  });
}

function initKartuKolokiumPage(): void {
  clearMessage();
  loadKartuKolokium(1);
  initActionButtons();
  initSearch();
  initPerPage();
}

initKartuKolokiumPage();
document.addEventListener("astro:page-load", initKartuKolokiumPage);