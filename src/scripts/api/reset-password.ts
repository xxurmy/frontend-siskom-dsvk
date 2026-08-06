// src/scripts/api/reset-password.ts

const API_BASE_URL = import.meta.env.VITE_BASE_URL;

const form = document.getElementById("reset-password-form") as HTMLFormElement;
const submitBtn = document.getElementById("reset-submit") as HTMLButtonElement;
const errorBox = document.getElementById("reset-error") as HTMLDivElement;
const successBox = document.getElementById("reset-success") as HTMLDivElement;

function showError(message: string) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function showSuccess(message: string) {
  successBox.textContent = message;
  successBox.classList.remove("hidden");
}

function hideMessages() {
  errorBox.classList.add("hidden");
  successBox.classList.add("hidden");
}

// Ambil token & email dari query string URL (?token=...&email=...)
const params = new URLSearchParams(window.location.search);
const token = params.get("token");
const email = params.get("email");

// Kalau token atau email tidak ada di URL, form tidak bisa dipakai
if (!token || !email) {
  hideMessages();
  showError("Link reset password tidak valid. Silakan minta link baru.");
  form.querySelectorAll("input, button[type=submit]").forEach((el) => {
    (el as HTMLInputElement | HTMLButtonElement).disabled = true;
  });
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideMessages();

  const password = (document.getElementById("password") as HTMLInputElement).value;
  const passwordConfirmation = (
    document.getElementById("password_confirmation") as HTMLInputElement
  ).value;

  if (password.length < 8) {
    showError("Password minimal 8 karakter");
    return;
  }

  if (password !== passwordConfirmation) {
    showError("Konfirmasi password tidak cocok");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Memproses...";

  try {
    const res = await fetch(`${API_BASE_URL}/reset-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        email,
        token,
        password,
        password_confirmation: passwordConfirmation,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.message || "Terjadi kesalahan, coba lagi");
      return;
    }

    showSuccess(data.message || "Password berhasil direset, silakan login dengan password baru");
    form.reset();

    // Redirect ke halaman login setelah beberapa detik
    setTimeout(() => {
      window.location.href = "/";
    }, 2000);
  } catch (err) {
    showError("Tidak dapat terhubung ke server, coba lagi nanti");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Reset Password";
  }
});