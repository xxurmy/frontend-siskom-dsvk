// src/scripts/form-update-kolokium.ts
// Logic untuk halaman "Update Kolokium" (form review/approve oleh admin):
// 1) ambil ?id= dari URL -> GET /auth/kolokium/{id} -> isi semua field form
// 2) fetch daftar dosen (GET /auth/dosen) -> isi <select> Pembimbing & Moderator
// 3) fetch daftar mahasiswa (GET /auth/mahasiswa) -> isi <select> Mahasiswa Pembahas
// 4) submit form -> PATCH /auth/kolokium/{id}
//
// PENTING: semua endpoint di routes/api.php ada di dalam Route::prefix('auth'),
// jadi WAJIB pakai prefix /auth di setiap path.
//
// CATATAN PENTING soal relasi pembimbing:
// KolokiumController@show hanya `return response()->json($kolokium)` TANPA
// eager-load relasi `pembimbing`, jadi ID dosen pembimbing yang sedang tersimpan
// TIDAK ikut kebawa di response (yang ada cuma string gabungan "namadosenpembimbing").
// Makanya dropdown Pembimbing Utama/Kedua di bawah cuma bisa ke-preselect KALAU
// backend kebetulan menyertakan field `pembimbing` (array of {id,...}) di response;
// kalau tidak ada, dropdown dibiarkan kosong dan field pembimbing_id TIDAK dikirim
// saat submit (supaya data pembimbing yang sudah ada di database tidak ketimpa
// jadi kosong secara tidak sengaja). Kalau admin memang mau ganti pembimbing,
// tinggal pilih Pembimbing Utama secara manual di dropdown.

// ------------------------------------------------------------------
// Konfigurasi
// ------------------------------------------------------------------
const API_BASE: string = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token"; // sesuaikan kalau key token localStorage Anda beda

// ------------------------------------------------------------------
// Tipe data (disesuaikan dengan KolokiumController & UserController)
// ------------------------------------------------------------------
type StatusPengajuan = "pending" | "approved" | "rejected";

interface UserOption {
  id: number;
  nama: string;
  nim?: string | null;
  nip?: string | null;
}

// dosenList() & mahasiswaList() di UserController sama-sama membalas
// { message, users: [...] }
interface UserOptionListResponse {
  message: string;
  users: UserOption[];
}

// Field opsional `pembimbing` didefensifkan -> lihat catatan di atas file.
interface Kolokium {
  id: number;
  mahasiswa_id: number;
  nama: string;
  nim: string;
  prodi: string;
  namadosenpembimbing: string | null;
  pembimbing?: { id: number; nama?: string }[];
  moderator_id: number | null;
  pembahas_id: number | null;
  judul: string;
  lokasi: string | null;
  tanggal: string | null;
  waktu: string | null;
  namapembahas: string | null;
  namadosenmoderator: string | null;
  ruangan: string | null;
  status: StatusPengajuan;
  jumlahforum: number;
}

interface UpdateKolokiumResponse {
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
let kolokiumId: number | null = null;
let currentKolokium: Kolokium | null = null;
let dosenOptions: UserOption[] = [];
let mahasiswaOptions: UserOption[] = [];

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
    const firstFieldError = err.errors ? Object.values(err.errors)[0]?.[0] : undefined;
    throw new Error(firstFieldError ?? err.message ?? `Request ke ${path} gagal (status ${res.status})`);
  }

  return json as T;
}

// ------------------------------------------------------------------
// Pesan status
// ------------------------------------------------------------------
function showMessage(text: string, variant: "success" | "error"): void {
  const el = document.getElementById("update-kolokium-message");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden", "bg-green-100", "text-green-800", "bg-red-100", "text-red-800");
  el.classList.add(...(variant === "success" ? ["bg-green-100", "text-green-800"] : ["bg-red-100", "text-red-800"]));
}

function clearMessage(): void {
  const el = document.getElementById("update-kolokium-message");
  if (!el) return;
  el.classList.add("hidden");
  el.textContent = "";
}

// ------------------------------------------------------------------
// Warna badge <select> Status Kolokium
// ------------------------------------------------------------------
const statusColors: Record<StatusPengajuan, string> = {
  pending: "bg-amber-500",
  approved: "bg-green-600",
  rejected: "bg-red-600",
};

function updateStatusColor(select: HTMLSelectElement): void {
  Object.values(statusColors).forEach((cls) => select.classList.remove(cls));
  const color = statusColors[select.value as StatusPengajuan] ?? statusColors.pending;
  select.classList.add(color);
}

function initStatusSelect(): void {
  const statusSelect = document.getElementById("status_kolokium") as HTMLSelectElement | null;
  if (!statusSelect) return;
  updateStatusColor(statusSelect);
  statusSelect.addEventListener("change", () => updateStatusColor(statusSelect));
}

// ------------------------------------------------------------------
// Ambil ?id= dari URL halaman
// ------------------------------------------------------------------
function getKolokiumIdFromUrl(): number | null {
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get("id");
  if (!idParam) return null;
  const id = parseInt(idParam, 10);
  return Number.isNaN(id) ? null : id;
}

// ------------------------------------------------------------------
// Kunci seluruh form (dipakai kalau ?id= tidak valid / data gagal dimuat)
// ------------------------------------------------------------------
function disableForm(): void {
  const form = document.getElementById("form-update-kolokium") as HTMLFormElement | null;
  form?.querySelectorAll("input, select, textarea, button").forEach((el) => {
    (el as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = true;
  });
}

// ------------------------------------------------------------------
// Muat detail kolokium -> isi semua field
// ------------------------------------------------------------------
async function loadKolokium(id: number): Promise<void> {
  const json = await apiFetch<Kolokium>(`/auth/kolokium/${id}`);
  if (!json) return;

  currentKolokium = json;

  const namaInput = document.getElementById("input-nama") as HTMLInputElement | null;
  const nimInput = document.getElementById("input-nim") as HTMLInputElement | null;
  const prodiInput = document.getElementById("input-prodi") as HTMLInputElement | null;
  const judulInput = document.getElementById("input-judul") as HTMLTextAreaElement | null;
  const lokasiInput = document.getElementById("input-lokasi") as HTMLInputElement | null;
  const tanggalInput = document.getElementById("input-tanggal") as HTMLInputElement | null;
  const waktuInput = document.getElementById("input-waktu") as HTMLInputElement | null;
  const ruanganInput = document.getElementById("input-ruangan") as HTMLInputElement | null;
  const statusSelect = document.getElementById("status_kolokium") as HTMLSelectElement | null;
  const namadosenpembimbingNote = document.getElementById("current-pembimbing-note");

  if (namaInput) namaInput.value = json.nama ?? "";
  if (nimInput) nimInput.value = json.nim ?? "";
  if (prodiInput) prodiInput.value = json.prodi ?? "";
  if (judulInput) judulInput.value = json.judul ?? "";
  if (lokasiInput) lokasiInput.value = json.lokasi ?? "";
  if (tanggalInput) tanggalInput.value = json.tanggal ?? "";
  if (waktuInput) waktuInput.value = json.waktu ?? "";
  if (ruanganInput) ruanganInput.value = json.ruangan ?? "";
  if (namadosenpembimbingNote) {
    namadosenpembimbingNote.textContent = json.namadosenpembimbing
      ? `Saat ini: ${json.namadosenpembimbing}`
      : "";
  }

  if (statusSelect) {
    statusSelect.value = json.status;
    updateStatusColor(statusSelect);
  }
}

// Dipanggil sekali setelah loadKolokium() + loadDosenOptions() + loadMahasiswaOptions()
// semuanya selesai (lihat Promise.all di DOMContentLoaded), supaya urutan selesainya
// fetch tidak jadi masalah -> opsi <select> dijamin sudah terisi sebelum di-preselect.
function applyPreselections(): void {
  if (!currentKolokium) return;

  selectValueIfExists("select-moderator", currentKolokium.moderator_id);
  selectValueIfExists("select-pembahas", currentKolokium.pembahas_id);

  // Preselect pembimbing HANYA kalau backend menyertakan field `pembimbing`
  // (lihat catatan besar di atas file).
  if (currentKolokium.pembimbing && currentKolokium.pembimbing.length > 0) {
    selectValueIfExists("select-pembimbing-utama", currentKolokium.pembimbing[0]?.id ?? null);
    selectValueIfExists("select-pembimbing-kedua", currentKolokium.pembimbing[1]?.id ?? null);
  }
}

function selectValueIfExists(selectId: string, value: number | null): void {
  if (value === null || value === undefined) return;
  const select = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!select) return;
  const hasOption = Array.from(select.options).some((opt) => opt.value === String(value));
  if (hasOption) select.value = String(value);
}

// ------------------------------------------------------------------
// Muat daftar dosen -> isi select Pembimbing Utama/Kedua & Moderator
// ------------------------------------------------------------------
async function loadDosenOptions(): Promise<void> {
  const json = await apiFetch<UserOptionListResponse>("/auth/dosen");
  dosenOptions = json?.users ?? [];

  const optionsHtml = dosenOptions
    .map((d) => `<option value="${d.id}">${d.nama}${d.nip ? ` (NIP: ${d.nip})` : ""}</option>`)
    .join("");

  const utamaSelect = document.getElementById("select-pembimbing-utama") as HTMLSelectElement | null;
  const keduaSelect = document.getElementById("select-pembimbing-kedua") as HTMLSelectElement | null;
  const moderatorSelect = document.getElementById("select-moderator") as HTMLSelectElement | null;

  if (utamaSelect) {
    utamaSelect.innerHTML = `<option value="">-- Pilih Dosen Pembimbing Utama --</option>${optionsHtml}`;
  }
  if (keduaSelect) {
    keduaSelect.innerHTML = `<option value="">-- Pilih Dosen Pembimbing Kedua --</option>${optionsHtml}`;
  }
  if (moderatorSelect) {
    moderatorSelect.innerHTML = `<option value="">-- Pilih Dosen Moderator --</option>${optionsHtml}`;
  }
}

// ------------------------------------------------------------------
// Muat daftar mahasiswa -> isi select Mahasiswa Pembahas
// ------------------------------------------------------------------
async function loadMahasiswaOptions(): Promise<void> {
  const json = await apiFetch<UserOptionListResponse>("/auth/mahasiswa");
  mahasiswaOptions = json?.users ?? [];

  const pembahasSelect = document.getElementById("select-pembahas") as HTMLSelectElement | null;
  if (!pembahasSelect) return;

  const optionsHtml = mahasiswaOptions
    .map((m) => `<option value="${m.id}">${m.nama}${m.nim ? ` (${m.nim})` : ""}</option>`)
    .join("");

  pembahasSelect.innerHTML = `<option value="">-- Pilih Mahasiswa Pembahas --</option>${optionsHtml}`;
}

// ------------------------------------------------------------------
// Submit form -> PATCH /auth/kolokium/{id}
// ------------------------------------------------------------------
async function handleSubmit(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  clearMessage();

  if (!kolokiumId) {
    showMessage("ID Kolokium tidak ditemukan, tidak bisa menyimpan perubahan.", "error");
    return;
  }

  const utamaSelect = document.getElementById("select-pembimbing-utama") as HTMLSelectElement | null;
  const keduaSelect = document.getElementById("select-pembimbing-kedua") as HTMLSelectElement | null;
  const judulInput = document.getElementById("input-judul") as HTMLTextAreaElement | null;
  const lokasiInput = document.getElementById("input-lokasi") as HTMLInputElement | null;
  const tanggalInput = document.getElementById("input-tanggal") as HTMLInputElement | null;
  const waktuInput = document.getElementById("input-waktu") as HTMLInputElement | null;
  const pembahasSelect = document.getElementById("select-pembahas") as HTMLSelectElement | null;
  const moderatorSelect = document.getElementById("select-moderator") as HTMLSelectElement | null;
  const ruanganInput = document.getElementById("input-ruangan") as HTMLInputElement | null;
  const statusSelect = document.getElementById("status_kolokium") as HTMLSelectElement | null;
  const submitBtn = document.getElementById("btn-submit-kolokium") as HTMLButtonElement | null;

  const pembimbingUtamaId = utamaSelect?.value ?? "";
  const pembimbingKeduaId = keduaSelect?.value ?? "";

  if (pembimbingKeduaId && pembimbingKeduaId === pembimbingUtamaId) {
    showMessage("Dosen Pembimbing Kedua harus berbeda dari Pembimbing Utama.", "error");
    return;
  }

  const moderatorId = moderatorSelect?.value ? Number(moderatorSelect.value) : null;
  const pembimbingUtamaNum = pembimbingUtamaId ? Number(pembimbingUtamaId) : null;
  const pembimbingKeduaNum = pembimbingKeduaId ? Number(pembimbingKeduaId) : null;

  if (moderatorId !== null && (moderatorId === pembimbingUtamaNum || moderatorId === pembimbingKeduaNum)) {
    showMessage("Moderator harus berbeda dari dosen pembimbing.", "error");
    return;
  }

  const payload: Record<string, unknown> = {
    judul: judulInput?.value.trim() || undefined,
    lokasi: lokasiInput?.value.trim() || null,
    tanggal: tanggalInput?.value || null,
    waktu: waktuInput?.value || null,
    ruangan: ruanganInput?.value.trim() || null,
    moderator_id: moderatorId,
    pembahas_id: pembahasSelect?.value ? Number(pembahasSelect.value) : null,
    status: statusSelect?.value ?? undefined,
  };

  // pembimbing_id hanya dikirim kalau admin benar-benar memilih Pembimbing
  // Utama, supaya data pembimbing yang sudah ada tidak ketimpa kosong
  // (lihat catatan besar di atas file soal relasi yang tidak ke-load).
  if (pembimbingUtamaNum) {
    payload.pembimbing_id = pembimbingKeduaNum
      ? [pembimbingUtamaNum, pembimbingKeduaNum]
      : [pembimbingUtamaNum];
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Menyimpan...";
  }

  try {
    const json = await apiFetch<UpdateKolokiumResponse>(`/auth/kolokium/${kolokiumId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

    if (json) {
      currentKolokium = json.kolokium;
      showMessage(json.message ?? "Kolokium berhasil diperbarui.", "success");
    }
  } catch (err) {
    console.error("Gagal memperbarui kolokium:", err);
    showMessage(err instanceof Error ? err.message : "Gagal memperbarui kolokium.", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span class="material-symbols-outlined text-sm">save</span> Update`;
    }
  }
}

function initForm(): void {
  const form = document.getElementById("form-update-kolokium") as HTMLFormElement | null;
  form?.addEventListener("submit", handleSubmit);
}

// ------------------------------------------------------------------
// Jalankan saat halaman siap
// ------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  initStatusSelect();
  initForm();

  kolokiumId = getKolokiumIdFromUrl();
  if (!kolokiumId) {
    showMessage("ID Kolokium tidak ditemukan di URL (contoh: ?id=1).", "error");
    disableForm();
    return;
  }

  try {
    await Promise.all([loadKolokium(kolokiumId), loadDosenOptions(), loadMahasiswaOptions()]);
    applyPreselections();
  } catch (err) {
    console.error("Gagal memuat data kolokium:", err);
    showMessage(err instanceof Error ? err.message : "Gagal memuat data kolokium.", "error");
    disableForm();
  }
});