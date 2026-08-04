// src/scripts/api/biodata-dosen-api.ts
// GET & PATCH & POST(store) untuk halaman biodata dosen.
// - GET  /auth/profile              -> isi nama, NIP, email, foto, preview tandatangan
// - PATCH /auth/profile             -> simpan email (nama & NIP readonly, tidak dikirim)
// - POST  /auth/profile/foto        -> upload foto profil (multipart), langsung saat file dipilih
// - POST  /auth/profile/tandatangan -> HANYA dikirim saat tombol "Simpan" utama diklik,
//   dengan cara ambil hasil canvas lewat window.getSignatureDataUrl() (lihat
//   biodata-signature.ts). Baik jalur gambar manual maupun "Unggah Gambar" sama-sama
//   cuma menggambar ke canvas dulu — belum terkirim ke server sampai Simpan diklik.
//
// CATATAN GAMBAR PROTECTED: endpoint GET /auth/images/{path} tetap di dalam
// middleware auth:sanctum (sengaja, supaya file tidak bisa diambil sembarang
// user). Karena <img src="..."> di browser TIDAK BISA mengirim header
// Authorization, kita tidak pernah pasang URL dari API langsung ke img.src.
// Sebagai gantinya, gambar di-fetch manual via loadAuthenticatedImage() dengan
// header Authorization, lalu hasilnya (blob) diubah jadi Object URL yang baru
// dipasang ke img.src.
//
// PESAN BERHASIL/GAGAL SIMPAN (tombol "Simpan" -> PATCH email + POST tandatangan):
// memakai modal InfoModal (src/components/InfoModal.astro) lewat helper
// showSuccess()/showError() di src/scripts/lib/info-dialog.ts.
//
// PESAN UPLOAD FOTO PROFIL: TETAP memakai banner inline showMessage()/
// #biodata-form-message seperti sebelumnya (tidak dipindah ke modal, sesuai
// permintaan — upload foto langsung terjadi saat file dipilih, bukan lewat
// tombol Simpan, jadi modal dianggap terlalu mengganggu untuk aksi itu).

import { showError, showSuccess } from "../../lib/info-dialog";

interface ApiUser {
  id: number;
  role: "admin" | "dosen" | "mahasiswa";
  nama: string;
  nip?: string | null;
  email: string;
  foto?: string | null;
  tandatangan?: string | null;
  [key: string]: unknown;
}

interface ProfileGetResponse {
  message?: string;
  user?: ApiUser;
}

interface ProfilePatchSuccessResponse {
  message: string;
  user: ApiUser;
}

interface ProfilePatchErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

interface UploadFotoResponse {
  message: string;
  foto: string;
  user: ApiUser;
}

interface UploadTandaTanganResponse {
  message: string;
  tandatangan: string;
  user: ApiUser;
}

interface ApiErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

declare global {
  interface Window {
    getSignatureDataUrl?: () => string | null;
  }
}

// Ubah dataURL ("data:image/png;base64,....") jadi Blob, buat dikirim
// sebagai multipart file ke /auth/profile/tandatangan.
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}

const API_BASE_URL = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token";

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function redirectIfUnauthorized(status: number): boolean {
  if (status === 401) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.href = "/";
    return true;
  }
  return false;
}

// Banner inline — SEKARANG cuma dipakai untuk pesan upload foto profil.
function showMessage(text: string, variant: "success" | "error"): void {
  const el = document.getElementById("biodata-form-message");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden", "text-green-700", "text-red-700");
  el.classList.add(variant === "success" ? "text-green-700" : "text-red-700");
}

function clearMessage(): void {
  const el = document.getElementById("biodata-form-message");
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

// ---------- Ambil gambar protected (foto/tandatangan) pakai token ----------
// Endpoint GET /auth/images/{path} butuh header Authorization, jadi tidak bisa
// dipasang langsung ke <img src>. Fetch manual, lalu convert response jadi
// Object URL yang browser bisa render di <img>.
async function loadAuthenticatedImage(url: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch (err) {
    console.error("Gagal memuat gambar:", err);
    return null;
  }
}

// Set src <img> dari URL protected, sambil revoke Object URL lama (kalau ada)
// supaya tidak bocor memori tiap kali gambar di-refresh.
async function setProtectedImageSrc(
  imgEl: HTMLImageElement | null,
  url: string | null | undefined,
  token: string
): Promise<void> {
  if (!imgEl || !url) return;

  const blobUrl = await loadAuthenticatedImage(url, token);
  if (!blobUrl) return;

  if (imgEl.src.startsWith("blob:")) {
    URL.revokeObjectURL(imgEl.src);
  }
  imgEl.src = blobUrl;
}

// ---------- GET ----------
async function loadBiodata(): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/";
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/profile`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (redirectIfUnauthorized(res.status)) return;

    if (!res.ok) {
      console.error("Gagal ambil biodata dosen:", res.status);
      return;
    }

    const data: ProfileGetResponse = await res.json();
    const user = data.user;
    if (!user) return;

    const namaEl = document.getElementById("biodata-nama") as HTMLInputElement | null;
    const nipEl = document.getElementById("biodata-nip") as HTMLInputElement | null;
    const emailEl = document.getElementById("biodata-email") as HTMLInputElement | null;
    const fotoEl = document.getElementById("biodata-foto-img") as HTMLImageElement | null;
    const ttdEl = document.getElementById("biodata-tandatangan-preview") as HTMLImageElement | null;

    if (namaEl) namaEl.value = user.nama ?? "";
    if (nipEl) nipEl.value = user.nip ?? "";
    if (emailEl) emailEl.value = user.email ?? "";

    await setProtectedImageSrc(fotoEl, user.foto, token);
    await setProtectedImageSrc(ttdEl, user.tandatangan, token);
  } catch (err) {
    console.error("Gagal ambil biodata dosen:", err);
  }
}

// ---------- PATCH (email) ----------
async function savePatchProfile(token: string): Promise<boolean> {
  const emailEl = document.getElementById("biodata-email") as HTMLInputElement | null;
  if (!emailEl) return false;

  const email = emailEl.value.trim();
  if (!email) {
    showError("Email wajib diisi.");
    return false;
  }

  const res = await fetch(`${API_BASE_URL}/auth/profile`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ email }),
  });

  if (redirectIfUnauthorized(res.status)) return false;

  const json = (await res.json()) as ProfilePatchSuccessResponse | ProfilePatchErrorResponse;

  if (!res.ok) {
    const errJson = json as ProfilePatchErrorResponse;
    if (errJson.errors) {
      const firstError = Object.values(errJson.errors)[0]?.[0];
      showError(firstError ?? errJson.message ?? "Gagal menyimpan biodata.");
    } else {
      showError(errJson.message ?? "Gagal menyimpan biodata.");
    }
    return false;
  }

  return true;
}

// ---------- POST (store) tanda tangan, kalau canvas ada isinya ----------
// Dipanggil di dalam saveBiodata(), bukan saat file dipilih — sesuai alur:
// gambar manual ATAU upload file (keduanya cuma "menggambar" ke canvas),
// baru dikirim ke server saat tombol Simpan diklik.
async function saveTandaTanganIfAny(token: string): Promise<boolean> {
  const dataUrl = window.getSignatureDataUrl?.();
  if (!dataUrl) return true; // tidak ada perubahan tanda tangan, anggap sukses

  const blob = dataUrlToBlob(dataUrl);
  const formData = new FormData();
  formData.append("tandatangan", blob, "tandatangan.png");

  const res = await fetch(`${API_BASE_URL}/auth/profile/tandatangan`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (redirectIfUnauthorized(res.status)) return false;

  if (!res.ok) {
    const errJson = (await res.json().catch(() => ({}))) as ApiErrorResponse;
    showError(errJson.message ?? "Gagal menyimpan tanda tangan.");
    return false;
  }

  const data: UploadTandaTanganResponse = await res.json();
  const ttdEl = document.getElementById("biodata-tandatangan-preview") as HTMLImageElement | null;
  await setProtectedImageSrc(ttdEl, data.tandatangan, token);
  return true;
}

// ---------- Simpan (PATCH email + POST tandatangan kalau ada) ----------
async function saveBiodata(): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/";
    return;
  }

  const submitBtn = document.getElementById("biodata-submit-btn") as HTMLButtonElement | null;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Menyimpan...";
  }

  try {
    const profileOk = await savePatchProfile(token);
    if (!profileOk) return;

    const ttdOk = await saveTandaTanganIfAny(token);
    if (!ttdOk) return;

    showSuccess("Biodata berhasil disimpan.");
  } catch (err) {
    console.error("Gagal menyimpan biodata dosen:", err);
    showError("Terjadi kesalahan jaringan. Coba lagi.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span class="material-symbols-outlined">save</span> Simpan';
    }
  }
}

function initSubmitBiodata(): void {
  const submitBtn = document.getElementById("biodata-submit-btn");
  if (!submitBtn) return;
  if (submitBtn.dataset.bound === "true") return;
  submitBtn.dataset.bound = "true";

  submitBtn.addEventListener("click", (e) => {
    e.preventDefault();
    saveBiodata();
  });
}

// ---------- POST (store) foto profil ----------
// CATATAN: pesan berhasil/gagal upload foto SENGAJA TETAP pakai banner inline
// showMessage()/#biodata-form-message, TIDAK dipindah ke InfoModal.
function initFotoUpload(): void {
  const editBtn = document.getElementById("biodata-edit-foto-btn");
  const fileInput = document.getElementById("biodata-foto-input") as HTMLInputElement | null;
  if (!editBtn || !fileInput) return;

  if (editBtn.dataset.bound === "true") return;
  editBtn.dataset.bound = "true";

  editBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const token = getToken();
    if (!token) {
      window.location.href = "/";
      return;
    }

    const formData = new FormData();
    formData.append("foto", file);

    try {
      const res = await fetch(`${API_BASE_URL}/auth/profile/foto`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (redirectIfUnauthorized(res.status)) return;

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as ApiErrorResponse;
        showMessage(errJson.message ?? "Gagal upload foto.", "error");
        return;
      }

      const data: UploadFotoResponse = await res.json();
      const fotoEl = document.getElementById("biodata-foto-img") as HTMLImageElement | null;
      await setProtectedImageSrc(fotoEl, data.foto, token);
      showMessage("Foto profil berhasil diupload.", "success");
    } catch (err) {
      console.error("Gagal upload foto:", err);
      showMessage("Terjadi kesalahan jaringan saat upload foto.", "error");
    } finally {
      fileInput.value = "";
    }
  });
}

function initBiodataDosenPage(): void {
  loadBiodata();
  initSubmitBiodata();
  initFotoUpload();
}

initBiodataDosenPage();
document.addEventListener("astro:page-load", initBiodataDosenPage);