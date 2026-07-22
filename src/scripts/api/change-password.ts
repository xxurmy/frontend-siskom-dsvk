// src/scripts/api/change-password.ts
// Logic untuk form "Ubah Password" — generik untuk semua role (admin, dosen,
// mahasiswa), karena AuthController::changePassword tidak mengecek role sama
// sekali, cuma butuh token valid.
//
// Dipakai di halaman profil admin/dosen/mahasiswa mana pun, asal form-nya
// pakai id yang sama:
// - form: #ubah-password-form
// - input: #current-password, #new-password, #confirm-password
// - submit button: #ubah-password-submit
// - pesan status: #password-form-message
// - tombol show/hide: class="toggle-password" + data-target="<id-input>"

interface ChangePasswordSuccessResponse {
  message: string;
}

interface ChangePasswordErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

const API_BASE: string = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token";

// CATATAN: toggle show/hide password & live-validation kecocokan password
// SUDAH ditangani oleh script lain (mis. profile-admin.ts + modul bersama
// src/scripts/password/password.ts). File ini SENGAJA tidak punya logic
// toggle sendiri, supaya tidak dobel-attach listener ke tombol yang sama
// (dobel listener bikin toggle kelihatan "nggak ngefek" saat diklik).

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

  if (form.dataset.submitBound === "true") return;
  form.dataset.submitBound = "true";

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
        // Token invalid/expired -> konsisten dengan script lain: lempar ke /login
        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_user");
        window.location.href = "/login";
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
// Init — dipanggil langsung (BUKAN nunggu DOMContentLoaded), karena script
// module Astro sudah jalan setelah HTML di-parse. DOMContentLoaded bisa
// sudah lewat duluan sebelum listener sempat terpasang, jadi form nggak
// akan pernah bisa disubmit tanpa error apapun.
// ------------------------------------------------------------------
function initChangePasswordPage(): void {
  initSubmitForm();
}

initChangePasswordPage();
document.addEventListener("astro:page-load", initChangePasswordPage);