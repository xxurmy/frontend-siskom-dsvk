// src/scripts/register.ts
// Logic register SISKOM DSVK — dipisah dari register.astro.
// Endpoint ditentukan dari query param ?role=dosen / ?role=mahasiswa di URL.

const API_BASE_URL = import.meta.env.VITE_BASE_URL;

type Role = "dosen" | "mahasiswa";

interface RegisterUser {
  id: number;
  role: Role;
  nama: string;
  username: string;
  email: string;
  prodi: string;
  nip?: string;
  nim?: string;
  [key: string]: unknown;
}

interface RegisterResponse {
  message?: string;
  errors?: Record<string, string[]>;
  user?: RegisterUser;
  token_type?: string;
  access_token?: string;
}

const REDIRECT_BY_ROLE: Record<Role, string> = {
  dosen: "/dosen/home",
  mahasiswa: "/mahasiswa/home",
};

function getRoleFromUrl(): Role {
  const params = new URLSearchParams(window.location.search);
  const role = params.get("role");
  return role === "dosen" ? "dosen" : "mahasiswa"; // default mahasiswa kalau param tidak ada/tidak valid
}

function initPasswordToggle(): void {
  const toggleButtons = document.querySelectorAll<HTMLButtonElement>(".toggle-password");

  toggleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      if (!targetId) return;

      const input = document.getElementById(targetId) as HTMLInputElement | null;
      const icon = btn.querySelector(".material-symbols-outlined");
      if (!input || !icon) return;

      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      icon.textContent = isHidden ? "visibility_off" : "visibility";
    });
  });
}

function initRegisterForm(): void {
  const form = document.querySelector("form") as HTMLFormElement | null;
  if (!form) return;

  const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
  const passwordHint = document.getElementById("password-hint");

  let errorBox = document.getElementById("register-error");
  if (!errorBox) {
    errorBox = document.createElement("div");
    errorBox.id = "register-error";
    errorBox.className =
      "hidden mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-2";
    form.prepend(errorBox);
  }

  function showError(message: string) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
  }

  function hideError() {
    if (!errorBox) return;
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
  }

  form.addEventListener("submit", async (e: SubmitEvent) => {
    e.preventDefault();
    hideError();

    const role = getRoleFromUrl();

    const nama = (document.getElementById("nama") as HTMLInputElement).value.trim();
    const nipNim = (document.getElementById("nip") as HTMLInputElement).value.trim();
    const username = (document.getElementById("username") as HTMLInputElement).value.trim();
    const prodi = (document.getElementById("prodi") as HTMLInputElement).value.trim();
    const email = (document.getElementById("email") as HTMLInputElement).value.trim();
    const password = (document.getElementById("password") as HTMLInputElement).value;
    const passwordConfirmation = (
      document.getElementById("password_confirmation") as HTMLInputElement
    ).value;

    if (password !== passwordConfirmation) {
      showError("Password dan konfirmasi password tidak sama.");
      passwordHint?.classList.add("text-red-500");
      return;
    }
    passwordHint?.classList.remove("text-red-500");

    const payload: Record<string, string> = {
      nama,
      username,
      prodi,
      email,
      password,
      password_confirmation: passwordConfirmation,
    };

    // Field NIP/NIM di form cuma satu input, tapi backend butuh key beda per role
    if (role === "dosen") {
      payload.nip = nipNim;
    } else {
      payload.nim = nipNim;
    }

    const endpoint = role === "dosen" ? "/register/dosen" : "/register/mahasiswa";

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Memproses...";
    }

    try {
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data: RegisterResponse = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.errors) {
          const firstError = Object.values(data.errors)[0]?.[0];
          showError(firstError || data.message || "Registrasi gagal.");
        } else {
          showError(data.message || "Registrasi gagal.");
        }
        return;
      }

      if (data.access_token) {
        localStorage.setItem("auth_token", data.access_token);
      }
      if (data.user) {
        localStorage.setItem("auth_user", JSON.stringify(data.user));
      }

      window.location.href = REDIRECT_BY_ROLE[role] || "/";
    } catch (err) {
      console.error(err);
      showError("Tidak bisa terhubung ke server. Coba lagi.");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Register";
      }
    }
  });
}

initPasswordToggle();
initRegisterForm();