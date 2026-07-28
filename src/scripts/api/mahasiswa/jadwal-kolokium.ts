// src/scripts/api/mahasiswa/jadwal-kolokium.ts
// Logic untuk halaman "Jadwal Kolokium" (role: mahasiswa):
// 1) fetch daftar kolokium yang approved (GET /kolokium?status=approved&search=...)
// 2) fetch status kehadiran mahasiswa login, SISI PESERTA:
//    kolokium yang saya ikuti + status kehadiran saya
//    (GET /auth/peserta-kolokium/my-kolokium)
// 3) render tabel + pagination dari Laravel paginator
// 4) tombol "Kehadiran" punya 3 state:
//    - Belum pernah ada record PesertaKolokium sama sekali -> tombol "Hadir"
//      (POST /peserta-kolokium, status dibuat "hadir")
//    - Record ada tapi status "batal" -> tombol "Hadir Ulang"
//      (PATCH /peserta-kolokium/{id}/status, status diubah jadi "hadir")
//    - Record ada dan status "hadir" -> TIDAK ADA tombol apapun, cuma badge "Hadir"
// 5) SEARCH: disamakan polanya dengan admin & dosen — dikirim ke backend lewat
//    query param `search` (di-debounce), BUKAN cuma filter di data yang sedang
//    tampil di halaman itu (keterbatasan versi sebelumnya).
// 6) "show entries" TETAP client-side slicing (backend selalu paginate(10)
//    per halaman, jadi opsi "25" nggak akan nampilin lebih dari 10 baris
//    yang sudah ter-fetch — ini keterbatasan terpisah dari search, belum
//    diminta untuk dibenerin).

const API_BASE: string = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token";
const SEARCH_DEBOUNCE_MS = 400;

// ------------------------------------------------------------------
// Tipe data (disesuaikan dengan KolokiumController & PesertaKolokiumController)
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

interface Kolokium {
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

// Record ringkas status kehadiran milik saya untuk satu kolokium
// (di-derive dari response /auth/peserta-kolokium/my-kolokium)
interface MyPesertaStatus {
  id: number; // peserta_kolokium_id
  kolokium_id: number;
  status: StatusPeserta;
}

// SISI PESERTA: kolokium yang saya ikuti + peserta_kolokium_id & status_kehadiran saya
// GET /auth/peserta-kolokium/my-kolokium
interface MyKolokiumPesertaItem {
  id: number; // kolokium_id
  peserta_kolokium_id: number;
  status_kehadiran: StatusPeserta;
}

interface MyKolokiumPesertaResponse {
  message: string;
  kolokiums: MyKolokiumPesertaItem[];
}

interface StorePesertaKolokiumResponse {
  message: string;
  peserta_kolokium: {
    id: number;
    kolokium_id: number;
    mahasiswa_id: number;
    status: StatusPeserta;
  };
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
let currentSearch = "";
let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
let lastPaginator: LaravelPaginator<Kolokium> | null = null;
let currentKolokiums: Kolokium[] = [];
// map kolokium_id -> status kehadiran saya (kalau pernah ada record)
let myPesertaMap: Map<number, MyPesertaStatus> = new Map();

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
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.href = "/login";
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
// Muat status kehadiran mahasiswa login untuk semua kolokium
// (SISI PESERTA: kolokium yang saya ikuti + status kehadiran saya,
// termasuk yang "batal" — supaya tombol "Hadir Ulang" bisa dibangun)
// ------------------------------------------------------------------
async function loadMyPeserta(): Promise<void> {
  const json = await apiFetch<MyKolokiumPesertaResponse>("/auth/peserta-kolokium/my-kolokium");
  myPesertaMap = new Map();
  if (json) {
    for (const item of json.kolokiums) {
      myPesertaMap.set(item.id, {
        id: item.peserta_kolokium_id,
        kolokium_id: item.id,
        status: item.status_kehadiran,
      });
    }
  }
}

// ------------------------------------------------------------------
// Muat daftar kolokium (halaman tertentu), ikut kirim `search` kalau ada
// ------------------------------------------------------------------
async function loadKolokium(page: number): Promise<void> {
  const tbody = document.getElementById("kolokium-tbody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="11" class="px-4 py-6 text-center text-body-sm text-on-surface-variant">Memuat data...</td></tr>`;
  }

  const params = new URLSearchParams({ status: "approved", page: String(page) });
  if (currentSearch) {
    params.set("search", currentSearch);
  }

  try {
    const json = await apiFetch<LaravelPaginator<Kolokium>>(`/auth/kolokium?${params.toString()}`);
    if (!json) return;

    lastPaginator = json;
    currentPage = json.current_page;
    currentKolokiums = json.data;

    await loadMyPeserta();
    renderTable();
    renderPaginationInfo();
    renderPaginationButtons();
  } catch (err) {
    console.error("Gagal memuat jadwal kolokium:", err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="11" class="px-4 py-6 text-center text-body-sm text-red-700">Gagal memuat data. Coba muat ulang halaman.</td></tr>`;
    }
  }
}

// ------------------------------------------------------------------
// Render badge / tombol kolom Kehadiran — 3 state:
// 1. Belum ada record sama sekali      -> tombol "Hadir" (POST, buat baru)
// 2. Record ada, status "batal"        -> tombol "Hadir Ulang" (PATCH -> hadir)
// 3. Record ada, status "hadir"        -> tidak ada tombol, cuma badge
// ------------------------------------------------------------------
function renderKehadiranCell(kolokium: Kolokium): string {
  // mahasiswa pemilik kolokium tidak bisa mendaftar jadi peserta di kolokiumnya sendiri
  if (currentUser && kolokium.mahasiswa_id === currentUser.id) {
    return `<span class="text-body-sm text-on-surface-variant italic">Kolokium Anda</span>`;
  }

  const peserta = myPesertaMap.get(kolokium.id);

  // State 3: sudah hadir -> tidak ada tombol sama sekali
  if (peserta && peserta.status === "hadir") {
    return `
      <span class="bg-secondary/10 text-secondary px-3 py-1 rounded-full text-[12px] font-bold flex items-center gap-1 w-fit">
        <span class="material-symbols-outlined text-[14px]">check_circle</span> Hadir
      </span>
    `;
  }

  // State 2: record ada tapi statusnya "batal" -> tombol "Hadir Ulang"
  if (peserta && peserta.status === "batal") {
    return `
      <button
        type="button"
        class="btn-hadir-ulang bg-primary-container text-on-primary px-3 py-1 rounded-full text-[12px] font-bold hover:bg-primary transition-colors"
        data-peserta-id="${peserta.id}"
        data-kolokium-id="${kolokium.id}"
      >
        Hadir Ulang
      </button>
    `;
  }

  // State 1: belum pernah ada record sama sekali -> tombol "Hadir" (buat baru)
  return `
    <button
      type="button"
      class="btn-hadir-baru bg-primary-container text-on-primary px-3 py-1 rounded-full text-[12px] font-bold hover:bg-primary transition-colors"
      data-kolokium-id="${kolokium.id}"
    >
      Hadir
    </button>
  `;
}

// ------------------------------------------------------------------
// Render isi tabel (search sudah difilter di backend; di sini cuma
// slicing "show entries" client-side dari 10 baris yang ter-fetch)
// ------------------------------------------------------------------
function getPageRows(): Kolokium[] {
  const perPageSelect = document.getElementById("entries-per-page") as HTMLSelectElement | null;
  const perPage = perPageSelect ? parseInt(perPageSelect.value, 10) : 10;
  // Catatan: backend selalu mengembalikan maksimal 10 baris per halaman,
  // jadi opsi "25" tidak akan menampilkan lebih dari 10 baris yang sudah ter-fetch.
  return currentKolokiums.slice(0, perPage);
}

function renderTable(): void {
  const tbody = document.getElementById("kolokium-tbody");
  if (!tbody) return;

  const rows = getPageRows();

  if (rows.length === 0) {
    const message = currentSearch
      ? `Tidak ditemukan hasil untuk pencarian "${currentSearch}".`
      : "Tidak ada jadwal kolokium ditemukan.";
    tbody.innerHTML = `<tr><td colspan="11" class="px-4 py-6 text-center text-body-sm text-on-surface-variant">${message}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map(
      (kolokium, index) => `
        <tr class="table-row-hover transition-colors">
          <td class="px-4 py-4 text-body-sm">${(currentPage - 1) * (lastPaginator?.per_page ?? 10) + index + 1}</td>
          <td class="px-4 py-4">${renderKehadiranCell(kolokium)}</td>
          <td class="px-4 py-4 text-body-sm whitespace-nowrap">${formatTanggal(kolokium.tanggal)}</td>
          <td class="px-4 py-4 text-body-sm">${kolokium.waktu ?? "-"}</td>
          <td class="px-4 py-4 text-body-sm">${kolokium.ruangan ?? kolokium.lokasi ?? "-"}</td>
          <td class="px-4 py-4 text-body-sm font-medium">${kolokium.nama}</td>
          <td class="px-4 py-4 text-body-sm">${kolokium.nim}</td>
          <td class="px-4 py-4 text-body-sm whitespace-nowrap">${kolokium.prodi}</td>
          <td class="px-4 py-4 text-body-sm min-w-[200px]">${kolokium.judul}</td>
          <td class="px-4 py-4 text-body-sm text-center">${kolokium.jumlahforum}</td>
          <td class="px-4 py-4 text-body-sm whitespace-nowrap">${kolokium.namadosenpembimbing ?? "-"}</td>
          <td class="px-4 py-4 text-body-sm whitespace-nowrap">${kolokium.namadosenmoderator ?? "-"}</td>
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
  if (total === 0) {
    el.textContent = currentSearch ? `Tidak ada hasil untuk "${currentSearch}"` : "Tidak ada data";
    return;
  }
  el.textContent = `Showing ${from ?? 0} to ${to ?? 0} of ${total} entries`;
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
        loadKolokium(page);
      }
    });
  });
}

// ------------------------------------------------------------------
// Aksi: Hadir (baru) & Hadir Ulang
// ------------------------------------------------------------------
function attachRowActionListeners(): void {
  document.querySelectorAll<HTMLButtonElement>(".btn-hadir-baru").forEach((btn) => {
    btn.addEventListener("click", () => handleHadirBaru(btn));
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-hadir-ulang").forEach((btn) => {
    btn.addEventListener("click", () => handleHadirUlang(btn));
  });
}

// State 1 -> 3: belum ada record sama sekali, buat baru lewat POST
async function handleHadirBaru(btn: HTMLButtonElement): Promise<void> {
  const kolokiumId = parseInt(btn.dataset.kolokiumId ?? "", 10);
  if (Number.isNaN(kolokiumId)) return;

  clearMessage();
  btn.disabled = true;
  btn.textContent = "Memproses...";

  try {
    await apiFetch<StorePesertaKolokiumResponse>("/auth/peserta-kolokium", {
      method: "POST",
      body: JSON.stringify({ kolokium_id: kolokiumId }),
    });

    showMessage("Berhasil mendaftar hadir kolokium.", "success");
    await loadKolokium(currentPage);
  } catch (err) {
    console.error("Gagal mendaftar kolokium:", err);
    showMessage(err instanceof Error ? err.message : "Gagal mendaftar kolokium.", "error");
    btn.disabled = false;
    btn.textContent = "Hadir";
  }
}

// State 2 -> 3: record ada dengan status "batal", ubah lagi jadi "hadir" lewat PATCH
async function handleHadirUlang(btn: HTMLButtonElement): Promise<void> {
  const pesertaId = parseInt(btn.dataset.pesertaId ?? "", 10);
  if (Number.isNaN(pesertaId)) return;

  clearMessage();
  btn.disabled = true;
  btn.textContent = "Memproses...";

  try {
    await apiFetch<{ message: string }>(`/auth/peserta-kolokium/${pesertaId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "hadir" }),
    });

    showMessage("Berhasil mendaftar hadir ulang kolokium.", "success");
    await loadKolokium(currentPage);
  } catch (err) {
    console.error("Gagal mendaftar hadir ulang kolokium:", err);
    showMessage(err instanceof Error ? err.message : "Gagal mendaftar hadir ulang kolokium.", "error");
    btn.disabled = false;
    btn.textContent = "Hadir Ulang";
  }
}

// ------------------------------------------------------------------
// Search (dikirim ke backend, sama seperti pola admin & dosen) &
// entries-per-page (tetap client-side, lihat catatan di getPageRows)
// ------------------------------------------------------------------
function initSearchAndEntries(): void {
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
        loadKolokium(1); // reset ke halaman 1 tiap kali kata kunci berubah
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  if (entriesSelect && entriesSelect.dataset.bound !== "true") {
    entriesSelect.dataset.bound = "true";
    entriesSelect.addEventListener("change", () => {
      renderTable();
    });
  }
}

// ------------------------------------------------------------------
// Jalankan saat halaman siap
// ------------------------------------------------------------------
async function initJadwalKolokiumPage(): Promise<void> {
  clearMessage();
  initSearchAndEntries();
  await loadProfil();
  await loadKolokium(1);
}

initJadwalKolokiumPage();
document.addEventListener("astro:page-load", initJadwalKolokiumPage);