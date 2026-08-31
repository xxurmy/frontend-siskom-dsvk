// src/scripts/api/mahasiswa/biodata.ts
// GET & PATCH untuk halaman biodata mahasiswa.
// - GET   /auth/profile -> isi nama (readonly), NIM (readonly), email
// - PATCH /auth/profile -> simpan email saja (nama & NIM tidak dikirim)
//
// Ubah Password pada halaman yang sama ditangani terpisah oleh
// src/scripts/api/change-password.ts (script generik lintas role).

interface ApiUser {
  id: number;
  role: "admin" | "dosen" | "mahasiswa";
  nama: string;
  nim?: string | null;
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

function redirectIfUnauthorized(status: number): boolean {
  if (status === 401) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.href = "/";
    return true;
  }
  return false;
}

function showMessage(text: string, variant: "success" | "error"): void {
  const el = document.getElementById("biodata-form-message");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden", "text-green-700", "text-red-700");
  el.classList.add(variant === "success" ? "text-green-700" : "text-red-700");
}

function clearMessage(): void {
  const el = document.getElementById("biodata-form-message");
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

// ---------- GET ----------
async function loadBiodata(): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/";
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/profile`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (redirectIfUnauthorized(res.status)) return;

    if (!res.ok) {
      console.error("Gagal ambil biodata mahasiswa:", res.status);
      return;
    }

    const data: ProfileGetResponse = await res.json();
    const user = data.user;
    if (!user) return;

    const namaEl = document.getElementById("biodata-nama") as HTMLInputElement | null;
    const nimEl = document.getElementById("biodata-nim") as HTMLInputElement | null;
    const emailEl = document.getElementById("biodata-email") as HTMLInputElement | null;

    if (namaEl) namaEl.value = user.nama ?? "";
    if (nimEl) nimEl.value = user.nim ?? "";
    if (emailEl) emailEl.value = user.email ?? "";
  } catch (err) {
    console.error("Gagal ambil biodata mahasiswa:", err);
  }
}

// ---------- PATCH (email) ----------
function initSubmitBiodataForm(): void {
  const form = document.getElementById("biodata-form") as HTMLFormElement | null;
  const submitBtn = document.getElementById("biodata-submit-btn") as HTMLButtonElement | null;
  if (!form) return;

  if (form.dataset.submitBound === "true") return;
  form.dataset.submitBound = "true";

  form.addEventListener("submit", async (e: SubmitEvent) => {
    e.preventDefault();
    clearMessage();

    const emailEl = document.getElementById("biodata-email") as HTMLInputElement;
    const email = emailEl.value.trim();

    if (!email) {
      showMessage("Email wajib diisi.", "error");
      return;
    }

    const token = getToken();
    if (!token) {
      window.location.href = "/";
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
        body: JSON.stringify({ email }),
      });

      if (redirectIfUnauthorized(res.status)) return;

      const json = (await res.json()) as ProfilePatchSuccessResponse | ProfilePatchErrorResponse;

      if (!res.ok) {
        const errJson = json as ProfilePatchErrorResponse;
        if (errJson.errors) {
          const firstError = Object.values(errJson.errors)[0]?.[0];
          showMessage(firstError ?? errJson.message ?? "Gagal menyimpan biodata.", "error");
        } else {
          showMessage(errJson.message ?? "Gagal menyimpan biodata.", "error");
        }
        return;
      }

      const okJson = json as ProfilePatchSuccessResponse;
      showMessage(okJson.message ?? "Biodata berhasil diperbarui.", "success");

      // Sinkronkan cache localStorage (dipakai sidebar & bagian lain)
      const cached = localStorage.getItem("auth_user");
      if (cached) {
        try {
          const cachedUser = JSON.parse(cached);
          localStorage.setItem(
            "auth_user",
            JSON.stringify({ ...cachedUser, email: okJson.user.email })
          );
        } catch {
          // biarkan, tidak kritikal
        }
      }
    } catch (err) {
      console.error("Gagal menyimpan biodata mahasiswa:", err);
      showMessage("Terjadi kesalahan jaringan. Coba lagi.", "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Simpan Perubahan";
      }
    }
  });
}

function initBiodataMahasiswaPage(): void {
  loadBiodata();
  initSubmitBiodataForm();
}

initBiodataMahasiswaPage();
document.addEventListener("astro:page-load", initBiodataMahasiswaPage);