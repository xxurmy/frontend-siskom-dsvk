// src/scripts/api/sidebar-profile.ts
// Ambil data user (nama, inisial, NIM/NIP) dari /auth/profile untuk ditampilkan
// di bagian bawah sidebar. Dipakai di SidebarAdmin, SidebarDosen, SidebarMahasiswa
// — beda-beda field sekunder yang ditampilkan.

const API_BASE_URL = import.meta.env.VITE_BASE_URL;

interface ApiUser {
  id: number;
  role: "admin" | "dosen" | "mahasiswa";
  nama: string;
  nim?: string;
  nip?: string;
  [key: string]: unknown;
}

interface ProfileResponse {
  message?: string;
  user?: ApiUser;
}

export type SidebarSecondaryField = "nim" | "nip" | "none";

function getInitials(nama: string): string {
  const words = nama.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

async function fetchProfile(): Promise<ApiUser | null> {
  const token = localStorage.getItem("auth_token");
  if (!token) return null;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/profile`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    const data: ProfileResponse = await res.json();
    return data.user ?? null;
  } catch (err) {
    console.error("Gagal ambil profil untuk sidebar:", err);
    return null;
  }
}

function applyProfile(user: ApiUser, secondaryField: SidebarSecondaryField): void {
  const nameEl = document.getElementById("sidebar-user-name");
  const initialsEl = document.getElementById("sidebar-user-initials");
  const secondaryEl = document.getElementById("sidebar-user-secondary");

  if (nameEl) nameEl.textContent = user.nama || "-";
  if (initialsEl) initialsEl.textContent = getInitials(user.nama || "?");

  if (secondaryEl) {
    if (secondaryField === "none") {
      secondaryEl.remove();
    } else {
      const value = secondaryField === "nim" ? user.nim : user.nip;
      secondaryEl.textContent = value || "-";
    }
  }
}

export async function initSidebarProfile(secondaryField: SidebarSecondaryField): Promise<void> {
  // Isi dulu dari cache localStorage (auth_user) biar instan, nggak nunggu network.
  const cached = localStorage.getItem("auth_user");
  if (cached) {
    try {
      applyProfile(JSON.parse(cached) as ApiUser, secondaryField);
    } catch {
      // biarkan, nanti tetap di-refresh oleh fetch di bawah
    }
  }

  // Lalu refresh dengan data terbaru dari server (kalau ada perubahan nama/dll).
  const user = await fetchProfile();
  if (user) {
    applyProfile(user, secondaryField);
  }
}