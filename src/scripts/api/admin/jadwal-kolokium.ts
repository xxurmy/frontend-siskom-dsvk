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
// SEARCH: input #jadwal-kolokium-search dikirim ke backend lewat query param
// `search` (di-debounce 400ms), backend sudah nge-LIKE ke banyak kolom
// sekaligus (nama, nim, prodi, judul, dosen pembimbing/moderator, lokasi,
// ruangan). Kalau hasil kosong SAAT sedang search, tampilkan pesan khusus
// yang beda dari pesan "belum ada data" biasa.
//
// PER PAGE: select #jadwal-kolokium-per-page dikirim ke backend lewat query
// param `per_page` (backend KolokiumController::index sudah validasi
// min:1|max:100, default 10 kalau tidak dikirim/invalid).

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
const COLSPAN = 14;
const EDIT_FORM_PATH = "/admin/form-update-kolokium";
const SEARCH_DEBOUNCE_MS = 400;
const DEFAULT_PER_PAGE = 10;

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
    window.location.href = "/login";
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

function renderRow(item: KolokiumItem, rowNumber: number): string {
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
    window.location.href = "/login";
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
    window.location.href = "/login";
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
      alert(errJson.message ?? "Gagal menghapus kolokium.");
      return;
    }

    await loadJadwalKolokium(currentPage);
  } catch (err) {
    console.error("Gagal menghapus kolokium:", err);
    alert("Terjadi kesalahan jaringan. Coba lagi.");
  }
}

function initActionButtons(): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;
  if (tbody.dataset.bound === "true") return;
  tbody.dataset.bound = "true";

  tbody.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const deleteBtn = target.closest<HTMLElement>(".kolokium-delete-btn");
    if (!deleteBtn) return;

    const id = Number(deleteBtn.dataset.id);
    if (!id) return;
    if (!confirm("Hapus kolokium ini? Tindakan ini tidak bisa dibatalkan.")) return;
    deleteKolokium(id);
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
  initPagination();
  initSearch();
  initPerPage();
}

initJadwalKolokiumPage();
document.addEventListener("astro:page-load", initJadwalKolokiumPage);