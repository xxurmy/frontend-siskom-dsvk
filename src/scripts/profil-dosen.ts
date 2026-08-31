// src/scripts/profil-dosen.ts
// Logika interaktif untuk halaman Biodata Dosen (toggle show/hide password
// & validasi kecocokan password baru/konfirmasi).
// Memakai modul bersama di src/scripts/password/password.ts, konsisten dengan
// profil-admin.ts & profil-mahasiswa.ts, supaya tidak duplikat logic.

import { initTogglePassword, initPasswordMatch } from "./password/password";

function initProfilDosenPage(): void {
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

document.addEventListener("DOMContentLoaded", initProfilDosenPage);
document.addEventListener("astro:page-load", initProfilDosenPage);