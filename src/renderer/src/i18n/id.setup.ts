import type { enSetup } from "./en.setup";

/** Teks Bahasa Indonesia untuk penyiapan awal. Digabung ke tabel utama di id.ts. */
export const idSetup: Record<keyof typeof enSetup, string> = {
  "setup.step": "Langkah {current} dari {total}",
  "setup.back": "Kembali",
  "setup.continue": "Lanjut",
  "setup.saving": "Menyimpan",
  "setup.saveFailed":
    "Markas tidak bisa menyimpan langkah ini. Pastikan host berjalan, lalu coba lagi.",

  "setup.language.label": "Pilih bahasa",
  "setup.language.title": "Pilih bahasa Anda",
  "setup.language.body": "Choose your language. Anda bisa menggantinya nanti di Pengaturan.",
  "setup.language.en.body": "Menus, buttons and messages in English.",
  "setup.language.id.body": "Menu, tombol dan pesan dalam Bahasa Indonesia.",
  "setup.language.note":
    "Bot menjawab dalam bahasa yang Anda pakai saat menulis. Pilihan ini hanya mengatur bahasa Markas.",
  "setup.language.unsupported.title": "Bahasa komputer Anda belum tersedia di Markas",
  "setup.language.unsupported.body":
    "Markas dimulai dalam bahasa Inggris. Pilih Bahasa Indonesia di sini atau nanti di Pengaturan.",

  "setup.engines.label": "Hubungkan mesin",
  "setup.engines.title": "Hubungkan mesin yang menjalankan bot Anda",
  "setup.engines.body":
    "Markas menjalankan alat baris perintah yang sudah Anda punya, dengan akun Anda sendiri. Markas tidak pernah meminta atau menyimpan kata sandinya.",
  "setup.engines.checkAgain": "Periksa lagi",
  "setup.engines.checking": "Memeriksa",
  "setup.engines.version": "Versi {version}",
  "setup.engines.ready": "Sudah masuk",
  "setup.engines.notInstalled": "Belum terpasang",
  "setup.engines.notSignedIn": "Belum masuk",
  "setup.engines.installing": "Memasang",
  "setup.engines.waiting": "Menunggu Anda masuk",
  "setup.engines.outdated": "Perlu diperbarui",
  "setup.engines.problem": "Perlu perhatian",
  "setup.engines.install": "Pasang",
  "setup.engines.update": "Perbarui",
  "setup.engines.signIn": "Masuk",
  "setup.engines.cancel": "Batal",
  "setup.engines.openLoginAgain": "Buka halaman masuk lagi",
  "setup.engines.detail.notInstalled":
    "Markas bisa memasangnya untuk Anda. Tidak perlu hak administrator.",
  "setup.engines.detail.signIn": "Masuk membuka halaman login {engine} di peramban Anda.",
  "setup.engines.detail.waiting": "Selesaikan login di peramban Anda. Markas akan lanjut sendiri.",
  "setup.engines.detail.installing": "Biasanya kurang dari satu menit.",
  "setup.engines.one.title": "Satu mesin yang sudah masuk cukup untuk mulai",
  "setup.engines.one.body":
    "Tombol Lanjut terbuka setelah satu mesin siap. Mesin yang lain bisa ditambahkan nanti dari Pengaturan.",
  "setup.engines.none.title": "Belum ada mesin yang masuk, jadi Lanjut masih terkunci",
  "setup.engines.none.body":
    "Markas perlu satu mesin untuk menjalankan bot. Masuk ke mesin yang Anda punya, atau pasang yang lain.",
  "setup.engines.getHelp": "Bantuan",
  "setup.engines.installFailed.title": "{engine} tidak bisa dipasang",
  "setup.engines.installFailed.offline": "Tidak ada koneksi internet.",
  "setup.engines.installFailed.permission": "Komputer ini tidak mengizinkan pemasangan.",
  "setup.engines.installFailed.missingTool": "Alat yang dibutuhkan pemasang tidak ditemukan.",
  "setup.engines.installFailed.body":
    "Anda bisa mencoba lagi, memasangnya sendiri dengan perintah di bawah, atau menunjukkan salinan yang sudah ada ke Markas.",
  "setup.engines.retry": "Coba lagi",
  "setup.engines.copyInstall": "Salin perintah pasang",
  "setup.engines.copied": "Tersalin",
  "setup.engines.locate": "Tunjukkan lokasinya",
  "setup.engines.locate.title": "Di mana {engine}?",
  "setup.engines.locate.body": "Tempel lokasi lengkap program {engine} di komputer ini.",
  "setup.engines.locate.path": "Lokasi program",
  "setup.engines.locate.use": "Pakai salinan ini",
  "setup.engines.locate.checking": "Memeriksa",
  "setup.engines.signInSlow.title": "Proses masuk {engine} lama sekali",
  "setup.engines.signInSlow.body":
    "Halaman login mungkin tertutup atau diblokir. Buka lagi, masuk lewat terminal, atau lewati {engine} dulu.",
  "setup.engines.signInTerminal": "Salin perintah terminal",
  "setup.engines.skip": "Lewati {engine}",
  "setup.engines.statusFailed.title": "Markas tidak bisa memeriksa mesin Anda",
  "setup.engines.statusFailed.body": "Host tidak menjawab. Markas akan terus mencoba.",

  "setup.model.label": "Pilih model bawaan",
  "setup.model.title": "Pilih model awal untuk bot baru",
  "setup.model.body":
    "Tiap mesin punya modelnya sendiri. Pilih satu untuk bot baru. Tiap bot bisa menggantinya nanti.",
  "setup.model.search": "Cari model",
  "setup.model.engines": "Mesin",
  "setup.model.ready": "Siap",
  "setup.model.signedInAs": "Masuk sebagai {email}",
  "setup.model.effort": "Upaya",
  "setup.model.effort.low": "Rendah",
  "setup.model.effort.medium": "Sedang",
  "setup.model.effort.high": "Tinggi",
  "setup.model.effort.xhigh": "Sangat tinggi",
  "setup.model.effort.max": "Maksimal",
  "setup.model.none": "Tidak ada model yang cocok dengan pencarian Anda.",
  "setup.model.loading": "Memuat model",
  "setup.model.fallback.title": "{engine} tidak memberi daftar modelnya",
  "setup.model.fallback.body":
    "Markas menampilkan daftar bawaan sampai mesin menjawab. Anda tetap bisa lanjut.",
  "setup.model.failed.title": "{engine} tidak memberi daftar modelnya",
  "setup.model.failed.body":
    "Anda bisa memakai bawaan mesin, mencoba lagi, atau mengetik nama model.",
  "setup.model.useDefault": "Pakai bawaan mesin",
  "setup.model.typeName": "Ketik nama model",
  "setup.model.custom": "Nama model",
  "setup.model.custom.use": "Pakai model ini",
  "setup.model.engineDefault": "Bawaan mesin",
  "setup.model.otherWaiting": "{engine} belum siap. Modelnya muncul di sini setelah siap.",

  "setup.consent.label": "Pahami risikonya",
  "setup.consent.title": "Bot bertindak di komputer ini atas nama Anda",
  "setup.consent.body": "Baca ini sekali. Anda bisa memperketat izin tiap bot kapan saja.",
  "setup.consent.files.title": "Bot bisa membaca dan mengubah berkas serta menjalankan perintah",
  "setup.consent.files.body":
    "Secara bawaan bot bekerja di foldernya sendiri, dan bertanya dulu sebelum menyentuh yang lain.",
  "setup.consent.web.title": "Bot bisa memakai web di perambannya sendiri",
  "setup.consent.web.body":
    "Tiap bot menjelajah di profil terpisah. Kata sandi diketik oleh Markas, tidak pernah diperlihatkan ke bot.",
  "setup.consent.approval.title": "Tindakan penting berhenti dulu menunggu persetujuan Anda",
  "setup.consent.approval.body":
    "Mengirim pesan, memakai login dan mengubah izin bot selalu bertanya dulu.",
  "setup.consent.agree":
    "Saya paham bot bisa bertindak di komputer dan akun saya, dan saya hanya akan menjalankan tugas yang saya percaya.",
  "setup.consent.private": "Tidak ada yang dikirim ke Markas. Tidak ada telemetri.",
  "setup.consent.needed.title": "Centang kotaknya untuk lanjut",
  "setup.consent.needed.body":
    "Markas tidak bisa menjalankan bot tanpa persetujuan ini. Tidak ada yang dipasang atau dijalankan sebelum Anda setuju.",
};
