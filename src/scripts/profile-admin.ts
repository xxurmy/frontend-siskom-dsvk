// src/scripts/profil-admin.ts
// Logika interaktif untuk halaman Profil Admin.
// Toggle show/hide & validasi kecocokan password memakai modul bersama
// di src/scripts/utils/password.ts supaya tidak duplikat dengan register.ts.

import { initTogglePassword, initPasswordMatch } from "./password/password";

function initProfilAdminPage(): void {
  initTogglePassword();

  initPasswordMatch({
    passwordId: "new-password",
    confirmPasswordId: "confirm-password",
    hintId: "password-hint",
    messages: {
      empty: "Password baru dan konfirmasi harus sama.",
      mismatch: "Konfirmasi password tidak sama dengan password baru.",
      match: "Password cocok.",
    },
  });
}

document.addEventListener("DOMContentLoaded", initProfilAdminPage);