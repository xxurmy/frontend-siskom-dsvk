// src/scripts/password-mahasiswa.ts
// Logic untuk halaman "Ubah Password":
// 1) toggle show/hide tiap input password
// 2) submit form -> POST /auth/change-password
//
// baseUrl diambil dari data-base-url di elemen #ubah-password-page
// (lihat profil-admin.astro), karena define:vars Astro tidak bisa
// dipakai di script eksternal.

// ------------------------------------------------------------------
// Tipe data (disesuaikan dengan AuthController::changePassword)
// ------------------------------------------------------------------
interface ChangePasswordSuccessResponse {
  message: string;
}

interface ChangePasswordErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

// ------------------------------------------------------------------
// Konfigurasi
// ------------------------------------------------------------------
// PENTING: nama env HARUS berprefix PUBLIC_ (mis. PUBLIC_BASE_URL) supaya
// terbaca di client-side. Astro hanya meng-expose env yang berprefix
// PUBLIC_ ke kode yang berjalan di browser.
const API_BASE: string = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token"; // sesuaikan kalau key token localStorage Anda beda

// ------------------------------------------------------------------
// Toggle show/hide password
// ------------------------------------------------------------------
function initTogglePassword(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>(".toggle-password");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      if (!targetId) return;

      const input = document.getElementById(targetId) as HTMLInputElement | null;
      const icon = btn.querySelector(".material-symbols-outlined");
      if (!input || !icon) return;

      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      icon.textContent = isHidden ? "visibility_off" : "visibility";
      btn.setAttribute("aria-label", isHidden ? "Sembunyikan password" : "Tampilkan password");
    });
  });
}

// ------------------------------------------------------------------
// Helper tampilkan pesan status di bawah form
// ------------------------------------------------------------------
function showMessage(text: string, variant: "success" | "error"): void {
  const el = document.getElementById("password-form-message");
  if (!el) return;

  el.textContent = text;
  el.classList.remove("hidden", "text-green-700", "text-red-700");
  el.classList.add(variant === "success" ? "text-green-700" : "text-red-700");
}

function clearMessage(): void {
  const el = document.getElementById("password-form-message");
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

// ------------------------------------------------------------------
// Submit form ubah password
// ------------------------------------------------------------------
function initSubmitForm(): void {
  const form = document.getElementById("ubah-password-form") as HTMLFormElement | null;
  const submitBtn = document.getElementById("ubah-password-submit") as HTMLButtonElement | null;
  if (!form) return;

  form.addEventListener("submit", async (e: SubmitEvent) => {
    e.preventDefault();
    clearMessage();

    const currentPasswordEl = document.getElementById("current-password") as HTMLInputElement;
    const newPasswordEl = document.getElementById("new-password") as HTMLInputElement;
    const confirmPasswordEl = document.getElementById("confirm-password") as HTMLInputElement;

    const currentPassword = currentPasswordEl.value;
    const newPassword = newPasswordEl.value;
    const confirmPassword = confirmPasswordEl.value;

    if (!currentPassword || !newPassword || !confirmPassword) {
      showMessage("Semua field wajib diisi.", "error");
      return;
    }

    if (newPassword.length < 8) {
      showMessage("Password baru minimal 8 karakter.", "error");
      return;
    }

    if (newPassword !== confirmPassword) {
      showMessage("Password baru dan konfirmasi tidak sama.", "error");
      return;
    }

    const token = localStorage.getItem(TOKEN_KEY);

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Menyimpan...";
    }

    try {
      const res = await fetch(`${API_BASE}/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({
          current_password: currentPassword,
          password: newPassword,
          password_confirmation: confirmPassword, // rule 'confirmed' di Laravel butuh field ini
        }),
      });

      if (res.status === 401) {
        window.location.href = "/denied";
        return;
      }

      const json = (await res.json()) as ChangePasswordSuccessResponse | ChangePasswordErrorResponse;

      if (!res.ok) {
        const errJson = json as ChangePasswordErrorResponse;

        if (errJson.errors) {
          const firstError = Object.values(errJson.errors)[0]?.[0];
          showMessage(firstError ?? errJson.message ?? "Gagal mengubah password.", "error");
        } else {
          showMessage(errJson.message ?? "Gagal mengubah password.", "error");
        }
        return;
      }

      const okJson = json as ChangePasswordSuccessResponse;
      showMessage(okJson.message ?? "Password berhasil diganti.", "success");
      form.reset();
    } catch (err) {
      console.error("Gagal mengubah password:", err);
      showMessage("Terjadi kesalahan jaringan. Coba lagi.", "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Ubah Password";
      }
    }
  });
}

// ------------------------------------------------------------------
// Jalankan saat halaman siap
// ------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  initTogglePassword();
  initSubmitForm();
});