// src/scripts/lib/info-dialog.ts
// Helper reusable untuk menampilkan modal notifikasi (berhasil/gagal) setelah
// aksi Update/Delete. Modal HTML-nya ada di src/components/InfoModal.astro —
// pastikan komponen itu sudah ditaruh sekali di Layout.astro sebelum helper
// ini dipakai (sejajar dengan <ConfirmModal />).
//
// Bedanya dengan confirm-dialog.ts: modal ini TIDAK punya tombol aksi (Ya/Batal),
// cuma pesan + tombol close (×), dan tidak return Promise<boolean> karena tidak
// ada keputusan yang perlu ditunggu.
//
// Cara pakai di script manapun:
//
//   import { showInfoDialog } from "../lib/info-dialog"; // sesuaikan path relatif
//
//   showInfoDialog({
//     title: "Berhasil Dihapus",
//     message: "Data kolokium sudah dihapus.",
//     variant: "success",
//   });
//
//   // untuk kasus gagal:
//   showInfoDialog({
//     title: "Gagal Menghapus",
//     message: "Terjadi kesalahan pada server, coba lagi.",
//     variant: "error",
//   });
//
// Modal otomatis tertutup sendiri setelah `autoCloseMs` (default 3000ms).
// Set `autoCloseMs: 0` kalau mau modal tetap terbuka sampai user klik close.

export type InfoVariant = "success" | "error";

export interface InfoDialogOptions {
  title?: string;
  message: string;
  variant?: InfoVariant;
  /** Nama Material Symbols icon yang menimpa icon default dari `variant`. */
  icon?: string;
  /** Auto-close dalam ms. Default 3000. Set 0 untuk menonaktifkan auto-close. */
  autoCloseMs?: number;
}

const variantStyles: Record<
  InfoVariant,
  { icon: string; iconWrap: string; title: string }
> = {
  success: {
    icon: "check_circle",
    iconWrap: "bg-green-100 text-green-600",
    title: "Berhasil",
  },
  error: {
    icon: "error",
    iconWrap: "bg-red-100 text-red-600",
    title: "Gagal",
  },
};

let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeInfoModal();
}

function closeInfoModal(): void {
  const modal = document.getElementById("info-modal");
  modal?.classList.add("hidden");
  modal?.classList.remove("flex");
  document.removeEventListener("keydown", handleKeydown);

  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }
}

/**
 * Tampilkan modal notifikasi berhasil/gagal. Tidak ada aksi untuk ditunggu,
 * jadi tidak return Promise — modal akan tertutup sendiri (auto-close) atau
 * saat user klik tombol close / overlay / tekan Escape.
 *
 * Kalau elemen #info-modal tidak ditemukan di DOM (lupa taruh <InfoModal />
 * di Layout.astro), otomatis fallback ke window.alert() supaya pesan tidak
 * silently hilang.
 */
export function showInfoDialog(options: InfoDialogOptions): void {
  const { title, message, variant = "success", icon, autoCloseMs = 2000 } = options;

  const modal = document.getElementById("info-modal");
  const titleEl = document.getElementById("info-modal-title");
  const messageEl = document.getElementById("info-modal-message");
  const closeBtn = document.getElementById("info-modal-close-btn") as HTMLButtonElement | null;
  const iconWrap = document.getElementById("info-modal-icon-wrap");
  const iconEl = document.getElementById("info-modal-icon");

  if (!modal || !titleEl || !messageEl || !closeBtn) {
    console.error(
      "#info-modal tidak ditemukan di DOM. Pastikan <InfoModal /> sudah ditaruh di Layout.astro."
    );
    window.alert(message);
    return;
  }

  // Bersihkan timer lama kalau ada modal info sebelumnya masih pending
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }

  const style = variantStyles[variant];

  titleEl.textContent = title ?? style.title;
  messageEl.textContent = message;

  if (iconWrap) {
    iconWrap.className = `w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${style.iconWrap}`;
  }
  if (iconEl) iconEl.textContent = icon ?? style.icon;

  modal.classList.remove("hidden");
  modal.classList.add("flex");

  // Clone tombol close supaya listener lama tidak menumpuk
  const newCloseBtn = closeBtn.cloneNode(true) as HTMLButtonElement;
  closeBtn.replaceWith(newCloseBtn);
  newCloseBtn.addEventListener("click", closeInfoModal);

  modal.addEventListener(
    "click",
    (e) => {
      if (e.target === modal) closeInfoModal();
    },
    { once: true }
  );

  document.addEventListener("keydown", handleKeydown);

  if (autoCloseMs > 0) {
    autoCloseTimer = setTimeout(closeInfoModal, autoCloseMs);
  }
}

// ------------------------------------------------------------------
// Shortcut untuk kasus sukses/gagal yang paling umum
// ------------------------------------------------------------------

/** Shortcut showInfoDialog() dengan variant "success" */
export function showSuccess(message: string, title?: string): void {
  showInfoDialog({ title, message, variant: "success" });
}

/** Shortcut showInfoDialog() dengan variant "error" */
export function showError(message: string, title?: string): void {
  showInfoDialog({ title, message, variant: "error" });
}