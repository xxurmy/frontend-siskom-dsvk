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

  if (!email) {
    showError("Email wajib diisi");
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
      showError(data.message || "Terjadi kesalahan, coba lagi");
      return;
    }

    showSuccess(data.message || "Jika email terdaftar, link reset password telah dikirim");
    form.reset();
  } catch (err) {
    showError("Tidak dapat terhubung ke server, coba lagi nanti");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Kirim Link Reset Password";
  }
});