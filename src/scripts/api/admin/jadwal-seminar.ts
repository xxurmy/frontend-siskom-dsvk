// src/scripts/api/admin/jadwal-seminar.ts
// GET    /auth/seminar?page=N   -> daftar semua seminar (paginated, admin)
// DELETE /auth/seminar/{id}     -> hapus seminar (hanya admin)
//
// Aturan tombol aksi berdasarkan status:
// - pending  -> tombol Edit & Hapus muncul
// - rejected -> tombol Edit & Hapus muncul
// - approved -> kedua tombol hilang (final, tidak bisa diubah/dihapus dari UI)
//
// Tombol Edit adalah link ke /admin/form-update-seminar?id={id}, membawa admin ke form update seminar dengan data seminar yang dipilih, sehingga admin bisa mengubah status seminar tersebut.

interface SeminarItem {
  id: number;
  mahasiswa_id: number;
  nama: string;
  nim: string;
  prodi: string;
  namadosenpembimbing: string | null;
  moderator_id: number | null;
  pembahas_id: number | null;
  judul: string;
  lokasi: string | null;
  tanggal: string | null;
  waktu: string | null;
  namapembahas: string | null;
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
const COLSPAN = 14;
const EDIT_FORM_PATH = "/admin/form-update-seminar";
const SEARCH_DEBOUNCE_MS = 400;

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
    window.location.href = "/login";
    return true;
  }
  return false;
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

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
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

function renderRow(item: SeminarItem, rowNumber: number): string {
  return `
    <tr class="table-row-hover transition-colors" data-row-id="${item.id}">
      <td class="px-4 py-4 text-body-sm">${rowNumber}</td>
      <td class="px-4 py-4 text-body-sm font-medium whitespace-nowrap">${escapeHtml(item.nama ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.nim ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.prodi ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.namadosenpembimbing ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm min-w-[200px]">${escapeHtml(item.judul ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.lokasi ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${formatTanggal(item.tanggal ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.waktu ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.namapembahas ?? "-")}</td>
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

async function loadJadwalSeminar(page = 1): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/login";
    return;
  }

  renderMessageRow("Memuat data...");

  const params = new URLSearchParams({ page: String(page) });
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
    window.location.href = "/login";
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
      alert(errJson.message ?? "Gagal menghapus seminar.");
      return;
    }

    await loadJadwalSeminar(currentPage);
  } catch (err) {
    console.error("Gagal menghapus seminar:", err);
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
    const deleteBtn = target.closest<HTMLElement>(".seminar-delete-btn");
    if (!deleteBtn) return;

    const id = Number(deleteBtn.dataset.id);
    if (!id) return;
    if (!confirm("Hapus seminar ini? Tindakan ini tidak bisa dibatalkan.")) return;
    deleteSeminar(id);
  });
}

function initPagination(): void {
  const firstBtn = document.getElementById("jadwal-seminar-first-btn");
  const prevBtn = document.getElementById("jadwal-seminar-prev-btn");
  const nextBtn = document.getElementById("jadwal-seminar-next-btn");
  const lastBtn = document.getElementById("jadwal-seminar-last-btn");

  firstBtn?.addEventListener("click", () => loadJadwalSeminar(1));
  prevBtn?.addEventListener("click", () => loadJadwalSeminar(Math.max(1, currentPage - 1)));
  nextBtn?.addEventListener("click", () => loadJadwalSeminar(currentPage + 1));
  lastBtn?.addEventListener("click", () => {
    const pageLabel = document.getElementById("jadwal-seminar-page-label");
    const lastPage = pageLabel?.textContent?.split("/")[1]?.trim();
    if (lastPage) loadJadwalSeminar(Number(lastPage));
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
      loadJadwalSeminar(1); // reset ke halaman 1 tiap kali kata kunci berubah
    }, SEARCH_DEBOUNCE_MS);
  });
}

function initJadwalSeminarPage(): void {
  loadJadwalSeminar(1);
  initActionButtons();
  initPagination();
  initSearch();
}

initJadwalSeminarPage();
document.addEventListener("astro:page-load", initJadwalSeminarPage);