// src/scripts/api/dosen/home.ts
// Fetch data untuk halaman dosen-home.astro:
//
// - Profil dosen (nama, NIP, foto)
// - "Jumlah Kolokium/Seminar Dihadiri" = total kolokium/seminar di mana dosen
//   ini terlibat sebagai PEMBIMBING atau MODERATOR (dari /kolokium/my &
//   /seminar/my, yang backend-nya sudah dicek pembimbing via relasi many-to-many
//   + moderator_id). Tidak difilter status, karena pembimbing tidak punya
//   konsep "hadir" seperti kartu (cuma moderator yang tanda tangan kartu).
// - "Belum ditandatangani" (kartu urgent) = statusparaf masih "pending",
//   khusus dari kartu yang dimoderatori dosen ini (/kartu-kolokium/my &
//   /kartu-seminar/my) — karena hanya moderator yang bisa tanda tangan kartu.
// - Jadwal hari ini = kolokium/seminar (pembimbing/moderator) yang tanggalnya hari ini

const API_BASE_URL = import.meta.env.VITE_BASE_URL;

type StatusParaf = "pending" | "signed" | "absent";

interface ApiUser {
  id: number;
  role: "admin" | "dosen" | "mahasiswa";
  nama: string;
  nip?: string;
  nim?: string;
  foto?: string;
  [key: string]: unknown;
}

interface ProfileResponse {
  message?: string;
  user?: ApiUser;
}

interface KartuItem {
  id: number;
  moderator_id: number;
  tanggal: string | null;
  waktu: string | null;
  namapemrasaran: string;
  nimpemrasaran: string;
  prodi: string;
  statusparaf: StatusParaf;
  [key: string]: unknown;
}

interface KartuKolokiumResponse {
  message?: string;
  kartu_kolokiums?: KartuItem[];
}

interface KartuSeminarResponse {
  message?: string;
  kartu_seminars?: KartuItem[];
}

interface ForumItem {
  id: number;
  nama: string;
  nim: string;
  prodi: string;
  judul: string;
  tanggal: string | null;
  waktu: string | null;
  status: string;
  [key: string]: unknown;
}

// Bentuk response Laravel paginate(): { data: [...], total, current_page, ... }
interface PaginatedResponse<T> {
  data: T[];
  total?: number;
  current_page?: number;
  [key: string]: unknown;
}

type JadwalItem = ForumItem & { jenis: "Kolokium" | "Seminar" };

function getToken(): string | null {
  return localStorage.getItem("auth_token");
}

async function apiGet<T>(path: string): Promise<T | null> {
  const token = getToken();
  if (!token) {
    window.location.href = "/login";
    return null;
  }

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401) {
      // token invalid/expired
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
      window.location.href = "/login";
      return null;
    }

    if (!res.ok) {
      console.error(`GET ${path} gagal dengan status ${res.status}`);
      return null;
    }

    return (await res.json()) as T;
  } catch (err) {
    console.error(`GET ${path} error:`, err);
    return null;
  }
}

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

// ---------- Profil ----------
async function loadProfile(): Promise<void> {
  const data = await apiGet<ProfileResponse>("/auth/profile");
  const user = data?.user;
  if (!user) return;

  setText("profile-nama", user.nama || "-");
  setText("profile-nip", user.nip || "-");

  const fotoEl = document.getElementById("profile-foto") as HTMLImageElement | null;
  if (fotoEl && user.foto) {
    fotoEl.src = user.foto;
  }
}

// ---------- Kartu Kolokium/Seminar: khusus untuk "belum ditandatangani" ----------
// (hanya moderator yang bisa tanda tangan kartu, jadi tetap moderator-only)
async function loadUrgentKolokium(): Promise<void> {
  const data = await apiGet<KartuKolokiumResponse>("/auth/kartu-kolokium/my");
  const items = data?.kartu_kolokiums ?? [];
  const belumTtd = items.filter((k) => k.statusparaf === "pending").length;
  setText("urgent-kolokium-count", String(belumTtd));
}

async function loadUrgentSeminar(): Promise<void> {
  const data = await apiGet<KartuSeminarResponse>("/auth/kartu-seminar/my");
  const items = data?.kartu_seminars ?? [];
  const belumTtd = items.filter((k) => k.statusparaf === "pending").length;
  setText("urgent-seminar-count", String(belumTtd));
}

// ---------- Jadwal Hari Ini ----------
function todayISO(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function renderJadwal(items: JadwalItem[]): void {
  const list = document.getElementById("jadwal-list");
  if (!list) return;

  if (items.length === 0) {
    list.innerHTML = `
      <li class="p-4 text-center text-sm text-on-surface-variant">
        Tidak ada jadwal hari ini.
      </li>
    `;
    return;
  }

  list.innerHTML = items
    .map((item, index) => {
      const isLast = index === items.length - 1;
      const isKolokium = item.jenis === "Kolokium";
      const iconBg = isKolokium ? "bg-[#E8F5E9] text-[#4CAF50]" : "bg-[#FFF3E0] text-[#FF9800]";
      const icon = isKolokium ? "school" : "event";
      const tanggalFormatted = item.tanggal
        ? new Date(item.tanggal).toLocaleDateString("id-ID", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : "-";

      return `
        <li class="p-4 ${isLast ? "" : "border-b border-outline-variant"} flex items-start gap-4 hover:bg-surface-container-low transition-colors">
          <div class="w-10 h-10 rounded-full ${iconBg} flex items-center justify-center shrink-0">
            <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">${icon}</span>
          </div>
          <div>
            <p class="font-body-md text-body-md text-on-surface font-medium mb-1">${escapeHtml(item.jenis)}: ${escapeHtml(item.nama)}</p>
            <p class="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-2">
              ${tanggalFormatted} <span class="w-1 h-1 rounded-full bg-outline"></span> ${item.waktu ?? "-"}
            </p>
          </div>
        </li>
      `;
    })
    .join("");
}

// ---------- Kolokium & Seminar (pembimbing ATAU moderator) ----------
// Dipakai untuk 2 hal sekaligus dari 1x fetch:
// 1. Stat "Jumlah Dihadiri" (pakai field `total` dari paginator, bukan data.length,
//    supaya tidak kepotong 10 karena paginate(10))
// 2. Jadwal Hari Ini (filter tanggal hari ini dari `data`)
async function loadKolokiumDanSeminar(): Promise<void> {
  const [kolokiumRes, seminarRes] = await Promise.all([
    apiGet<PaginatedResponse<ForumItem>>("/auth/kolokium/my"),
    apiGet<PaginatedResponse<ForumItem>>("/auth/seminar/my"),
  ]);

  // Stat "Dihadiri" = total kolokium/seminar dimana dosen jadi pembimbing ATAU moderator
  const totalKolokium = kolokiumRes?.total ?? kolokiumRes?.data?.length ?? 0;
  const totalSeminar = seminarRes?.total ?? seminarRes?.data?.length ?? 0;
  setText("stat-kolokium-dihadiri", String(totalKolokium));
  setText("stat-seminar-dihadiri", String(totalSeminar));

  // Jadwal Hari Ini dari data yang sama
  const today = todayISO();

  const kolokiumToday: JadwalItem[] = (kolokiumRes?.data ?? [])
    .filter((k) => k.tanggal?.slice(0, 10) === today)
    .map((k) => ({ ...k, jenis: "Kolokium" as const }));

  const seminarToday: JadwalItem[] = (seminarRes?.data ?? [])
    .filter((s) => s.tanggal?.slice(0, 10) === today)
    .map((s) => ({ ...s, jenis: "Seminar" as const }));

  const gabungan = [...kolokiumToday, ...seminarToday].sort((a, b) =>
    (a.waktu ?? "").localeCompare(b.waktu ?? "")
  );

  renderJadwal(gabungan);
}

// ---------- Init ----------
function initDosenDashboard(): void {
  loadProfile();
  loadKolokiumDanSeminar();
  loadUrgentKolokium();
  loadUrgentSeminar();
}

initDosenDashboard();
document.addEventListener("astro:page-load", initDosenDashboard);