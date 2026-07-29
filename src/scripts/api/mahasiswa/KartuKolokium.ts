// src/scripts/api/mahasiswa/KartuKolokium.ts
// Logic untuk halaman "Kartu Kolokium" (role: mahasiswa):
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
//    - Saat diklik & dikonfirmasi -> PATCH /auth/peserta-kolokium/{peserta_kolokium_id}/status
//      dengan body { status: "batal" } (sesuai PesertaKolokiumController::updateStatus,
//      yang juga sudah menolak permintaan jika sudah hari-H di sisi backend)
// 6) Download -> generate PDF "Kartu Kolokium" (jsPDF + jspdf-autotable),
//    mengambil SEMUA data (bukan hanya 1 halaman) + biodata mahasiswa untuk header
//    NOTE: PDF ini SENGAJA TANPA kop surat institusi (logo/kepala surat) dan
//    TANPA footer form-control (No. Revisi / Hal / Tanggal Berlaku) — hanya
//    judul "KARTU KOLOKIUM", biodata mahasiswa, dan tabel kolokium.

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ------------------------------------------------------------------
// Konfigurasi
// ------------------------------------------------------------------
const API_BASE: string = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token"; // sesuaikan kalau key token localStorage Anda beda
const SEARCH_DEBOUNCE_MS = 400;
const COLSPAN = 8;
const DEFAULT_PER_PAGE = 10;

// ------------------------------------------------------------------
// Tipe data (disesuaikan dengan KartuKolokiumController)
// ------------------------------------------------------------------
type StatusParaf = "signed" | "absent" | string;

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
  tandatangandosen: string | null;
  statusparaf: StatusParaf | null;
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

// Struktur data profil mahasiswa dari GET /auth/profile (UserController::profile).
// Field di sini dibuat fleksibel (beberapa kemungkinan nama key) karena struktur
// persis responsenya belum dikonfirmasi — sesuaikan lagi kalau field aslinya beda.
interface ProfileUser {
  name?: string;
  nama?: string;
  nim?: string;
  prodi?: string;
  foto_profil?: string | null;
  foto?: string | null;
  photo?: string | null;
}

interface ProfileResponse {
  message: string;
  user: ProfileUser;
}

interface BiodataMahasiswa {
  nama: string;
  nim: string;
  prodi: string;
  fotoPath: string | null; // path relatif, harus diakses lewat /auth/images/{path} (butuh token)
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
// Format tanggal, waktu & status untuk tampilan
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

function statusBadge(status: StatusParaf | null): string {
  if (status === "signed") {
    return `<span class="bg-secondary/10 text-secondary border border-secondary/20 px-3 py-1 rounded-full text-[12px] font-bold whitespace-nowrap">Sudah ditanda tangan</span>`;
  }
  if (status === "absent") {
    return `<span class="bg-error/10 text-error border border-error/20 px-3 py-1 rounded-full text-[12px] font-bold whitespace-nowrap">Dosen tidak hadir</span>`;
  }
  return `<span class="bg-outline/10 text-on-surface-variant border border-outline/20 px-3 py-1 rounded-full text-[12px] font-bold whitespace-nowrap">Menunggu tanda tangan</span>`;
}

function escapeHtml(value: string | null): string {
  if (!value) return "-";
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
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
// Ambil SEMUA kartu kolokium (lintas halaman) — dipakai khusus untuk export PDF.
// Sengaja pakai per_page besar (MAX_PER_PAGE backend = 100) di sini supaya
// jumlah request lebih sedikit, independen dari pilihan "Show entries" di UI.
// ------------------------------------------------------------------
async function fetchAllKartuKolokium(): Promise<KartuKolokium[]> {
  const all: KartuKolokium[] = [];
  let page = 1;
  let lastPage = 1;
  const EXPORT_PER_PAGE = 100;

  do {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(EXPORT_PER_PAGE),
    });
    if (currentSearch) params.set("search", currentSearch);

    const json = await apiFetch<KartuKolokiumListResponse>(
      `/auth/kartu-kolokium/my?${params.toString()}`
    );
    if (!json) break;

    all.push(...json.kartu_kolokiums.data);
    lastPage = json.kartu_kolokiums.last_page;
    page++;
  } while (page <= lastPage);

  return all;
}

// ------------------------------------------------------------------
// Ambil biodata mahasiswa login (untuk header PDF: nama, NIM, prodi, foto)
// Endpoint asli: GET /auth/profile (UserController::profile)
// ------------------------------------------------------------------
async function fetchBiodataMahasiswa(): Promise<BiodataMahasiswa | null> {
  try {
    const json = await apiFetch<ProfileResponse>("/auth/profile");
    const user = json?.user;
    if (!user) return null;

    return {
      nama: user.name ?? user.nama ?? "-",
      nim: user.nim ?? "-",
      prodi: user.prodi ?? "-",
      fotoPath: user.foto_profil ?? user.foto ?? user.photo ?? null,
    };
  } catch (err) {
    console.error("Gagal memuat profil mahasiswa:", err);
    return null;
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
        <tr class="table-row-hover transition-colors">
          <td class="px-4 py-4 text-body-sm whitespace-nowrap">${formatTanggal(kartu.tanggal)}</td>
          <td class="px-4 py-4 text-body-sm">${formatWaktu(kartu.waktu)}</td>
          <td class="px-4 py-4 text-body-sm font-medium">${escapeHtml(kartu.namapemrasaran)}</td>
          <td class="px-4 py-4 text-body-sm">${escapeHtml(kartu.nimpemrasaran)}</td>
          <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(kartu.prodi)}</td>
          <td class="px-4 py-4 text-body-sm">${escapeHtml(kartu.moderator)}</td>
          <td class="px-4 py-4">${statusBadge(kartu.statusparaf)}</td>
          <td class="px-4 py-4 text-center">${renderBatalkanCell(kartu)}</td>
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

  const confirmed = window.confirm(
    "Apakah Anda yakin ingin membatalkan kehadiran kolokium ini?"
  );
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
// Export PDF "Kartu Kolokium"
// (TANPA kop surat institusi & TANPA footer form-control)
// ------------------------------------------------------------------

// Ambil gambar sebagai dataURL, dipakai supaya jsPDF (addImage) bisa
// render gambar dari server. `withAuth = true` menambahkan header
// Authorization, WAJIB untuk endpoint yang ada di grup auth:sanctum
// seperti /auth/images/{path} (foto profil).
async function loadImageAsDataUrl(url: string, withAuth = false): Promise<string | null> {
  try {
    const headers: HeadersInit = {};
    if (withAuth) {
      const token = localStorage.getItem(TOKEN_KEY);
      headers.Authorization = `Bearer ${token ?? ""}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error(`Gagal memuat gambar (${res.status}):`, url);
      return null;
    }

    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error("Gagal memuat gambar:", url, err);
    return null;
  }
}

// Bangun URL foto profil dari path relatif via GET /auth/images/{path}
function buildFotoUrl(fotoPath: string): string {
  // Kalau backend sudah mengembalikan URL absolut (http/https), pakai langsung.
  if (/^https?:\/\//i.test(fotoPath)) return fotoPath;
  // Path relatif -> arahkan ke route /auth/images/{path} (butuh token, lihat withAuth di loadImageAsDataUrl)
  const cleanPath = fotoPath.replace(/^\/+/, "");
  return `${API_BASE}/auth/images/${cleanPath}`;
}

function detectImageFormat(dataUrl: string): "PNG" | "JPEG" {
  return dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")
    ? "JPEG"
    : "PNG";
}

// Hitung ukuran gambar yang proporsional (mempertahankan aspect ratio asli)
// supaya muat di dalam kotak maxW x maxH tanpa melar/gepeng.
function computeContainSize(
  doc: jsPDF,
  dataUrl: string,
  maxW: number,
  maxH: number
): { w: number; h: number } {
  try {
    const props = doc.getImageProperties(dataUrl);
    const ratio = props.width / props.height;
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    return { w, h };
  } catch {
    // fallback kalau gagal baca properti gambar
    return { w: maxW, h: maxH };
  }
}

async function generateKartuKolokiumPdf(): Promise<void> {
  showMessage("Menyiapkan PDF...", "success");

  try {
    const [biodata, allKartu] = await Promise.all([
      fetchBiodataMahasiswa(),
      fetchAllKartuKolokium(),
    ]);

    if (allKartu.length === 0) {
      showMessage("Tidak ada data kartu kolokium untuk diekspor.", "error");
      return;
    }

    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const leftX = 40;
    const rightMarginX = pageWidth - 40;

    // Tanpa kop surat institusi (logo/kepala surat) — konten langsung
    // dimulai dari margin atas halaman.
    const topY = 40;

    // ---------- Siapkan foto profil (dimuat dulu, dipakai di tabel header kolom kanan) ----------
    let fotoDataUrl: string | null = null;
    if (biodata?.fotoPath) {
      const fotoUrl = buildFotoUrl(biodata.fotoPath);
      fotoDataUrl = await loadImageAsDataUrl(fotoUrl, true); // withAuth: route /auth/images perlu token
      if (!fotoDataUrl) {
        console.warn("Foto profil gagal dimuat untuk PDF, dilewati.");
      }
    }

    const prodiText = biodata?.prodi
      ? `PROGRAM STUDI ${biodata.prodi.toUpperCase()}`
      : "PROGRAM STUDI TEKNOLOGI REKAYASA PERANGKAT LUNAK";

    const now = new Date();
    // Asumsi tahun akademik baru dimulai bulan Juli (indeks bulan 6).
    // TODO: sesuaikan kalau aturan tahun akademik kampus berbeda.
    const tahunAjaran =
      now.getMonth() >= 6
        ? `${now.getFullYear()}/${now.getFullYear() + 1}`
        : `${now.getFullYear() - 1}/${now.getFullYear()}`;

    // ---------- Tabel header, sesuai layout: ----------
    // ┌───────────────┬──────────┐
    // │     judul      │           │
    // ├───────────────┤  foto     │  <- foto menyatu (rowSpan) sepanjang 2 baris
    // │  data biodata  │           │
    // └───────────────┴──────────┘
    // Kolom kiri (judul di atas, data biodata di bawah) dipisah garis horizontal.
    // Kolom kanan (foto) membentang penuh dari atas sampai bawah tanpa garis pemisah.
    const headerColRightW = 130; // lebar kolom foto
    const headerColLeftW = rightMarginX - leftX - headerColRightW;
    const judulRowH = 64;
    const biodataRowH = 96;

    autoTable(doc, {
      startY: topY,
      margin: { left: leftX, right: pageWidth - rightMarginX },
      theme: "grid",
      styles: {
        font: "times",
        fontSize: 10,
        cellPadding: 6,
        valign: "middle",
        lineColor: [255, 255, 255],
        lineWidth: 0.75,
      },
      columnStyles: {
        0: { cellWidth: headerColLeftW },
        1: { cellWidth: headerColRightW },
      },
      body: [
        [
          { content: "", styles: { minCellHeight: judulRowH } },
          { content: "", rowSpan: 2, styles: { minCellHeight: judulRowH + biodataRowH } },
        ],
        [{ content: "", styles: { minCellHeight: biodataRowH } }],
      ] as unknown as (string | Record<string, unknown>)[][],
      didDrawCell: (data) => {
        const { cell, row, column } = data;

        if (column.index === 0 && row.index === 0) {
          // Baris atas, kolom kiri: judul (rata tengah)
          const centerX = cell.x + cell.width / 2;
          doc.setFont("times", "bold");
          doc.setFontSize(18);
          doc.text("KARTU KOLOKIUM", centerX, cell.y + cell.height / 2 - 12, { align: "center" });
          doc.setFontSize(11);
          doc.text(prodiText, centerX, cell.y + cell.height / 2 + 4, {
            align: "center",
            maxWidth: cell.width - 12,
          });
          doc.text(`TAHUN AKADEMIK ${tahunAjaran}`, centerX, cell.y + cell.height / 2 + 18, {
            align: "center",
            maxWidth: cell.width - 12,
          });
        } else if (column.index === 0 && row.index === 1) {
          // Baris bawah, kolom kiri: data biodata (Nama & NIM)
          doc.setFont("times", "normal");
          doc.setFontSize(11);
          const textY = cell.y + cell.height / 2;
          doc.text("Nama Mahasiswa", cell.x + 6, textY - 8);
          doc.text("NIM", cell.x + 6, textY + 8);
          doc.text(`: ${biodata?.nama ?? "-"}`, cell.x + 106, textY - 8);
          doc.text(`: ${biodata?.nim ?? "-"}`, cell.x + 106, textY + 8);
        } else if (column.index === 1 && row.index === 0 && fotoDataUrl) {
          // Kolom kanan (span 2 baris): foto profil, proporsional, TANPA crop oval
          const format = detectImageFormat(fotoDataUrl);
          const pad = 6;
          const maxW = cell.width - pad * 2;
          const maxH = cell.height - pad * 2;
          const { w, h } = computeContainSize(doc, fotoDataUrl, maxW, maxH);
          const drawX = cell.x + (cell.width - w) / 2;
          const drawY = cell.y + (cell.height - h) / 2;
          doc.addImage(fotoDataUrl, format, drawX, drawY, w, h);
        }
      },
    });

    // ---------- Tentukan startY tabel data: tepat di bawah tabel header ----------
    const tableStartY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;

    // ---------- Siapkan gambar tanda tangan/paraf per baris ----------
    const signatureImages: Record<number, string> = {};
    await Promise.all(
      allKartu.map(async (kartu, idx) => {
        if (!kartu.tandatangandosen) return;

        if (kartu.tandatangandosen.startsWith("data:")) {
          signatureImages[idx] = kartu.tandatangandosen;
          return;
        }

        // Sama seperti foto profil: kemungkinan path relatif yang disajikan
        // lewat route /auth/images/{path}, jadi butuh token juga.
        const url = buildFotoUrl(kartu.tandatangandosen);
        const dataUrl = await loadImageAsDataUrl(url, true);
        if (dataUrl) signatureImages[idx] = dataUrl;
      })
    );

    // ---------- Tabel ----------
    const body = allKartu.map((kartu, idx) => [
      String(idx + 1),
      formatTanggal(kartu.tanggal),
      formatWaktu(kartu.waktu),
      kartu.namapemrasaran ?? "-",
      kartu.nimpemrasaran ?? "-",
      kartu.moderator ?? "-",
      "", // kolom Paraf digambar manual via didDrawCell
    ]);

    autoTable(doc, {
      startY: tableStartY,
      // Tanpa kop surat, jadi halaman lanjutan cukup pakai margin atas standar.
      margin: { top: 40, bottom: 40 },
      head: [["No", "Hari/Tanggal", "Waktu", "Nama Pemrasaran", "NIM", "Moderator", "Paraf"]],
      body,
      styles: { font: "times", fontSize: 10, cellPadding: 6, valign: "middle" },
      headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: "bold" },
      theme: "grid",
      columnStyles: {
        0: { cellWidth: 30, halign: "center" },
        6: { cellWidth: 70 },
      },
      didDrawCell: (data) => {
        if (data.section === "body" && data.column.index === 6) {
          const dataUrl = signatureImages[data.row.index];
          if (dataUrl) {
            const format = detectImageFormat(dataUrl);
            const pad = 4;
            const maxW = data.cell.width - pad * 2;
            const maxH = data.cell.height - pad * 2;
            const { w, h } = computeContainSize(doc, dataUrl, maxW, maxH);
            const drawX = data.cell.x + (data.cell.width - w) / 2;
            const drawY = data.cell.y + (data.cell.height - h) / 2;
            doc.addImage(dataUrl, format, drawX, drawY, w, h);
          }
        }
      },
    });

    // ---------- Preview dulu di tab baru, TIDAK langsung download ----------
    const blob = doc.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank");

    showMessage("PDF siap ditinjau — dibuka di tab baru.", "success");
  } catch (err) {
    console.error("Gagal membuat PDF kartu kolokium:", err);
    showMessage("Gagal membuat PDF. Coba lagi.", "error");
  }
}

function handleDownload(): void {
  void generateKartuKolokiumPdf();
}

// ------------------------------------------------------------------
// Search, per_page (server-side) & tombol download
// ------------------------------------------------------------------
function initSearchAndActions(): void {
  const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
  const entriesSelect = document.getElementById("entries-per-page") as HTMLSelectElement | null;
  const downloadBtn = document.getElementById("download-btn") as HTMLButtonElement | null;

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

  if (downloadBtn && downloadBtn.dataset.bound !== "true") {
    downloadBtn.dataset.bound = "true";
    downloadBtn.addEventListener("click", handleDownload);
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