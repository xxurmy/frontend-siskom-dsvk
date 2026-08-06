// src/scripts/api/forgot-password.ts

const API_BASE_URL = import.meta.env.VITE_BASE_URL;

const form = document.getElementById("forgot-password-form") as HTMLFormElement;
const submitBtn = document.getElementById("forgot-submit") as HTMLButtonElement;
const errorBox = document.getElementById("forgot-error") as HTMLDivElement;
const successBox = document.getElementById("forgot-success") as HTMLDivElement;

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

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideMessages();

  const email = (document.getElementById("email") as HTMLInputElement).value.trim();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email) {
    showError("Email wajib diisi");
    return;
  }

  if (!emailPattern.test(email)) {
    showError("Format email tidak valid");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Mengirim...";

  try {
    const res = await fetch(`${API_BASE_URL}/forgot-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();

    if (!res.ok) {
      // 404 -> email tidak terdaftar (pesan spesifik dari backend)
      // 422 -> validasi gagal
      // status lain -> error umum
      showError(data.message || "Terjadi kesalahan, coba lagi");
      return;
    }

    showSuccess(data.message || "Link reset password telah dikirim ke email Anda");
    form.reset();
  } catch (err) {
    showError("Tidak dapat terhubung ke server, coba lagi nanti");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Kirim Link Reset Password";
  }
});