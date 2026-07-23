// src/scripts/biodata-signature.ts
// Logic untuk kanvas tanda tangan di halaman Biodata:
// - Menggambar tanda tangan pakai mouse/jari (canvas)
// - Tombol "Hapus"          -> bersihkan kanvas
// - Tombol "Lihat Tampilan" -> tampilkan hasil gambar ke area Preview
// - Tombol "Unggah Gambar"  -> upload file gambar tanda tangan, gambar ke kanvas
//
// PENTING: file ini TIDAK mengirim apapun ke API. Baik gambar manual maupun
// hasil upload, keduanya cuma "menggambar" ke <canvas>. Pengiriman ke server
// baru terjadi saat tombol "Simpan" utama diklik (lihat biodata-*-api.ts),
// yang membaca hasil canvas lewat window.getSignatureDataUrl().

declare global {
  interface Window {
    getSignatureDataUrl?: () => string | null;
  }
}

// Baris ini WAJIB ada — memaksa file ini dianggap "module" oleh TypeScript
// (bukan "script" biasa), karena `declare global` cuma valid di dalam module.
export {};

function initSignaturePad() {
  const canvas = document.getElementById("signature-pad") as HTMLCanvasElement | null;
  const container = document.getElementById("signature-pad-container");
  const clearBtn = document.getElementById("signature-clear-btn");
  const previewBtn = document.getElementById("signature-preview-btn");
  const uploadBtn = document.getElementById("signature-upload-btn");
  const uploadInput = document.getElementById("signature-upload-input") as HTMLInputElement | null;

  // FIX: cari elemen preview via id (stabil), bukan via alt text.
  // Sebelumnya pakai `document.querySelector('img[alt="Signature Preview"]')`,
  // padahal atribut alt di markup .astro adalah "Preview Tanda Tangan" —
  // jadi elemen ini selalu null dan preview tidak pernah ter-update.
  const previewImg = document.getElementById(
    "biodata-tandatangan-preview"
  ) as HTMLImageElement | null;

  if (!canvas || !container || !clearBtn || !previewBtn || !uploadBtn || !uploadInput) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let isDrawing = false;
  let hasDrawn = false;

  // Expose ke window supaya script API (biodata-*-api.ts) bisa ambil hasil
  // canvas saat tombol "Simpan" utama diklik, tanpa perlu import lintas modul.
  window.getSignatureDataUrl = () => (hasDrawn ? canvas!.toDataURL("image/png") : null);

  // Samakan resolusi kanvas dengan ukuran tampilnya biar gambar nggak buram/gepeng
  function resizeCanvas() {
    const rect = container!.getBoundingClientRect();
    const prevData = hasDrawn ? canvas!.toDataURL() : null;

    canvas!.width = rect.width;
    canvas!.height = rect.height;

    ctx!.lineWidth = 2;
    ctx!.lineCap = "round";
    ctx!.strokeStyle = "#191c1d";

    // Restore gambar sebelumnya kalau ada, biar nggak hilang pas resize
    if (prevData) {
      const img = new Image();
      img.onload = () => ctx!.drawImage(img, 0, 0, canvas!.width, canvas!.height);
      img.src = prevData;
    }
  }

  function getPos(e: MouseEvent | TouchEvent): { x: number; y: number } {
    const rect = canvas!.getBoundingClientRect();
    if (e instanceof TouchEvent) {
      const touch = e.touches[0] ?? e.changedTouches[0];
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startDraw(e: MouseEvent | TouchEvent) {
    isDrawing = true;
    hasDrawn = true;
    const { x, y } = getPos(e);
    ctx!.beginPath();
    ctx!.moveTo(x, y);
  }

  function draw(e: MouseEvent | TouchEvent) {
    if (!isDrawing) return;
    e.preventDefault();
    const { x, y } = getPos(e);
    ctx!.lineTo(x, y);
    ctx!.stroke();
  }

  function stopDraw() {
    isDrawing = false;
  }

  canvas.addEventListener("mousedown", startDraw);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", stopDraw);
  canvas.addEventListener("mouseleave", stopDraw);

  canvas.addEventListener("touchstart", startDraw, { passive: true });
  canvas.addEventListener("touchmove", draw, { passive: false });
  canvas.addEventListener("touchend", stopDraw);

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // Tombol Hapus
  clearBtn.addEventListener("click", () => {
    ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
    hasDrawn = false;
  });

  // Tombol Lihat Tampilan -> salin isi kanvas ke area Preview
  previewBtn.addEventListener("click", () => {
    if (!hasDrawn) return;
    const dataUrl = canvas!.toDataURL("image/png");
    if (previewImg) {
      previewImg.src = dataUrl;
      // FIX: lepas efek blur/opacity langsung dari parent <div> pembungkus img,
      // sesuai struktur markup: <div class="... opacity-50 blur-[1px]"><img .../></div>
      previewImg.parentElement?.classList.remove("opacity-50", "blur-[1px]");
    }
  });

  // Tombol Unggah Gambar -> pilih file, gambar ke kanvas
  uploadBtn.addEventListener("click", () => uploadInput.click());

  uploadInput.addEventListener("change", () => {
    const file = uploadInput.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
        ctx!.drawImage(img, 0, 0, canvas!.width, canvas!.height);
        hasDrawn = true;
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

initSignaturePad();
document.addEventListener("astro:page-load", initSignaturePad);