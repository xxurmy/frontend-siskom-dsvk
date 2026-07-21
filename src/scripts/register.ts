// src/scripts/register.ts
// Logika interaktif untuk halaman Register.
// Toggle show/hide & validasi kecocokan password memakai modul bersama
// di src/scripts/utils/password.ts supaya tidak duplikat dengan profil-admin.ts.

import { initTogglePassword, initPasswordMatch } from "./password/password";

function initRegisterPage(): void {
  initTogglePassword();

  initPasswordMatch({
    passwordId: "password",
    confirmPasswordId: "password_confirmation",
    hintId: "password-hint",
    messages: {
      empty: "Password dan konfirmasi harus sama.",
      mismatch: "Konfirmasi password tidak sama dengan password.",
      match: "Password cocok.",
    },
    classes: {
      neutral: "text-gray-400",
      error: "text-red-500",
      success: "text-green-600",
    },
  });
}

document.addEventListener("DOMContentLoaded", initRegisterPage);