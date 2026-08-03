// src/scripts/lib/confirm-dialog.ts
// Helper reusable untuk menampilkan modal konfirmasi sebelum aksi Update/Delete.
// Modal HTML-nya ada di src/components/ConfirmModal.astro — pastikan komponen itu
// sudah ditaruh sekali di Layout.astro sebelum helper ini dipakai.
//
// Cara pakai di script manapun:
//
//   import { confirmDialog } from "../lib/confirm-dialog"; // sesuaikan path relatif
//
//   const ok = await confirmDialog({
//     title: "Hapus Kolokium?",
//     message: "Data yang dihapus tidak bisa dikembalikan.",
//     variant: "danger",
//     confirmText: "Ya, Hapus",
//   });
//   if (!ok) return;
//   // lanjut proses delete/update ke API...

export type ConfirmVariant = "danger" | "primary";

export interface ConfirmDialogOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** "danger" untuk aksi hapus/batal (merah), "primary" untuk aksi update biasa (biru) */
  variant?: ConfirmVariant;
}

const variantStyles: Record<
  ConfirmVariant,
  { icon: string; iconWrap: string; confirmBtn: string }
> = {
  danger: {
    icon: "delete",
    iconWrap: "bg-red-100 text-red-600",
    confirmBtn: "bg-red-600 hover:opacity-90",
  },
  primary: {
    icon: "help",
    iconWrap: "bg-blue-100 text-blue-600",
    confirmBtn: "bg-ipb-blue hover:opacity-90",
  },
};

let activeResolver: ((value: boolean) => void) | null = null;

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeModal(false);
}

function closeModal(result: boolean): void {
  const modal = document.getElementById("confirm-modal");
  modal?.classList.add("hidden");
  modal?.classList.remove("flex");
  document.removeEventListener("keydown", handleKeydown);

  if (activeResolver) {
    activeResolver(result);
    activeResolver = null;
  }
}

/**
 * Tampilkan modal konfirmasi. Resolve `true` kalau user klik tombol konfirmasi,
 * `false` kalau klik Batal / overlay / tekan Escape.
 *
 * Kalau elemen #confirm-modal tidak ditemukan di DOM (lupa taruh <ConfirmModal />
 * di Layout.astro), otomatis fallback ke window.confirm() bawaan browser supaya
 * aksi tidak silently gagal.
 */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  const {
    title = "Konfirmasi",
    message,
    confirmText = "Ya, Lanjutkan",
    cancelText = "Batal",
    variant = "danger",
  } = options;

  return new Promise((resolve) => {
    const modal = document.getElementById("confirm-modal");
    const titleEl = document.getElementById("confirm-modal-title");
    const messageEl = document.getElementById("confirm-modal-message");
    const confirmBtn = document.getElementById("confirm-modal-confirm-btn") as HTMLButtonElement | null;
    const cancelBtn = document.getElementById("confirm-modal-cancel-btn") as HTMLButtonElement | null;
    const iconWrap = document.getElementById("confirm-modal-icon-wrap");
    const icon = document.getElementById("confirm-modal-icon");

    if (!modal || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
      console.error(
        "#confirm-modal tidak ditemukan di DOM. Pastikan <ConfirmModal /> sudah ditaruh di Layout.astro."
      );
      resolve(window.confirm(message));
      return;
    }

    activeResolver = resolve;

    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;

    const style = variantStyles[variant];
    if (iconWrap) {
      iconWrap.className = `w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${style.iconWrap}`;
    }
    if (icon) icon.textContent = style.icon;
    confirmBtn.className = `px-4 py-2 text-white text-label-md font-bold rounded-lg transition-opacity ${style.confirmBtn}`;

    modal.classList.remove("hidden");
    modal.classList.add("flex");

    // Clone tombol supaya listener lama (dari pemanggilan sebelumnya) tidak menumpuk
    const newConfirmBtn = confirmBtn.cloneNode(true) as HTMLButtonElement;
    confirmBtn.replaceWith(newConfirmBtn);
    const newCancelBtn = cancelBtn.cloneNode(true) as HTMLButtonElement;
    cancelBtn.replaceWith(newCancelBtn);

    newConfirmBtn.addEventListener("click", () => closeModal(true));
    newCancelBtn.addEventListener("click", () => closeModal(false));

    modal.addEventListener(
      "click",
      (e) => {
        if (e.target === modal) closeModal(false);
      },
      { once: true }
    );

    document.addEventListener("keydown", handleKeydown);

    newConfirmBtn.focus();
  });
}

// ------------------------------------------------------------------
// Shortcut untuk aksi DELETE-only (tanpa update)
// ------------------------------------------------------------------
export interface ConfirmDeleteOptions {
  title?: string;
  message?: string;
  confirmText?: string;
}

/**
 * Shortcut di atas confirmDialog() khusus untuk aksi hapus murni (bukan update).
 * Variant selalu "danger" dan sudah punya default title/message/confirmText
 * yang wajar, jadi di pemanggil cukup:
 *
 *   const ok = await confirmDelete({ message: "Kolokium ini akan dihapus permanen." });
 *   if (!ok) return;
 *   await apiFetch(`/auth/kolokium/${id}`, { method: "DELETE" });
 *
 * Semua opsi bersifat opsional; panggil confirmDelete() tanpa argumen pun sudah valid.
 */
export function confirmDelete(options: ConfirmDeleteOptions = {}): Promise<boolean> {
  return confirmDialog({
    title: options.title ?? "Hapus Data?",
    message: options.message ?? "Data yang dihapus tidak bisa dikembalikan. Lanjutkan?",
    confirmText: options.confirmText ?? "Ya, Hapus",
    variant: "danger",
  });
}