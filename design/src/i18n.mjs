// Markas ships in English and Bahasa Indonesia.
// A screen is drawn once in English; translate() swaps every text it knows for the other
// language, which also shows where a longer translation would break a layout.

/** Returns a copy of `spec` with every text found in `dictionary` replaced. */
export function translate(spec, dictionary) {
  if (!spec) return spec;
  const next = {
    ...spec,
    children: (spec.children ?? []).map((child) => translate(child, dictionary)),
  };
  if (spec.type === "text" && dictionary[spec.characters] !== undefined) {
    next.characters = dictionary[spec.characters];
  }
  return next;
}

/** Bahasa Indonesia for the main screen. Bot names, sites and times stay as they are. */
export const ID = {
  Chats: "Obrolan",
  Rounds: "Ronde",
  Keyring: "Kunci",
  Switchboard: "Sambungan",
  Archive: "Arsip",
  Logbook: "Buku log",
  "16% left": "Sisa 16%",
  Search: "Cari",
  "Waiting on you": "Menunggu Anda",
  "Finish a sign-in step": "Selesaikan langkah masuk",
  Pinned: "Disematkan",
  Crew: "Kru",
  "Next rounds": "Ronde berikutnya",
  "See all": "Lihat semua",
  "Atlas is set up. Test run passed.": "Atlas sudah siap. Uji coba berhasil.",
  "Stock is 3.410 units.": "Stok 3.410 unit.",
  "Synced 14 notes.": "14 catatan disinkronkan.",
  "Working: inbox summary": "Bekerja: ringkasan kotak masuk",
  "Your brief for today is ready.": "Ringkasan hari ini sudah siap.",
  "Weekly report sent Monday.": "Laporan mingguan terkirim Senin.",
  "Dashboard to notes": "Dasbor ke catatan",
  "Inbox summary": "Ringkasan kotak masuk",
  "Stock check": "Cek stok",
  "Today 11:00": "Hari ini 11.00",
  "Today 12:00": "Hari ini 12.00",
  "Today 16:00": "Hari ini 16.00",
  Mon: "Sen",
  "Host running": "Host berjalan",
  "3 engines ready": "3 mesin siap",
  "Stock and dashboard checks": "Cek stok dan dasbor",
  Idle: "Siaga",
  Main: "Utama",
  "Reorder rules": "Aturan pesan ulang",
  "Metrics login": "Login Metrics",
  Today: "Hari ini",
  You: "Anda",
  "Check the stock level now and tell me if it is below the reorder line.":
    "Cek stok sekarang dan beri tahu saya kalau di bawah batas pesan ulang.",
  Browser: "Peramban",
  "4 steps": "4 langkah",
  "Stock is 3.410 units as of 09:00. That is above the 2.000 unit reorder line, so I did not message Sam.":
    "Stok 3.410 unit per pukul 09.00. Itu di atas batas pesan ulang 2.000 unit, jadi saya tidak mengirim pesan ke Sam.",
  "The next scheduled check is at 16:00.": "Cek terjadwal berikutnya pukul 16.00.",
  "Message Atlas": "Kirim pesan ke Atlas",
  "Context 3% full": "Konteks terisi 3%",
  "Enter to send": "Enter untuk kirim",
  Files: "Berkas",
  Settings: "Pengaturan",
  "Metrics: stock overview": "Metrics: ringkasan stok",
  "Stock level": "Tingkat stok",
  "Orders today": "Pesanan hari ini",
  Failed: "Gagal",
  "Atlas is reading the page": "Atlas sedang membaca halaman",
  "snapshot · 212 elements · 2 s ago": "cuplikan · 212 elemen · 2 dtk lalu",
  Live: "Langsung",
  "Recent actions": "Tindakan terbaru",
  Opened: "Membuka",
  "Filled sign-in": "Mengisi login",
  "Metrics (Atlas) from the keyring": "Metrics (Atlas) dari Kunci",
  Clicked: "Mengeklik",
  "Dashboards, stock overview": "Dasbor, ringkasan stok",
  Read: "Membaca",
  "stock level tile": "kotak tingkat stok",
};
