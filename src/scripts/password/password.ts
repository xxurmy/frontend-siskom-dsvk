// src/scripts/utils/password.ts
// Utilitas bersama untuk field password:
// 1. initTogglePassword  -> show/hide input password (tombol dengan class .toggle-password)
// 2. initPasswordMatch   -> validasi kecocokan password baru & konfirmasi

/**
 * Mengaktifkan tombol show/hide pada semua input password.
 * Tombol harus punya class "toggle-password" dan atribut data-target
 * yang berisi id dari input password terkait, misalnya:
 *
 * <input id="password" type="password" />
 * <button class="toggle-password" data-target="password">
 *   <span class="material-symbols-outlined">visibility</span>
 * </button>
 */
export function initTogglePassword(): void {
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

export interface PasswordMatchMessages {
  empty: string;
  mismatch: string;
  match: string;
}

export interface PasswordMatchClasses {
  neutral: string;
  error: string;
  success: string;
}

interface InitPasswordMatchOptions {
  passwordId: string;
  confirmPasswordId: string;
  hintId: string;
  messages?: Partial<PasswordMatchMessages>;
  classes?: Partial<PasswordMatchClasses>;
}

const DEFAULT_MESSAGES: PasswordMatchMessages = {
  empty: "Password baru dan konfirmasi harus sama.",
  mismatch: "Konfirmasi password tidak sama dengan password baru.",
  match: "Password cocok.",
};

const DEFAULT_CLASSES: PasswordMatchClasses = {
  neutral: "text-outline",
  error: "text-red-600",
  success: "text-green-600",
};

/**
 * Mengaktifkan validasi real-time antara input password baru & konfirmasi.
 * Bisa dipakai ulang di halaman mana saja selama id elemennya diberikan,
 * dan pesan/kelas warnanya bisa disesuaikan per halaman lewat opsi.
 */
export function initPasswordMatch(options: InitPasswordMatchOptions): void {
  const { passwordId, confirmPasswordId, hintId } = options;
  const messages: PasswordMatchMessages = { ...DEFAULT_MESSAGES, ...options.messages };
  const classes: PasswordMatchClasses = { ...DEFAULT_CLASSES, ...options.classes };

  const password = document.getElementById(passwordId) as HTMLInputElement | null;
  const confirmPassword = document.getElementById(confirmPasswordId) as HTMLInputElement | null;
  const hint = document.getElementById(hintId) as HTMLParagraphElement | null;

  if (!password || !confirmPassword || !hint) return;

  const allClasses = [classes.neutral, classes.error, classes.success];

  function validateMatch(): void {
    if (!confirmPassword!.value) {
      hint!.textContent = messages.empty;
      hint!.classList.remove(...allClasses);
      hint!.classList.add(classes.neutral);
      return;
    }

    if (password!.value !== confirmPassword!.value) {
      hint!.textContent = messages.mismatch;
      hint!.classList.remove(...allClasses);
      hint!.classList.add(classes.error);
    } else {
      hint!.textContent = messages.match;
      hint!.classList.remove(...allClasses);
      hint!.classList.add(classes.success);
    }
  }

  password.addEventListener("input", validateMatch);
  confirmPassword.addEventListener("input", validateMatch);
}