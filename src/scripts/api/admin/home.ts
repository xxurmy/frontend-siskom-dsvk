// src/scripts/api/admin/home.ts
// Fetch data untuk halaman admin/home.astro:
// - Total Kolokium (total, accepted, pending) dari /auth/kolokium (filter ?status)
// - Total Seminar (total, accepted, pending) dari /auth/seminar (filter ?status)
// - Total Akun Mahasiswa & Dosen dari /auth/users (hitung berdasarkan field role)
//
// Catatan: field `total` diambil dari meta paginator Laravel (paginate(10)),
// bukan `data.length`, supaya angkanya benar meski hasilnya lebih dari 10 baris.

const API_BASE_URL = import.meta.env.VITE_BASE_URL;

interface ApiUserListItem {
  id: number;
  role: "admin" | "dosen" | "mahasiswa";
  nama: string;
  nim?: string | null;
  nip?: string | null;
  username: string;
  email: string;
  prodi?: string | null;
  foto?: string | null;
  tandatangan?: string | null;
  status?: boolean | number;
  [key: string]: unknown;
}

interface UsersResponse {
  message?: string;
  users?: ApiUserListItem[];
}

interface PaginatedResponse<T = unknown> {
  data: T[];
  total?: number;
  current_page?: number;
  [key: string]: unknown;
}

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
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
      window.location.href = "/login";
      return null;
    }

    if (res.status === 403) {
      // Bukan admin -> lempar ke halaman unassigned (harusnya sudah ditangani
      // role guard di Layout.astro, ini cuma jaga-jaga tambahan).
      window.location.href = "/unassigned";
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

// ---------- Kolokium & Seminar (total, accepted, pending) ----------
async function loadForumStats(
  basePath: "/auth/kolokium" | "/auth/seminar",
  ids: { total: string; accepted: string; pending: string }
): Promise<void> {
  const [totalRes, acceptedRes, pendingRes] = await Promise.all([
    apiGet<PaginatedResponse>(basePath),
    apiGet<PaginatedResponse>(`${basePath}?status=approved`),
    apiGet<PaginatedResponse>(`${basePath}?status=pending`),
  ]);

  setText(ids.total, String(totalRes?.total ?? totalRes?.data?.length ?? 0));
  setText(ids.accepted, String(acceptedRes?.total ?? acceptedRes?.data?.length ?? 0));
  setText(ids.pending, String(pendingRes?.total ?? pendingRes?.data?.length ?? 0));
}

// ---------- Total Akun Mahasiswa & Dosen ----------
async function loadUserStats(): Promise<void> {
  const data = await apiGet<UsersResponse>("/auth/users");
  const users = data?.users ?? [];

  const totalMahasiswa = users.filter((u) => u.role === "mahasiswa").length;
  const totalDosen = users.filter((u) => u.role === "dosen").length;

  setText("stat-akun-mahasiswa", String(totalMahasiswa));
  setText("stat-akun-dosen", String(totalDosen));
}

// ---------- Init ----------
function initAdminDashboardData(): void {
  loadForumStats("/auth/kolokium", {
    total: "stat-kolokium-total",
    accepted: "stat-kolokium-accepted",
    pending: "stat-kolokium-pending",
  });

  loadForumStats("/auth/seminar", {
    total: "stat-seminar-total",
    accepted: "stat-seminar-accepted",
    pending: "stat-seminar-pending",
  });

  loadUserStats();
}

initAdminDashboardData();
document.addEventListener("astro:page-load", initAdminDashboardData);