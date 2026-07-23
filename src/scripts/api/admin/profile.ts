// src/scripts/api/admin/profile.ts
// GET & PATCH data profil admin (nama, email). Username readonly -> tidak dikirim.

interface ApiUser {
  id: number;
  role: "admin" | "dosen" | "mahasiswa";
  nama: string;
  username: string;
  email: string;
  [key: string]: unknown;
}

interface ProfileGetResponse {
  message?: string;
  user?: ApiUser;
}

interface ProfilePatchSuccessResponse {
  message: string;
  user: ApiUser;
}

interface ProfilePatchErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

const API_BASE_URL = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token";

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function showMessage(text: string, variant: "success" | "error"): void {
  const el = document.getElementById("profil-form-message");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden", "text-green-700", "text-red-700");
  el.classList.add(variant === "success" ? "text-green-700" : "text-red-700");
}

function clearMessage(): void {
  const el = document.getElementById("profil-form-message");
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

// ---------- GET ----------
async function loadAdminProfile(): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/login";
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/profile`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401) {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
      window.location.href = "/login";
      return;
    }

    if (!res.ok) {
      console.error("Gagal ambil profil admin:", res.status);
      return;
    }

    const data: ProfileGetResponse = await res.json();
    const user = data.user;
    if (!user) return;

    const usernameEl = document.getElementById("username") as HTMLInputElement | null;
    const namaEl = document.getElementById("nama") as HTMLInputElement | null;
    const emailEl = document.getElementById("email") as HTMLInputElement | null;

    if (usernameEl) usernameEl.value = user.username ?? "";
    if (namaEl) namaEl.value = user.nama ?? "";
    if (emailEl) emailEl.value = user.email ?? "";
  } catch (err) {
    console.error("Gagal ambil profil admin:", err);
  }
}

// ---------- PATCH ----------
function initSubmitProfilForm(): void {
  const form = document.getElementById("profil-form") as HTMLFormElement | null;
  const submitBtn = document.getElementById("profil-submit") as HTMLButtonElement | null;
  if (!form) return;

  if (form.dataset.submitBound === "true") return;
  form.dataset.submitBound = "true";

  form.addEventListener("submit", async (e: SubmitEvent) => {
    e.preventDefault();
    clearMessage();

    const namaEl = document.getElementById("nama") as HTMLInputElement;
    const emailEl = document.getElementById("email") as HTMLInputElement;

    const nama = namaEl.value.trim();
    const email = emailEl.value.trim();

    if (!nama || !email) {
      showMessage("Nama dan email wajib diisi.", "error");
      return;
    }

    const token = getToken();
    if (!token) {
      window.location.href = "/login";
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Menyimpan...";
    }

    try {
      const res = await fetch(`${API_BASE_URL}/auth/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ nama, email }),
      });

      if (res.status === 401) {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_user");
        window.location.href = "/login";
        return;
      }

      const json = (await res.json()) as ProfilePatchSuccessResponse | ProfilePatchErrorResponse;

      if (!res.ok) {
        const errJson = json as ProfilePatchErrorResponse;
        if (errJson.errors) {
          const firstError = Object.values(errJson.errors)[0]?.[0];
          showMessage(firstError ?? errJson.message ?? "Gagal menyimpan profil.", "error");
        } else {
          showMessage(errJson.message ?? "Gagal menyimpan profil.", "error");
        }
        return;
      }

      const okJson = json as ProfilePatchSuccessResponse;
      showMessage(okJson.message ?? "Profil berhasil diperbarui.", "success");

      // Sinkronkan cache localStorage (dipakai sidebar & bagian lain)
      const cached = localStorage.getItem("auth_user");
      if (cached) {
        try {
          const cachedUser = JSON.parse(cached);
          localStorage.setItem(
            "auth_user",
            JSON.stringify({ ...cachedUser, nama: okJson.user.nama, email: okJson.user.email })
          );
        } catch {
          // biarkan, tidak kritikal
        }
      }
    } catch (err) {
      console.error("Gagal menyimpan profil admin:", err);
      showMessage("Terjadi kesalahan jaringan. Coba lagi.", "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Simpan Perubahan";
      }
    }
  });
}

function initAdminProfilePage(): void {
  loadAdminProfile();
  initSubmitProfilForm();
}

initAdminProfilePage();
document.addEventListener("astro:page-load", initAdminProfilePage);