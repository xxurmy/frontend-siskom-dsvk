// src/scripts/api/admin/jadwal-kolokium.ts
// GET    /auth/kolokium?page=N&search=...&per_page=N  -> daftar semua kolokium (paginated, admin)
// DELETE /auth/kolokium/{id}                          -> hapus kolokium (hanya admin)
//
// Aturan tombol aksi berdasarkan status:
// - pending  -> tombol Edit & Hapus muncul
// - rejected -> tombol Edit & Hapus muncul
// - approved -> kedua tombol hilang (final, tidak bisa diubah/dihapus dari UI)
//
// Tombol Edit adalah link ke /admin/form-update-kolokium?id={id}, membawa admin ke form update kolokium dengan data kolokium yang dipilih, sehingga admin bisa mengubah status kolokium tersebut.
// Tombol Hapus akan memanggil DELETE /auth/kolokium/{id} untuk menghapus kolokium tersebut, hanya bisa dilakukan oleh admin.
// Tombol Edit & Hapus hanya muncul untuk kolokium yang belum disetujui (pending) atau ditolak (rejected), dan tidak muncul untuk kolokium yang sudah disetujui (approved).
//
// KOLOM ABSENSI: tombol "Absensi" membuka halaman /admin/absensi-kolokium
// dengan query param kolokium_id, tempat admin bisa menandai kehadiran
// (statusparaf) peserta forum kolokium tsb. Tombol hanya aktif kalau
// status kolokium sudah "approved" — karena mahasiswa baru bisa daftar
// hadir (jadi peserta_kolokium) setelah kolokium disetujui admin
// (lihat PesertaKolokiumController::store, validasi status === 'approved').
// Kalau belum approved, tombol disabled (tidak ada peserta yang mungkin
// terdaftar).
//
// SEARCH: input #jadwal-kolokium-search dikirim ke backend lewat query param
// `search` (di-debounce 400ms), backend sudah nge-LIKE ke banyak kolom
// sekaligus (nama, nim, prodi, judul, dosen pembimbing/moderator, lokasi,
// ruangan). Kalau hasil kosong SAAT sedang search, tampilkan pesan khusus
// yang beda dari pesan "belum ada data" biasa.
//
// PER PAGE: select #jadwal-kolokium-per-page dikirim ke backend lewat query
// param `per_page` (backend KolokiumController::index sudah validasi
// min:1|max:100, default 10 kalau tidak dikirim/invalid).
//
// KONFIRMASI HAPUS: menggunakan ConfirmModal (src/components/ConfirmModal.astro)
// lewat helper confirmDialog() di src/scripts/lib/confirm-dialog.ts, bukan
// window.confirm() bawaan browser.
//
// TAMPILAN KOLOM (mengikuti referensi desain):
// - Kolom Nama/NIM/Prodi digabung jadi satu kolom "Pemrasaran": nama (bold)
//   di baris atas, lalu "NIM · Prodi" di baris bawah dengan teks lebih kecil.
// - Kolom Judul dipotong beberapa kata saja, dengan tombol untuk
//   menampilkan/menyembunyikan teks lengkap LANGSUNG di dalam sel yang sama
//   (tanpa modal) — klik tombol lagi untuk mempersingkat kembali.
// - Kolom Dosen Pembimbing selalu ditampilkan penuh apa adanya, tanpa
//   dipotong dan tanpa tombol.
// - Sel Pemrasaran/Dosen Pembimbing/Judul/Lokasi/Tanggal/Moderator/Ruangan
//   tidak dipaksa satu baris (whitespace-nowrap dihapus) supaya baris
//   melebar ke bawah, bukan ke samping, saat teks tidak muat. Kolom
//   Dokumen, Absensi, Status, dan Aksi tetap seperti semula.

import { confirmDialog } from "../../lib/confirm-dialog";
import { showSuccess, showError } from "../../lib/info-dialog";

interface KolokiumItem {
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
const TBODY_ID = "jadwal-kolokium-tbody";
const COLSPAN = 13;
const EDIT_FORM_PATH = "/admin/form-update-kolokium";
const ABSENSI_PATH = "/admin/absensi-kolokium";
const SEARCH_DEBOUNCE_MS = 400;
const DEFAULT_PER_PAGE = 10;
const JUDUL_WORD_LIMIT = 4;

// BERKAS: daftar dokumen yang bisa di-export per kolokium, mengikuti
// routes/api.php (KolokiumController) — semua GET, butuh Bearer token,
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
    label: "Rekapitulasi Nilai Kolokium",
    icon: "assignment",
    path: (id) => `/kolokium/${id}/export-rekapitulasi-nilai-kolokium`,
  },
  {
    key: "lembar-penilaian",
    label: "Lembar Penilaian Kolokium",
    icon: "fact_check",
    path: (id) => `/kolokium/${id}/export-lembar-penilaian-kolokium`,
  },
  {
    key: "daftar-hadir",
    label: "Daftar Hadir Kolokium",
    icon: "how_to_reg",
    path: (id) => `/kolokium/${id}/export-daftar-hadir-kolokium`,
  },
  {
    key: "berita-acara",
    label: "Berita Acara Pelaksanaan Kolokium",
    icon: "description",
    path: (id) => `/kolokium/${id}/export-berita-acara-kolokium`,
  },
  {
    key: "kesediaan-moderator",
    label: "Surat Kesediaan Moderator Kolokium",
    icon: "how_to_vote",
    path: (id) => `/kolokium/${id}/export-kesediaan-moderator-kolokium`,
  },
  {
    key: "pengumuman",
    label: "Pengumuman Kolokium",
    icon: "campaign",
    path: (id) => `/kolokium/${id}/export-pengumuman-kolokium`,
  },
];

const STATUS_LABEL: Record<KolokiumItem["status"], string> = {
  pending: "Belum diterima",
  approved: "Sudah diterima",
  rejected: "Ditolak",
};

const STATUS_BADGE_CLASS: Record<KolokiumItem["status"], string> = {
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
  const select = document.getElementById("jadwal-kolokium-per-page") as HTMLSelectElement | null;
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

// ============================================================
// SEL "PEMRASARAN" (gabungan Nama / NIM / Prodi)
// ============================================================

function renderPemrasaranCell(item: KolokiumItem): string {
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

function renderJudulCell(item: KolokiumItem): string {
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
function renderDosenPembimbingCell(item: KolokiumItem): string {
  const text = item.namadosenpembimbing;
  if (!text) {
    return `<span class="text-body-sm text-on-surface">-</span>`;
  }
  return `<span class="text-body-sm text-on-surface">${escapeHtml(text)}</span>`;
}

function renderActionButtons(item: KolokiumItem): string {
  if (item.status === "approved") {
    return `
      <button
        type="button"
        class="kolokium-delete-btn text-red-600 hover:text-red-800"
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
      class="kolokium-delete-btn text-red-600 hover:text-red-800"
      title="Hapus"
      data-id="${item.id}"
    >
      <span class="material-symbols-outlined text-lg">delete</span>
    </button>
  `;
}

function renderBerkasButton(item: KolokiumItem): string {
  return `
    <button
      type="button"
      class="kolokium-berkas-btn inline-flex items-center gap-1.5 bg-primary-container text-on-primary px-3 py-1.5 rounded-lg text-body-sm font-bold hover:bg-primary transition-all active:scale-95"
      data-kolokium-id="${item.id}"
      data-kolokium-nama="${escapeHtml(item.nama ?? "-")}"
      title="Lihat Berkas"
    >
      <span class="material-symbols-outlined text-[18px]">folder_open</span>
      Dokumen
    </button>
  `;
}

function renderAbsensiButton(item: KolokiumItem): string {
  const isApproved = item.status === "approved";
  const disabledClass = "opacity-40 cursor-not-allowed";
  const title = isApproved
    ? "Buka Absensi"
    : "Kolokium harus berstatus disetujui sebelum bisa diabsen";

  return `
    <button
      type="button"
      class="kolokium-absensi-btn inline-flex items-center gap-1.5 bg-primary-container text-on-primary px-3 py-1.5 rounded-lg text-body-sm font-bold hover:bg-primary transition-all active:scale-95 ${!isApproved ? disabledClass : ""}"
      data-kolokium-id="${item.id}"
      title="${title}"
      ${!isApproved ? "disabled" : ""}
    >
      <span class="material-symbols-outlined text-[18px]">fact_check</span>
      Absensi
    </button>
  `;
}

function renderRow(item: KolokiumItem, rowNumber: number): string {
  return `
    <tr class="table-row-hover transition-colors align-top" data-row-id="${item.id}">
      <td class="px-4 py-4 text-body-sm align-top">${rowNumber}</td>
      <td class="px-4 py-4 align-top">${renderPemrasaranCell(item)}</td>
      <td class="px-4 py-4 align-top break-words">${renderDosenPembimbingCell(item)}</td>
      <td class="px-4 py-4 align-top break-words">${renderJudulCell(item)}</td>
      <td class="px-4 py-4 text-body-sm align-top break-words">${escapeHtml(item.lokasi ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm align-top break-words">${formatTanggal(item.tanggal ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm align-top">${escapeHtml(item.waktu ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm align-top break-words">${escapeHtml(item.namadosenmoderator ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm align-top break-words">${escapeHtml(item.ruangan ?? "-")}</td>
      <td class="px-4 py-4 text-center whitespace-nowrap">
        ${renderBerkasButton(item)}
      </td>
      <td class="px-4 py-4 text-center whitespace-nowrap">
        ${renderAbsensiButton(item)}
      </td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">
        <span class="px-2 py-1 rounded text-white text-xs font-medium ${STATUS_BADGE_CLASS[item.status]} whitespace-nowrap">
          ${STATUS_LABEL[item.status]}
        </span>
      </td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">
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

function renderPaginationInfo(data: PaginatedResponse<KolokiumItem>): void {
  const infoEl = document.getElementById("jadwal-kolokium-pagination-info");
  if (infoEl) {
    if (data.total === 0) {
      infoEl.textContent = currentSearch
        ? `Tidak ada hasil untuk "${currentSearch}"`
        : "Tidak ada data";
    } else {
      infoEl.textContent = `Showing ${data.from ?? 0} to ${data.to ?? 0} of ${data.total} entries`;
    }
  }

  const pageLabel = document.getElementById("jadwal-kolokium-page-label");
  if (pageLabel) {
    pageLabel.textContent = `${data.current_page} / ${data.last_page}`;
  }

  const firstBtn = document.getElementById("jadwal-kolokium-first-btn") as HTMLButtonElement | null;
  const prevBtn = document.getElementById("jadwal-kolokium-prev-btn") as HTMLButtonElement | null;
  const nextBtn = document.getElementById("jadwal-kolokium-next-btn") as HTMLButtonElement | null;
  const lastBtn = document.getElementById("jadwal-kolokium-last-btn") as HTMLButtonElement | null;

  const atFirst = data.current_page <= 1;
  const atLast = data.current_page >= data.last_page;

  if (firstBtn) firstBtn.disabled = atFirst;
  if (prevBtn) prevBtn.disabled = atFirst;
  if (nextBtn) nextBtn.disabled = atLast;
  if (lastBtn) lastBtn.disabled = atLast;
}

function renderTable(data: PaginatedResponse<KolokiumItem>): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;

  if (data.data.length === 0) {
    if (currentSearch) {
      renderMessageRow(`Tidak ditemukan hasil untuk pencarian "${currentSearch}".`);
    } else {
      renderMessageRow("Belum ada data kolokium.");
    }
    return;
  }

  const startNumber = data.from ?? 1;
  tbody.innerHTML = data.data.map((item, idx) => renderRow(item, startNumber + idx)).join("");
}

async function loadJadwalKolokium(page = 1): Promise<void> {
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
    const res = await fetch(`${API_BASE_URL}/auth/kolokium?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (redirectIfUnauthorized(res.status)) return;

    if (!res.ok) {
      renderMessageRow("Gagal memuat data kolokium.", "error");
      return;
    }

    const data: PaginatedResponse<KolokiumItem> = await res.json();
    currentPage = data.current_page;
    renderTable(data);
    renderPaginationInfo(data);
  } catch (err) {
    console.error("Gagal ambil daftar kolokium:", err);
    renderMessageRow("Terjadi kesalahan jaringan.", "error");
  }
}

async function deleteKolokium(id: number): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/";
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/kolokium/${id}`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (redirectIfUnauthorized(res.status)) return;

    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as ApiErrorResponse;
      showError(errJson.message ?? "Gagal menghapus kolokium.");
      return;
    }

    showSuccess("Kolokium berhasil dihapus.");
    await loadJadwalKolokium(currentPage);
  } catch (err) {
    console.error("Gagal menghapus kolokium:", err);
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
    const deleteBtn = target.closest<HTMLElement>(".kolokium-delete-btn");
    if (!deleteBtn) return;

    const id = Number(deleteBtn.dataset.id);
    if (!id) return;

    const ok = await confirmDialog({
      title: "Hapus Kolokium?",
      message: "Data kolokium yang dihapus tidak bisa dikembalikan. Lanjutkan?",
      variant: "danger",
      confirmText: "Ya, Hapus",
    });
    if (!ok) return;

    deleteKolokium(id);
  });
}

// ============================================================
// TOGGLE JUDUL: klik tombol -> tampilkan/sembunyikan teks lengkap
// langsung di dalam sel yang sama (tanpa modal).
// ============================================================

function initJudulToggleButtons(): void {
  const tbody = document.getElementById(TBODY_ID);
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

function renderBerkasModalBody(kolokiumId: number): void {
  const { body } = getBerkasModalEls();
  if (!body) return;

  body.innerHTML = BERKAS_LIST.map((berkas) => {
    const isLoading = downloadingKeys.has(berkas.key);
    return `
      <button
        type="button"
        class="berkas-download-btn flex items-center justify-between gap-3 px-4 py-3 border border-outline-variant rounded-lg hover:bg-surface-container-low transition-colors text-left disabled:opacity-60 disabled:cursor-not-allowed"
        data-berkas-key="${berkas.key}"
        data-kolokium-id="${kolokiumId}"
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

function openBerkasModal(kolokiumId: number, nama: string): void {
  const { overlay, subtitle } = getBerkasModalEls();
  if (!overlay) return;

  if (subtitle) subtitle.textContent = nama;
  overlay.dataset.kolokiumId = String(kolokiumId);
  overlay.dataset.kolokiumNama = nama;

  renderBerkasModalBody(kolokiumId);

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
// sama pola nama file yang dibuat backend (mis. "Rekap_Nilai_Kolokium_Budi.docx")
// alih-alih "rekap-nilai-4.docx" yang kurang deskriptif.
const BERKAS_FALLBACK_PREFIX: Record<string, string> = {
  "rekap-nilai": "Rekap_Nilai_Kolokium",
  "lembar-penilaian": "Lembar_Penilaian_Kolokium",
  "daftar-hadir": "Daftar_Hadir_Kolokium",
  "berita-acara": "Berita_Acara_Kolokium",
  "kesediaan-moderator": "Kesediaan_Moderator_Kolokium",
  "pengumuman": "Pengumuman_Kolokium",
};

async function downloadBerkas(berkas: BerkasDefinition, kolokiumId: number, kolokiumNama: string): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/";
    return;
  }

  if (downloadingKeys.has(berkas.key)) return; // cegah klik dobel
  downloadingKeys.add(berkas.key);
  renderBerkasModalBody(kolokiumId);

  try {
    const res = await fetch(`${API_BASE_URL}/auth${berkas.path(kolokiumId)}`, {
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
    const namaFile = kolokiumNama.trim() ? kolokiumNama.replace(/\s+/g, "_") : String(kolokiumId);
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
    renderBerkasModalBody(kolokiumId);
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
    const kolokiumId = Number(btn.dataset.kolokiumId);
    const berkas = BERKAS_LIST.find((b) => b.key === key);
    if (!berkas || !kolokiumId) return;

    const kolokiumNama = overlay.dataset.kolokiumNama ?? "";
    downloadBerkas(berkas, kolokiumId, kolokiumNama);
  });
}

function initBerkasButtons(): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;
  if (tbody.dataset.berkasBound === "true") return;
  tbody.dataset.berkasBound = "true";

  tbody.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>(".kolokium-berkas-btn");
    if (!btn) return;

    const kolokiumId = Number(btn.dataset.kolokiumId);
    const nama = btn.dataset.kolokiumNama ?? "-";
    if (!kolokiumId) return;

    openBerkasModal(kolokiumId, nama);
  });
}

function initAbsensiButtons(): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;
  if (tbody.dataset.absensiBound === "true") return;
  tbody.dataset.absensiBound = "true";

  tbody.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLElement>(".kolokium-absensi-btn");
    if (!btn) return;
    if (btn.hasAttribute("disabled")) return;

    const kolokiumId = btn.dataset.kolokiumId;
    if (!kolokiumId) return;

    window.location.href = `${ABSENSI_PATH}?kolokium_id=${kolokiumId}`;
  });
}

function initPagination(): void {
  const firstBtn = document.getElementById("jadwal-kolokium-first-btn");
  const prevBtn = document.getElementById("jadwal-kolokium-prev-btn");
  const nextBtn = document.getElementById("jadwal-kolokium-next-btn");
  const lastBtn = document.getElementById("jadwal-kolokium-last-btn");

  firstBtn?.addEventListener("click", () => loadJadwalKolokium(1));
  prevBtn?.addEventListener("click", () => loadJadwalKolokium(Math.max(1, currentPage - 1)));
  nextBtn?.addEventListener("click", () => loadJadwalKolokium(currentPage + 1));
  lastBtn?.addEventListener("click", () => {
    const pageLabel = document.getElementById("jadwal-kolokium-page-label");
    const lastPage = pageLabel?.textContent?.split("/")[1]?.trim();
    if (lastPage) loadJadwalKolokium(Number(lastPage));
  });
}

function initSearch(): void {
  const searchInput = document.getElementById("jadwal-kolokium-search") as HTMLInputElement | null;
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
      loadJadwalKolokium(1); // reset ke halaman 1 tiap kali kata kunci berubah
    }, SEARCH_DEBOUNCE_MS);
  });
}

function initPerPage(): void {
  const select = document.getElementById("jadwal-kolokium-per-page") as HTMLSelectElement | null;
  if (!select) return;
  if (select.dataset.bound === "true") return;
  select.dataset.bound = "true";

  select.addEventListener("change", () => {
    loadJadwalKolokium(1); // reset ke halaman 1 tiap kali per_page berubah
  });
}

function initJadwalKolokiumPage(): void {
  loadJadwalKolokium(1);
  initActionButtons();
  initAbsensiButtons();
  initBerkasButtons();
  initBerkasModal();
  initJudulToggleButtons();
  initPagination();
  initSearch();
  initPerPage();
}

initJadwalKolokiumPage();
document.addEventListener("astro:page-load", initJadwalKolokiumPage);