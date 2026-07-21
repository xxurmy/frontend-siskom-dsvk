// src/scripts/profil-admin.ts
// Logika interaktif untuk halaman Profil Admin:
// 1. Toggle show/hide pada setiap input password
// 2. Validasi kecocokan Password Baru & Konfirmasi Password Baru

function initTogglePassword(): void {
  const toggleButtons = document.querySelectorAll<HTMLButtonElement>(".toggle-password");

  toggleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      if (!targetId) return;

      const input = document.getElementById(targetId) as HTMLInputElement | null;
      const icon = btn.querySelector<HTMLElement>(".material-symbols-outlined");
      if (!input || !icon) return;

      if (input.type === "password") {
        input.type = "text";
        icon.textContent = "visibility_off";
        btn.setAttribute("aria-label", "Sembunyikan password");
      } else {
        input.type = "password";
        icon.textContent = "visibility";
        btn.setAttribute("aria-label", "Tampilkan password");
      }
    });
  });
}

function initPasswordMatchValidation(): void {
  const newPassword = document.getElementById("new-password") as HTMLInputElement | null;
  const confirmPassword = document.getElementById("confirm-password") as HTMLInputElement | null;
  const hint = document.getElementById("password-hint") as HTMLParagraphElement | null;

  if (!newPassword || !confirmPassword || !hint) return;

  function validateMatch(): void {
    if (!confirmPassword!.value) {
      hint!.textContent = "Password baru dan konfirmasi harus sama.";
      hint!.classList.remove("text-red-600", "text-green-600");
      hint!.classList.add("text-outline");
      return;
    }

    if (newPassword!.value !== confirmPassword!.value) {
      hint!.textContent = "Konfirmasi password tidak sama dengan password baru.";
      hint!.classList.remove("text-outline", "text-green-600");
      hint!.classList.add("text-red-600");
    } else {
      hint!.textContent = "Password cocok.";
      hint!.classList.remove("text-red-600", "text-outline");
      hint!.classList.add("text-green-600");
    }
  }

  newPassword.addEventListener("input", validateMatch);
  confirmPassword.addEventListener("input", validateMatch);
}

function initProfilAdminPage(): void {
  initTogglePassword();
  initPasswordMatchValidation();
}

document.addEventListener("DOMContentLoaded", initProfilAdminPage);