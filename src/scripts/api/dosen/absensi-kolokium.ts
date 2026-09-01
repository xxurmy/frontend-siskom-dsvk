// src/scripts/api/dosen/absensi-kolokium.ts
// Halaman Daftar Peserta Kolokium — dibuka dari tombol "Peserta" di Jadwal
// Kolokium dosen (?kolokium_id=...). Menampilkan info kolokium + daftar
// peserta forum (kartu kolokium), READ-ONLY (tanpa status paraf/tanda
// tangan, tanpa aksi tandai hadir/tidak hadir, tanpa tombol Simpan — fitur
// tanda tangan/paraf sudah dihapus dari aplikasi).
//
// GET /auth/kolokium/{id}                       -> info kolokium (header halaman)
// GET /auth/kartu-kolokium/kolokium/{kolokiumId} -> daftar peserta (tidak dipaginate)

interface KartuKolokium {
  id: number;
  kolokium_id: number;
  pemrasaran_id: number;
  moderator_id: number;
  peserta_kolokium_id: number;
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

interface KartuKolokiumListResponse {
  message: string;
  kartu_kolokiums: KartuKolokium[];
}

interface KolokiumInfo {
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

let kolokiumId: string | null = null;

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

function getKolokiumIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("kolokium_id");
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
// Info kolokium (header halaman)
// ------------------------------------------------------------------
function renderKolokiumInfo(info: KolokiumInfo): void {
  const container = document.getElementById("kolokium-info");
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

async function loadKolokiumInfo(): Promise<void> {
  const token = getToken();
  if (!token || !kolokiumId) return;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/kolokium/${kolokiumId}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (redirectIfUnauthorized(res.status)) return;

    if (!res.ok) {
      const container = document.getElementById("kolokium-info");
      if (container) {
        container.innerHTML = `<p class="text-body-sm text-error col-span-full">Gagal memuat informasi kolokium.</p>`;
      }
      return;
    }

    const info: KolokiumInfo = await res.json();
    renderKolokiumInfo(info);
  } catch (err) {
    console.error("Gagal ambil info kolokium:", err);
    const container = document.getElementById("kolokium-info");
    if (container) {
      container.innerHTML = `<p class="text-body-sm text-error col-span-full">Terjadi kesalahan jaringan.</p>`;
    }
  }
}

// ------------------------------------------------------------------
// Tabel peserta (read-only)
// ------------------------------------------------------------------
function renderRow(item: KartuKolokium, index: number): string {
  return `
    <tr class="table-row-hover transition-colors">
      <td class="px-4 py-4 text-body-sm">${index + 1}</td>
      <td class="px-4 py-4 text-body-sm font-medium">${escapeHtml(item.namaforum ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm">${escapeHtml(item.nimforum ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.prodi ?? "-")}</td>
    </tr>
  `;
}

function renderTable(items: KartuKolokium[]): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;

  if (items.length === 0) {
    renderMessageRow("Belum ada peserta yang terdaftar hadir pada kolokium ini.");
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
  if (!kolokiumId) {
    renderMessageRow("ID kolokium tidak ditemukan pada URL.", "error");
    return;
  }

  renderMessageRow("Memuat data...");

  try {
    const res = await fetch(`${API_BASE_URL}/auth/kartu-kolokium/kolokium/${kolokiumId}`, {
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

    const json: KartuKolokiumListResponse = await res.json();
    renderTable(json.kartu_kolokiums);
  } catch (err) {
    console.error("Gagal ambil peserta kolokium:", err);
    renderMessageRow("Terjadi kesalahan jaringan.", "error");
  }
}

function initAbsensiKolokiumPage(): void {
  clearMessage();
  kolokiumId = getKolokiumIdFromUrl();
  loadKolokiumInfo();
  loadPeserta();
}

initAbsensiKolokiumPage();
document.addEventListener("astro:page-load", initAbsensiKolokiumPage);