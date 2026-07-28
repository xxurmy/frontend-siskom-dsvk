// src/scripts/form-update-kolokium.ts
// Logic untuk halaman "Update Kolokium" (form review/approve oleh admin):
// 1) ambil ?id= dari URL -> GET /auth/kolokium/{id} -> isi semua field form
// 2) fetch daftar dosen (GET /auth/dosen) -> isi <select> Pembimbing & Moderator
// 3) submit form -> PATCH /auth/kolokium/{id}
//
// PENTING: semua endpoint di routes/api.php ada di dalam Route::prefix('auth'),
// jadi WAJIB pakai prefix /auth di setiap path.

import TomSelect from "tom-select";
import "tom-select/dist/css/tom-select.css";

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
// Pesan status
// ------------------------------------------------------------------
function showMessage(text: string, variant: "success" | "error"): void {
  const el = document.getElementById("update-kolokium-message");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden", "bg-green-100", "text-green-800", "bg-red-100", "text-red-800");
  el.classList.add(
    ...(variant === "success" 
      ? ["bg-green-100", "text-green-800"] 
      : ["bg-red-100", "text-red-800"])
  );
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

  if (namaInput) namaInput.value = json.nama ?? "";
  if (nimInput) nimInput.value = json.nim ?? "";
  if (prodiInput) prodiInput.value = json.prodi ?? "";
  if (judulInput) judulInput.value = json.judul ?? "";
  if (lokasiInput) lokasiInput.value = json.lokasi ?? "";
  if (ruanganInput) ruanganInput.value = json.ruangan ?? "";

  if (tanggalInput) tanggalInput.value = toDateInputValue(json.tanggal);
  if (waktuInput) waktuInput.value = toTimeInputValue(json.waktu);

  if (statusSelect) {
    statusSelect.value = json.status;
    updateStatusColor(statusSelect);
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

  // Validasi minimal pembimbing utama harus dipilih
  if (!pembimbingUtamaNum) {
    showMessage("Dosen Pembimbing Utama harus dipilih.", "error");
    return;
  }

  const payload: Record<string, unknown> = {
    judul: judulInput?.value.trim() || undefined,
    lokasi: lokasiInput?.value.trim() || null,
    tanggal: tanggalInput?.value || null,
    waktu: waktuInput?.value || null,
    ruangan: ruanganInput?.value.trim() || null,
    moderator_id: moderatorId,
    status: statusSelect?.value ?? undefined,
  };

  // Kirim pembimbing_id dengan array
  payload.pembimbing_id = pembimbingKeduaNum
    ? [pembimbingUtamaNum, pembimbingKeduaNum]
    : [pembimbingUtamaNum];

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
// Main initialization
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
    // Load data kolokium dan daftar dosen secara paralel
    await Promise.all([loadKolokium(kolokiumId), loadDosenOptions()]);
    // Preselect dropdown setelah semua data tersedia
    applyPreselections();
  } catch (err) {
    console.error("Gagal memuat data kolokium:", err);
    showMessage(err instanceof Error ? err.message : "Gagal memuat data kolokium.", "error");
    disableForm();
  }
});