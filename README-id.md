# Claude Code Usage

🌐 **Bahasa**: [🏠 Main](README.md) | [English](README-en.md) | [繁體中文](README-zh-TW.md) | [简体中文](README-zh-CN.md) | [日本語](README-ja.md) | [한국어](README-ko.md) | **Bahasa Indonesia**

---

**Pelatih penggunaan lokal Claude Code dan Codex di status bar.** Bukan alat billing. Tampilan biaya / kuota Claude tetap ada; Codex Beta menganalisis token dan perilaku sesuai semantik Codex.

> **Apa ini:** monitor status bar VS Code yang membaca log percakapan Claude Code lokal Anda dan menampilkan estimasi penggunaan serta biaya **berbasis token** — plus penasihat AI opsional yang menyarankan cara memperbaiki prompt Anda dan mengurangi pemborosan.

> **ini _Bukanlah_:** alat billing. Semua angka adalah estimasi berdasarkan tarif publik per-juta-token. Rujuk ke akun Anthropic Anda untuk biaya yang sebenarnya.

> Screenshot berasal dari UI berbahasa Inggris. Lihat [README utama](README.md) untuk referensi fitur lengkap.

## Screenshot

### Status bar

![Status bar](images/v2-status-bar-en.png)

Arahkan kursor ke indikator kuota untuk melihat rinciannya:

![Quota tooltip](images/v2-quota-en.png)

### Dashboard

![Dashboard](images/v2-dashboard-en.png)

## Fitur

- **Status bar** — biaya hari ini, biaya sesi saat ini, dan kuota 5-jam / mingguan yang sebenarnya (`5h:N% wk:N%`) dibaca dari sesi OAuth Claude Code sendiri. Tanpa konfigurasi.
- **Tab dashboard** — Hari Ini / Bulan Ini / Sepanjang Waktu, plus **Sesi / Proyek / Konten / Branch**, semuanya bisa diurutkan.
- **Grafik komposisi biaya bertumpuk** dengan sumbu Y dan garis referensi — lihat sekilas berapa banyak dari tiap hari / bulan yang terpakai untuk masukan, keluaran, cache-write, dan cache-read.
- **Tab Konten** — memperkirakan konten mana yang menghabiskan token Anda (prompt Anda vs. hasil tool vs. output / pemikiran asisten).
- **Saran AI** (opsional) — mengirim ringkasan penggunaan plus sampel prompt Anda ke API yang kompatibel dengan OpenAI (DeepSeek V4 Pro secara default) dan menyarankan penulisan ulang yang konkret. Gunakan API key Anda sendiri, atau pratinjau demo statis terlebih dahulu.
- **Harga multi-vendor** — Opus 4.x / Sonnet 4.x / Haiku 4.5 diverifikasi terhadap harga publik Anthropic; tarif referensi untuk OpenAI / Gemini / DeepSeek / Kimi / GLM / Qwen dengan fallback berbasis family model. `Refresh Token Pricing` menarik data LiteLLM langsung.
- **Personalisasi** — bahasa, zona waktu, angka desimal, angka ringkas, pengelompokan proyek, toggle penyegaran otomatis dashboard.

## Codex Beta di v2.3

- Catatan penggunaan Codex hanya ditemukan dari `sessions/**/*.jsonl` dan `archived_sessions/**/*.jsonl`; file kredensial, database, dan file tak dikenal tetap dikecualikan. Secara terpisah, ekstensi hanya melakukan streaming terhadap `$CODEX_HOME/session_index.jsonl` untuk memetakan `id` ke `thread_name` bagi judul thread yang sebenarnya. Jalur absolut dalam judul disamarkan dan judul hanya disimpan di memori. Setiap baris JSONL penggunaan di-stream dan diparse sementara hanya untuk mengambil metadata penggunaan dan struktur dalam daftar izin; field prompt, respons, perintah, dan argumen alat tidak diperiksa atau dipakai untuk analisis, serta tidak pernah disimpan atau dipersistenkan.
- **Diproses** = input + output, **Penggunaan tanpa cache** = Input tanpa cache + output, **cached input** tetap bagian dari input, dan reasoning bagian dari output. Ringkasan juga menampilkan tingkat hit cache input sebagai cached input / input. Biaya tagihan Codex tidak ditampilkan. Kartu ringkasan pertama menampilkan estimasi biaya ekuivalen API untuk cakupan terpilih dengan label yang jelas, sedangkan tampilan Sepanjang Waktu menunjukkan tren mingguan dengan dasar harga yang sama. Claude / Codex / Compare tetap memisahkan makna tiap penyedia.
- **Hari Ini** pada Codex berarti hari kalender saat ini dalam zona waktu yang dikonfigurasi. Tampilan ini menambahkan biaya ekuivalen API per jam yang tepat di samping tampilan komposisi Token yang terpisah. Grafik utama harian dan bulanan juga memakai biaya ekuivalen API sebagai default, sementara komposisi Token tetap tersedia secara terpisah. Hanya harga model yang dikenal dan cocok tepat yang dihitung; model tak dikenal tetap tanpa harga dan cakupan harga selalu terlihat. Sidecar per jam yang bersifat tambahan dan kompatibel dengan schema 3 hanya memproses file canonical yang sudah diketahui memuat penggunaan hari ini, dapat dilanjutkan dari checkpoint, dan tidak memicu pengindeksan ulang seluruh riwayat.
- Atribusi Token per permintaan memprioritaskan component `last_token_usage` yang valid; `total_tokens` di dalamnya adalah ukuran konteks aktif, bukan penggunaan permintaan. Signature numerik lengkap total-plus-last hanya menghapus replay yang terbukti berasal dari sumber rate-limit pseudonim yang sama atau record yang tepat bersebelahan. Jika last snapshot tidak ada, parser kembali ke cumulative lineage high-water. Setelah upgrade, indeks dibangun ulang otomatis satu kali dan subtotal terindeks tetap terlihat selama prosesnya.
- Tampilan Sepanjang Waktu / Perbandingan Claude dan Codex menghitung ekuivalen terpakai historis langsung dari log Token lokal. Pengamatan reset resmi terbaru yang valid menjadi satu jangkar bagi rangkaian periode mingguan yang unik dan tidak tumpang tindih, sehingga setiap peristiwa penggunaan hanya dihitung dalam satu periode. Jika tidak ada pengamatan yang dapat dipakai, riwayat khusus pemakaian kembali ke minggu kalender UTC Senin-ke-Senin. Reset masa depan yang tumpang tindih tetapi tidak selaras dianggap konflik meskipun nama series berbeda; reset itu tidak dapat membuat periode berjalan kedua. Rentang periode dan waktu reset ditampilkan terpisah. Penggunaan Codex disimpan sebagai irisan harian. Bila suatu irisan melewati reset resmi di tengah hari, Token tetap dihitung satu kali, periode terdampak diberi label 「perkiraan batas」, dan hanya ekuivalen terpakai yang ditampilkan tanpa menyimpulkan total batas atau sisa. Aturan tampilan ini tidak mengubah schema indeks dan tidak memicu pembangunan ulang. Periode historis Codex selalu hanya menampilkan nilai terpakai. Hanya periode berjalan terbaru yang boleh memperkirakan total batas bila reset tidak berkonflik dan penggunaan terindeks dapat diatribusikan dengan andal ke satu sumber pengamatan; nilai sisa periode berjalan tetap tidak ditampilkan sebagai kesimpulan. Penggunaan dari beberapa login yang tidak dapat diatribusikan juga tetap hanya menampilkan nilai terpakai tanpa mengarang pemisahan akun. Harga API resmi saat ini diterapkan konsisten pada riwayat. Ini proksi, bukan tagihan atau harga langganan resmi. Panel ini aktif secara default dan dapat disembunyikan di Settings dengan `showWeeklyEquivalentValue`. Claude mulai merekam pengamatan batas per profil sejak rilis ini.
- Beralih ke Codex tetap memakai struktur Hari Ini / Bulan Ini / Sepanjang Waktu / Sesi / Proyek / Konten / Settings yang sudah ada, dengan label yang disesuaikan pada makna Codex. Kedua penyedia memakai render function, HTML class, grafik, tabel, jarak, dan aturan responsif yang sama; grafik deret waktunya tetap sejajar lebarnya, sedangkan konten padat hanya bergulir di areanya sendiri. Rekomendasi Codex memakai bukti struktural 30 hari yang telah diindeks.
- Tugas utama memakai judul thread nyata terbaru setelah jalur disamarkan. Baris tugas anak memprioritaskan judul thread nyatanya sendiri; jika tidak ada, baris memakai nama panggilan yang dilaporkan sambil menampilkan judul induk / tugas utama. Jika informasi itu juga tidak ada, baris memakai nama pengganti netral yang dilokalkan. Nama proyek memakai nama repositori Git, atau nama folder di luar Git. Ekstensi tidak mengarang Branches atau Workflows yang tidak dapat dihitung secara andal.
- Nilai 7 dan 30 hari memakai irisan tepat berdasarkan hari peristiwa di zona waktu yang dikonfigurasi. Saat migrasi atau pembangunan ulang belum selesai, setiap kartu, tabel, proyek, sesi, rekomendasi, dan nilai status Codex ditandai sebagai **subtotal terindeks**, sementara total lama yang belum diverifikasi dikecualikan. Setelah Codex home terdeteksi, tab penyedianya langsung ditampilkan; selama indeks pertama dibuat, jumlah file terindeks yang tepat, persentase, dan progres kapasitas tampil langsung di halaman, sedangkan Perbandingan menunggu hingga kedua penyedia memiliki data nyata. Setelah checkpoint atomik pertama dibuat, seluruh dasbor subtotal tetap dapat digunakan saat pengindeksan berlanjut; indikator progres tidak menggantikan kartu atau tabel. Codex home yang dipilih tidak membedakan akun, jadi log dari beberapa login di home yang sama digabung. Log lokal tidak memiliki identitas akun yang andal; kartu batas tetap **terakhir diamati** dan tidak dijumlahkan.
- Setiap rekomendasi hanya menampilkan pengamatan, bukti yang mudah dibaca, dan tindakan bersyarat bila agregat struktural 30 hari yang telah diindeks mendukungnya. Tanpa bukti, tidak ada saran umum.
- Indeks persisten menyimpan kunci pseudonim dengan salt khusus mesin; agregat numerik dan struktural; serta metadata proyek, direktori, agen, model, effort, peran, waktu, dan kualitas yang telah disanitasi. Indeks tidak pernah menyimpan ID mentah, jalur lengkap atau URL repositori, judul thread, maupun isi percakapan.
- Tab Settings bersama hanya menampilkan kontrol umum dan kontrol yang berlaku untuk Codex saat Codex dipilih. Pengumpulan Codex dan rekomendasi Codex lokal dapat dinonaktifkan secara terpisah; jeda watcher latar dapat diatur (default 30 detik, tersedia Off dan interval lebih panjang). Indeks pertama atau migrasi indeks lama yang belum tuntas mendapat satu batas streaming 64 GiB / 16.384 lintasan file; kapasitas itu tidak dialokasikan di memori di muka serta tetap dapat dibatalkan dan dilanjutkan. Setelah tuntas, kerja latar kembali ke 128 MiB / 64 lintasan file dan Refresh yang selalu terlihat memakai 2 GiB / 512 lintasan file. Refresh biasa tanpa perubahan tetap membaca nol isi JSONL penggunaan.
## Instalasi

Cari **`Claude Code Usage`** di tampilan Extensions (`Ctrl+Shift+X`), atau:

```
ext install GrowthJack.claude-code-usage
```

Juga tersedia di [Open VSX Registry](https://open-vsx.org/extension/GrowthJack/claude-code-usage) untuk Cursor / Windsurf.

## Konfigurasi

Buka Settings (`Ctrl+,`) dan cari **`Claude Code Usage`**. Semua pengaturan bersifat opsional. Yang paling berguna:

- `language` — bahasa UI (`auto` / `en` / `de-DE` / `zh-TW` / `zh-CN` / `ja` / `ko` / `pt-BR` / `id`).
- `timezone` — zona waktu IANA untuk tampilan tanggal (mis. `Asia/Jakarta`).
- `usageLimitTracking` — tampilkan indikator kuota 5 jam / mingguan yang sebenarnya.
- `showCost` / `showContext` — nyalakan/matikan item biaya dan indikator pengisian jendela konteks (seperti `/context`) di status bar.
- Setiap item status bar ini bisa dimatikan sendiri — atur `usageLimitTracking`, `showCost`, atau `showContext` ke `false` untuk menyembunyikan salah satunya saja.
- `advice.apiKey` — API key untuk fitur saran AI (kompatibel dengan OpenAI).
- `dashboardAutoRefresh` — nyalakan/matikan penyegaran otomatis dashboard (bisa juga di-toggle di header dashboard).

Lihat [tabel pengaturan lengkap di README utama](README.md#configuration).

## Pemecahan masalah

**"No Claude Code Data"** — pastikan Claude Code sudah terpasang dan pernah dipakai minimal sekali; periksa pengaturan `dataDirectory` (deteksi otomatis mencari di `~/.claude/projects`).

**Kuota menampilkan `5h:--% wk:--%`** — login ke profil Claude yang aktif.
Kredensial mengikuti `dataDirectory` eksplisit, lalu `CLAUDE_CONFIG_DIR` valid
pertama, lalu `~/.claude`; item Keychain macOS global hanya dipakai untuk profil
default.

**Riwayat penggunaan bulan-bulan lama hilang** — Claude Code menghapus log yang lebih lama dari `cleanupPeriodDays` (default 30). Untuk menyimpan lebih lama, atur `{ "cleanupPeriodDays": 365 }` di `~/.claude/settings.json`. Log yang sudah terhapus tidak bisa dipulihkan.

**Jumlah token lebih rendah daripada `stats-cache` Claude Code** — satu respons
dapat ditulis sebagai baris transkrip `thinking` dan `text` yang terpisah dengan
`messageId`, `requestId`, dan vektor `usage` lengkap yang sama. Extension ini
menghitung identitas respons tersebut satu kali dan menyimpan vektor terbesarnya;
`stats-cache` Claude Code menjumlahkan setiap baris. Extension tidak memakai
faktor pengali agar hasilnya menyerupai cache itu.

**Jumlah token lebih rendah dari dashboard provider Anda** — beberapa proxy / dynamic workflow menulis catatan per-agent ke sub-direktori yang mungkin tidak lengkap. Pengeluaran sebenarnya ada di halaman billing provider Anda. Atribusi workflow native sedang direncanakan.

## Kredit

Fork dari [`ClaudeCodeUsage/ClaudeCodeUsage`](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage). Berlisensi MIT. Kontribusi komunitas dicatat di [CHANGELOG.md](CHANGELOG.md). Banyak perubahan kode disusun dengan bantuan [Claude Code](https://claude.com/claude-code).

Kredit alat pengembangan: pemeliharaan repositori menggunakan [Claude Code](https://claude.com/claude-code) dan [OpenAI Codex](https://developers.openai.com/codex/). Kredit alat ini dipisahkan dari kontributor manusia; Codex tidak ditambahkan ke daftar kontributor manusia Release Drafter dan tidak diberi identitas `Co-Authored-By` yang dibuat-buat.

**Issue, PR, dan ide sangat kami sambut** — begitulah proyek ini berkembang.

## Lisensi

[MIT](LICENSE)
