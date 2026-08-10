// src/scripts/api/admin/manajemen-akun.ts
// GET    /auth/users?page=N&search=...&per_page=N  -> daftar semua user (paginated, admin)
// DELETE /auth/users/{id}                          -> hapus user (hanya admin)
//
// Beda dari jadwal-kolokium.ts: tidak ada tombol Edit sama sekali, hanya
// tombol Hapus untuk semua baris (tidak tergantung status apapun).
// Kolom foto profil & tanda tangan sengaja tidak ditampilkan/diambil,
// cukup nama, username, email, role, nim/nip, & prodi.
//
// SEARCH: input #tabel-akun-search dikirim ke backend lewat query param
// `search` (di-debounce 400ms), backend sudah nge-LIKE ke banyak kolom
// sekaligus (nama, username, email, nim, nip).
//
// PER PAGE: select #tabel-akun-per-page dikirim ke backend lewat query
// param `per_page` (backend UserController::index sudah validasi
// min:1|max:100, default 10 kalau tidak dikirim/invalid).
//
// Response /auth/users berbentuk { message, users: PaginatedResponse<User> },
// beda dengan /auth/kolokium yang paginatornya langsung di root response.
//
// KONFIRMASI HAPUS: menggunakan ConfirmModal (src/components/ConfirmModal.astro)
// lewat helper confirmDialog() di src/scripts/lib/confirm-dialog.ts, bukan
// window.confirm() bawaan browser.

import { confirmDialog } from "../../lib/confirm-dialog";
import { showSuccess, showError } from "../../lib/info-dialog";

interface UserItem {
  id: number;
  role: "admin" | "dosen" | "mahasiswa";
  nama: string;
  nim: string | null;
  nip: string | null;
  username: string;
  email: string;
  prodi: string | null;
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

interface UsersApiResponse {
  message?: string;
  users: PaginatedResponse<UserItem>;
}

interface ApiErrorResponse {
  message: string;
}

const API_BASE_URL = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token";
const TBODY_ID = "tabel-akun-tbody";
const COLSPAN = 9;
const SEARCH_DEBOUNCE_MS = 400;
const DEFAULT_PER_PAGE = 10;

const ROLE_LABEL: Record<UserItem["role"], string> = {
  admin: "Admin",
  dosen: "Dosen",
  mahasiswa: "Mahasiswa",
};

const ROLE_BADGE_CLASS: Record<UserItem["role"], string> = {
  admin: "bg-purple-600",
  dosen: "bg-blue-600",
  mahasiswa: "bg-green-600",
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
  const select = document.getElementById("tabel-akun-per-page") as HTMLSelectElement | null;
  const value = select ? parseInt(select.value, 10) : DEFAULT_PER_PAGE;
  return Number.isNaN(value) || value < 1 ? DEFAULT_PER_PAGE : value;
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function renderActionButtons(item: UserItem): string {
  return `
    <button
      type="button"
      class="user-delete-btn text-red-600 hover:text-red-800"
      title="Hapus"
      data-id="${item.id}"
    >
      <span class="material-symbols-outlined text-lg">delete</span>
    </button>
  `;
}

function renderRow(item: UserItem, rowNumber: number): string {
  const nimNip = item.role === "dosen" ? item.nip : item.nim;

  return `
    <tr class="table-row-hover transition-colors" data-row-id="${item.id}">
      <td class="px-4 py-4 text-body-sm">${rowNumber}</td>
      <td class="px-4 py-4 text-body-sm font-medium whitespace-nowrap">${escapeHtml(item.nama ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.username ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.email ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm">
        <span class="px-2 py-1 rounded text-white text-xs font-medium ${ROLE_BADGE_CLASS[item.role]} whitespace-nowrap">
          ${ROLE_LABEL[item.role]}
        </span>
      </td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(nimNip ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.prodi ?? "-")}</td>
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

function renderPaginationInfo(data: PaginatedResponse<UserItem>): void {
  const infoEl = document.getElementById("tabel-akun-pagination-info");
  if (infoEl) {
    if (data.total === 0) {
      infoEl.textContent = currentSearch
        ? `Tidak ada hasil untuk "${currentSearch}"`
        : "Tidak ada data";
    } else {
      infoEl.textContent = `Showing ${data.from ?? 0} to ${data.to ?? 0} of ${data.total} entries`;
    }
  }

  const pageLabel = document.getElementById("tabel-akun-page-label");
  if (pageLabel) {
    pageLabel.textContent = `${data.current_page} / ${data.last_page}`;
  }

  const firstBtn = document.getElementById("tabel-akun-first-btn") as HTMLButtonElement | null;
  const prevBtn = document.getElementById("tabel-akun-prev-btn") as HTMLButtonElement | null;
  const nextBtn = document.getElementById("tabel-akun-next-btn") as HTMLButtonElement | null;
  const lastBtn = document.getElementById("tabel-akun-last-btn") as HTMLButtonElement | null;

  const atFirst = data.current_page <= 1;
  const atLast = data.current_page >= data.last_page;

  if (firstBtn) firstBtn.disabled = atFirst;
  if (prevBtn) prevBtn.disabled = atFirst;
  if (nextBtn) nextBtn.disabled = atLast;
  if (lastBtn) lastBtn.disabled = atLast;
}

function renderTable(data: PaginatedResponse<UserItem>): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;

  if (data.data.length === 0) {
    if (currentSearch) {
      renderMessageRow(`Tidak ditemukan hasil untuk pencarian "${currentSearch}".`);
    } else {
      renderMessageRow("Belum ada data akun.");
    }
    return;
  }

  const startNumber = data.from ?? 1;
  tbody.innerHTML = data.data.map((item, idx) => renderRow(item, startNumber + idx)).join("");
}

async function loadTabelAkun(page = 1): Promise<void> {
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
    const res = await fetch(`${API_BASE_URL}/auth/users?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (redirectIfUnauthorized(res.status)) return;

    if (!res.ok) {
      renderMessageRow("Gagal memuat data akun.", "error");
      return;
    }

    const json: UsersApiResponse = await res.json();
    const data = json.users;
    currentPage = data.current_page;
    renderTable(data);
    renderPaginationInfo(data);
  } catch (err) {
    console.error("Gagal ambil daftar akun:", err);
    renderMessageRow("Terjadi kesalahan jaringan.", "error");
  }
}

async function deleteUser(id: number): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/";
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/users/${id}`, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (redirectIfUnauthorized(res.status)) return;

    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as ApiErrorResponse;
      showError(errJson.message ?? "Gagal menghapus akun.");
      return;
    }

    showSuccess("Akun berhasil dihapus.");
    await loadTabelAkun(currentPage);
  } catch (err) {
    console.error("Gagal menghapus akun:", err);
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
    const deleteBtn = target.closest<HTMLElement>(".user-delete-btn");
    if (!deleteBtn) return;

    const id = Number(deleteBtn.dataset.id);
    if (!id) return;

    const ok = await confirmDialog({
      title: "Hapus Akun?",
      message: "Data akun yang dihapus tidak bisa dikembalikan. Lanjutkan?",
      variant: "danger",
      confirmText: "Ya, Hapus",
    });
    if (!ok) return;

    deleteUser(id);
  });
}

function initPagination(): void {
  const firstBtn = document.getElementById("tabel-akun-first-btn");
  const prevBtn = document.getElementById("tabel-akun-prev-btn");
  const nextBtn = document.getElementById("tabel-akun-next-btn");
  const lastBtn = document.getElementById("tabel-akun-last-btn");

  firstBtn?.addEventListener("click", () => loadTabelAkun(1));
  prevBtn?.addEventListener("click", () => loadTabelAkun(Math.max(1, currentPage - 1)));
  nextBtn?.addEventListener("click", () => loadTabelAkun(currentPage + 1));
  lastBtn?.addEventListener("click", () => {
    const pageLabel = document.getElementById("tabel-akun-page-label");
    const lastPage = pageLabel?.textContent?.split("/")[1]?.trim();
    if (lastPage) loadTabelAkun(Number(lastPage));
  });
}

function initSearch(): void {
  const searchInput = document.getElementById("tabel-akun-search") as HTMLInputElement | null;
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
      loadTabelAkun(1); // reset ke halaman 1 tiap kali kata kunci berubah
    }, SEARCH_DEBOUNCE_MS);
  });
}

function initPerPage(): void {
  const select = document.getElementById("tabel-akun-per-page") as HTMLSelectElement | null;
  if (!select) return;
  if (select.dataset.bound === "true") return;
  select.dataset.bound = "true";

  select.addEventListener("change", () => {
    loadTabelAkun(1); // reset ke halaman 1 tiap kali per_page berubah
  });
}

function initTabelAkunPage(): void {
  loadTabelAkun(1);
  initActionButtons();
  initPagination();
  initSearch();
  initPerPage();
}

initTabelAkunPage();
document.addEventListener("astro:page-load", initTabelAkunPage);