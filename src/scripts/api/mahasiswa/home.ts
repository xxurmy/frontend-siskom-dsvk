// src/scripts/api/mahasiswa/home.ts
// Logic fetch untuk halaman beranda mahasiswa.

// ------------------------------------------------------------------
// Tipe data (disesuaikan dengan field yang dikembalikan controller Laravel)
// ------------------------------------------------------------------
type Role = "mahasiswa" | "dosen" | "admin";
type StatusPengajuan = "pending" | "approved" | "rejected";
type StatusParaf = "signed" | "absent";

interface UserProfil {
  id: number;
  nama: string;
  nim?: string | null;
  prodi?: string | null;
  role: Role;
  tandatangan?: string | null;
}

// Beberapa endpoint bisa membungkus user di { user }, { data }, atau langsung object
type ProfilResponse = UserProfil | { user: UserProfil } | { data: UserProfil };

interface Kolokium {
  id: number;
  mahasiswa_id: number;
  nama: string;
  nim: string;
  prodi: string;
  judul: string;
  status: StatusPengajuan;
  tanggal: string | null;
  waktu: string | null;
}

interface Seminar {
  id: number;
  mahasiswa_id: number;
  nama: string;
  nim: string;
  prodi: string;
  judul: string;
  status: StatusPengajuan;
  tanggal: string | null;
  waktu: string | null;
}

// Bentuk response Laravel paginate()
interface LaravelPaginator<T> {
  current_page: number;
  data: T[];
  total: number;
  [key: string]: unknown;
}

interface KartuKolokium {
  id: number;
  kolokium_id: number;
  pemrasaran_id: number;
  moderator_id: number;
  forum_id: number;
  tanggal: string | null;
  waktu: string | null;
  namapemrasaran: string;
  nimpemrasaran: string;
  prodi: string;
  moderator: string;
  tandatangandosen: string | null;
  statusparaf: StatusParaf;
  namaforum?: string;
  nimforum?: string;
}

interface KartuSeminar {
  id: number;
  seminar_id: number;
  pemrasaran_id: number;
  moderator_id: number;
  forum_id: number;
  tanggal: string | null;
  waktu: string | null;
  namapemrasaran: string;
  nimpemrasaran: string;
  prodi: string;
  moderator: string;
  tandatangandosen: string | null;
  statusparaf: StatusParaf;
  namaforum?: string;
  nimforum?: string;
}

// kartu_kolokiums / kartu_seminars dikembalikan sebagai hasil paginate(),
// jadi bentuknya paginator ({ data, total, current_page, ... }), bukan array polos.
interface KartuKolokiumListResponse {
  message: string;
  kartu_kolokiums: LaravelPaginator<KartuKolokium>;
}

interface KartuSeminarListResponse {
  message: string;
  kartu_seminars: LaravelPaginator<KartuSeminar>;
}

// ------------------------------------------------------------------
// Konfigurasi
// ------------------------------------------------------------------
const API_BASE: string = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token"; // sesuaikan kalau key token localStorage Anda beda

// Mapping status pengajuan -> label & warna badge
const STATUS_MAP: Record<StatusPengajuan | "default", { label: string; className: string }> = {
  pending: { label: "Menunggu", className: "bg-yellow-100 text-yellow-800" },
  approved: { label: "Diterima", className: "bg-green-100 text-green-800" },
  rejected: { label: "Ditolak", className: "bg-red-100 text-red-800" },
  default: { label: "Belum ada pengajuan", className: "bg-surface-container text-on-surface-variant" },
};

function setBadge(elId: string, statusKey: StatusPengajuan | undefined): void {
  const el = document.getElementById(elId);
  if (!el) return;
  const info = STATUS_MAP[statusKey ?? "default"] ?? STATUS_MAP.default;
  el.textContent = info.label;
  el.className =
    "inline-flex items-center px-3 py-1 rounded-full text-xs font-medium " + info.className;
}

function setText(elId: string, value: string | number): void {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = String(value);
}

async function apiFetch<T>(path: string): Promise<T | null> {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token ?? ""}`,
    },
  });

  if (res.status === 401) {
    // token tidak valid / kedaluwarsa -> arahkan ke halaman login
    window.location.href = "/";
    return null;
  }

  if (!res.ok) {
    throw new Error(`Request ke ${path} gagal (status ${res.status})`);
  }

  return (await res.json()) as T;
}

function extractUser(json: ProfilResponse): UserProfil {
  if ("user" in json) return json.user;
  if ("data" in json) return json.data;
  return json;
}

// ------------------------------------------------------------------
// Load Profil
// ------------------------------------------------------------------
async function loadProfil(): Promise<void> {
  try {
    const json = await apiFetch<ProfilResponse>("/auth/profile");
    if (!json) return;

    const user = extractUser(json);

    setText("profil-nama", user.nama ?? "-");
    setText("profil-nim", `NIM: ${user.nim ?? "-"}`);
    setText("profil-prodi", user.prodi ?? "-");
  } catch (err) {
    console.error("Gagal memuat profil:", err);
    setText("profil-nama", "Gagal memuat profil");
  }
}

// ------------------------------------------------------------------
// Load Status Kolokium & Seminar (ambil pengajuan terbaru milik user)
// ------------------------------------------------------------------
async function loadStatusPengajuan(): Promise<void> {
  try {
    const json = await apiFetch<LaravelPaginator<Kolokium>>("/auth/kolokium/my");
    if (!json) return;

    const latest = json.data?.[0];
    setBadge("status-kolokium", latest?.status);
  } catch (err) {
    console.error("Gagal memuat status kolokium:", err);
    setBadge("status-kolokium", undefined);
  }

  try {
    const json = await apiFetch<LaravelPaginator<Seminar>>("/auth/seminar/my");
    if (!json) return;

    const latest = json.data?.[0];
    setBadge("status-seminar", latest?.status);
  } catch (err) {
    console.error("Gagal memuat status seminar:", err);
    setBadge("status-seminar", undefined);
  }
}

// ------------------------------------------------------------------
// Load Jumlah Kehadiran (dari kartu kolokium / kartu seminar milik user)
// ------------------------------------------------------------------
async function loadKehadiran(): Promise<void> {
  try {
    const json = await apiFetch<KartuKolokiumListResponse>("/auth/kartu-kolokium/my");
    if (!json) return;

    const jumlah = json.kartu_kolokiums?.total ?? 0;
    setText("count-kolokium-dihadiri", jumlah);
  } catch (err) {
    console.error("Gagal memuat kehadiran kolokium:", err);
    setText("count-kolokium-dihadiri", "-");
  }

  try {
    const json = await apiFetch<KartuSeminarListResponse>("/auth/kartu-seminar/my");
    if (!json) return;

    const jumlah = json.kartu_seminars?.total ?? 0;
    setText("count-seminar-dihadiri", jumlah);
  } catch (err) {
    console.error("Gagal memuat kehadiran seminar:", err);
    setText("count-seminar-dihadiri", "-");
  }
}

// ------------------------------------------------------------------
// Jalankan semua saat halaman siap
// ------------------------------------------------------------------
function initBerandaPage(): void {
  loadProfil();
  loadStatusPengajuan();
  loadKehadiran();
}

initBerandaPage();
document.addEventListener("astro:page-load", initBerandaPage);