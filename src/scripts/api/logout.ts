// src/scripts/logout.ts
// Logic logout SISKOM DSVK — generik untuk semua role (admin, dosen, mahasiswa).
// Pasang attribute `data-logout` di elemen apa pun (button/link) yang mau
// jadi tombol logout, lalu panggil initLogoutButtons() di script sidebar masing-masing.
//
// KONFIRMASI LOGOUT: menggunakan ConfirmModal (src/components/ConfirmModal.astro)
// lewat helper confirmDialog() di src/scripts/lib/confirm-dialog.ts, bukan
// window.confirm() bawaan browser.

import { confirmDialog } from "../lib/confirm-dialog";

const API_BASE_URL = import.meta.env.VITE_BASE_URL;

async function performLogout(trigger: HTMLElement): Promise<void> {
  const token = localStorage.getItem("auth_token");

  // Feedback visual sederhana selagi proses logout jalan
  trigger.setAttribute("aria-disabled", "true");
  trigger.style.pointerEvents = "none";
  trigger.style.opacity = "0.6";

  try {
    if (token) {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
    }
  } catch (err) {
    // Tetap lanjut logout di sisi client meski API gagal (mis. koneksi putus),
    // supaya user tidak terjebak tidak bisa keluar dari akunnya.
    console.error("Logout API error:", err);
  } finally {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.href = "/";
  }
}

export function initLogoutButtons(): void {
  document.querySelectorAll<HTMLElement>("[data-logout]").forEach((el) => {
    // Cegah double-binding kalau initAll() dipanggil ulang (astro:page-load)
    if (el.dataset.logoutBound === "true") return;
    el.dataset.logoutBound = "true";

    el.addEventListener("click", async (e) => {
      e.preventDefault();

      // Kalau trigger lagi disabled (proses logout sebelumnya masih jalan / sudah diklik),
      // jangan buka modal lagi.
      if (el.getAttribute("aria-disabled") === "true") return;

      const ok = await confirmDialog({
        title: "Keluar dari Akun?",
        message: "Anda akan keluar dari sesi ini dan perlu login kembali untuk melanjutkan.",
        variant: "danger",
        confirmText: "Ya, Keluar",
        icon: "logout",
      });
      if (!ok) return;

      performLogout(el);
    });
  });
}