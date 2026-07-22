// src/scripts/auth/login.ts
// Logic login SISKOM DSVK — dipisah dari login.astro biar lebih rapi & gampang di-maintain.

const API_BASE_URL = import.meta.env.VITE_BASE_URL;

type Role = "admin" | "dosen" | "mahasiswa";

interface LoginUser {
  id: number;
  role: Role;
  nama: string;
  username: string;
  email: string;
  [key: string]: unknown;
}

interface LoginResponse {
  access_token?: string;
  user?: LoginUser;
  message?: string;
}

const REDIRECT_BY_ROLE: Record<Role, string> = {
  admin: "/admin/home",
  dosen: "/dosen/home",
  mahasiswa: "/mahasiswa/home",
};

function initLoginForm(): void {
  const form = document.getElementById("login-form") as HTMLFormElement | null;
  const errorBox = document.getElementById("login-error") as HTMLDivElement | null;
  const submitBtn = document.getElementById("login-submit") as HTMLButtonElement | null;

  if (!form || !errorBox || !submitBtn) return;

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

    const username = (document.getElementById("username") as HTMLInputElement).value.trim();
    const password = (document.getElementById("password") as HTMLInputElement).value;

    submitBtn!.disabled = true;
    submitBtn!.textContent = "Memproses...";

    try {
      const res = await fetch(`${API_BASE_URL}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ username, password }),
      });

      const data: LoginResponse = await res.json().catch(() => ({}));

      if (!res.ok) {
        showError(data.message || "Username atau password salah.");
        return;
      }
      
      if (data.access_token) {
        localStorage.setItem("auth_token", data.access_token);
      }
      if (data.user) {
        localStorage.setItem("auth_user", JSON.stringify(data.user));
      }

      const role = data.user?.role;
      window.location.href = (role && REDIRECT_BY_ROLE[role]) || "/home";
    } catch (err) {
      console.error(err);
      showError("Tidak bisa terhubung ke server. Coba lagi.");
    } finally {
      submitBtn!.disabled = false;
      submitBtn!.textContent = "Login";
    }
  });
}

initLoginForm();