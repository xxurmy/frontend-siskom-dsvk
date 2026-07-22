// src/scripts/role-guard.ts
// Guard role — dipanggil sekali dari Layout.astro untuk memastikan role
// user yang login sesuai dengan role yang dibutuhkan halaman (userRole prop).
// Kalau tidak sesuai (atau belum login), user di-redirect.

type Role = "admin" | "dosen" | "mahasiswa";

interface StoredUser {
  role?: Role;
  nama?: string;
  username?: string;
  [key: string]: unknown;
}

const UNASSIGNED_PATH = "/unassigned";
const LOGIN_PATH = "/login";

function getStoredUser(): StoredUser | null {
  try {
    const raw = localStorage.getItem("auth_user");
    if (!raw) return null;
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

/**
 * Cek apakah role user yang sedang login sesuai dengan role yang
 * dibutuhkan halaman ini (dari prop userRole di Layout.astro).
 *
 * @param requiredRole - role yang dibutuhkan untuk mengakses halaman ini
 */
export function guardRole(requiredRole: Role): void {
  const token = localStorage.getItem("auth_token");
  const user = getStoredUser();

  // Belum login sama sekali -> lempar ke login
  if (!token || !user || !user.role) {
    window.location.href = LOGIN_PATH;
    return;
  }

  // Sudah login tapi role tidak cocok -> lempar ke halaman unassigned
  if (user.role !== requiredRole) {
    window.location.href = UNASSIGNED_PATH;
    return;
  }
}