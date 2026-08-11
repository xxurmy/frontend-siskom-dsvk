// src/scripts/api/dosen/absensi-seminar.ts
// Halaman Absensi Seminar — dibuka dari tombol "Absensi" di Jadwal Seminar
// dosen (?seminar_id=...). Menampilkan info seminar + daftar peserta forum
// (kartu seminar) yang statusparaf-nya bisa ditandai Hadir/Tidak Hadir,
// lalu disimpan sekaligus lewat tombol "Simpan" (bulk update).
//
// GET  /auth/seminar/{id}                       -> info seminar (header halaman)
// GET  /auth/kartu-seminar/seminar/{seminarId} -> daftar peserta (tidak dipaginate)
// PATCH /auth/kartu-seminar/bulk-status-paraf    -> simpan perubahan status paraf
//
// Aturan tombol aksi sama dengan halaman Kartu Seminar:
// - Belum hari-H -> kedua tombol (Hadir/Tidak Hadir) disabled.
// - Sudah hari-H:
//   - pending -> keduanya aktif
//   - absent  -> "Hadir" (signed) tetap aktif, mahasiswa masih bisa
//                diubah dari absent -> signed
//   - signed  -> status final, keduanya hilang
//
// Perubahan yang dipilih di tabel disimpan dulu sebagai state lokal
// (belum dikirim ke server) sampai tombol "Simpan" ditekan, supaya dosen
// bisa menandai banyak peserta sekaligus baru submit satu kali.

import { confirmDialog } from "../../lib/confirm-dialog";

interface KartuSeminar {
  id: number;
  seminar_id: number;
  pemrasaran_id: number;
  moderator_id: number;
  peserta_seminar_id: number;
  forum_id: number;
  tanggal: string | null;
  waktu: string | null;
  namapemrasaran: string | null;
  nimpemrasaran: string | null;
  prodi: string | null;
  moderator: string | null;
  namaforum?: string | null;
  nimforum?: string | null;
  tandatangandosen: string | null;
  statusparaf: "pending" | "signed" | "absent";
}

interface KartuSeminarListResponse {
  message: string;
  kartu_seminars: KartuSeminar[];
}

interface SeminarInfo {
  id: number;
  nama: string;
  nim: string;
  prodi: string;
  judul: string;
  tanggal: string | null;
  waktu: string | null;
  ruangan: string | null;
  namadosenpembimbing: string | null;
  namadosenmoderator: string | null;
  jumlahforum: number;
  [key: string]: unknown;
}

interface BulkUpdateResponse {
  message: string;
  updated: KartuSeminar[];
  errors: { id: number; message: string }[];
}

interface ApiErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

type PendingStatus = "signed" | "absent";

const API_BASE_URL = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token";
const TBODY_ID = "absensi-tbody";
const COLSPAN = 6;

const STATUS_LABEL: Record<KartuSeminar["statusparaf"], string> = {
  pending: "Belum ditanda tangani",
  signed: "Sudah ditanda tangan",
  absent: "Tidak Hadir",
};

const STATUS_BADGE_CLASS: Record<KartuSeminar["statusparaf"], string> = {
  pending: "bg-outline/10 text-on-surface-variant border border-outline/20",
  signed: "bg-secondary/10 text-secondary border border-secondary/20",
  absent: "bg-error/10 text-error border border-error/20",
};

let seminarId: string | null = null;
let items: KartuSeminar[] = [];
// Perubahan lokal yang belum disimpan: id kartu seminar -> status pilihan dosen
const pendingChanges = new Map<number, PendingStatus>();

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

function getSeminarIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("seminar_id");
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function formatTanggal(dateStr: string | null): string {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatWaktu(waktu: string | null): string {
  if (!waktu) return "-";
  return waktu.slice(0, 5); // "14:00:00" -> "14:00"
}

// Aktif kalau hari ini >= tanggal seminar (konsisten dengan validasi
// backend KartuSeminarController::updateStatusParaf / bulkUpdateStatusParaf).
function isBeforeHariH(tanggal: string | null): boolean {
  if (!tanggal) return true;

  const tanggalSeminar = new Date(tanggal);
  if (Number.isNaN(tanggalSeminar.getTime())) return true;
  tanggalSeminar.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return today.getTime() < tanggalSeminar.getTime();
}

// ------------------------------------------------------------------
// Pesan status
// ------------------------------------------------------------------
function showMessage(text: string, variant: "success" | "error"): void {
  const el = document.getElementById("absensi-message");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden", "bg-green-100", "text-green-800", "bg-red-100", "text-red-800");
  el.classList.add(variant === "success" ? "bg-green-100" : "bg-red-100", variant === "success" ? "text-green-800" : "text-red-800");
}

function clearMessage(): void {
  const el = document.getElementById("absensi-message");
  if (!el) return;
  el.classList.add("hidden");
  el.textContent = "";
}

function renderMessageRow(message: string, variant: "info" | "error" = "info"): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;
  const colorClass = variant === "error" ? "text-error" : "text-on-surface-variant";
  tbody.innerHTML = `
    <tr>
      <td colspan="${COLSPAN}" class="px-4 py-8 text-center text-body-sm ${colorClass}">
        ${escapeHtml(message)}
      </td>
    </tr>
  `;
}

// ------------------------------------------------------------------
// Info seminar (header halaman)
// ------------------------------------------------------------------
function renderSeminarInfo(info: SeminarInfo): void {
  const container = document.getElementById("seminar-info");
  if (!container) return;

  const rows: [string, string][] = [
    ["Judul", info.judul ?? "-"],
    ["Nama Pemrasaran", `${info.nama ?? "-"} (${info.nim ?? "-"})`],
    ["Prodi", info.prodi ?? "-"],
    ["Tanggal", formatTanggal(info.tanggal)],
    ["Waktu", formatWaktu(info.waktu)],
    ["Ruangan", info.ruangan ?? "-"],
    ["Dosen Pembimbing", info.namadosenpembimbing ?? "-"],
    ["Moderator", info.namadosenmoderator ?? "-"],
    ["Jumlah Forum", String(info.jumlahforum ?? 0)],
  ];

  container.innerHTML = rows
    .map(
      ([label, value]) => `
        <div>
          <p class="text-label-sm text-on-surface-variant uppercase tracking-wide">${label}</p>
          <p class="text-body-sm font-medium">${escapeHtml(value)}</p>
        </div>
      `
    )
    .join("");
}

async function loadSeminarInfo(): Promise<void> {
  const token = getToken();
  if (!token || !seminarId) return;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/seminar/${seminarId}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (redirectIfUnauthorized(res.status)) return;

    if (!res.ok) {
      const container = document.getElementById("seminar-info");
      if (container) {
        container.innerHTML = `<p class="text-body-sm text-error col-span-full">Gagal memuat informasi seminar.</p>`;
      }
      return;
    }

    const info: SeminarInfo = await res.json();
    renderSeminarInfo(info);
  } catch (err) {
    console.error("Gagal ambil info seminar:", err);
    const container = document.getElementById("seminar-info");
    if (container) {
      container.innerHTML = `<p class="text-body-sm text-error col-span-full">Terjadi kesalahan jaringan.</p>`;
    }
  }
}

// ------------------------------------------------------------------
// Tabel peserta
// ------------------------------------------------------------------
function currentDisplayStatus(item: KartuSeminar): KartuSeminar["statusparaf"] {
  const pending = pendingChanges.get(item.id);
  if (!pending) return item.statusparaf;
  return pending;
}

function renderActionButtons(item: KartuSeminar): string {
  if (item.statusparaf === "signed") {
    return `<span class="text-body-sm text-on-surface-variant">-</span>`;
  }

  const belumHariH = isBeforeHariH(item.tanggal);
  const disabledClass = "opacity-40 cursor-not-allowed";
  const selected = pendingChanges.get(item.id);

  const hadirActiveClass = selected === "signed" ? "bg-secondary text-white" : "text-secondary hover:bg-secondary/10";
  const absentActiveClass = selected === "absent" ? "bg-error text-white" : "text-error hover:bg-error/10";

  const hadirTitle = belumHariH ? "Belum bisa ditandai — tunggu sampai hari-H seminar" : "Hadir";

  let html = `
    <button
      type="button"
      class="absensi-hadir-btn rounded-lg px-3 py-1.5 text-body-sm font-bold transition-colors flex items-center gap-1 ${hadirActiveClass} ${belumHariH ? disabledClass : ""}"
      title="${hadirTitle}"
      data-id="${item.id}"
      ${belumHariH ? "disabled" : ""}
    >
      <span class="material-symbols-outlined text-[16px]">check_circle</span>
      Hadir
    </button>
  `;

  if (item.statusparaf !== "absent" || selected === undefined || selected !== "absent") {
    const absentTitle = belumHariH ? "Belum bisa ditandai — tunggu sampai hari-H seminar" : "Tidak Hadir";

    html += `
      <button
        type="button"
        class="absensi-tidakhadir-btn rounded-lg px-3 py-1.5 text-body-sm font-bold transition-colors flex items-center gap-1 ${absentActiveClass} ${belumHariH ? disabledClass : ""}"
        title="${absentTitle}"
        data-id="${item.id}"
        ${belumHariH ? "disabled" : ""}
      >
        <span class="material-symbols-outlined text-[16px]">cancel</span>
        Tidak Hadir
      </button>
    `;
  }

  return html;
}

function renderRow(item: KartuSeminar, index: number): string {
  const displayStatus = currentDisplayStatus(item);
  const hasPendingChange = pendingChanges.has(item.id);

  return `
    <tr class="table-row-hover transition-colors ${hasPendingChange ? "bg-primary-container/10" : ""}" data-row-id="${item.id}">
      <td class="px-4 py-4 text-body-sm">${index + 1}</td>
      <td class="px-4 py-4 text-body-sm font-medium">${escapeHtml(item.namaforum ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm">${escapeHtml(item.nimforum ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.prodi ?? "-")}</td>
      <td class="px-4 py-4">
        <span class="${STATUS_BADGE_CLASS[displayStatus]} px-3 py-1 rounded-full text-[12px] font-bold whitespace-nowrap">
          ${STATUS_LABEL[displayStatus]}${hasPendingChange ? " (belum disimpan)" : ""}
        </span>
      </td>
      <td class="px-4 py-4">
        <div class="flex justify-center gap-2">
          ${renderActionButtons(item)}
        </div>
      </td>
    </tr>
  `;
}

function renderTable(): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;

  if (items.length === 0) {
    renderMessageRow("Belum ada peserta yang terdaftar hadir pada seminar ini.");
    return;
  }

  tbody.innerHTML = items.map((item, index) => renderRow(item, index)).join("");
}

function updateSaveButtonState(): void {
  const btn = document.getElementById("absensi-save-btn") as HTMLButtonElement | null;
  const info = document.getElementById("absensi-info");
  if (btn) btn.disabled = pendingChanges.size === 0;
  if (info) {
    info.textContent =
      pendingChanges.size > 0
        ? `${pendingChanges.size} perubahan belum disimpan.`
        : "\u00A0";
  }
}

// ------------------------------------------------------------------
// Fetch peserta
// ------------------------------------------------------------------
async function loadPeserta(): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/";
    return;
  }
  if (!seminarId) {
    renderMessageRow("ID seminar tidak ditemukan pada URL.", "error");
    return;
  }

  renderMessageRow("Memuat data...");

  try {
    const res = await fetch(`${API_BASE_URL}/auth/kartu-seminar/seminar/${seminarId}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (redirectIfUnauthorized(res.status)) return;

    if (!res.ok) {
      renderMessageRow("Gagal memuat data peserta.", "error");
      return;
    }

    const json: KartuSeminarListResponse = await res.json();
    items = json.kartu_seminars;

    renderTable();
    updateSaveButtonState();
  } catch (err) {
    console.error("Gagal ambil peserta seminar:", err);
    renderMessageRow("Terjadi kesalahan jaringan.", "error");
  }
}

// ------------------------------------------------------------------
// Pilih status lokal (belum disimpan)
// ------------------------------------------------------------------
function initTableInteraction(): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;
  if (tbody.dataset.bound === "true") return;
  tbody.dataset.bound = "true";

  tbody.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    const hadirBtn = target.closest<HTMLElement>(".absensi-hadir-btn");
    if (hadirBtn) {
      if (hadirBtn.hasAttribute("disabled")) return;
      const id = Number(hadirBtn.dataset.id);
      if (!id) return;
      const item = items.find((i) => i.id === id);
      if (!item) return;

      if (item.statusparaf === "signed") return;

      // Toggle: kalau sudah dipilih "signed", batalkan pilihan (kembali ke status server)
      if (pendingChanges.get(id) === "signed") {
        pendingChanges.delete(id);
      } else {
        pendingChanges.set(id, "signed");
      }
      renderTable();
      updateSaveButtonState();
      return;
    }

    const absentBtn = target.closest<HTMLElement>(".absensi-tidakhadir-btn");
    if (absentBtn) {
      if (absentBtn.hasAttribute("disabled")) return;
      const id = Number(absentBtn.dataset.id);
      if (!id) return;
      const item = items.find((i) => i.id === id);
      if (!item) return;

      if (item.statusparaf === "signed") return;

      if (pendingChanges.get(id) === "absent") {
        pendingChanges.delete(id);
      } else {
        pendingChanges.set(id, "absent");
      }
      renderTable();
      updateSaveButtonState();
    }
  });
}

// ------------------------------------------------------------------
// Simpan (bulk update)
// ------------------------------------------------------------------
async function saveChanges(): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/";
    return;
  }

  if (pendingChanges.size === 0) return;

  const itemsPayload = Array.from(pendingChanges.entries()).map(([id, statusparaf]) => ({
    id,
    statusparaf,
  }));

  const saveBtn = document.getElementById("absensi-save-btn") as HTMLButtonElement | null;
  if (saveBtn) saveBtn.disabled = true;

  clearMessage();

  try {
    const res = await fetch(`${API_BASE_URL}/auth/kartu-seminar/bulk-status-paraf`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ items: itemsPayload }),
    });

    if (redirectIfUnauthorized(res.status)) return;

    const json = (await res.json()) as BulkUpdateResponse | ApiErrorResponse;

    if (res.status >= 500 || (!("updated" in json) && !res.ok)) {
      const errJson = json as ApiErrorResponse;
      showMessage(errJson.message ?? "Gagal menyimpan perubahan.", "error");
      if (saveBtn) saveBtn.disabled = false;
      return;
    }

    const bulkJson = json as BulkUpdateResponse;

    // Hapus pendingChanges untuk item yang berhasil diupdate
    for (const updated of bulkJson.updated ?? []) {
      pendingChanges.delete(updated.id);
    }

    if (bulkJson.errors && bulkJson.errors.length > 0) {
      const errMessages = bulkJson.errors.map((e) => `#${e.id}: ${e.message}`).join("; ");
      showMessage(`Sebagian gagal disimpan (${errMessages}).`, "error");
    } else {
      showMessage("Perubahan absensi berhasil disimpan.", "success");
    }

    // Refresh data dari server biar status paraf & tombol aksi konsisten
    await loadPeserta();
  } catch (err) {
    console.error("Gagal simpan absensi:", err);
    showMessage("Terjadi kesalahan jaringan. Coba lagi.", "error");
  } finally {
    updateSaveButtonState();
  }
}

function initSaveButton(): void {
  const btn = document.getElementById("absensi-save-btn");
  if (!btn) return;
  if (btn.dataset.bound === "true") return;
  btn.dataset.bound = "true";

  btn.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Simpan Absensi?",
      message: `${pendingChanges.size} perubahan status kehadiran akan disimpan. Status "Hadir" (ditandatangani) tidak dapat diubah lagi setelah disimpan.`,
      variant: "primary",
      confirmText: "Ya, Simpan",
      icon: "save",
    });
    if (!ok) return;

    saveChanges();
  });
}

function initAbsensiSeminarPage(): void {
  clearMessage();
  pendingChanges.clear();
  seminarId = getSeminarIdFromUrl();
  loadSeminarInfo();
  loadPeserta();
  initTableInteraction();
  initSaveButton();
}

initAbsensiSeminarPage();
document.addEventListener("astro:page-load", initAbsensiSeminarPage);