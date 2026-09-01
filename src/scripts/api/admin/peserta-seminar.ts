// src/scripts/api/admin/peserta-seminar.ts
// Halaman Daftar Peserta Seminar (admin) — dibuka dari tombol "Peserta" di
// Jadwal Seminar admin (?seminar_id=...). Menampilkan info seminar +
// daftar peserta forum (kartu seminar), READ-ONLY (tanpa status paraf/
// tanda tangan, tanpa aksi tandai hadir/tidak hadir, tanpa tombol Simpan —
// fitur tanda tangan/paraf sudah dihapus dari aplikasi). Sama seperti versi
// dosen, tapi admin bisa mengakses kartu seminar dari seminar manapun
// (tidak dibatasi moderator_id).
//
// GET /auth/seminar/{id}                       -> info seminar (header halaman)
// GET /auth/kartu-seminar/seminar/{seminarId} -> daftar peserta (tidak dipaginate)

interface KartuSeminar {
  id: number;
  seminar_id: number;
  pemrasaran_id: number;
  moderator_id: number;
  peserta_seminar_id: number;
  forum_id: number;
  tanggal: string | null;
  waktu: string | null;
  namapemrasaran: string | null;
  nimpemrasaran: string | null;
  prodi: string | null;
  moderator: string | null;
  namaforum?: string | null;
  nimforum?: string | null;
}

interface KartuSeminarListResponse {
  message: string;
  kartu_seminars: KartuSeminar[];
}

interface SeminarInfo {
  id: number;
  nama: string;
  nim: string;
  prodi: string;
  judul: string;
  tanggal: string | null;
  waktu: string | null;
  ruangan: string | null;
  namadosenpembimbing: string | null;
  namadosenmoderator: string | null;
  jumlahforum: number;
  [key: string]: unknown;
}

const API_BASE_URL = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token";
const TBODY_ID = "absensi-tbody";
const COLSPAN = 4;

let seminarId: string | null = null;

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

function getSeminarIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("seminar_id");
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
// Pesan status (error)
// ------------------------------------------------------------------
function showMessage(text: string, variant: "success" | "error"): void {
  const el = document.getElementById("absensi-message");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden", "bg-green-100", "text-green-800", "bg-red-100", "text-red-800");
  el.classList.add(variant === "success" ? "bg-green-100" : "bg-red-100", variant === "success" ? "text-green-800" : "text-red-800");
}

function clearMessage(): void {
  const el = document.getElementById("absensi-message");
  if (!el) return;
  el.classList.add("hidden");
  el.textContent = "";
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

// ------------------------------------------------------------------
// Info seminar (header halaman)
// ------------------------------------------------------------------
function renderSeminarInfo(info: SeminarInfo): void {
  const container = document.getElementById("seminar-info");
  if (!container) return;

  const rows: [string, string][] = [
    ["Judul", info.judul ?? "-"],
    ["Nama Pemrasaran", `${info.nama ?? "-"} (${info.nim ?? "-"})`],
    ["Prodi", info.prodi ?? "-"],
    ["Tanggal", formatTanggal(info.tanggal)],
    ["Waktu", formatWaktu(info.waktu)],
    ["Ruangan", info.ruangan ?? "-"],
    ["Dosen Pembimbing", info.namadosenpembimbing ?? "-"],
    ["Moderator", info.namadosenmoderator ?? "-"],
    ["Jumlah Forum", String(info.jumlahforum ?? 0)],
  ];

  container.innerHTML = rows
    .map(
      ([label, value]) => `
        <div>
          <p class="text-label-sm text-on-surface-variant uppercase tracking-wide">${label}</p>
          <p class="text-body-sm font-medium">${escapeHtml(value)}</p>
        </div>
      `
    )
    .join("");
}

async function loadSeminarInfo(): Promise<void> {
  const token = getToken();
  if (!token || !seminarId) return;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/seminar/${seminarId}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (redirectIfUnauthorized(res.status)) return;

    if (!res.ok) {
      const container = document.getElementById("seminar-info");
      if (container) {
        container.innerHTML = `<p class="text-body-sm text-error col-span-full">Gagal memuat informasi seminar.</p>`;
      }
      return;
    }

    const info: SeminarInfo = await res.json();
    renderSeminarInfo(info);
  } catch (err) {
    console.error("Gagal ambil info seminar:", err);
    const container = document.getElementById("seminar-info");
    if (container) {
      container.innerHTML = `<p class="text-body-sm text-error col-span-full">Terjadi kesalahan jaringan.</p>`;
    }
  }
}

// ------------------------------------------------------------------
// Tabel peserta (read-only)
// ------------------------------------------------------------------
function renderRow(item: KartuSeminar, index: number): string {
  return `
    <tr class="table-row-hover transition-colors">
      <td class="px-4 py-4 text-body-sm">${index + 1}</td>
      <td class="px-4 py-4 text-body-sm font-medium">${escapeHtml(item.namaforum ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm">${escapeHtml(item.nimforum ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.prodi ?? "-")}</td>
    </tr>
  `;
}

function renderTable(items: KartuSeminar[]): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;

  if (items.length === 0) {
    renderMessageRow("Belum ada peserta yang terdaftar hadir pada seminar ini.");
    return;
  }

  tbody.innerHTML = items.map((item, index) => renderRow(item, index)).join("");
}

// ------------------------------------------------------------------
// Fetch peserta
// ------------------------------------------------------------------
async function loadPeserta(): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/";
    return;
  }
  if (!seminarId) {
    renderMessageRow("ID seminar tidak ditemukan pada URL.", "error");
    return;
  }

  renderMessageRow("Memuat data...");

  try {
    const res = await fetch(`${API_BASE_URL}/auth/kartu-seminar/seminar/${seminarId}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (redirectIfUnauthorized(res.status)) return;

    if (!res.ok) {
      renderMessageRow("Gagal memuat data peserta.", "error");
      return;
    }

    const json: KartuSeminarListResponse = await res.json();
    renderTable(json.kartu_seminars);
  } catch (err) {
    console.error("Gagal ambil peserta seminar:", err);
    renderMessageRow("Terjadi kesalahan jaringan.", "error");
  }
}

function initAbsensiSeminarPage(): void {
  clearMessage();
  seminarId = getSeminarIdFromUrl();
  loadSeminarInfo();
  loadPeserta();
}

initAbsensiSeminarPage();
document.addEventListener("astro:page-load", initAbsensiSeminarPage);