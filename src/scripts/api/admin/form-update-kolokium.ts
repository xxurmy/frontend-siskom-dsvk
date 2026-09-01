// src/scripts/form-update-kolokium.ts
// Logic untuk halaman "Update Kolokium" (form review/approve oleh admin):
// 1) ambil ?id= dari URL -> GET /auth/kolokium/{id} -> isi semua field form
// 2) fetch daftar dosen (GET /auth/dosen) -> isi <select> Pembimbing & Moderator
// 3) submit form -> PATCH /auth/kolokium/{id}
//
// PENTING: semua endpoint di routes/api.php ada di dalam Route::prefix('auth'),
// jadi WAJIB pakai prefix /auth di setiap path.
//
// PESAN BERHASIL/GAGAL: memakai modal InfoModal (src/components/InfoModal.astro)
// lewat helper showSuccess()/showError() di src/scripts/lib/info-dialog.ts,
// BUKAN banner inline #update-kolokium-message lagi — supaya konsisten dengan
// aksi Update/Delete kolokium lain di sisi admin.
//
// VALIDASI SEBELUM SUBMIT (client-side, sebelum request PATCH dikirim):
// 1. Dosen pembimbing utama wajib dipilih.
// 2. Dosen pembimbing utama & kedua tidak boleh sama/ganda.
// 3. Tanggal kolokium wajib SESUDAH hari ini (tidak boleh hari ini atau lewat).
// 4. Dosen moderator tidak boleh sama dengan dosen pembimbing (utama/kedua).
// 5. Dosen moderator & ruangan wajib diisi jika status "approved".
// 6. Catatan wajib diisi jika status "rejected" (opsional untuk status lain).
// Semua pesan validasi ini spesifik per kasus, ditampilkan lewat showError().

import TomSelect from "tom-select";
import "tom-select/dist/css/tom-select.css";
import { showError, showSuccess } from "../../lib/info-dialog";

// ------------------------------------------------------------------
// Konfigurasi
// ------------------------------------------------------------------
const API_BASE: string = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token";

// ------------------------------------------------------------------
// Tipe data
// ------------------------------------------------------------------
type StatusPengajuan = "pending" | "approved" | "rejected";

interface UserOption {
  id: number;
  nama: string;
  nim?: string | null;
  nip?: string | null;
}

interface UserOptionListResponse {
  message: string;
  users: UserOption[];
}

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

interface UpdateKolokiumResponse {
  message: string;
  kolokium: Kolokium;
}

interface ApiErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

// ------------------------------------------------------------------
// BERKAS / SYARAT ADMINISTRASI (Admin: lihat & verifikasi)
// Mengikuti SyaratAdministrasiKolokiumController@SYARAT_MAP di backend.
// ------------------------------------------------------------------
interface SyaratDefinition {
  key: string;
  label: string;
}

const SYARAT_LIST: SyaratDefinition[] = [
  { key: "proposal", label: "Proposal yang Disetujui Pembimbing" },
  { key: "bukti_spp", label: "Bukti Lunas SPP Terbaru" },
  { key: "transkrip", label: "Transkrip Nilai" },
  { key: "kartu_kolokium", label: "Kartu Kolokium (min. 10x)" },
  { key: "makalah", label: "Makalah Kolokium" },
];

interface SyaratItem {
  key: string;
  label: string;
  terisi: boolean;
  url: string | null;
  uploaded_at: string | null;
}

type SyaratStatus = "belum_lengkap" | "menunggu_verifikasi" | "lengkap" | "ditolak";

interface SyaratAdministrasiResponse {
  message: string;
  status: SyaratStatus;
  catatan_admin: string | null;
  syarat: SyaratItem[];
}

interface VerifySyaratResponse {
  message: string;
  syarat: {
    id: number;
    kolokium_id: number;
    status: SyaratStatus;
    catatan_admin: string | null;
  };
}

let syaratData: SyaratAdministrasiResponse | null = null;
const viewingKeys = new Set<string>(); // dipakai buat loading state tombol "Lihat"

// ------------------------------------------------------------------
// State halaman
// ------------------------------------------------------------------
let kolokiumId: number | null = null;
let currentKolokium: Kolokium | null = null;
let dosenOptions: UserOption[] = [];

// ------------------------------------------------------------------
// Helper fetch
// ------------------------------------------------------------------
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API_BASE}${path}`, {
    // cache: "no-store" -> jangan pernah sajikan response GET (mis. status
    // syarat administrasi) dari cache browser, selalu ambil data terbaru
    // dari server. Bisa dioverride oleh init.cache kalau caller butuh beda.
    cache: "no-store",
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

// ------------------------------------------------------------------
// Konversi tanggal -> format "YYYY-MM-DD"
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
// Konversi waktu -> format "HH:mm"
// ------------------------------------------------------------------
function toTimeInputValue(value: string | null): string {
  if (!value) return "";

  const isoMatch = value.match(/^(\d{2}):(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}:${isoMatch[2]}`;

  const ampmMatch = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2];
    const period = ampmMatch[3].toUpperCase();
    if (period === "AM" && hours === 12) hours = 0;
    if (period === "PM" && hours !== 12) hours += 12;
    return `${String(hours).padStart(2, "0")}:${minutes}`;
  }

  return "";
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

// ------------------------------------------------------------------
// Tampilkan tanda wajib (*) pada label Catatan saat status = rejected
// ------------------------------------------------------------------
function updateCatatanRequiredMark(status: StatusPengajuan): void {
  const mark = document.getElementById("catatan-required-mark");
  if (!mark) return;

  if (status === "rejected") {
    mark.classList.remove("hidden");
  } else {
    mark.classList.add("hidden");
  }
}

function initStatusSelect(): void {
  const statusSelect = document.getElementById("status_kolokium") as HTMLSelectElement | null;
  if (!statusSelect) return;

  updateStatusColor(statusSelect);
  updateCatatanRequiredMark(statusSelect.value as StatusPengajuan);

  statusSelect.addEventListener("change", () => {
    updateStatusColor(statusSelect);
    updateCatatanRequiredMark(statusSelect.value as StatusPengajuan);
  });
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
// Kunci seluruh form
// ------------------------------------------------------------------
function disableForm(): void {
  const form = document.getElementById("form-update-kolokium") as HTMLFormElement | null;
  form?.querySelectorAll("input, select, textarea, button").forEach((el) => {
    (el as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = true;
  });
}

// ------------------------------------------------------------------
// Helper untuk mendapatkan nama dosen dari ID
// ------------------------------------------------------------------
function getDosenNameById(dosenId: number | null | undefined): string | null {
  if (!dosenId) return null;
  const dosen = dosenOptions.find((d) => d.id === dosenId);
  return dosen ? dosen.nama : null;
}

// ------------------------------------------------------------------
// Muat detail kolokium -> isi semua field form
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
  const catatanInput = document.getElementById("input-catatan") as HTMLTextAreaElement | null;

  if (namaInput) namaInput.value = json.nama ?? "";
  if (nimInput) nimInput.value = json.nim ?? "";
  if (prodiInput) prodiInput.value = json.prodi ?? "";
  if (judulInput) judulInput.value = json.judul ?? "";
  if (lokasiInput) lokasiInput.value = json.lokasi ?? "";
  if (ruanganInput) ruanganInput.value = json.ruangan ?? "";
  if (catatanInput) catatanInput.value = json.catatan ?? "";

  if (tanggalInput) tanggalInput.value = toDateInputValue(json.tanggal);
  if (waktuInput) waktuInput.value = toTimeInputValue(json.waktu);

  if (statusSelect) {
    statusSelect.value = json.status;
    updateStatusColor(statusSelect);
    updateCatatanRequiredMark(json.status);
  }
}

// ------------------------------------------------------------------
// Preselect <select> setelah opsi-opsi sudah terisi
// ------------------------------------------------------------------
function applyPreselections(): void {
  if (!currentKolokium) return;

  // Preselect moderator
  selectAndUpdatePlaceholder("select-moderator", currentKolokium.moderator_id, "-- Pilih Dosen Moderator --");

  // Preselect pembimbing jika data tersedia dari backend
  if (currentKolokium.pembimbing && currentKolokium.pembimbing.length > 0) {
    const sorted = [...currentKolokium.pembimbing].sort(
      (a, b) => (a.pivot?.urutan ?? 1) - (b.pivot?.urutan ?? 2)
    );

    const pembimbingUtamaId = sorted[0]?.id ?? null;
    const pembimbingKeduaId = sorted[1]?.id ?? null;

    // Preselect dan update placeholder untuk pembimbing utama
    selectAndUpdatePlaceholder(
      "select-pembimbing-utama",
      pembimbingUtamaId,
      "-- Pilih Dosen Pembimbing Utama --"
    );

    // Preselect dan update placeholder untuk pembimbing kedua
    selectAndUpdatePlaceholder(
      "select-pembimbing-kedua",
      pembimbingKeduaId,
      "-- Pilih Dosen Pembimbing Kedua --"
    );
  }
}

function selectAndUpdatePlaceholder(
  selectId: string,
  value: number | null | undefined,
  defaultPlaceholder: string
): void {
  const select = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!select) return;

  const tomSelectInstance = (select as any).tomselect;
  if (!tomSelectInstance) return;

  // Jika ada value (dosen sudah dipilih)
  if (value != null) {
    // Set value
    tomSelectInstance.setValue(String(value));

    // Cari nama dosen dari dosenOptions
    const dosenName = getDosenNameById(value);

    if (dosenName) {
      // Update placeholder text melalui DOM langsung
      const placeholderEl = tomSelectInstance.control.querySelector('.ts-placeholder') as HTMLElement;
      if (placeholderEl) {
        placeholderEl.textContent = dosenName;
      }

      // Update settings placeholder
      tomSelectInstance.settings.placeholder = dosenName;

      // Update option placeholder di select asli
      const placeholderOpt = select.querySelector('option[value=""]') as HTMLOptionElement | null;
      if (placeholderOpt) {
        placeholderOpt.textContent = dosenName;
        placeholderOpt.disabled = true; // Disable karena sudah ada value
      }
    }
  } else {
    // Reset ke placeholder default
    const placeholderEl = tomSelectInstance.control.querySelector('.ts-placeholder') as HTMLElement;
    if (placeholderEl) {
      placeholderEl.textContent = defaultPlaceholder;
    }

    tomSelectInstance.settings.placeholder = defaultPlaceholder;

    const placeholderOpt = select.querySelector('option[value=""]') as HTMLOptionElement | null;
    if (placeholderOpt) {
      placeholderOpt.textContent = defaultPlaceholder;
      placeholderOpt.disabled = false;
    }
  }
}

// ------------------------------------------------------------------
// Muat daftar dosen -> isi select Pembimbing & Moderator
// ------------------------------------------------------------------
async function loadDosenOptions(): Promise<void> {
  const json = await apiFetch<UserOptionListResponse>("/auth/dosen");
  dosenOptions = json?.users ?? [];

  const optionsHtml = dosenOptions
    .map(
      (d) =>
        `<option value="${d.id}">${d.nama}${d.nip ? ` (NIP: ${d.nip})` : ""}</option>`
    )
    .join("");

  // Konfigurasi untuk setiap select dosen dengan placeholder
  const selectConfigs = [
    {
      id: "select-pembimbing-utama",
      defaultPlaceholder: "-- Pilih Dosen Pembimbing Utama --",
    },
    {
      id: "select-pembimbing-kedua",
      defaultPlaceholder: "-- Pilih Dosen Pembimbing Kedua --",
    },
    {
      id: "select-moderator",
      defaultPlaceholder: "-- Pilih Dosen Moderator --",
    },
  ];

  selectConfigs.forEach((config) => {
    const el = document.getElementById(config.id) as HTMLSelectElement | null;
    if (!el) return;

    // Set innerHTML dengan placeholder default di awal
    el.innerHTML = `<option value="">${config.defaultPlaceholder}</option>${optionsHtml}`;

    // Inisialisasi TomSelect dengan konfigurasi
    new TomSelect(el, {
      create: false,
      searchField: ["text"],
      maxOptions: 100,
      sortField: [
        {
          field: "text",
          direction: "asc",
        },
      ],
      placeholder: config.defaultPlaceholder,
      onItemAdd: function(this: any, value: string) {
        // Disable placeholder option saat ada item yang dipilih
        const placeholderOpt = el.querySelector('option[value=""]') as HTMLOptionElement | null;
        if (placeholderOpt) {
          placeholderOpt.disabled = true;
        }

        // Update placeholder dengan nama dosen yang dipilih
        const dosenId = parseInt(value);
        const dosenName = getDosenNameById(dosenId);
        if (dosenName) {
          this.settings.placeholder = dosenName;
          // Update DOM placeholder
          const placeholderEl = this.control.querySelector('.ts-placeholder') as HTMLElement;
          if (placeholderEl) {
            placeholderEl.textContent = dosenName;
          }
          if (placeholderOpt) {
            placeholderOpt.textContent = dosenName;
          }
        }
      },
      onItemRemove: function(this: any) {
        // Enable kembali placeholder option jika tidak ada item yang dipilih
        if (this.items.length === 0) {
          const placeholderOpt = el.querySelector('option[value=""]') as HTMLOptionElement | null;
          if (placeholderOpt) {
            placeholderOpt.disabled = false;
            placeholderOpt.textContent = config.defaultPlaceholder;
          }
          this.settings.placeholder = config.defaultPlaceholder;
          // Update DOM placeholder
          const placeholderEl = this.control.querySelector('.ts-placeholder') as HTMLElement;
          if (placeholderEl) {
            placeholderEl.textContent = config.defaultPlaceholder;
          }
        }
      },
    });
  });
}

// ------------------------------------------------------------------
// Validasi form sebelum submit. Return pesan error spesifik (string)
// kalau ada yang gagal, atau null kalau semua valid.
// ------------------------------------------------------------------
interface FormValues {
  pembimbingUtamaId: number | null;
  pembimbingKeduaId: number | null;
  tanggal: string; // "YYYY-MM-DD" atau ""
  moderatorId: number | null;
  ruangan: string;
  status: StatusPengajuan;
  catatan: string;
}

function validateForm(values: FormValues): string | null {
  const { pembimbingUtamaId, pembimbingKeduaId, tanggal, moderatorId, ruangan, status, catatan } = values;

  // 1. Dosen pembimbing (utama) wajib dipilih
  if (!pembimbingUtamaId) {
    return "Dosen pembimbing wajib dipilih.";
  }

  // 2. Dosen pembimbing tidak boleh sama/ganda
  if (pembimbingKeduaId && pembimbingKeduaId === pembimbingUtamaId) {
    return "Dosen pembimbing tidak boleh sama/ganda. Pilih dosen yang berbeda untuk pembimbing kedua.";
  }

  // 3. Tanggal kolokium harus SESUDAH hari ini (tidak boleh hari ini atau lewat)
  if (!tanggal) {
    return "Tanggal kolokium wajib diisi.";
  }
  if (tanggal <= todayLocalISO()) {
    return "Tanggal kolokium tidak boleh hari ini atau sudah lewat. Pilih tanggal setelah hari ini.";
  }

  // 5. Moderator & ruangan pada dasarnya boleh kosong, TAPI wajib diisi
  //    begitu admin mengubah status kolokium menjadi "approved".
  if (status === "approved") {
    if (!moderatorId) {
      return "Dosen moderator wajib diisi untuk kolokium yang disetujui (approved).";
    }
    if (!ruangan) {
      return "Ruangan wajib diisi untuk kolokium yang disetujui (approved).";
    }
  }

  // 4. Kalau moderator sudah diisi (baik karena wajib approved atau opsional
  //    di status lain), moderator tidak boleh sama dengan dosen pembimbing.
  if (moderatorId && (moderatorId === pembimbingUtamaId || moderatorId === pembimbingKeduaId)) {
    return "Dosen moderator tidak boleh sama dengan dosen pembimbing.";
  }

  // 6. Catatan wajib diisi jika status ditolak (rejected). Opsional untuk
  //    status lain (pending/approved).
  if (status === "rejected" && !catatan) {
    return "Catatan wajib diisi jika kolokium ditolak.";
  }

  return null;
}

// ------------------------------------------------------------------
// Submit form -> PATCH /auth/kolokium/{id}
// ------------------------------------------------------------------
async function handleSubmit(e: SubmitEvent): Promise<void> {
  e.preventDefault();

  if (!kolokiumId) {
    showError("ID Kolokium tidak ditemukan, tidak bisa menyimpan perubahan.");
    return;
  }

  const utamaSelect = document.getElementById("select-pembimbing-utama") as HTMLSelectElement | null;
  const keduaSelect = document.getElementById("select-pembimbing-kedua") as HTMLSelectElement | null;
  const judulInput = document.getElementById("input-judul") as HTMLTextAreaElement | null;
  const lokasiInput = document.getElementById("input-lokasi") as HTMLInputElement | null;
  const tanggalInput = document.getElementById("input-tanggal") as HTMLInputElement | null;
  const waktuInput = document.getElementById("input-waktu") as HTMLInputElement | null;
  const moderatorSelect = document.getElementById("select-moderator") as HTMLSelectElement | null;
  const ruanganInput = document.getElementById("input-ruangan") as HTMLInputElement | null;
  const statusSelect = document.getElementById("status_kolokium") as HTMLSelectElement | null;
  const catatanInput = document.getElementById("input-catatan") as HTMLTextAreaElement | null;
  const submitBtn = document.getElementById("btn-submit-kolokium") as HTMLButtonElement | null;

  const pembimbingUtamaId = utamaSelect?.value ? Number(utamaSelect.value) : null;
  const pembimbingKeduaId = keduaSelect?.value ? Number(keduaSelect.value) : null;
  const moderatorId = moderatorSelect?.value ? Number(moderatorSelect.value) : null;
  const tanggal = tanggalInput?.value ?? "";
  const ruangan = ruanganInput?.value.trim() ?? "";
  const status = (statusSelect?.value as StatusPengajuan) ?? "pending";
  const catatan = catatanInput?.value.trim() ?? "";

  const validationError = validateForm({
    pembimbingUtamaId,
    pembimbingKeduaId,
    tanggal,
    moderatorId,
    ruangan,
    status,
    catatan,
  });

  if (validationError) {
    showError(validationError);
    return;
  }

  const payload: Record<string, unknown> = {
    judul: judulInput?.value.trim() || undefined,
    lokasi: lokasiInput?.value.trim() || null,
    tanggal: tanggal || null,
    waktu: waktuInput?.value || null,
    ruangan: ruangan || null,
    moderator_id: moderatorId,
    status: statusSelect?.value ?? undefined,
    catatan: catatan || null,
  };

  // Kirim pembimbing_id dengan array
  payload.pembimbing_id = pembimbingKeduaId
    ? [pembimbingUtamaId, pembimbingKeduaId]
    : [pembimbingUtamaId];

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
      await loadKolokium(kolokiumId!);
      applyPreselections();
      showSuccess(json.message ?? "Kolokium berhasil diperbarui.");
    }
  } catch (err) {
    console.error("Gagal memperbarui kolokium:", err);
    showError(err instanceof Error ? err.message : "Gagal memperbarui kolokium.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span class="material-symbols-outlined text-sm">save</span> Update`;
    }
  }
}

// ------------------------------------------------------------------
// MODAL BERKAS (admin: lihat berkas + ubah status verifikasi & catatan)
// ------------------------------------------------------------------
function getBerkasModalEls() {
  return {
    overlay: document.getElementById("berkas-modal-overlay"),
    body: document.getElementById("berkas-modal-body"),
    closeBtn: document.getElementById("berkas-modal-close-btn"),
    berkasBtn: document.getElementById("berkas-btn"),
    statusSelect: document.getElementById("berkas-verify-status") as HTMLSelectElement | null,
    catatanInput: document.getElementById("berkas-verify-catatan") as HTMLTextAreaElement | null,
    submitBtn: document.getElementById("berkas-verify-submit-btn") as HTMLButtonElement | null,
  };
}

function renderBerkasModalBody(): void {
  const { body } = getBerkasModalEls();
  if (!body || !syaratData) return;

  body.innerHTML = SYARAT_LIST.map((def) => {
    const item = syaratData!.syarat.find((s) => s.key === def.key);
    const terisi = item?.terisi ?? false;

    return `
      <div class="flex items-center justify-between gap-3 border border-outline-variant rounded-lg px-3 py-2.5">
        <div>
          <p class="text-body-sm font-medium text-on-surface">${def.label}</p>
          <span class="text-xs font-bold ${terisi ? "text-secondary" : "text-on-surface-variant"}">
            ${terisi ? "Sudah Diupload" : "Belum Diupload"}
          </span>
        </div>
        ${
          item?.url
            ? `<button
                type="button"
                class="berkas-view-btn shrink-0 text-xs font-bold text-primary hover:underline flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                data-syarat-key="${def.key}"
                ${viewingKeys.has(def.key) ? "disabled" : ""}
              >
                <span class="material-symbols-outlined text-[16px]">visibility</span>
                ${viewingKeys.has(def.key) ? "Membuka..." : "Lihat"}
              </button>`
            : `<span class="shrink-0 text-xs text-on-surface-variant">-</span>`
        }
      </div>
    `;
  }).join("");
}

async function fetchSyaratAdministrasi(id: number): Promise<void> {
  try {
    const json = await apiFetch<SyaratAdministrasiResponse>(
      `/auth/kolokium/${id}/syarat-administrasi`
    );
    syaratData = json;
  } catch (err) {
    console.error("Gagal memuat syarat administrasi:", err);
    syaratData = null;
  }
}

async function openBerkasModal(): Promise<void> {
  if (!kolokiumId) return;
  const { overlay, statusSelect, catatanInput } = getBerkasModalEls();
  if (!overlay) return;

  await fetchSyaratAdministrasi(kolokiumId);
  if (!syaratData) {
    showError("Gagal memuat data berkas syarat administrasi.");
    return;
  }

  renderBerkasModalBody();

  if (statusSelect) statusSelect.value = syaratData.status;
  if (catatanInput) catatanInput.value = syaratData.catatan_admin ?? "";

  overlay.classList.remove("hidden");
  overlay.classList.add("flex");
}

function closeBerkasModal(): void {
  const { overlay } = getBerkasModalEls();
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.classList.remove("flex");
}

async function submitVerifikasi(): Promise<void> {
  if (!kolokiumId) return;
  const { statusSelect, catatanInput, submitBtn } = getBerkasModalEls();

  const status = statusSelect?.value as SyaratStatus | undefined;
  const catatan = catatanInput?.value.trim() ?? "";

  if (!status) {
    showError("Status verifikasi wajib dipilih.");
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Menyimpan...";
  }

  try {
    const json = await apiFetch<VerifySyaratResponse>(
      `/auth/kolokium/${kolokiumId}/syarat-administrasi/verify`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status,
          catatan_admin: catatan || null,
        }),
      }
    );

    if (json) {
      showSuccess(json.message ?? "Status verifikasi berhasil diperbarui.");
      if (syaratData) {
        syaratData.status = json.syarat.status;
        syaratData.catatan_admin = json.syarat.catatan_admin;
      }
    }
  } catch (err) {
    console.error("Gagal memperbarui status verifikasi:", err);
    showError(err instanceof Error ? err.message : "Gagal memperbarui status verifikasi.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span class="material-symbols-outlined text-sm">check_circle</span> Simpan Status Verifikasi`;
    }
  }
}

// Buka file syarat administrasi lewat endpoint ber-auth (bukan link publik lagi,
// karena backend sekarang simpan file di storage lokal disk 'private').
async function viewBerkasFile(key: string): Promise<void> {
  if (!kolokiumId) return;

  viewingKeys.add(key);
  renderBerkasModalBody();

  try {
    const token = localStorage.getItem(TOKEN_KEY);

    const res = await fetch(
      `${API_BASE}/auth/kolokium/${kolokiumId}/syarat-administrasi/${key}/file`,
      {
        // cache: "no-store" -> paksa browser selalu ambil dari server, jangan
        // sajikan blob lama dari cache lokal saat file baru saja di-replace
        // lewat upload ulang (lapis pengaman tambahan selain header
        // Cache-Control di backend).
        cache: "no-store",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      }
    );

    if (res.status === 401) {
      window.location.href = "/";
      return;
    }

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as ApiErrorResponse;
      throw new Error(err.message ?? "Gagal membuka berkas.");
    }

    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    window.open(blobUrl, "_blank", "noopener");

    setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
  } catch (err) {
    console.error("Gagal membuka berkas:", err);
    showError(err instanceof Error ? err.message : "Gagal membuka berkas.");
  } finally {
    viewingKeys.delete(key);
    renderBerkasModalBody();
  }
}

function initBerkasModal(): void {
  const { overlay, closeBtn, berkasBtn, submitBtn, body } = getBerkasModalEls();
  if (!overlay || overlay.dataset.bound === "true") return;
  overlay.dataset.bound = "true";

  berkasBtn?.addEventListener("click", openBerkasModal);
  closeBtn?.addEventListener("click", closeBerkasModal);
  submitBtn?.addEventListener("click", submitVerifikasi);

  // Klik tombol "Lihat" -> buka file lewat endpoint ber-auth
  body?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const viewBtn = target.closest<HTMLElement>(".berkas-view-btn");
    if (!viewBtn || viewBtn.hasAttribute("disabled")) return;

    const key = viewBtn.dataset.syaratKey;
    if (!key) return;

    viewBerkasFile(key);
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeBerkasModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeBerkasModal();
  });
}

function initForm(): void {
  const form = document.getElementById("form-update-kolokium") as HTMLFormElement | null;
  form?.addEventListener("submit", handleSubmit);
}

// ------------------------------------------------------------------
// Main initialization
// ------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  initStatusSelect();
  initForm();
  initBerkasModal();

  kolokiumId = getKolokiumIdFromUrl();
  if (!kolokiumId) {
    showError("ID Kolokium tidak ditemukan di URL (contoh: ?id=1).");
    disableForm();
    return;
  }

  try {
    // Load data kolokium dan daftar dosen secara paralel
    await Promise.all([loadKolokium(kolokiumId), loadDosenOptions()]);
    // Preselect dropdown setelah semua data tersedia
    applyPreselections();
  } catch (err) {
    console.error("Gagal memuat data kolokium:", err);
    showError(err instanceof Error ? err.message : "Gagal memuat data kolokium.");
    disableForm();
  }
});