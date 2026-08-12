// src/scripts/api/admin/jadwal-seminar.ts
// GET    /auth/seminar?page=N&search=...&per_page=N -> daftar semua seminar (paginated, admin)
// DELETE /auth/seminar/{id}                         -> hapus seminar (hanya admin)
//
// Aturan tombol aksi berdasarkan status:
// - pending  -> tombol Edit & Hapus muncul
// - rejected -> tombol Edit & Hapus muncul
// - approved -> kedua tombol hilang (final, tidak bisa diubah/dihapus dari UI)
//
// Tombol Edit adalah link ke /admin/form-update-seminar?id={id}, membawa admin ke form update seminar dengan data seminar yang dipilih, sehingga admin bisa mengubah status seminar tersebut.
// Tombol Hapus akan memanggil DELETE /auth/seminar/{id} untuk menghapus seminar tersebut, hanya bisa dilakukan oleh admin.
// Tombol Edit & Hapus hanya muncul untuk seminar yang belum disetujui (pending) atau ditolak (rejected), dan tidak muncul untuk seminar yang sudah disetujui (approved).
//
// KOLOM ABSENSI: tombol "Absensi" membuka halaman /admin/absensi-seminar
// dengan query param seminar_id, tempat admin bisa menandai kehadiran
// (statusparaf) peserta forum seminar tsb. Tombol hanya aktif kalau
// status seminar sudah "approved" — karena mahasiswa baru bisa daftar
// hadir (jadi peserta_seminar) setelah seminar disetujui admin
// (lihat PesertaSeminarController::store, validasi status === 'approved').
// Kalau belum approved, tombol disabled (tidak ada peserta yang mungkin
// terdaftar).
//
// SEARCH: input #jadwal-seminar-search dikirim ke backend lewat query param
// `search` (di-debounce 400ms), backend sudah nge-LIKE ke banyak kolom
// sekaligus (nama, nim, prodi, judul, dosen pembimbing/moderator, lokasi,
// ruangan). Kalau hasil kosong SAAT sedang search, tampilkan pesan khusus
// yang beda dari pesan "belum ada data" biasa.
//
// PER PAGE: select #jadwal-seminar-per-page dikirim ke backend lewat query
// param `per_page` (backend SeminarController::index sudah validasi
// min:1|max:100, default 10 kalau tidak dikirim/invalid).
//
// KONFIRMASI HAPUS: menggunakan ConfirmModal (src/components/ConfirmModal.astro)
// lewat helper confirmDialog() di src/scripts/lib/confirm-dialog.ts, bukan
// window.confirm() bawaan browser.

import { confirmDialog } from "../../lib/confirm-dialog";
import { showSuccess, showError } from "../../lib/info-dialog";

interface SeminarItem {
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
  status: "pending" | "approved" | "rejected";
  jumlahforum: number;
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

interface ApiErrorResponse {
  message: string;
}

const API_BASE_URL = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token";
const TBODY_ID = "jadwal-seminar-tbody";
const COLSPAN = 15;
const EDIT_FORM_PATH = "/admin/form-update-seminar";
const ABSENSI_PATH = "/admin/absensi-seminar";
const SEARCH_DEBOUNCE_MS = 400;
const DEFAULT_PER_PAGE = 10;

// BERKAS: daftar dokumen yang bisa di-export per seminar, mengikuti
// routes/api.php (SeminarController) — semua GET, butuh Bearer token,
// response-nya file .docx (bukan JSON), makanya di-download lewat fetch+blob
// bukan window.location, supaya header Authorization bisa disertakan.
interface BerkasDefinition {
  key: string;
  label: string;
  icon: string;
  path: (id: number) => string;
}

const BERKAS_LIST: BerkasDefinition[] = [
  {
    key: "rekap-nilai",
    label: "Rekapitulasi Nilai Seminar",
    icon: "assignment",
    path: (id) => `/seminar/${id}/export-rekapitulasi-nilai-seminar`,
  },
  {
    key: "lembar-penilaian",
    label: "Lembar Penilaian Seminar",
    icon: "fact_check",
    path: (id) => `/seminar/${id}/export-lembar-penilaian`,
  },
  {
    key: "daftar-hadir",
    label: "Daftar Hadir Seminar",
    icon: "how_to_reg",
    path: (id) => `/seminar/${id}/export-daftar-hadir-seminar`,
  },
  {
    key: "berita-acara",
    label: "Berita Acara Pelaksanaan Seminar",
    icon: "description",
    path: (id) => `/seminar/${id}/export-berita-acara-seminar`,
  },
];

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
  const select = document.getElementById("jadwal-seminar-per-page") as HTMLSelectElement | null;
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

function renderActionButtons(item: SeminarItem): string {
  if (item.status === "approved") {
    return `
      <button
        type="button"
        class="seminar-delete-btn text-red-600 hover:text-red-800"
        title="Hapus"
        data-id="${item.id}"
      >
        <span class="material-symbols-outlined text-lg">delete</span>
      </button>
    `;
  }

  return `
    <a
      href="${EDIT_FORM_PATH}?id=${item.id}"
      class="text-blue-600 hover:text-blue-800"
      title="Edit"
    >
      <span class="material-symbols-outlined text-lg">edit</span>
    </a>
    <button
      type="button"
      class="seminar-delete-btn text-red-600 hover:text-red-800"
      title="Hapus"
      data-id="${item.id}"
    >
      <span class="material-symbols-outlined text-lg">delete</span>
    </button>
  `;
}

function renderBerkasButton(item: SeminarItem): string {
  return `
    <button
      type="button"
      class="seminar-berkas-btn inline-flex items-center gap-1.5 bg-primary-container text-on-primary px-3 py-1.5 rounded-lg text-body-sm font-bold hover:bg-primary transition-all active:scale-95"
      data-seminar-id="${item.id}"
      data-seminar-nama="${escapeHtml(item.nama ?? "-")}"
      title="Lihat Berkas"
    >
      <span class="material-symbols-outlined text-[18px]">folder_open</span>
      Berkas
    </button>
  `;
}

function renderAbsensiButton(item: SeminarItem): string {
  const isApproved = item.status === "approved";
  const disabledClass = "opacity-40 cursor-not-allowed";
  const title = isApproved
    ? "Buka Absensi"
    : "Seminar harus berstatus disetujui sebelum bisa diabsen";

  return `
    <button
      type="button"
      class="seminar-absensi-btn inline-flex items-center gap-1.5 bg-primary-container text-on-primary px-3 py-1.5 rounded-lg text-body-sm font-bold hover:bg-primary transition-all active:scale-95 ${!isApproved ? disabledClass : ""}"
      data-seminar-id="${item.id}"
      title="${title}"
      ${!isApproved ? "disabled" : ""}
    >
      <span class="material-symbols-outlined text-[18px]">fact_check</span>
      Absensi
    </button>
  `;
}

function renderRow(item: SeminarItem, rowNumber: number): string {
  return `
    <tr class="table-row-hover transition-colors" data-row-id="${item.id}">
      <td class="px-4 py-4 text-body-sm">${rowNumber}</td>
      <td class="px-4 py-4 text-body-sm font-medium whitespace-nowrap">${escapeHtml(item.nama ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.nim ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.prodi ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.namadosenpembimbing ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.judul ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.lokasi ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${formatTanggal(item.tanggal ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.waktu ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.namadosenmoderator ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.ruangan ?? "-")}</td>
      <td class="px-4 py-4 text-center">
        ${renderBerkasButton(item)}
      </td>
      <td class="px-4 py-4 text-center">
        ${renderAbsensiButton(item)}
      </td>
      <td class="px-4 py-4 text-body-sm">
        <span class="px-2 py-1 rounded text-white text-xs font-medium ${STATUS_BADGE_CLASS[item.status]} whitespace-nowrap">
          ${STATUS_LABEL[item.status]}
        </span>
      </td>
      <td class="px-4 py-4 text-body-sm">
        <div class="flex items-center gap-2">
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

function renderPaginationInfo(data: PaginatedResponse<SeminarItem>): void {
  const infoEl = document.getElementById("jadwal-seminar-pagination-info");
  if (infoEl) {
    if (data.total === 0) {
      infoEl.textContent = currentSearch
        ? `Tidak ada hasil untuk "${currentSearch}"`
        : "Tidak ada data";
    } else {
      infoEl.textContent = `Showing ${data.from ?? 0} to ${data.to ?? 0} of ${data.total} entries`;
    }
  }

  const pageLabel = document.getElementById("jadwal-seminar-page-label");
  if (pageLabel) {
    pageLabel.textContent = `${data.current_page} / ${data.last_page}`;
  }

  const firstBtn = document.getElementById("jadwal-seminar-first-btn") as HTMLButtonElement | null;
  const prevBtn = document.getElementById("jadwal-seminar-prev-btn") as HTMLButtonElement | null;
  const nextBtn = document.getElementById("jadwal-seminar-next-btn") as HTMLButtonElement | null;
  const lastBtn = document.getElementById("jadwal-seminar-last-btn") as HTMLButtonElement | null;

  const atFirst = data.current_page <= 1;
  const atLast = data.current_page >= data.last_page;

  if (firstBtn) firstBtn.disabled = atFirst;
  if (prevBtn) prevBtn.disabled = atFirst;
  if (nextBtn) nextBtn.disabled = atLast;
  if (lastBtn) lastBtn.disabled = atLast;
}

function renderTable(data: PaginatedResponse<SeminarItem>): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;

  if (data.data.length === 0) {
    if (currentSearch) {
      renderMessageRow(`Tidak ditemukan hasil untuk pencarian "${currentSearch}".`);
    } else {
      renderMessageRow("Belum ada data seminar.");
    }
    return;
  }

  const startNumber = data.from ?? 1;
  tbody.innerHTML = data.data.map((item, idx) => renderRow(item, startNumber + idx)).join("");
}

async function loadJadwalSeminars(page = 1): Promise<void> {
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
    const res = await fetch(`${API_BASE_URL}/auth/seminar?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (redirectIfUnauthorized(res.status)) return;

    if (!res.ok) {
      renderMessageRow("Gagal memuat data seminar.", "error");
      return;
    }

    const data: PaginatedResponse<SeminarItem> = await res.json();
    currentPage = data.current_page;
    renderTable(data);
    renderPaginationInfo(data);
  } catch (err) {
    console.error("Gagal ambil daftar seminar:", err);
    renderMessageRow("Terjadi kesalahan jaringan.", "error");
  }
}

async function deleteSeminar(id: number): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/";
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/seminar/${id}`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (redirectIfUnauthorized(res.status)) return;

    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as ApiErrorResponse;
      showError(errJson.message ?? "Gagal menghapus seminar.");
      return;
    }

    showSuccess("Seminar berhasil dihapus.");
    await loadJadwalSeminars(currentPage);
  } catch (err) {
    console.error("Gagal menghapus seminar:", err);
    showError("Terjadi kesalahan jaringan. Coba lagi.");
  }
}

function initActionButtons(): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;
  if (tbody.dataset.bound === "true") return;
  tbody.dataset.bound = "true";

  tbody.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const deleteBtn = target.closest<HTMLElement>(".seminar-delete-btn");
    if (!deleteBtn) return;

    const id = Number(deleteBtn.dataset.id);
    if (!id) return;

    const ok = await confirmDialog({
      title: "Hapus Seminar?",
      message: "Data seminar yang dihapus tidak bisa dikembalikan. Lanjutkan?",
      variant: "danger",
      confirmText: "Ya, Hapus",
    });
    if (!ok) return;

    deleteSeminar(id);
  });
}

// ============================================================
// MODAL BERKAS
// ============================================================

// state file yang lagi didownload, biar tombolnya dikasih loading state
// dan tidak bisa diklik dobel selagi proses download berjalan
const downloadingKeys = new Set<string>();

function getBerkasModalEls() {
  return {
    overlay: document.getElementById("berkas-modal-overlay"),
    subtitle: document.getElementById("berkas-modal-subtitle"),
    body: document.getElementById("berkas-modal-body"),
    closeBtn: document.getElementById("berkas-modal-close-btn"),
  };
}

function renderBerkasModalBody(seminarId: number): void {
  const { body } = getBerkasModalEls();
  if (!body) return;

  body.innerHTML = BERKAS_LIST.map((berkas) => {
    const isLoading = downloadingKeys.has(berkas.key);
    return `
      <button
        type="button"
        class="berkas-download-btn flex items-center justify-between gap-3 px-4 py-3 border border-outline-variant rounded-lg hover:bg-surface-container-low transition-colors text-left disabled:opacity-60 disabled:cursor-not-allowed"
        data-berkas-key="${berkas.key}"
        data-seminar-id="${seminarId}"
        ${isLoading ? "disabled" : ""}
      >
        <span class="flex items-center gap-3">
          <span class="material-symbols-outlined text-primary">${berkas.icon}</span>
          <span class="text-body-sm font-medium">${berkas.label}</span>
        </span>
        <span class="material-symbols-outlined text-on-surface-variant text-[20px]">
          ${isLoading ? "progress_activity" : "download"}
        </span>
      </button>
    `;
  }).join("");
}

function openBerkasModal(seminarId: number, nama: string): void {
  const { overlay, subtitle } = getBerkasModalEls();
  if (!overlay) return;

  if (subtitle) subtitle.textContent = nama;
  overlay.dataset.seminarId = String(seminarId);
  overlay.dataset.seminarNama = nama;

  renderBerkasModalBody(seminarId);

  overlay.classList.remove("hidden");
  overlay.classList.add("flex");
}

function closeBerkasModal(): void {
  const { overlay } = getBerkasModalEls();
  if (!overlay) return;

  overlay.classList.add("hidden");
  overlay.classList.remove("flex");
}

// Ambil nama file asli dari header Content-Disposition kalau ada,
// fallback ke nama default kalau backend tidak mengirimnya.
function extractFilename(res: Response, fallback: string): string {
  const disposition = res.headers.get("Content-Disposition");
  if (!disposition) return fallback;

  const match = disposition.match(/filename="?([^"]+)"?/);
  return match?.[1] ?? fallback;
}

// Label per key dipakai buat nama file fallback, biar hasilnya konsisten
// sama pola nama file yang dibuat backend (mis. "Rekap_Nilai_Seminar_Budi.docx")
// alih-alih "rekap-nilai-4.docx" yang kurang deskriptif.
const BERKAS_FALLBACK_PREFIX: Record<string, string> = {
  "rekap-nilai": "Rekap_Nilai_Seminar",
  "lembar-penilaian": "Lembar_Penilaian_Seminar",
  "daftar-hadir": "Daftar_Hadir_Seminar",
  "berita-acara": "Berita_Acara_Seminar",
};

async function downloadBerkas(berkas: BerkasDefinition, seminarId: number, seminarNama: string): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/";
    return;
  }

  if (downloadingKeys.has(berkas.key)) return; // cegah klik dobel
  downloadingKeys.add(berkas.key);
  renderBerkasModalBody(seminarId);

  try {
    const res = await fetch(`${API_BASE_URL}/auth${berkas.path(seminarId)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (redirectIfUnauthorized(res.status)) return;

    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as ApiErrorResponse;
      showError(errJson.message ?? `Gagal mengunduh ${berkas.label}.`);
      return;
    }

    const blob = await res.blob();
    const namaFile = seminarNama.trim() ? seminarNama.replace(/\s+/g, "_") : String(seminarId);
    const prefix = BERKAS_FALLBACK_PREFIX[berkas.key] ?? berkas.key;
    const fileName = extractFilename(res, `${prefix}_${namaFile}.docx`);

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error(`Gagal mengunduh ${berkas.label}:`, err);
    showError("Terjadi kesalahan jaringan. Coba lagi.");
  } finally {
    downloadingKeys.delete(berkas.key);
    renderBerkasModalBody(seminarId);
  }
}

function initBerkasModal(): void {
  const { overlay, closeBtn, body } = getBerkasModalEls();
  if (!overlay || overlay.dataset.bound === "true") return;
  overlay.dataset.bound = "true";

  closeBtn?.addEventListener("click", closeBerkasModal);

  // klik di luar konten modal (di area overlay gelap) juga menutup modal
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeBerkasModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeBerkasModal();
  });

  body?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>(".berkas-download-btn");
    if (!btn || btn.hasAttribute("disabled")) return;

    const key = btn.dataset.berkasKey;
    const seminarId = Number(btn.dataset.seminarId);
    const berkas = BERKAS_LIST.find((b) => b.key === key);
    if (!berkas || !seminarId) return;

    const seminarNama = overlay.dataset.seminarNama ?? "";
    downloadBerkas(berkas, seminarId, seminarNama);
  });
}

function initBerkasButtons(): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;
  if (tbody.dataset.berkasBound === "true") return;
  tbody.dataset.berkasBound = "true";

  tbody.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>(".seminar-berkas-btn");
    if (!btn) return;

    const seminarId = Number(btn.dataset.seminarId);
    const nama = btn.dataset.seminarNama ?? "-";
    if (!seminarId) return;

    openBerkasModal(seminarId, nama);
  });
}

function initAbsensiButtons(): void {
  const tbody = document.getElementById(TBODY_ID);
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

    window.location.href = `${ABSENSI_PATH}?seminar_id=${seminarId}`;
  });
}

function initPagination(): void {
  const firstBtn = document.getElementById("jadwal-seminar-first-btn");
  const prevBtn = document.getElementById("jadwal-seminar-prev-btn");
  const nextBtn = document.getElementById("jadwal-seminar-next-btn");
  const lastBtn = document.getElementById("jadwal-seminar-last-btn");

  firstBtn?.addEventListener("click", () => loadJadwalSeminars(1));
  prevBtn?.addEventListener("click", () => loadJadwalSeminars(Math.max(1, currentPage - 1)));
  nextBtn?.addEventListener("click", () => loadJadwalSeminars(currentPage + 1));
  lastBtn?.addEventListener("click", () => {
    const pageLabel = document.getElementById("jadwal-seminar-page-label");
    const lastPage = pageLabel?.textContent?.split("/")[1]?.trim();
    if (lastPage) loadJadwalSeminars(Number(lastPage));
  });
}

function initSearch(): void {
  const searchInput = document.getElementById("jadwal-seminar-search") as HTMLInputElement | null;
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
      loadJadwalSeminars(1); // reset ke halaman 1 tiap kali kata kunci berubah
    }, SEARCH_DEBOUNCE_MS);
  });
}

function initPerPage(): void {
  const select = document.getElementById("jadwal-seminar-per-page") as HTMLSelectElement | null;
  if (!select) return;
  if (select.dataset.bound === "true") return;
  select.dataset.bound = "true";

  select.addEventListener("change", () => {
    loadJadwalSeminars(1); // reset ke halaman 1 tiap kali per_page berubah
  });
}

function initJadwalSeminarsPage(): void {
  loadJadwalSeminars(1);
  initActionButtons();
  initAbsensiButtons();
  initBerkasButtons();
  initBerkasModal();
  initPagination();
  initSearch();
  initPerPage();
}

initJadwalSeminarsPage();
document.addEventListener("astro:page-load", initJadwalSeminarsPage);