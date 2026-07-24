// src/scripts/api/jadwal-kolokium.ts
// Fetch & render tabel "Jadwal Kolokium" untuk dosen, dari /auth/kolokium/my
// (backend sudah filter: dosen ini sebagai PEMBIMBING atau MODERATOR).

interface KolokiumItem {
  id: number;
  mahasiswa_id: number;
  nama: string;
  nim: string;
  prodi: string;
  namadosenpembimbing: string | null;
  moderator_id: number | null;
  namadosenmoderator: string | null;
  pembahas_id: number | null;
  namapembahas: string | null;
  judul: string;
  lokasi: string | null;
  tanggal: string | null;
  waktu: string | null;
  ruangan: string | null;
  status: string;
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

const API_BASE_URL = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token";

let currentPage = 1;
let lastResponse: PaginatedResponse<KolokiumItem> | null = null;

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
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

// ---------- Fetch ----------
async function fetchKolokium(page: number): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/login";
    return;
  }

  const tbody = document.getElementById("kolokium-table-body");
  if (tbody) {
    tbody.innerHTML = `
      <tr><td colspan="11" class="px-4 py-6 text-center text-body-sm text-on-surface-variant">Memuat data...</td></tr>
    `;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/kolokium/my?page=${page}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401) {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
      window.location.href = "/login";
      return;
    }

    if (!res.ok) {
      if (tbody) {
        tbody.innerHTML = `
          <tr><td colspan="11" class="px-4 py-6 text-center text-body-sm text-error">Gagal memuat data (status ${res.status}).</td></tr>
        `;
      }
      return;
    }

    const data: PaginatedResponse<KolokiumItem> = await res.json();
    lastResponse = data;
    currentPage = data.current_page;

    renderTable(data.data);
    renderPaginationInfo(data);
    renderPaginationButtons(data);
  } catch (err) {
    console.error("Gagal fetch jadwal kolokium:", err);
    if (tbody) {
      tbody.innerHTML = `
        <tr><td colspan="11" class="px-4 py-6 text-center text-body-sm text-error">Terjadi kesalahan jaringan.</td></tr>
      `;
    }
  }
}

// ---------- Render tabel ----------
function renderTable(items: KolokiumItem[]): void {
  const tbody = document.getElementById("kolokium-table-body");
  if (!tbody) return;

  const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
  const keyword = (searchInput?.value ?? "").trim().toLowerCase();

  const filtered = keyword
    ? items.filter(
        (item) =>
          item.nama.toLowerCase().includes(keyword) ||
          item.nim.toLowerCase().includes(keyword) ||
          item.judul.toLowerCase().includes(keyword) ||
          item.prodi.toLowerCase().includes(keyword)
      )
    : items;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="11" class="px-4 py-6 text-center text-body-sm text-on-surface-variant">Tidak ada data kolokium.</td></tr>
    `;
    return;
  }

  const startNumber = lastResponse?.from ?? 1;

  tbody.innerHTML = filtered
    .map((item, index) => {
      return `
        <tr class="table-row-hover transition-colors">
          <td class="px-4 py-4 text-body-sm">${startNumber + index}</td>
          <td class="px-4 py-4 text-body-sm whitespace-nowrap">${formatTanggal(item.tanggal)}</td>
          <td class="px-4 py-4 text-body-sm">${item.waktu ?? "-"}</td>
          <td class="px-4 py-4 text-body-sm">${escapeHtml(item.ruangan ?? "-")}</td>
          <td class="px-4 py-4 text-body-sm font-medium">${escapeHtml(item.nama)}</td>
          <td class="px-4 py-4 text-body-sm">${escapeHtml(item.nim)}</td>
          <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.prodi)}</td>
          <td class="px-4 py-4 text-body-sm min-w-[200px]">${escapeHtml(item.judul)}</td>
          <td class="px-4 py-4 text-body-sm text-center">${item.jumlahforum}</td>
          <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.namadosenpembimbing ?? "-")}</td>
          <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.namadosenmoderator ?? "-")}</td>
        </tr>
      `;
    })
    .join("");
}

// ---------- "Showing X to Y of Z entries" ----------
function renderPaginationInfo(data: PaginatedResponse<KolokiumItem>): void {
  const el = document.getElementById("pagination-info");
  if (!el) return;

  if (data.total === 0) {
    el.textContent = "Tidak ada data.";
    return;
  }

  el.textContent = `Showing ${data.from ?? 0} to ${data.to ?? 0} of ${data.total} entries`;
}

// ---------- Tombol pagination ----------
function renderPaginationButtons(data: PaginatedResponse<KolokiumItem>): void {
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
        fetchKolokium(page);
      }
    });
  });
}

// ---------- Search (filter di data yang sedang tampil) ----------
function initSearch(): void {
  const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
  if (!searchInput) return;
  if (searchInput.dataset.bound === "true") return;
  searchInput.dataset.bound = "true";

  searchInput.addEventListener("input", () => {
    if (lastResponse) {
      renderTable(lastResponse.data);
    }
  });
}

function initJadwalKolokiumPage(): void {
  initSearch();
  fetchKolokium(currentPage);
}

initJadwalKolokiumPage();
document.addEventListener("astro:page-load", initJadwalKolokiumPage);