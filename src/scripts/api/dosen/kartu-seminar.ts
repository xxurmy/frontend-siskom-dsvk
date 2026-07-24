// src/scripts/api/dosen/kartu-seminar.ts
// GET  /auth/kartu-seminar/my                 -> daftar kartu seminar yang dimoderatori dosen ini
// PATCH /auth/kartu-seminar/{id}/status-paraf  -> ubah status jadi 'signed' atau 'absent'
//
// Aturan tombol aksi (sesuai status):
// - pending -> tombol "Tandatangani" & "Tidak Hadir" sama-sama muncul
// - absent  -> tombol "Tidak Hadir" hilang (sudah absent), "Tandatangani" tetap ada
//              (dosen masih bisa mengubah dari absent -> signed)
// - signed  -> kedua tombol hilang (status final, tidak bisa diubah lagi;
//              backend juga sudah menolak perubahan lain saat statusparaf sudah signed)

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

interface UpdateStatusParafResponse {
  message: string;
  kartu_seminar: KartuSeminar;
}

interface ApiErrorResponse {
  message: string;
  errors?: Record<string, string[]>;
}

const API_BASE_URL = import.meta.env.VITE_BASE_URL;
const TOKEN_KEY = "auth_token";
const TBODY_ID = "kartu-seminar-tbody";
const COLSPAN = 10;

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

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function redirectIfUnauthorized(status: number): boolean {
  if (status === 401) {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    window.location.href = "/login";
    return true;
  }
  return false;
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

function renderActionButtons(item: KartuSeminar): string {
  if (item.statusparaf === "signed") {
    return `<span class="text-body-sm text-on-surface-variant">-</span>`;
  }

  let html = `
    <button
      type="button"
      class="kartu-sign-btn text-secondary hover:bg-secondary/10 rounded-lg p-2 transition-colors"
      title="Tandatangani"
      data-id="${item.id}"
    >
      <span class="material-symbols-outlined">draw</span>
    </button>
  `;

  if (item.statusparaf !== "absent") {
    html += `
      <button
        type="button"
        class="kartu-absent-btn text-error hover:bg-error/10 rounded-lg p-2 transition-colors"
        title="Tidak Hadir"
        data-id="${item.id}"
      >
        <span class="material-symbols-outlined">person_off</span>
      </button>
    `;
  }

  return html;
}

function renderRow(item: KartuSeminar): string {
  return `
    <tr class="table-row-hover transition-colors" data-row-id="${item.id}">
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${formatTanggal(item.tanggal)}</td>
      <td class="px-4 py-4 text-body-sm">${formatWaktu(item.waktu)}</td>
      <td class="px-4 py-4 text-body-sm font-medium">${escapeHtml(item.namapemrasaran ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm">${escapeHtml(item.nimpemrasaran ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm whitespace-nowrap">${escapeHtml(item.prodi ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm">${escapeHtml(item.moderator ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm">${escapeHtml(item.namaforum ?? "-")}</td>
      <td class="px-4 py-4 text-body-sm">${escapeHtml(item.nimforum ?? "-")}</td>
      <td class="px-4 py-4">
        <span class="${STATUS_BADGE_CLASS[item.statusparaf]} px-3 py-1 rounded-full text-[12px] font-bold whitespace-nowrap">
          ${STATUS_LABEL[item.statusparaf]}
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

function renderTable(items: KartuSeminar[]): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;

  if (items.length === 0) {
    renderMessageRow("Belum ada data kartu seminar.");
    return;
  }

  tbody.innerHTML = items.map(renderRow).join("");
}

async function loadKartuSeminar(): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/login";
    return;
  }

  renderMessageRow("Memuat data...");

  try {
    const res = await fetch(`${API_BASE_URL}/auth/kartu-seminar/my`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (redirectIfUnauthorized(res.status)) return;

    if (!res.ok) {
      renderMessageRow("Gagal memuat data kartu seminar.", "error");
      return;
    }

    const data: KartuSeminarListResponse = await res.json();
    renderTable(data.kartu_seminars ?? []);
  } catch (err) {
    console.error("Gagal ambil kartu seminar:", err);
    renderMessageRow("Terjadi kesalahan jaringan.", "error");
  }
}

async function updateStatusParaf(id: number, statusparaf: "signed" | "absent"): Promise<void> {
  const token = getToken();
  if (!token) {
    window.location.href = "/login";
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/kartu-seminar/${id}/status-paraf`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ statusparaf }),
    });

    if (redirectIfUnauthorized(res.status)) return;

    const json = (await res.json()) as UpdateStatusParafResponse | ApiErrorResponse;

    if (!res.ok) {
      const errJson = json as ApiErrorResponse;
      alert(errJson.message ?? "Gagal memperbarui status paraf.");
      return;
    }

    // Refresh seluruh tabel biar data & tombol aksi tetap konsisten dengan server
    await loadKartuSeminar();
  } catch (err) {
    console.error("Gagal update status paraf kartu seminar:", err);
    alert("Terjadi kesalahan jaringan. Coba lagi.");
  }
}

function initActionButtons(): void {
  const tbody = document.getElementById(TBODY_ID);
  if (!tbody) return;
  if (tbody.dataset.bound === "true") return;
  tbody.dataset.bound = "true";

  tbody.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    const signBtn = target.closest<HTMLElement>(".kartu-sign-btn");
    if (signBtn) {
      const id = Number(signBtn.dataset.id);
      if (!id) return;
      if (!confirm("Tandatangani kartu seminar ini?")) return;
      updateStatusParaf(id, "signed");
      return;
    }

    const absentBtn = target.closest<HTMLElement>(".kartu-absent-btn");
    if (absentBtn) {
      const id = Number(absentBtn.dataset.id);
      if (!id) return;
      if (!confirm("Tandai mahasiswa ini tidak hadir?")) return;
      updateStatusParaf(id, "absent");
    }
  });
}

function initKartuSeminarPage(): void {
  loadKartuSeminar();
  initActionButtons();
}

initKartuSeminarPage();
document.addEventListener("astro:page-load", initKartuSeminarPage);