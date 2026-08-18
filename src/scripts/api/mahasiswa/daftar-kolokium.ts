// src/scripts/api/mahasiswa/daftar-kolokium.ts
// Logic untuk halaman "Daftar Kolokium" (role: mahasiswa):
// 1) fetch profil login untuk isi field readonly (Nama/NIM/Prodi) -> GET /auth/profile
// 2) fetch status kolokium terbaru milik mahasiswa login -> GET /auth/kolokium/my
//    - kalau status masih 'pending' atau 'approved', form disembunyikan (tidak boleh
//      daftar dobel), hanya status card yang tampil
//    - kalau belum pernah daftar / status 'rejected', form ditampilkan untuk isi ulang
//    - kalau status 'rejected', form di-PREFILL dengan data pengajuan sebelumnya
//      (judul, lokasi, tanggal, waktu, pembimbing) supaya mahasiswa tahu apa yang
//      pernah diisi dan tinggal mengedit, bukan mengisi dari nol
// 3) submit form:
//    - belum pernah daftar -> POST /auth/kolokium (KolokiumController@store)
//    - status sebelumnya 'rejected' -> PATCH /auth/kolokium/{id}/resubmit
//      (KolokiumController@resubmit), status kembali ke pending & catatan di-null-kan
//
// Dropdown "Dosen Pembimbing" diisi dari endpoint khusus
// (bukan UserController@index yang admin-only): GET /auth/dosen.
// Endpoint ini hanya butuh login (role apa saja), lihat UserController@dosenList.
//
// CATATAN ADMIN: ditampilkan readonly di Status Card (bukan di form), hanya
// muncul kalau status rejected/approved DAN admin memang mengisi catatan.
//
// PESAN ERROR: memakai modal InfoModal (src/components/InfoModal.astro) lewat
// helper showError() di src/scripts/lib/info-dialog.ts.
// PESAN BERHASIL: TETAP memakai banner inline showMessage()/#kolokium-message
// seperti sebelumnya (tidak dipindah ke modal, sesuai permintaan).
//
// VALIDASI SEBELUM SUBMIT (client-side, mirip form-update-kolokium.ts admin,
// TAPI tanpa status/moderator/ruangan karena field itu tidak diisi mahasiswa):
// 1. Dosen pembimbing utama wajib dipilih.
// 2. Dosen pembimbing utama & kedua tidak boleh sama/ganda.
// 3. Tanggal kolokium (kalau diisi) wajib SESUDAH hari ini (tidak boleh hari
//    ini atau lewat).
// 4. Rencana tugas akhir (judul) wajib diisi.

import { showError } from "../../lib/info-dialog";

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
  pembimbing?: { id: number; nama?: string; pivot?: { urutan: number } }[];
  moderator_id: number | null;
  judul: string;
  lokasi: string | null;
  tanggal: string | null;
  waktu: string | null;
  namadosenmoderator: string | null;
  ruangan: string | null;
  status: StatusPengajuan;
  catatan: string | null;
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

interface ResubmitKolokiumResponse {
  message: string;
  kolokium: Kolokium;
}

interface ApiErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

// ------------------------------------------------------------------
// BERKAS / SYARAT ADMINISTRASI
// Mengikuti SyaratAdministrasiKolokiumController@SYARAT_MAP di backend.
// key harus persis sama dengan {syaratKey} di route POST /kolokium/{id}/syarat-administrasi/{syaratKey}
// ------------------------------------------------------------------
interface SyaratDefinition {
  key: string;
  label: string;
  accept: string; // dipakai untuk atribut accept pada <input type="file">
  hint: string;   // dipakai untuk keterangan format & ukuran maksimal
}

const SYARAT_LIST: SyaratDefinition[] = [
  { key: "proposal", label: "Proposal yang Disetujui Pembimbing", accept: ".pdf", hint: "PDF, maks. 50MB" },
  { key: "bukti_spp", label: "Bukti Lunas SPP Terbaru", accept: ".pdf", hint: "PDF, maks. 10MB" },
  { key: "transkrip", label: "Transkrip Nilai", accept: ".pdf", hint: "PDF, maks. 10MB" },
  { key: "kartu_kolokium", label: "Kartu Kolokium (min. 10x)", accept: ".pdf,.jpg,.jpeg,.png", hint: "PDF/Gambar, maks. 10MB" },
  { key: "makalah", label: "Makalah Kolokium", accept: ".pdf", hint: "PDF, maks. 50MB" },
];

interface SyaratItem {
  key: string;
  label: string;
  terisi: boolean;
  url: string | null;
  uploaded_at: string | null;
}

interface SyaratAdministrasiResponse {
  message: string;
  status: "belum_lengkap" | "menunggu_verifikasi" | "lengkap" | "ditolak";
  catatan_admin: string | null;
  syarat: SyaratItem[];
}

interface UploadSyaratResponse {
  message: string;
  url: string;
  syarat: SyaratItem[];
}

let syaratData: SyaratAdministrasiResponse | null = null;
const uploadingKeys = new Set<string>();

const SYARAT_STATUS_LABEL: Record<SyaratAdministrasiResponse["status"], string> = {
  belum_lengkap: "Belum Lengkap",
  menunggu_verifikasi: "Menunggu Verifikasi",
  lengkap: "Lengkap",
  ditolak: "Ditolak",
};

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
    window.location.href = "/";
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
// Pesan status (khusus BERHASIL, tetap banner inline seperti sebelumnya)
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
// Tanggal hari ini (lokal browser) dalam format "YYYY-MM-DD", dipakai
// untuk validasi #3 (tanggal kolokium harus sesudah hari ini).
// ------------------------------------------------------------------
function todayLocalISO(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ------------------------------------------------------------------
// Konversi tanggal -> format "YYYY-MM-DD" (untuk <input type="date">)
// ------------------------------------------------------------------
function toDateInputValue(value: string | null): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return "";
}

// ------------------------------------------------------------------
// Konversi waktu -> format "HH:mm" (untuk <input type="time">)
// ------------------------------------------------------------------
function toTimeInputValue(value: string | null): string {
  if (!value) return "";
  const isoMatch = value.match(/^(\d{2}):(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}:${isoMatch[2]}`;
  return "";
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
// Catatan admin: tampil hanya kalau status rejected/approved DAN ada isinya
// ------------------------------------------------------------------
function renderCatatan(kolokium: Kolokium | null): void {
  const wrapper = document.getElementById("catatan-wrapper");
  const textarea = document.getElementById("catatan-textarea") as HTMLTextAreaElement | null;

  if (!wrapper || !textarea) return;

  const status = kolokium?.status ?? null;
  const catatan = kolokium?.catatan ?? null;

  const shouldShow =
    (status === "rejected" || status === "approved") && !!catatan;

  if (shouldShow) {
    textarea.value = catatan as string;
    wrapper.classList.remove("hidden");
  } else {
    textarea.value = "";
    wrapper.classList.add("hidden");
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
  renderCatatan(currentKolokium);
  toggleForm();
  toggleBerkasButton();
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
// Isi form dengan data kolokium sebelumnya (dipakai saat status rejected,
// supaya mahasiswa tahu apa yang sudah pernah diisi & bisa mengedit dari situ)
// ------------------------------------------------------------------
function prefillFormFromKolokium(kolokium: Kolokium): void {
  const utamaSelect = document.getElementById("pembimbing-utama-select") as HTMLSelectElement | null;
  const keduaSelect = document.getElementById("pembimbing-kedua-select") as HTMLSelectElement | null;
  const judulInput = document.getElementById("judul-textarea") as HTMLTextAreaElement | null;
  const lokasiInput = document.getElementById("lokasi-input") as HTMLInputElement | null;
  const tanggalInput = document.getElementById("tanggal-input") as HTMLInputElement | null;
  const waktuInput = document.getElementById("waktu-input") as HTMLInputElement | null;

  if (judulInput) judulInput.value = kolokium.judul ?? "";
  if (lokasiInput) lokasiInput.value = kolokium.lokasi ?? "";
  if (tanggalInput) tanggalInput.value = toDateInputValue(kolokium.tanggal);
  if (waktuInput) waktuInput.value = toTimeInputValue(kolokium.waktu);

  // Pembimbing: butuh relasi "pembimbing" ikut dikirim dari backend
  // (GET /auth/kolokium/my harus eager-load with('pembimbing')).
  const pembimbingList = kolokium.pembimbing ?? [];
  const sorted = [...pembimbingList].sort(
    (a, b) => (a.pivot?.urutan ?? 1) - (b.pivot?.urutan ?? 2)
  );

  const pembimbingUtamaId = sorted[0]?.id ?? null;
  const pembimbingKeduaId = sorted[1]?.id ?? null;

  if (utamaSelect && pembimbingUtamaId) {
    utamaSelect.value = String(pembimbingUtamaId);
  }
  if (keduaSelect && pembimbingKeduaId) {
    keduaSelect.value = String(pembimbingKeduaId);
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
// Validasi form sebelum submit. Return pesan error spesifik (string)
// kalau ada yang gagal, atau null kalau semua valid.
// Catatan: TIDAK ada validasi status/moderator/ruangan di sini karena
// field-field itu tidak diisi oleh mahasiswa (beda dengan form admin).
// ------------------------------------------------------------------
interface FormValues {
  pembimbingUtamaId: number | null;
  pembimbingKeduaId: number | null;
  tanggal: string; // "YYYY-MM-DD" atau ""
  judul: string;
}

function validateForm(values: FormValues): string | null {
  const { pembimbingUtamaId, pembimbingKeduaId, tanggal, judul } = values;

  // 1. Dosen pembimbing utama wajib dipilih
  if (!pembimbingUtamaId) {
    return "Dosen pembimbing utama wajib dipilih.";
  }

  // 2. Dosen pembimbing tidak boleh sama/ganda
  if (pembimbingKeduaId && pembimbingKeduaId === pembimbingUtamaId) {
    return "Dosen pembimbing tidak boleh sama/ganda. Pilih dosen yang berbeda untuk pembimbing kedua.";
  }

  // 3. Tanggal kolokium (kalau diisi) wajib SESUDAH hari ini
  if (tanggal && tanggal <= todayLocalISO()) {
    return "Tanggal kolokium tidak boleh hari ini atau sudah lewat. Pilih tanggal setelah hari ini.";
  }

  // 4. Rencana tugas akhir (judul) wajib diisi
  if (!judul) {
    return "Rencana tugas akhir wajib diisi.";
  }

  return null;
}

// ------------------------------------------------------------------
// Submit form pendaftaran / pengajuan ulang kolokium
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

  const pembimbingUtamaId = utamaSelect?.value ? Number(utamaSelect.value) : null;
  const pembimbingKeduaId = keduaSelect?.value ? Number(keduaSelect.value) : null;
  const tanggal = tanggalInput?.value ?? "";
  const judul = judulInput?.value.trim() ?? "";

  const validationError = validateForm({
    pembimbingUtamaId,
    pembimbingKeduaId,
    tanggal,
    judul,
  });

  if (validationError) {
    showError(validationError);
    return;
  }

  const pembimbingId = [pembimbingUtamaId as number];
  if (pembimbingKeduaId) pembimbingId.push(pembimbingKeduaId);

  const payload: Record<string, unknown> = {
    pembimbing_id: pembimbingId,
    judul,
    lokasi: lokasiInput?.value.trim() || null,
    tanggal: tanggal || null,
    waktu: waktuInput?.value || null,
  };

  // Kalau pengajuan sebelumnya ditolak -> resubmit kolokium yang sama
  // (PATCH ke endpoint resubmit, bukan bikin kolokium baru lewat POST)
  const isResubmit = currentKolokium?.status === "rejected";

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = isResubmit ? "Mengajukan ulang..." : "Mengirim...";
  }

  try {
    if (isResubmit && currentKolokium) {
      await apiFetch<ResubmitKolokiumResponse>(
        `/auth/kolokium/${currentKolokium.id}/resubmit`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        }
      );

      showMessage("Kolokium berhasil diajukan ulang. Menunggu persetujuan panitia.", "success");
    } else {
      await apiFetch<StoreKolokiumResponse>("/auth/kolokium", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      showMessage("Kolokium berhasil diajukan. Menunggu persetujuan panitia.", "success");
    }

    await loadMyKolokium();
  } catch (err) {
    console.error(
      isResubmit ? "Gagal mengajukan ulang kolokium:" : "Gagal mengajukan kolokium:",
      err
    );
    showError(
      err instanceof Error
        ? err.message
        : isResubmit
        ? "Gagal mengajukan ulang kolokium."
        : "Gagal mengajukan kolokium."
    );
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span class="material-symbols-outlined text-sm">save</span> Kirim`;
    }
  }
}

// ------------------------------------------------------------------
// MODAL BERKAS (mahasiswa: lihat status + upload/replace file)
// ------------------------------------------------------------------
function getBerkasModalEls() {
  return {
    overlay: document.getElementById("berkas-modal-overlay"),
    statusEl: document.getElementById("berkas-modal-status"),
    catatanWrapper: document.getElementById("berkas-catatan-wrapper"),
    catatanText: document.getElementById("berkas-catatan-text"),
    body: document.getElementById("berkas-modal-body"),
    closeBtn: document.getElementById("berkas-modal-close-btn"),
    berkasBtn: document.getElementById("berkas-btn"),
  };
}

function renderBerkasModalBody(): void {
  const { body } = getBerkasModalEls();
  if (!body || !syaratData) return;

  body.innerHTML = SYARAT_LIST.map((def) => {
    const item = syaratData!.syarat.find((s) => s.key === def.key);
    const terisi = item?.terisi ?? false;
    const isUploading = uploadingKeys.has(def.key);

    return `
      <div class="border border-outline-variant rounded-lg p-3">
        <div class="flex items-center justify-between gap-2 mb-1">
          <p class="text-body-sm font-medium text-on-surface">${def.label}</p>
          <span class="text-xs font-bold px-2 py-0.5 rounded-full ${
            terisi ? "bg-secondary/20 text-secondary" : "bg-outline/20 text-on-surface-variant"
          }">
            ${terisi ? "Sudah Upload" : "Belum Upload"}
          </span>
        </div>
        <p class="text-xs text-on-surface-variant mb-2">${def.hint}</p>

        <div class="flex items-center gap-2">
          ${
            item?.url
              ? `<a href="${item.url}" target="_blank" rel="noopener" class="text-xs font-medium text-primary hover:underline flex items-center gap-1">
                  <span class="material-symbols-outlined text-[16px]">visibility</span> Lihat Berkas
                </a>`
              : ""
          }
        </div>

        <div class="mt-2 flex items-center gap-2">
          <input
            type="file"
            accept="${def.accept}"
            class="berkas-file-input flex-1 text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-surface-container file:text-on-surface file:text-xs file:font-medium hover:file:bg-surface-container-high"
            data-syarat-key="${def.key}"
            ${isUploading ? "disabled" : ""}
          />
          <button
            type="button"
            class="berkas-upload-btn shrink-0 bg-primary-container hover:bg-primary text-on-primary text-xs font-bold px-3 py-1.5 rounded-md disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            data-syarat-key="${def.key}"
            ${isUploading ? "disabled" : ""}
          >
            ${isUploading ? "Mengupload..." : terisi ? "Ganti" : "Upload"}
          </button>
        </div>
      </div>
    `;
  }).join("");
}

async function fetchSyaratAdministrasi(kolokiumId: number): Promise<void> {
  try {
    const json = await apiFetch<SyaratAdministrasiResponse>(
      `/auth/kolokium/${kolokiumId}/syarat-administrasi`
    );
    syaratData = json;
  } catch (err) {
    console.error("Gagal memuat syarat administrasi:", err);
    syaratData = null;
  }
}

function renderBerkasHeader(): void {
  const { statusEl, catatanWrapper, catatanText } = getBerkasModalEls();
  if (!syaratData) return;

  if (statusEl) {
    statusEl.textContent = `Status: ${SYARAT_STATUS_LABEL[syaratData.status]}`;
  }

  if (catatanWrapper && catatanText) {
    if (syaratData.catatan_admin) {
      catatanText.textContent = syaratData.catatan_admin;
      catatanWrapper.classList.remove("hidden");
    } else {
      catatanWrapper.classList.add("hidden");
    }
  }
}

async function openBerkasModal(): Promise<void> {
  if (!currentKolokium) return;
  const { overlay } = getBerkasModalEls();
  if (!overlay) return;

  await fetchSyaratAdministrasi(currentKolokium.id);
  if (!syaratData) {
    showError("Gagal memuat data berkas syarat administrasi.");
    return;
  }

  renderBerkasHeader();
  renderBerkasModalBody();

  overlay.classList.remove("hidden");
  overlay.classList.add("flex");
}

function closeBerkasModal(): void {
  const { overlay } = getBerkasModalEls();
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.classList.remove("flex");
}

// Update tombol Berkas: cuma tampil kalau mahasiswa sudah punya kolokium
// (belum ada kolokium -> belum ada tempat nyimpen berkas syarat administrasi)
function toggleBerkasButton(): void {
  const { berkasBtn } = getBerkasModalEls();
  if (!berkasBtn) return;

  if (currentKolokium) {
    berkasBtn.classList.remove("hidden");
    berkasBtn.classList.add("inline-flex");
  } else {
    berkasBtn.classList.add("hidden");
    berkasBtn.classList.remove("inline-flex");
  }
}

async function uploadSyaratFile(key: string, file: File): Promise<void> {
  if (!currentKolokium) return;

  uploadingKeys.add(key);
  renderBerkasModalBody();

  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(
      `${API_BASE}/auth/kolokium/${currentKolokium.id}/syarat-administrasi/${key}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` }, // JANGAN set Content-Type, biar browser isi boundary multipart otomatis
        body: formData,
      }
    );

    if (res.status === 401) {
      window.location.href = "/";
      return;
    }

    const json = await res.json();

    if (!res.ok) {
      const err = json as ApiErrorResponse;
      const firstFieldError = err.errors ? Object.values(err.errors)[0]?.[0] : undefined;
      throw new Error(firstFieldError ?? err.message ?? "Upload berkas gagal.");
    }

    const uploadJson = json as UploadSyaratResponse;
    if (syaratData) {
      syaratData.syarat = uploadJson.syarat;
      syaratData.status = "menunggu_verifikasi";
    }

    showMessage(uploadJson.message ?? "Berkas berhasil diupload.", "success");
  } catch (err) {
    console.error("Gagal upload berkas:", err);
    showError(err instanceof Error ? err.message : "Gagal upload berkas.");
  } finally {
    uploadingKeys.delete(key);
    renderBerkasHeader();
    renderBerkasModalBody();
  }
}

function initBerkasModal(): void {
  const { overlay, closeBtn, body, berkasBtn } = getBerkasModalEls();
  if (!overlay || overlay.dataset.bound === "true") return;
  overlay.dataset.bound = "true";

  berkasBtn?.addEventListener("click", openBerkasModal);
  closeBtn?.addEventListener("click", closeBerkasModal);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeBerkasModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeBerkasModal();
  });

  // Klik tombol "Upload"/"Ganti" -> trigger file input pasangannya, lalu upload
  body?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const uploadBtn = target.closest<HTMLElement>(".berkas-upload-btn");
    if (!uploadBtn || uploadBtn.hasAttribute("disabled")) return;

    const key = uploadBtn.dataset.syaratKey;
    if (!key) return;

    const fileInput = body.querySelector<HTMLInputElement>(
      `.berkas-file-input[data-syarat-key="${key}"]`
    );

    if (!fileInput?.files || fileInput.files.length === 0) {
      showError("Pilih file terlebih dahulu sebelum upload.");
      return;
    }

    uploadSyaratFile(key, fileInput.files[0]);
  });
}

// ------------------------------------------------------------------
// Jalankan saat halaman siap
// ------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  clearMessage();
  initBerkasModal();

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

  // Kalau status ditolak, isi ulang form dengan data pengajuan sebelumnya
  // supaya mahasiswa tahu apa yang pernah diisi (tinggal diedit, bukan isi dari nol).
  if (currentKolokium && currentKolokium.status === "rejected") {
    prefillFormFromKolokium(currentKolokium);
  }
});