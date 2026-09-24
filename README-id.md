# Claude Code Usage

🌐 **Bahasa**: [🏠 Main](README.md) | [English](README-en.md) | [Deutsch](README-de-DE.md) | [繁體中文](README-zh-TW.md) | [简体中文](README-zh-CN.md) | [日本語](README-ja.md) | [한국어](README-ko.md) | [Português (Brasil)](README-pt-BR.md) | **Bahasa Indonesia**

---

**Pelatih penggunaan lokal Claude Code dan Codex di status bar.** Bukan alat billing. Tampilan biaya / kuota Claude tetap ada; Codex menganalisis token dan perilaku sesuai semantik Codex.

> **Apa ini:** monitor status bar VS Code yang membaca log penggunaan lokal Claude Code dan Codex, lalu menampilkan token, kuota, dan estimasi sesuai makna data masing-masing penyedia. Saran opsional membantu mengurangi pemakaian yang tidak perlu.

> **Apa yang bukan:** alat penagihan. Biaya Claude dan biaya setara API Codex hanyalah estimasi, bukan tagihan langganan. Periksa akun penyedia terkait untuk tagihan sebenarnya. Kuota Codex adalah pengamatan lokal terakhir, bukan saldo langsung.

> Screenshot mencakup UI bahasa Inggris dan Tionghoa Sederhana. Lihat [README utama](README.md) untuk referensi lengkap.

## Screenshot

### Status bar

![Status bar](images/v2-status-bar-en.png)

Arahkan kursor ke indikator kuota untuk melihat rinciannya:

![Quota tooltip](images/v2-quota-en.png)

### Dashboard

![Dashboard](images/v2-dashboard-en.png)

### Codex dan Perbandingan v2.3

![Claude hari ini, Tionghoa Sederhana, tema gelap](images/v2.3.1/claude-today-zh-CN-dark.png)

![Ringkasan Codex, Tionghoa Sederhana, tema gelap](images/v2.3.1/codex-overview-zh-CN-dark.png)

![Estimasi batas mingguan Codex, Inggris, tema gelap](images/v2.3.1/codex-weekly-estimate-en-dark.png)

![Heatmap gabungan Claude dan Codex, Inggris, tema terang](images/v2.3.1/compare-heatmap-en-light.png)

![Matriks aktivitas proyek, Inggris, tema gelap](images/v2.3.2/project-activity-matrix-en-dark.png)

Lima gambar v2.3 ini menggunakan renderer produksi, data sintetis, dan variabel tema VS Code Light+/Dark+, bukan bukti penggunaan pribadi atau tagihan. Instalasi VSIX native diverifikasi secara terpisah.

- Codex menampilkan **token terpakai hari ini** dan **sisa kuota** secara terpisah: penggunaan mingguan 36% berarti `wk 64%`. Tooltip tetap menampilkan bilah penggunaan, waktu reset, dan catatan berbaris. Kuota berasal dari pengamatan lokal terakhir, bukan saldo langsung.
- Detail periode tertutup secara default; pengaturan berbagi berada di bawah pratinjau. Berbagi aktif secara default dan dapat dimatikan, dengan intensitas kuantil, logaritmik, atau linear.
- Panggilan CLI dihitung hanya jika sesi persisten menyimpan log dengan usage. Panggilan tanpa log tidak dapat dipulihkan; Hari ini dan 30 hari terakhir memakai zona waktu yang dikonfigurasi.
- Projects menambahkan heatmap Token 30/90 hari “proyek × tanggal” dan tren harian bertumpuk untuk kedua penyedia, dengan tooltip presisi, cakupan eksplisit, baris terbatas, dan ekor “Proyek lain”.

## Fitur

- **Status bar** — biaya hari ini, biaya sesi saat ini, dan kuota 5-jam / mingguan yang sebenarnya (`5h:N% wk:N%`) dibaca dari sesi OAuth Claude Code sendiri. Tanpa konfigurasi.
- **Format kuota** — pilih Bawaan (default), hanya 5 jam, atau hanya Mingguan di ⚙ Pengaturan; pilihan Kustom baru menampilkan kolom templat.
- **Tab dashboard** — Hari Ini / 30 Hari Terakhir / Sepanjang Waktu, plus **Sesi / Proyek / Konten / Branch**, semuanya bisa diurutkan.
- **Grafik komposisi biaya bertumpuk** dengan sumbu Y dan garis referensi — lihat sekilas berapa banyak dari tiap hari / bulan yang terpakai untuk masukan, keluaran, cache-write, dan cache-read.
- **Tab Konten** — memperkirakan konten mana yang menghabiskan token Anda (prompt Anda vs. hasil tool vs. output / pemikiran asisten).
- **Saran AI** (opsional) — dimulai dari bukti lokal dan tindakan yang dapat dijelaskan. Personalisasi BYOK opsional hanya memakai agregat secara default; sampel prompt memerlukan persetujuan terpisah. Permintaan lengkap dipratinjau secara persis sebelum tindakan Kirim yang terpisah, dan umpan balik berguna / tidak berguna / diterapkan tetap lokal. Saran dapat ditunda untuk waktu terbatas dan muncul kembali setelah kedaluwarsa atau secara manual.
  Pencabutan persetujuan langsung membatalkan pratinjau dan permintaan saran yang sedang berjalan; data yang sudah terkirim tidak dapat ditarik kembali.
- **Harga multi-vendor** — Opus 4.x / Sonnet 4.x / Haiku 4.5 diverifikasi terhadap harga publik Anthropic; tarif referensi untuk OpenAI / Gemini / DeepSeek / Kimi / GLM / Qwen dengan fallback berbasis family model. `Refresh Token Pricing` menarik data LiteLLM langsung.
- **Personalisasi** — bahasa, zona waktu, angka desimal, angka ringkas, pengelompokan proyek, toggle penyegaran otomatis dashboard.

## Yang baru di v2.4

<details open>
<summary>Perubahan utama rilis terbaru</summary>


- **Status Codex dan pengguliran** — metrik ringkas bawaan menampilkan token
  yang diproses hari ini, sedangkan jatah mingguan menampilkan sisanya.
  Pembaruan panel ditunda sebentar saat menggulir, dengan batas waktu tunggu.
- **Satu ruang kerja berbagi yang mengutamakan pratinjau** — pratinjau ekspor
  selebar penuh menjadi fokus, dengan kontrol di bawahnya. Satu pemilih tampilan
  berpindah antara **heatmap aktivitas gabungan**, **Claude Share Card**, dan
  **heatmap token Claude**. Tampilan gabungan hanya tersedia saat kedua penyedia
  memiliki data nyata; dua tampilan lama tetap khusus Claude.
- **Entri kompatibel tanpa panel ganda** — `exportShareCard`, `exportHeatmap`,
  dan `publishHeatmapToGitHub` tetap tersedia dan membuka pratinjau yang sesuai.
  `enableShareCard` tetap menjadi satu-satunya sakelar berbagi yang terlihat dan
  aktif secara default; `showHeatmap` yang dipensiunkan disimpan hanya untuk satu
  rilis kompatibilitas status dan penghapusan terbatas.
- **Batas artefak lokal dan penyedia yang ketat** — memilih tampilan, melihat
  pratinjau, serta mengekspor SVG/Markdown lokal hanya memakai agregat yang
  sudah tersedia dan tidak melakukan permintaan jaringan, login GitHub, atau
  pengambilan profil/avatar/nama. Hanya tindakan terpisah **Publikasikan ke
  GitHub** untuk heatmap Claude yang dapat terhubung; tindakan ini tetap khusus
  repositori publik dan mengonfirmasi target serta aksi buat/timpa yang tepat
  sebelum menulis. Aktivitas gabungan bukan klaim tagihan, produktivitas,
  kemampuan, atau kesetaraan penyedia.

</details>

## Yang baru di v2.3

<details>
<summary>Tampilkan fitur Codex, perbandingan, dan riwayat v2.3</summary>


- **Penyempurnaan di seluruh seri v2.3** — metadata model GPT-6 Astra dan
  Fable 5.1, harga AWS Bedrock opsional, pilihan mata uang tampilan dengan kurs
  referensi tetap, matriks aktivitas proyek khusus Token 30/90 hari, drill-down
  bulan/hari/jam lengkap, refresh yang mempertahankan state, grafik aksesibel,
  serta beban watcher dan indeks judul yang lebih rendah.
  Detail per patch hanya disimpan di CHANGELOG dan GitHub Releases.
- Catatan penggunaan Codex hanya ditemukan dari `sessions/**/*.jsonl` dan `archived_sessions/**/*.jsonl`; file kredensial, database, dan file tak dikenal tetap dikecualikan. Secara terpisah, ekstensi hanya melakukan streaming terhadap `$CODEX_HOME/session_index.jsonl` untuk memetakan `id` ke `thread_name` bagi judul thread yang sebenarnya. Jalur absolut dalam judul disamarkan dan judul hanya disimpan di memori. Setiap baris JSONL penggunaan di-stream dan diparse sementara hanya untuk mengambil metadata penggunaan dan struktur dalam daftar izin; field prompt, respons, perintah, dan argumen alat tidak diperiksa atau dipakai untuk analisis, serta tidak pernah disimpan atau dipersistenkan.
- **Diproses** = input + output, **Penggunaan tanpa cache** = Input tanpa cache + output, **cached input** tetap bagian dari input, dan reasoning bagian dari output. Ringkasan juga menampilkan tingkat hit cache input sebagai cached input / input. Biaya tagihan Codex tidak ditampilkan. Kartu ringkasan pertama menampilkan estimasi biaya ekuivalen API untuk cakupan terpilih dengan label yang jelas, sedangkan tampilan Sepanjang Waktu menunjukkan tren mingguan dengan dasar harga yang sama. Claude / Codex / Compare tetap memisahkan makna tiap penyedia.
- **Hari Ini** pada Codex berarti hari kalender saat ini dalam zona waktu yang dikonfigurasi. Tampilan ini menambahkan biaya ekuivalen API per jam yang tepat di samping tampilan komposisi Token yang terpisah. Grafik utama harian dan bulanan juga memakai biaya ekuivalen API sebagai default, sementara komposisi Token tetap tersedia secara terpisah. Hanya harga model yang dikenal dan cocok tepat yang dihitung; model tak dikenal tetap tanpa harga dan cakupan harga selalu terlihat. Sidecar per jam yang bersifat tambahan dan kompatibel dengan schema 3 menyimpan bucket tanggal / jam yang jarang untuk 30 hari bergulir, mendukung checkpoint dan resume, membuang hari ke-31, dan membuka tanggal tanpa membaca JSONL. Grafik dan tabel bulanan Codex menampilkan bulan dari yang paling lama ke yang terbaru.
- Atribusi Token per permintaan memprioritaskan component `last_token_usage` yang valid; `total_tokens` di dalamnya adalah ukuran konteks aktif, bukan penggunaan permintaan. Signature numerik lengkap total-plus-last hanya menghapus replay yang terbukti berasal dari sumber rate-limit pseudonim yang sama atau record yang tepat bersebelahan. Jika last snapshot tidak ada, parser kembali ke cumulative lineage high-water. Setelah upgrade, indeks dibangun ulang otomatis satu kali dan subtotal terindeks tetap terlihat selama prosesnya.
- Tampilan Sepanjang Waktu / Perbandingan Claude dan Codex menghitung ekuivalen terpakai historis langsung dari log Token lokal. Pengamatan reset resmi terbaru yang valid menjadi jangkar bagi rangkaian periode mingguan yang unik dan tidak tumpang tindih, sehingga setiap peristiwa penggunaan hanya dihitung dalam satu periode. Jika tidak ada pengamatan yang dapat dipakai, riwayat khusus pemakaian kembali ke minggu kalender UTC Senin-ke-Senin. Pengamatan dari series yang sama tetap menjadi satu series dan dapat ditampilkan sebagai perkiraan berkeyakinan rendah tanpa membuat periode berjalan kedua. Pengamatan account-wide `codex` dapat menghias periode historis dan berjalan; pergeseran reset, ketidakpastian sumber file, atau batas irisan harian menurunkan keyakinan. Kunci file bukan identitas akun, sehingga file lokal yang memenuhi syarat dalam satu home dipakai bersama. Jika series kuota lokal tumpang tindih, periode berjalan memakai pengamatan nyata terbaru untuk estimasi gabungan berkeyakinan rendah. Periode selesai yang atribusinya ambigu atau periode tanpa pengamatan tetap hanya menampilkan ekuivalen terpakai tanpa mengarang pemisahan akun. Setiap periode teramati yang konsisten, termasuk periode berjalan, dapat menampilkan estimasi total dan sisa daya tahan; ketidakpastian atribusi atau batas menurunkan keyakinan alih-alih menyembunyikan nilainya. Aturan tampilan ini tidak mengubah schema indeks dan tidak memicu pembangunan ulang. Harga API resmi saat ini diterapkan konsisten pada riwayat. Ini proksi, bukan tagihan, saldo resmi, atau harga langganan resmi. Panel ini aktif secara default dan dapat disembunyikan di Settings dengan `showWeeklyEquivalentValue`. Claude mulai merekam pengamatan batas per profil sejak rilis ini.
- Beralih ke Codex tetap memakai struktur Hari Ini / 30 Hari Terakhir / Sepanjang Waktu / Sesi / Proyek / Konten / Settings yang sudah ada, dengan label yang disesuaikan pada makna Codex. Kedua penyedia memakai render function, HTML class, grafik, tabel, jarak, dan aturan responsif yang sama; grafik deret waktunya tetap sejajar lebarnya, sedangkan konten padat hanya bergulir di areanya sendiri. Rekomendasi Codex memakai bukti struktural 30 hari yang telah diindeks.
- Tugas utama memakai judul thread nyata terbaru setelah jalur disamarkan. Baris tugas anak memprioritaskan judul thread nyatanya sendiri; jika tidak ada, baris memakai nama panggilan yang dilaporkan sambil menampilkan judul induk / tugas utama. Jika informasi itu juga tidak ada, baris memakai nama pengganti netral yang dilokalkan. Nama proyek memakai nama repositori Git, atau nama folder di luar Git. Ekstensi tidak mengarang Branches atau Workflows yang tidak dapat dihitung secara andal.
- Nilai 7 dan 30 hari memakai irisan tepat berdasarkan hari peristiwa di zona waktu yang dikonfigurasi. Saat migrasi atau pembangunan ulang belum selesai, setiap kartu, tabel, proyek, sesi, rekomendasi, dan nilai status Codex ditandai sebagai **subtotal terindeks**, sementara total lama yang belum diverifikasi dikecualikan. Setelah Codex home terdeteksi, tab penyedianya langsung ditampilkan; selama indeks pertama dibuat, jumlah file terindeks yang tepat, persentase, dan progres kapasitas tampil langsung di halaman, sedangkan Perbandingan menunggu hingga kedua penyedia memiliki data nyata. Setelah checkpoint atomik pertama dibuat, seluruh dasbor subtotal tetap dapat digunakan saat pengindeksan berlanjut; indikator progres tidak menggantikan kartu atau tabel. Codex home yang dipilih tidak membedakan akun, jadi log dari beberapa login di home yang sama digabung. Log lokal tidak memiliki identitas akun yang andal; kartu batas tetap **terakhir diamati** dan tidak dijumlahkan.
- Setiap rekomendasi hanya menampilkan pengamatan, bukti yang mudah dibaca, dan tindakan bersyarat bila agregat struktural 30 hari yang telah diindeks mendukungnya. Tanpa bukti, tidak ada saran umum.
- Indeks persisten menyimpan kunci pseudonim dengan salt khusus mesin; agregat numerik dan struktural; serta metadata proyek, direktori, agen, model, effort, peran, waktu, dan kualitas yang telah disanitasi. Indeks tidak pernah menyimpan ID mentah, jalur lengkap atau URL repositori, judul thread, maupun isi percakapan.
- Tab Settings bersama hanya menampilkan kontrol umum dan kontrol yang berlaku untuk Codex saat Codex dipilih. Pengumpulan Codex dan rekomendasi Codex lokal dapat dinonaktifkan secara terpisah; jeda watcher latar dapat diatur (default 30 detik, tersedia Off dan interval lebih panjang). Indeks pertama atau migrasi indeks lama yang belum tuntas mendapat satu batas streaming 64 GiB / 16.384 lintasan file; kapasitas itu tidak dialokasikan di memori di muka serta tetap dapat dibatalkan dan dilanjutkan. Setelah tuntas, kerja latar kembali ke 128 MiB / 64 lintasan file dan Refresh yang selalu terlihat memakai 2 GiB / 512 lintasan file. Refresh biasa tanpa perubahan tetap membaca nol isi JSONL penggunaan.
</details>

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
- `advice.apiKey` — API key milik pengguna yang dipakai bersama oleh Saran AI dan Usage Optimizer (endpoint Anthropic atau kompatibel OpenAI).
- `dashboardAutoRefresh` — nyalakan/matikan penyegaran otomatis dashboard (bisa juga di-toggle di header dashboard).

Lihat [tabel pengaturan lengkap di README utama](README.md#configuration).

## Data lokal, privasi, dan batasan

Lihat [Local data and privacy](LOCAL-DATA.md) untuk inventaris lengkap,
retensi, migrasi, penghapusan, dan batas interaksi jarak jauh.

| Data | Retensi lokal | Perilaku jarak jauh |
|---|---|---|
| Log sumber | Milik penyedia, hanya-baca, tidak disalin utuh | Tidak ada secara default |
| Indeks Codex | Agregat numerik/struktur pseudonim yang terbatas | Tidak ada |
| Riwayat kuota | Pengamatan jendela anonim terbatas, tanpa ID akun mentah | Hanya kuota Claude saat aktif; Codex tetap lokal |
| UI/berbagi | Filter serta judul/rentang/tujuan GitHub opsional | Publikasi hanya setelah konfirmasi tepat |
| Saran/kunci | Bukti agregat terbatas; kunci hanya di SecretStorage | Hanya permintaan yang dipratinjau persis setelah tindakan Kirim terpisah |

Reset tanpa bukti terstruktur tidak dapat direkonstruksi. Riwayat beberapa login
yang ambigu memakai pengamatan nyata terbaru untuk estimasi gabungan periode berjalan
berkeyakinan rendah; periode selesai tetap hanya menampilkan nilai terpakai. Nilai ekuivalen API bukan
tagihan. Retensi log sumber dikelola Claude Code/Codex; kontrol hapus eksplisit
adalah cara andal menghapus state turunan ekstensi.

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

Daftar lengkap penulis PR dan pelapor issue ada di [Credits README utama](README.md#credits), dengan PR yang digabung dibedakan dari usulan yang belum digabung.

Dibuat oleh [@jack21](https://github.com/jack21) dan dikelola oleh [@Carl723000](https://github.com/Carl723000). Berlisensi MIT.

Kredit alat pengembangan: pemeliharaan repositori menggunakan [Claude Code](https://claude.com/claude-code) dan [OpenAI Codex](https://developers.openai.com/codex/). Kredit alat ini dipisahkan dari kontributor manusia; Codex tidak ditambahkan ke daftar kontributor manusia Release Drafter dan tidak diberi identitas `Co-Authored-By` yang dibuat-buat.

**Issue, PR, dan ide sangat kami sambut** — begitulah proyek ini berkembang.

## Lisensi

[MIT](LICENSE)
