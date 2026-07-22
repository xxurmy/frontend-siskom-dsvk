// src/scripts/jadwal-seminar.ts
// Logic untuk halaman "Jadwal Seminar":
// 1) fetch daftar seminar yang approved (GET /auth/seminar?status=approved)
// 2) fetch status kehadiran mahasiswa login (GET /auth/peserta-seminar/my-peserta)
// 3) render tabel + pagination dari Laravel paginator
// 4) aksi Daftar (POST /auth/peserta-seminar) & Batal (PATCH /auth/peserta-seminar/{id}/status)
// 5) search & "show entries" -> filter client-side dari data yang sudah ke-fetch
//    (backend index() tidak punya parameter search / per_page dinamis)
//
// PENTING: semua endpoint di routes/api.php ada di dalam Route::prefix('auth'),
// jadi WAJIB pakai prefix /auth di setiap path, termasuk /auth/seminar dan
// /auth/peserta-seminar (bukan cuma /auth/profile & /auth/change-password).

// ------------------------------------------------------------------
// Konfigurasi
// ------------------------------------------------------------------
// PENTING: nama env HARUS berprefix PUBLIC_ (mis. PUBLIC_BASE_URL) supaya
// terbaca di client-side. Astro hanya meng-expose env yang berprefix
// PUBLIC_ ke kode yang berjalan di browser.
const API_BASE: string = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token"; // sesuaikan kalau key token localStorage Anda beda

// ------------------------------------------------------------------
// Tipe data (disesuaikan dengan SeminarController & PesertaSeminarController)
// ------------------------------------------------------------------
type StatusPengajuan = "pending" | "approved" | "rejected";
type StatusPeserta = "hadir" | "batal";

interface UserProfil {
  id: number;
  nama: string;
  nim?: string | null;
  prodi?: string | null;
  role: "mahasiswa" | "dosen" | "admin";
}

type ProfilResponse = UserProfil | { user: UserProfil } | { data: UserProfil };

interface Seminar {
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
  status: StatusPengajuan;
  jumlahforum: number;
}

interface LaravelPaginator<T> {
  current_page: number;
  data: T[];
  from: number | null;
  last_page: number;
  per_page: number;
  to: number | null;
  total: number;
}

interface PesertaSeminar {
  id: number;
  seminar_id: number;
  mahasiswa_id: number;
  status: StatusPeserta;
}

interface PesertaSeminarListResponse {
  message: string;
  peserta_seminars: PesertaSeminar[];
}

interface StorePesertaSeminarResponse {
  message: string;
  peserta_seminar: PesertaSeminar;
  jumlahforum: number;
}

interface ApiErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

// ------------------------------------------------------------------
// State halaman
// ------------------------------------------------------------------
let currentUser: UserProfil | null = null;
let currentPage = 1;
let lastPaginator: LaravelPaginator<Seminar> | null = null;
let currentSeminars: Seminar[] = [];
// map seminar_id -> peserta_seminar milik user login
let myPesertaMap: Map<number, PesertaSeminar> = new Map();
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

function extractUser(json: ProfilResponse): UserProfil {
  if ("user" in json) return json.user;
  if ("data" in json) return json.data;
  return json;
}

// ------------------------------------------------------------------
// Pesan status
// ------------------------------------------------------------------
function showMessage(text: string, variant: "success" | "error"): void {
  const el = document.getElementById("jadwal-message");
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
  const el = document.getElementById("jadwal-message");
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

// ------------------------------------------------------------------
// Muat data profil (sekali di awal, untuk tahu siapa yang login)
// ------------------------------------------------------------------
async function loadProfil(): Promise<void> {
  const json = await apiFetch<ProfilResponse>("/auth/profile");
  if (json) {
    currentUser = extractUser(json);
  }
}

// ------------------------------------------------------------------
// Muat status kehadiran mahasiswa login untuk semua seminar
// ------------------------------------------------------------------
async function loadMyPeserta(): Promise<void> {
  const json = await apiFetch<PesertaSeminarListResponse>("/auth/peserta-seminar/my-peserta");
  myPesertaMap = new Map();
  if (json) {
    for (const peserta of json.peserta_seminars) {
      myPesertaMap.set(peserta.seminar_id, peserta);
    }
  }
}

// ------------------------------------------------------------------
// Muat daftar seminar (halaman tertentu)
// ------------------------------------------------------------------
async function loadSeminar(page: number): Promise<void> {
  const tbody = document.getElementById("seminar-tbody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="11" class="px-4 py-6 text-center text-body-sm text-on-surface-variant">Memuat data...</td></tr>`;
  }

  try {
    const json = await apiFetch<LaravelPaginator<Seminar>>(
      `/auth/seminar?status=approved&page=${page}`
    );
    if (!json) return;

    lastPaginator = json;
    currentPage = json.current_page;
    currentSeminars = json.data;

    await loadMyPeserta();
    renderTable();
    renderPaginationInfo();
    renderPaginationButtons();
  } catch (err) {
    console.error("Gagal memuat jadwal seminar:", err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="11" class="px-4 py-6 text-center text-body-sm text-red-700">Gagal memuat data. Coba muat ulang halaman.</td></tr>`;
    }
  }
}

// ------------------------------------------------------------------
// Render badge / tombol kolom Kehadiran
// ------------------------------------------------------------------
function renderKehadiranCell(seminar: Seminar): string {
  // mahasiswa pemilik seminar tidak bisa mendaftar jadi peserta di seminarnya sendiri
  if (currentUser && seminar.mahasiswa_id === currentUser.id) {
    return `<span class="text-body-sm text-on-surface-variant italic">Seminar Anda</span>`;
  }

  const peserta = myPesertaMap.get(seminar.id);

  if (peserta && peserta.status === "hadir") {
    return `
      <div class="flex items-center gap-2">
        <span class="bg-secondary/10 text-secondary px-3 py-1 rounded-full text-[12px] font-bold flex items-center gap-1 w-fit">
          <span class="material-symbols-outlined text-[14px]">check_circle</span> Hadir
        </span>
        <button
          type="button"
          class="btn-batal-hadir text-[12px] text-red-600 hover:underline"
          data-peserta-id="${peserta.id}"
          data-seminar-id="${seminar.id}"
        >
          Batal
        </button>
      </div>
    `;
  }

  return `
    <button
      type="button"
      class="btn-daftar-hadir bg-primary-container text-on-primary px-3 py-1 rounded-full text-[12px] font-bold hover:bg-primary transition-colors"
      data-seminar-id="${seminar.id}"
    >
      Daftar
    </button>
  `;
}

// ------------------------------------------------------------------
// Render isi tabel (dengan search client-side & slicing show-entries)
// ------------------------------------------------------------------
function getFilteredRows(): Seminar[] {
  let rows = currentSeminars;

  if (searchTerm.trim() !== "") {
    const term = searchTerm.trim().toLowerCase();
    rows = rows.filter((s) =>
      [s.nama, s.nim, s.prodi, s.judul, s.namadosenpembimbing ?? "", s.namadosenmoderator ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }

  const perPageSelect = document.getElementById("entries-per-page") as HTMLSelectElement | null;
  const perPage = perPageSelect ? parseInt(perPageSelect.value, 10) : 10;
  // Catatan: backend selalu mengembalikan maksimal 10 baris per halaman,
  // jadi opsi "25" tidak akan menampilkan lebih dari 10 baris yang sudah ter-fetch.
  return rows.slice(0, perPage);
}

function renderTable(): void {
  const tbody = document.getElementById("seminar-tbody");
  if (!tbody) return;

  const rows = getFilteredRows();

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="px-4 py-6 text-center text-body-sm text-on-surface-variant">Tidak ada jadwal seminar ditemukan.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map(
      (seminar, index) => `
        <tr class="table-row-hover transition-colors">
          <td class="px-4 py-4 text-body-sm">${(currentPage - 1) * (lastPaginator?.per_page ?? 10) + index + 1}</td>
          <td class="px-4 py-4">${renderKehadiranCell(seminar)}</td>
          <td class="px-4 py-4 text-body-sm whitespace-nowrap">${formatTanggal(seminar.tanggal)}</td>
          <td class="px-4 py-4 text-body-sm">${seminar.waktu ?? "-"}</td>
          <td class="px-4 py-4 text-body-sm">${seminar.ruangan ?? seminar.lokasi ?? "-"}</td>
          <td class="px-4 py-4 text-body-sm font-medium">${seminar.nama}</td>
          <td class="px-4 py-4 text-body-sm">${seminar.nim}</td>
          <td class="px-4 py-4 text-body-sm whitespace-nowrap">${seminar.prodi}</td>
          <td class="px-4 py-4 text-body-sm min-w-[200px]">${seminar.judul}</td>
          <td class="px-4 py-4 text-body-sm text-center">${seminar.jumlahforum}</td>
          <td class="px-4 py-4 text-body-sm whitespace-nowrap">${seminar.namadosenpembimbing ?? "-"}</td>
          <td class="px-4 py-4 text-body-sm whitespace-nowrap">${seminar.namadosenmoderator ?? "-"}</td>
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
  if (!el || !lastPaginator) return;

  const { from, to, total } = lastPaginator;
  el.textContent =
    total === 0
      ? "Tidak ada data"
      : `Showing ${from ?? 0} to ${to ?? 0} of ${total} entries`;
}

// ------------------------------------------------------------------
// Tombol pagination (First, «, nomor halaman, », Last)
// ------------------------------------------------------------------
function renderPaginationButtons(): void {
  const container = document.getElementById("pagination-buttons");
  if (!container || !lastPaginator) return;

  const { current_page, last_page } = lastPaginator;

  const btnClass =
    "px-3 py-1 text-body-sm border border-outline-variant rounded hover:bg-surface-container transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent";
  const activeClass = "px-3 py-1 text-body-sm bg-ipb-blue text-white rounded font-bold";

  const pageButtons: string[] = [];
  const startPage = Math.max(1, current_page - 1);
  const endPage = Math.min(last_page, current_page + 1);

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
        loadSeminar(page);
      }
    });
  });
}

// ------------------------------------------------------------------
// Aksi Daftar & Batal
// ------------------------------------------------------------------
function attachRowActionListeners(): void {
  document.querySelectorAll<HTMLButtonElement>(".btn-daftar-hadir").forEach((btn) => {
    btn.addEventListener("click", () => handleDaftar(btn));
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-batal-hadir").forEach((btn) => {
    btn.addEventListener("click", () => handleBatal(btn));
  });
}

async function handleDaftar(btn: HTMLButtonElement): Promise<void> {
  const seminarId = parseInt(btn.dataset.seminarId ?? "", 10);
  if (Number.isNaN(seminarId)) return;

  clearMessage();
  btn.disabled = true;
  btn.textContent = "Memproses...";

  try {
    await apiFetch<StorePesertaSeminarResponse>("/auth/peserta-seminar", {
      method: "POST",
      body: JSON.stringify({ seminar_id: seminarId }),
    });

    showMessage("Berhasil mendaftar hadir seminar.", "success");
    await loadSeminar(currentPage);
  } catch (err) {
    console.error("Gagal mendaftar seminar:", err);
    showMessage(err instanceof Error ? err.message : "Gagal mendaftar seminar.", "error");
    btn.disabled = false;
    btn.textContent = "Daftar";
  }
}

async function handleBatal(btn: HTMLButtonElement): Promise<void> {
  const pesertaId = parseInt(btn.dataset.pesertaId ?? "", 10);
  if (Number.isNaN(pesertaId)) return;

  clearMessage();
  btn.disabled = true;

  try {
    await apiFetch<{ message: string }>(`/auth/peserta-seminar/${pesertaId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "batal" }),
    });

    showMessage("Kehadiran berhasil dibatalkan.", "success");
    await loadSeminar(currentPage);
  } catch (err) {
    console.error("Gagal membatalkan kehadiran:", err);
    showMessage(err instanceof Error ? err.message : "Gagal membatalkan kehadiran.", "error");
    btn.disabled = false;
  }
}

// ------------------------------------------------------------------
// Search & entries-per-page (client-side, lihat catatan di renderTable)
// ------------------------------------------------------------------
function initSearchAndEntries(): void {
  const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
  const entriesSelect = document.getElementById("entries-per-page") as HTMLSelectElement | null;

  searchInput?.addEventListener("input", () => {
    searchTerm = searchInput.value;
    renderTable();
  });

  entriesSelect?.addEventListener("change", () => {
    renderTable();
  });
}

// ------------------------------------------------------------------
// Jalankan saat halaman siap
// ------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  initSearchAndEntries();
  await loadProfil();
  await loadSeminar(1);
});