// src/scripts/daftar-seminar.ts
// Logic untuk halaman "Daftar Seminar" (form pendaftaran seminar oleh mahasiswa):
// 1) fetch profil login (GET /auth/profile) -> isi Nama/NIM/Prodi (readonly)
// 2) fetch status pengajuan seminar milik mahasiswa (GET /auth/seminar/my) -> isi Status Card
//    & kunci form kalau mahasiswa sudah pernah mendaftar
// 3) fetch daftar dosen (GET /auth/dosen) -> isi <select> Pembimbing Utama & Kedua
// 4) submit form -> POST /auth/seminar
//
// PENTING: semua endpoint di routes/api.php ada di dalam Route::prefix('auth'),
// jadi WAJIB pakai prefix /auth di setiap path (mis. /auth/seminar, /auth/dosen),
// bukan cuma /auth/profile & /auth/change-password.
//
// CATATAN: SeminarController@store hanya mengizinkan role "mahasiswa" (403 kalau
// bukan), dan field "moderator_id" / "ruangan" sengaja TIDAK dikirim dari form ini
// karena diisi belakangan oleh panitia/admin (lihat kolom "akan diisi oleh panitia").

// ------------------------------------------------------------------
// Konfigurasi
// ------------------------------------------------------------------
const API_BASE: string = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token"; // sesuaikan kalau key token localStorage Anda beda

// ------------------------------------------------------------------
// Tipe data (disesuaikan dengan SeminarController & UserController)
// ------------------------------------------------------------------
type StatusPengajuan = "pending" | "approved" | "rejected";

interface UserProfil {
  id: number;
  nama: string;
  nim?: string | null;
  nip?: string | null;
  prodi?: string | null;
  role: "mahasiswa" | "dosen" | "admin";
}

type ProfilResponse = UserProfil | { user: UserProfil } | { data: UserProfil };

interface Seminar {
  id: number;
  mahasiswa_id: number;
  nama: string;
  nim: string;
  prodi: string;
  namadosenpembimbing: string | null;
  moderator_id: number | null;
  judul: string;
  lokasi: string | null;
  tanggal: string | null;
  waktu: string | null;
  namadosenmoderator: string | null;
  ruangan: string | null;
  status: StatusPengajuan;
  jumlahforum: number;
}

interface LaravelPaginator<T> {
  current_page: number;
  data: T[];
  from: number | null;
  last_page: number;
  per_page: number;
  to: number | null;
  total: number;
}

// Dipakai untuk isi <select> pembimbing (dosen).
// Nama key list di response (dosen/users/data) belum pasti,
// makanya di-extract pakai extractList() di bawah biar toleran.
interface UserOption {
  id: number;
  nama: string;
  nim?: string | null;
  nip?: string | null;
  prodi?: string | null;
}

type UserOptionListResponse =
  | UserOption[]
  | { dosen: UserOption[] }
  | { users: UserOption[] }
  | { data: UserOption[] };

interface StoreSeminarResponse {
  message: string;
  seminar: Seminar;
}

interface ApiErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

// ------------------------------------------------------------------
// State halaman
// ------------------------------------------------------------------
let currentUser: UserProfil | null = null;
let existingSeminar: Seminar | null = null;
let dosenOptions: UserOption[] = [];

// ------------------------------------------------------------------
// Helper fetch
// ------------------------------------------------------------------
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token ?? ""}`,
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 401) {
    window.location.href = "/";
    return null;
  }

  const json = await res.json();

  if (!res.ok) {
    const err = json as ApiErrorResponse;
    const firstFieldError = err.errors ? Object.values(err.errors)[0]?.[0] : undefined;
    throw new Error(firstFieldError ?? err.message ?? `Request ke ${path} gagal (status ${res.status})`);
  }

  return json as T;
}

function extractUser(json: ProfilResponse): UserProfil {
  if ("user" in json) return json.user;
  if ("data" in json) return json.data;
  return json;
}

// Toleran terhadap beberapa kemungkinan bentuk response list dosen.
function extractList(json: UserOptionListResponse): UserOption[] {
  if (Array.isArray(json)) return json;
  if ("dosen" in json) return json.dosen;
  if ("users" in json) return json.users;
  if ("data" in json) return json.data;
  return [];
}

// ------------------------------------------------------------------
// Pesan status
// ------------------------------------------------------------------
function showMessage(text: string, variant: "success" | "error"): void {
  const el = document.getElementById("daftar-seminar-message");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden", "bg-green-100", "text-green-800", "bg-red-100", "text-red-800");
  el.classList.add(...(variant === "success" ? ["bg-green-100", "text-green-800"] : ["bg-red-100", "text-red-800"]));
}

function clearMessage(): void {
  const el = document.getElementById("daftar-seminar-message");
  if (!el) return;
  el.classList.add("hidden");
  el.textContent = "";
}

// ------------------------------------------------------------------
// Status Card (badge "Belum Mendaftar" / "Pending" / "Disetujui" / "Ditolak")
// ------------------------------------------------------------------
function renderStatusBadge(): void {
  const el = document.getElementById("status-badge");
  if (!el) return;

  el.classList.remove(
    "bg-outline",
    "bg-yellow-500",
    "bg-green-600",
    "bg-red-600"
  );

  if (!existingSeminar) {
    el.textContent = "Belum Mendaftar";
    el.classList.add("bg-outline");
    return;
  }

  switch (existingSeminar.status) {
    case "pending":
      el.textContent = "Menunggu Persetujuan";
      el.classList.add("bg-yellow-500");
      break;
    case "approved":
      el.textContent = "Disetujui";
      el.classList.add("bg-green-600");
      break;
    case "rejected":
      el.textContent = "Ditolak";
      el.classList.add("bg-red-600");
      break;
  }
}

// Kalau mahasiswa sudah pernah mendaftar (status apa pun), form dikunci
// karena backend tidak menyediakan endpoint update/delete untuk mahasiswa
// (SeminarController@update & @destroy hanya untuk role admin).
function lockFormIfAlreadyRegistered(): void {
  const form = document.getElementById("form-daftar-seminar") as HTMLFormElement | null;
  const submitBtn = document.getElementById("btn-submit-seminar") as HTMLButtonElement | null;
  if (!form) return;

  if (existingSeminar) {
    form.querySelectorAll("input, select, textarea, button").forEach((el) => {
      (el as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = true;
    });
    if (submitBtn) {
      submitBtn.textContent = "Anda sudah mendaftar seminar";
    }
  }
}

// ------------------------------------------------------------------
// Muat data profil (Nama, NIM, Prodi)
// ------------------------------------------------------------------
async function loadProfil(): Promise<void> {
  const json = await apiFetch<ProfilResponse>("/auth/profile");
  if (!json) return;

  currentUser = extractUser(json);

  const namaInput = document.getElementById("input-nama") as HTMLInputElement | null;
  const nimInput = document.getElementById("input-nim") as HTMLInputElement | null;
  const prodiInput = document.getElementById("input-prodi") as HTMLInputElement | null;

  if (namaInput) namaInput.value = currentUser.nama ?? "";
  if (nimInput) nimInput.value = currentUser.nim ?? "";
  if (prodiInput) prodiInput.value = currentUser.prodi ?? "";
}

// ------------------------------------------------------------------
// Muat status pengajuan seminar milik mahasiswa login
// ------------------------------------------------------------------
async function loadMySeminarStatus(): Promise<void> {
  const json = await apiFetch<LaravelPaginator<Seminar>>("/auth/seminar/my");
  existingSeminar = json && json.data.length > 0 ? json.data[0] : null;
  renderStatusBadge();
  lockFormIfAlreadyRegistered();
}

// ------------------------------------------------------------------
// Muat daftar dosen -> isi select Pembimbing Utama & Kedua
// ------------------------------------------------------------------
async function loadDosenOptions(): Promise<void> {
  const json = await apiFetch<UserOptionListResponse>("/auth/dosen");
  dosenOptions = json ? extractList(json) : [];

  const utamaSelect = document.getElementById("select-pembimbing-utama") as HTMLSelectElement | null;
  const keduaSelect = document.getElementById("select-pembimbing-kedua") as HTMLSelectElement | null;

  const optionsHtml = dosenOptions
    .map((d) => `<option value="${d.id}">${d.nama}${d.nip ? ` (NIP: ${d.nip})` : ""}</option>`)
    .join("");

  if (utamaSelect) {
    utamaSelect.innerHTML = `<option value="">-- Pilih Dosen Pembimbing Utama --</option>${optionsHtml}`;
  }
  if (keduaSelect) {
    keduaSelect.innerHTML = `<option value="">-- Pilih Dosen Pembimbing Kedua --</option>${optionsHtml}`;
  }
}

// ------------------------------------------------------------------
// Submit form -> POST /auth/seminar
// ------------------------------------------------------------------
async function handleSubmit(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  clearMessage();

  const utamaSelect = document.getElementById("select-pembimbing-utama") as HTMLSelectElement | null;
  const keduaSelect = document.getElementById("select-pembimbing-kedua") as HTMLSelectElement | null;
  const judulInput = document.getElementById("input-judul") as HTMLTextAreaElement | null;
  const lokasiInput = document.getElementById("input-lokasi") as HTMLInputElement | null;
  const tanggalInput = document.getElementById("input-tanggal") as HTMLInputElement | null;
  const waktuInput = document.getElementById("input-waktu") as HTMLInputElement | null;
  const submitBtn = document.getElementById("btn-submit-seminar") as HTMLButtonElement | null;

  const pembimbingUtamaId = utamaSelect?.value ?? "";
  const pembimbingKeduaId = keduaSelect?.value ?? "";
  const judul = judulInput?.value.trim() ?? "";

  if (!pembimbingUtamaId) {
    showMessage("Dosen Pembimbing Utama wajib dipilih.", "error");
    return;
  }
  if (!judul) {
    showMessage("Rencana Tugas Akhir (judul) wajib diisi.", "error");
    return;
  }
  if (pembimbingKeduaId && pembimbingKeduaId === pembimbingUtamaId) {
    showMessage("Dosen Pembimbing Kedua harus berbeda dari Pembimbing Utama.", "error");
    return;
  }

  const pembimbingId = [Number(pembimbingUtamaId)];
  if (pembimbingKeduaId) pembimbingId.push(Number(pembimbingKeduaId));

  const payload: Record<string, unknown> = {
    pembimbing_id: pembimbingId,
    judul,
    lokasi: lokasiInput?.value.trim() || null,
    tanggal: tanggalInput?.value || null,
    waktu: waktuInput?.value || null,
  };

  // moderator_id & ruangan sengaja tidak dikirim: diisi belakangan oleh panitia.

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Mengirim...";
  }

  try {
    const json = await apiFetch<StoreSeminarResponse>("/auth/seminar", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (json) {
      existingSeminar = json.seminar;
      showMessage(json.message ?? "Seminar berhasil didaftarkan.", "success");
      renderStatusBadge();
      lockFormIfAlreadyRegistered();
    }
  } catch (err) {
    console.error("Gagal mendaftar seminar:", err);
    showMessage(err instanceof Error ? err.message : "Gagal mendaftar seminar.", "error");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span class="material-symbols-outlined text-sm">save</span> Kirim`;
    }
  }
}

function initForm(): void {
  const form = document.getElementById("form-daftar-seminar") as HTMLFormElement | null;
  form?.addEventListener("submit", handleSubmit);
}

// ------------------------------------------------------------------
// Jalankan saat halaman siap
// ------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  initForm();
  await loadProfil();
  // Hanya meload status seminar dan opsi dosen
  await Promise.all([loadMySeminarStatus(), loadDosenOptions()]);
});