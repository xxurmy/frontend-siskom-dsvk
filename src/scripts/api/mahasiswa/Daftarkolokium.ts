// src/scripts/api/mahasiswa/Daftarkolokium.ts
// Logic untuk halaman "Daftar Kolokium" (role: mahasiswa):
// 1) fetch profil login untuk isi field readonly (Nama/NIM/Prodi) -> GET /auth/profile
// 2) fetch status kolokium terbaru milik mahasiswa login -> GET /auth/kolokium/my
//    - kalau status masih 'pending' atau 'approved', form disembunyikan (tidak boleh
//      daftar dobel), hanya status card yang tampil
//    - kalau belum pernah daftar / status 'rejected', form ditampilkan untuk isi ulang
// 3) submit form pendaftaran -> POST /auth/kolokium (KolokiumController@store)
//
// Dropdown "Dosen Pembimbing" diisi dari endpoint khusus
// (bukan UserController@index yang admin-only): GET /auth/dosen.
// Endpoint ini hanya butuh login (role apa saja), lihat UserController@dosenList.

// ------------------------------------------------------------------
// Konfigurasi
// ------------------------------------------------------------------
// PENTING: nama env HARUS berprefix PUBLIC_ (mis. PUBLIC_BASE_URL) supaya
// terbaca di client-side. Astro hanya meng-expose env yang berprefix
// PUBLIC_ ke kode yang berjalan di browser. Jika tetap memakai VITE_BASE_URL,
// tambahkan `envPrefix: ["VITE_", "PUBLIC_"]` di astro.config.mjs.
const API_BASE: string = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token"; // sesuaikan kalau key token localStorage Anda beda
const statusCard = document.getElementById("status-card");

if (statusCard) {
  statusCard.classList.remove("hidden");
}

// ------------------------------------------------------------------
// Tipe data
// ------------------------------------------------------------------
type StatusPengajuan = "pending" | "approved" | "rejected";

interface UserProfil {
  id: number;
  nama: string;
  nim?: string | null;
  prodi?: string | null;
  role: "mahasiswa" | "dosen" | "admin";
}

type ProfilResponse = UserProfil | { user: UserProfil } | { data: UserProfil };

interface Kolokium {
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

interface UserListItem {
  id: number;
  role: string;
  nama: string;
  nim?: string | null;
  nip?: string | null;
}

interface UserListResponse {
  message: string;
  users: UserListItem[];
}

interface StoreKolokiumResponse {
  message: string;
  kolokium: Kolokium;
}

interface ApiErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

// ------------------------------------------------------------------
// State halaman
// ------------------------------------------------------------------
let currentUser: UserProfil | null = null;
let currentKolokium: Kolokium | null = null;

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
    window.location.href = "/denied";
    return null;
  }

  const json = await res.json();

  if (!res.ok) {
    const err = json as ApiErrorResponse;
    throw new Error(err.message ?? `Request ke ${path} gagal (status ${res.status})`);
  }

  return json as T;
}

function extractUser(json: ProfilResponse): UserProfil {
  if ("user" in json) return json.user;
  if ("data" in json) return json.data;
  return json;
}

// ------------------------------------------------------------------
// Pesan status
// ------------------------------------------------------------------
function showMessage(text: string, variant: "success" | "error"): void {
  const el = document.getElementById("kolokium-message");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden", "bg-green-100", "text-green-800", "bg-red-100", "text-red-800");
  el.classList.add(variant === "success" ? "bg-green-100" : "bg-red-100");
  el.classList.add(variant === "success" ? "text-green-800" : "text-red-800");
}

function clearMessage(): void {
  const el = document.getElementById("kolokium-message");
  if (!el) return;
  el.classList.add("hidden");
  el.textContent = "";
}

// ------------------------------------------------------------------
// Status badge
// ------------------------------------------------------------------
function renderStatusBadge(status: StatusPengajuan | null): void {
  const badge = document.getElementById("status-badge");
  if (!badge) return;

  badge.className = "px-4 py-1.5 rounded-full font-body-sm text-body-sm text-white";

  switch (status) {
    case "pending":
      badge.classList.add("bg-yellow-500");
      badge.textContent = "Menunggu Persetujuan";
      break;
    case "approved":
      badge.classList.add("bg-secondary");
      badge.textContent = "Disetujui";
      break;
    case "rejected":
      badge.classList.add("bg-error");
      badge.textContent = "Ditolak";
      break;
    default:
      badge.classList.add("bg-outline");
      badge.textContent = "Belum Mendaftar";
  }
}

// ------------------------------------------------------------------
// Muat profil login -> isi field readonly
// ------------------------------------------------------------------
async function loadProfil(): Promise<void> {
  const json = await apiFetch<ProfilResponse>("/auth/profile");
  if (!json) return;

  currentUser = extractUser(json);

  const namaInput = document.getElementById("nama-input") as HTMLInputElement | null;
  const nimInput = document.getElementById("nim-input") as HTMLInputElement | null;
  const prodiInput = document.getElementById("prodi-input") as HTMLInputElement | null;

  if (namaInput) namaInput.value = currentUser.nama ?? "";
  if (nimInput) nimInput.value = currentUser.nim ?? "";
  if (prodiInput) prodiInput.value = currentUser.prodi ?? "";
}

// ------------------------------------------------------------------
// Muat status kolokium terbaru milik mahasiswa login
// ------------------------------------------------------------------
async function loadMyKolokium(): Promise<void> {
  try {
    const json = await apiFetch<LaravelPaginator<Kolokium>>("/auth/kolokium/my");

    currentKolokium =
      json && json.data.length > 0
        ? json.data[0]
        : null;
  } catch (err) {
    console.error("Gagal memuat status kolokium:", err);
    currentKolokium = null;
  }

  renderStatusBadge(currentKolokium?.status ?? null);
  toggleForm();
}

// Form hanya ditampilkan jika belum pernah daftar, atau pengajuan terakhir ditolak.
function toggleForm(): void {
  const formWrapper = document.getElementById("form-wrapper");

  if (!formWrapper) return;

  // Jika belum pernah daftar atau ditolak, tampilkan form
  if (!currentKolokium || currentKolokium.status === "rejected") {
    formWrapper.classList.remove("hidden");
  } else {
    // Pending atau approved, sembunyikan form
    formWrapper.classList.add("hidden");
  }
}

// ------------------------------------------------------------------
// Muat opsi dosen (pembimbing)
// ------------------------------------------------------------------
async function initDosenOptions(): Promise<void> {
  const utamaSelect = document.getElementById("pembimbing-utama-select") as HTMLSelectElement | null;
  const keduaSelect = document.getElementById("pembimbing-kedua-select") as HTMLSelectElement | null;

  await loadDosenOptions(utamaSelect, keduaSelect);
}

async function loadDosenOptions(
  utamaSelect: HTMLSelectElement | null,
  keduaSelect: HTMLSelectElement | null
): Promise<void> {
  try {
    const json = await apiFetch<UserListResponse>("/auth/dosen");
    if (!json) return;

    fillSelectOptions(utamaSelect, json.users, "-- Pilih Dosen Pembimbing Utama --");
    fillSelectOptions(keduaSelect, json.users, "-- Pilih Dosen Pembimbing Kedua --");
  } catch (err) {
    console.error("Gagal memuat daftar dosen:", err);
    setSelectFallback(utamaSelect, "Daftar dosen tidak dapat dimuat");
    setSelectFallback(keduaSelect, "Daftar dosen tidak dapat dimuat");
  }
}

function fillSelectOptions(
  select: HTMLSelectElement | null,
  items: UserListItem[],
  placeholder: string
): void {
  if (!select) return;
  select.innerHTML = `<option value="">${placeholder}</option>`;
  items.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = String(item.id);
    opt.textContent = item.nip ? `${item.nama} (${item.nip})` : item.nama;
    select.appendChild(opt);
  });
}

function setSelectFallback(select: HTMLSelectElement | null, message: string): void {
  if (!select) return;
  select.innerHTML = `<option value="">${message}</option>`;
  select.disabled = true;
}

// ------------------------------------------------------------------
// Submit form pendaftaran kolokium
// ------------------------------------------------------------------
async function handleSubmit(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  clearMessage();

  const utamaSelect = document.getElementById("pembimbing-utama-select") as HTMLSelectElement | null;
  const keduaSelect = document.getElementById("pembimbing-kedua-select") as HTMLSelectElement | null;
  const judulInput = document.getElementById("judul-textarea") as HTMLTextAreaElement | null;
  const lokasiInput = document.getElementById("lokasi-input") as HTMLInputElement | null;
  const tanggalInput = document.getElementById("tanggal-input") as HTMLInputElement | null;
  const waktuInput = document.getElementById("waktu-input") as HTMLInputElement | null;
  const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement | null;

  const pembimbingUtama = utamaSelect?.value ?? "";
  const pembimbingKedua = keduaSelect?.value ?? "";

  if (!pembimbingUtama) {
    showMessage("Dosen pembimbing utama wajib dipilih.", "error");
    return;
  }
  if (!judulInput?.value.trim()) {
    showMessage("Rencana tugas akhir wajib diisi.", "error");
    return;
  }

  const pembimbingId = [Number(pembimbingUtama)];
  if (pembimbingKedua) pembimbingId.push(Number(pembimbingKedua));

  const payload: Record<string, unknown> = {
    pembimbing_id: pembimbingId,
    judul: judulInput.value.trim(),
    lokasi: lokasiInput?.value.trim() || null,
    tanggal: tanggalInput?.value || null,
    waktu: waktuInput?.value || null,
  };

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Mengirim...";
  }

  try {
    await apiFetch<StoreKolokiumResponse>("/auth/kolokium", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    showMessage("Kolokium berhasil diajukan. Menunggu persetujuan panitia.", "success");
    await loadMyKolokium();
  } catch (err) {
    console.error("Gagal mengajukan kolokium:", err);
    showMessage(err instanceof Error ? err.message : "Gagal mengajukan kolokium.", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span class="material-symbols-outlined text-sm">save</span> Kirim`;
    }
  }
}

// ------------------------------------------------------------------
// Jalankan saat halaman siap
// ------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  clearMessage();

  const form = document.getElementById("kolokium-form") as HTMLFormElement | null;
  form?.addEventListener("submit", handleSubmit);

  // Ambil status pengajuan terlebih dahulu
  await loadMyKolokium();

  // Jika sudah memiliki pengajuan (pending atau approved),
  // cukup tampilkan status dan hentikan proses.
  if (currentKolokium && currentKolokium.status !== "rejected") {
    return;
  }

  // Jika belum pernah mendaftar atau status ditolak,
  // baru ambil data untuk mengisi form.
  await loadProfil();
  await initDosenOptions();
});