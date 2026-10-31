# Biozatix Slide Viewer

Aplikasi web untuk mengelola case patologi dan slide mikroskop (WSI). Slide yang diunggah langsung dapat dilihat sebagai gambar bertile (Deep Zoom) tanpa proses konversi, diberi anotasi, dan dibandingkan berdampingan dalam split view. Akses diatur dengan login dan role yang permission-nya dapat diatur sendiri.

## Daftar isi

- [Teknologi](#teknologi)
- [Prasyarat](#prasyarat)
- [Menjalankan aplikasi](#menjalankan-aplikasi)
- [Konfigurasi database MySQL](#konfigurasi-database-mysql)
- [Login, role, dan permission](#login-role-dan-permission)
- [Tile service](#tile-service)
- [Log aplikasi](#log-aplikasi)
- [Struktur folder](#struktur-folder)
- [Arsitektur](#arsitektur)
- [Alur utama aplikasi](#alur-utama-aplikasi)
- [Endpoint HTTP](#endpoint-http)
- [Cara menambahkan halaman](#cara-menambahkan-halaman)
- [Batasan dan catatan](#batasan-dan-catatan)

## Teknologi

- **React 19 + React Router 7**, dibangun dengan **Vite**, untuk antarmuka di folder `client/`.
- **Bootstrap 5** dan **Font Awesome** untuk komponen dan ikon.
- **OpenSeadragon 6** (paket npm) untuk menampilkan gambar DZI dengan pemuatan tile sesuai tingkat zoom.
- **Node.js dan Express 5** sebagai REST API serta penyaji tile dan hasil build React.
- **express-session** dengan sesi tersimpan di MySQL (`express-mysql-session`), dan **bcryptjs** untuk hash password.
- **OpenSlide** (Python, di folder `tile-service/`) untuk membaca tile langsung dari file slide sesuai permintaan viewer.
- **Multer** untuk menerima file upload dengan penyimpanan ke disk.
- **MySQL** (melalui `mysql2`) untuk user, role, kategori, case, slide, dan anotasi.

Semua pustaka frontend dibundel oleh Vite, sehingga browser tidak membutuhkan CDN atau akses internet.

## Prasyarat

1. Node.js 20 atau lebih baru dan npm.
2. Python 3.9 atau lebih baru untuk tile service (lihat [Tile service](#tile-service)).
3. MySQL 5.7.8 atau lebih baru (dibutuhkan tipe kolom `JSON`), misalnya dari Laragon.
4. File slide yang dapat dibaca oleh OpenSlide, misalnya `.svs`, `.tif`, atau `.tiff`.

## Menjalankan aplikasi

Dari folder proyek:

```powershell
npm install
cd tile-service
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
cd ..
```

### Mode pengembangan

```powershell
npm run dev
```

Perintah ini menjalankan tiga proses sekaligus:

- **server**: Express di <http://localhost:3000>, dengan nodemon yang me-restart server saat file backend berubah.
- **client**: Vite di <http://localhost:5173>, dengan hot reload saat file React berubah. Request `/api` dan `/slides` diteruskan ke Express.
- **tiles**: tile service di <http://127.0.0.1:3100>. Proses ini tidak me-restart otomatis; jalankan ulang `npm run dev` setelah mengubah `tile-service/app.py`.

Saat pengembangan, buka **<http://localhost:5173>**. Ketiga proses juga bisa dijalankan terpisah dengan `npm run dev:server`, `npm run dev:client`, dan `npm run dev:tiles`.

### Produksi

```powershell
npm run build        # membangun React ke client/dist
npm run start:tiles  # tile service (biarkan berjalan, misalnya di terminal lain)
npm start            # Express menyajikan API, tile, dan client/dist
```

Kedua proses harus berjalan; untuk server sungguhan jalankan keduanya sebagai service (lihat [Tile service](#tile-service)). Buka <http://localhost:3000>. Port dapat diubah dengan variabel lingkungan `PORT`. Jika `client/dist` belum dibangun, halaman menampilkan pesan untuk menjalankan `npm run build`. Setiap ada perubahan di `client/`, jalankan `npm run build` lagi sebelum `npm start`.

Hentikan server dengan `Ctrl+C`.

## Konfigurasi database MySQL

1. Jalankan MySQL (di Laragon: **Start All**).
2. Salin `.env.example` menjadi `.env`, lalu isi kredensial MySQL dan `SESSION_SECRET`:

   ```env
   MYSQL_HOST=127.0.0.1
   MYSQL_PORT=3306
   MYSQL_USER=root
   MYSQL_PASSWORD=password_anda
   MYSQL_DATABASE=biozatix_slide_viewer
   SESSION_SECRET=string_acak_panjang
   ```

3. Buat database-nya, misalnya:

   ```powershell
   mysql -u root -p < database/schema.sql
   ```

Saat aplikasi dimulai, `database/initialize.js` menjalankan langkah berikut. Jika koneksi MySQL gagal, server tidak akan dimulai.

- Membuat atau memigrasikan semua tabel secara otomatis.
- Membuat role bawaan dan user `admin` pertama.
- Mendaftarkan file `.dzi` yang sudah ada di `public/slides/` ke tabel `slides` sebagai slide tanpa case.

| Tabel | Isi |
|---|---|
| `users` | Akun login: username, nama, hash password (bcrypt), role, status aktif, login terakhir |
| `roles` | Role. `is_system = 1` untuk Administrator, yang selalu memiliki semua permission |
| `role_permissions` | Permission yang dimiliki setiap role |
| `categories` | Kategori case (nama, deskripsi, warna) |
| `cases` | Case: nomor unik, judul, kategori, status (`open`, `in_review`, `closed`), deskripsi, pembuat |
| `slides` | Satu baris per slide: nama slide (`<nama>.dzi`), nama asli, nama file sumber, status (`ready`, `failed`, atau `processing` untuk sisa alur lama), magnifikasi, `case_id`, pengunggah |
| `slide_annotations` | Satu baris per slide berisi seluruh anotasi dalam kolom `JSON`; terhapus otomatis jika slide dihapus |
| `sessions` | Sesi login (dibuat otomatis oleh `express-mysql-session`) |

## Login, role, dan permission

Saat pertama kali dijalankan dengan tabel `users` kosong, aplikasi membuat user berikut:

| Username | Password |
|---|---|
| `admin` | Nilai `ADMIN_PASSWORD` di `.env`, atau `admin123` jika tidak diisi |

**Segera ganti password ini** lewat menu user di kanan atas, lalu pilih **Ganti password**.

Role bersifat dinamis. Di halaman **Role & Permission**, admin dapat membuat role baru dan mencentang permission yang dimilikinya. Tiga role dibuat otomatis:

| Role | Permission |
|---|---|
| Administrator (sistem) | Semua permission. Tidak dapat diubah atau dihapus |
| Patolog | Melihat, membuat, dan mengubah case; melihat dan mengunggah slide; membuat anotasi |
| Viewer | Melihat case dan slide (termasuk anotasi) tanpa mengubah apa pun |

Daftar permission ada di `config/permissions.js`:

| Permission | Fungsi |
|---|---|
| `cases.view` / `cases.create` / `cases.update` / `cases.delete` | Melihat, membuat, mengubah (termasuk memindahkan slide antar case), dan menghapus case |
| `slides.view` | Melihat slide, tile, dan anotasi; membuka split view |
| `slides.upload` | Mengunggah slide ke case |
| `slides.delete` | Menghapus slide beserta file sumber, cache tile, dan anotasinya |
| `annotations.edit` | Membuat dan menyimpan anotasi |
| `categories.manage` | Mengelola kategori |
| `users.manage` | Mengelola user: membuat, mengubah role, menonaktifkan, mereset password |
| `roles.manage` | Mengelola role dan permission |
| `settings.manage` | Mengatur nama aplikasi, subtitle, dan logo (Administrasi → Pengaturan) |

Pengaman bawaan:

- User tidak dapat menghapus, menonaktifkan, atau mengubah role akunnya sendiri.
- Harus selalu ada minimal satu administrator aktif.
- Perubahan role dan user berlaku dalam beberapa detik tanpa perlu login ulang.
- Setelah 10 kali gagal login untuk username yang sama dari IP yang sama, login diblokir selama 15 menit.

Semua endpoint `/api` kecuali login, serta semua file di `/slides` (DZI dan tile), membutuhkan sesi login. File slide tidak dapat dibuka tanpa login meskipun URL-nya diketahui.

| Variabel `.env` | Default | Fungsi |
|---|---|---|
| `SESSION_SECRET` | acak tiap start | Kunci penanda cookie sesi. Wajib diisi; tanpa ini semua user ter-logout setiap kali server restart |
| `SESSION_MAX_AGE_HOURS` | `12` | Lama sesi tanpa aktivitas sebelum harus login ulang |
| `COOKIE_SECURE` | `false` | Isi `true` jika aplikasi diakses melalui HTTPS |
| `TRUST_PROXY` | – | Isi `1` jika berjalan di belakang reverse proxy (misalnya nginx), agar IP dan HTTPS terbaca benar |
| `ADMIN_PASSWORD` | `admin123` | Password user `admin` pertama. Hanya dipakai saat tabel `users` kosong |

### Pengaturan tampilan aplikasi

Di **Administrasi → Pengaturan** (permission `settings.manage`), admin dapat mengubah:

- **Nama aplikasi** (wajib, maksimal 60 karakter).
- **Subtitle** (opsional, maksimal 120 karakter).
- **Logo:** PNG, JPG, atau WebP, maksimal 1 MB. Jenis file diperiksa dari isinya, bukan dari ekstensinya. SVG tidak diterima karena dapat berisi skrip. Tanpa logo, dipakai ikon mikroskop bawaan.

Ketiganya tampil di halaman login, header aplikasi, header halaman link berbagi, judul tab, dan favicon. Nilainya disimpan di tabel `app_settings`, dan logo di `public/branding/`. Endpoint `GET /api/public/settings` dapat dibaca tanpa login karena halaman login membutuhkannya.

### Tema dan bahasa

Setiap user memilih **tema** (Terang, Gelap, atau Ikuti sistem) dan **bahasa** (Bahasa Indonesia atau English) dari menu akun di kanan atas, dari halaman **Akun Saya**, atau dari halaman login. Pilihan disimpan per browser di `localStorage` (`ui-theme`, `ui-language`). Bawaannya Ikuti sistem dan Bahasa Indonesia.

**Tema:**
- Tema diterapkan lewat atribut `data-theme` dan `data-bs-theme` pada `<html>`. Warna didefinisikan sebagai token CSS di `client/src/styles/app.css`, dengan versi gelap di blok `:root[data-theme='dark']`.
- "Ikuti sistem" langsung berganti saat tema OS berganti.
- Skrip kecil di `client/index.html` menerapkan tema sebelum aplikasi dimuat, sehingga halaman tidak berkedip putih.

**Bahasa:**
- Teks di kode ditulis dalam Bahasa Indonesia dan dibungkus `t('...')` dari `client/src/i18n`. Terjemahan Inggrisnya ada di `client/src/i18n/en.js`, dengan teks Indonesia sebagai kuncinya.
- Teks yang belum punya terjemahan tetap tampil dalam Bahasa Indonesia, jadi tidak pernah kosong.
- Pesan dari server diterjemahkan di browser, termasuk pesan yang berisi angka (lewat pola di `EN_PATTERNS`).
- Format tanggal dan angka mengikuti bahasa yang dipilih.
- Mengganti bahasa me-render ulang seluruh aplikasi. Jika ada anotasi yang belum disimpan, aplikasi meminta konfirmasi dulu.
- Untuk menambah teks baru: tulis `t('Teks Indonesia')` di komponen, lalu tambahkan terjemahannya di `en.js`. Teks dengan angka dapat memakai `{n}` dan bentuk `{ one, other }`.

## Tile service

Tile slide tidak dibuat di depan. `tile-service/app.py` (Python, OpenSlide) membaca tile langsung dari file yang diunggah di `uploads/` saat viewer memintanya, lalu menyimpannya di cache `storage/tile-cache/`. Karena itu slide langsung dapat dibuka begitu upload selesai.

```text
Browser → Express /slides/<nama>.dzi, /slides/<nama>_files/<level>/<x>_<y>.jpg   (login, permission, link share)
        → middleware/tileProxyMiddleware.js → tile service 127.0.0.1:3100 → OpenSlide → file di uploads/
```

- Tile service hanya mendengarkan di `127.0.0.1` dan tidak memeriksa login; semua akses lewat Express.
- Slide lama yang dulu dikonversi oleh vips masih punya file `.dzi` di `public/slides/`. Slide tersebut tetap disajikan dari file statis itu.
- Cache dibatasi `TILE_CACHE_MAX_GB`; tile yang paling lama tidak dibuka dihapus lebih dulu. Folder cache boleh dihapus kapan saja dan akan terisi lagi.
- Express memanggil tile service lewat `127.0.0.1`, bukan `localhost`, karena di Windows `localhost` menambah jeda sekitar 250 ms per request.

### Instalasi

```powershell
cd tile-service
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

Paket `openslide-bin` sudah berisi library OpenSlide untuk Windows, Linux, dan macOS, jadi tidak perlu instalasi terpisah. Di Linux, pakai `.venv/bin/python` dan pastikan paket `python3-venv` terpasang.

`scripts/tile-service.js` (dipakai oleh `npm run dev:tiles` dan `npm run start:tiles`) menjalankan Python dari `.venv` dengan `.env` yang sama seperti Express, dan mengarahkan tile service ke folder `uploads/`.

### Pengaturan `.env`

| Variabel | Default | Fungsi |
|---|---|---|
| `TILE_SERVICE_HOST` | `127.0.0.1` | Alamat tile service (dipakai Express dan Python) |
| `TILE_SERVICE_PORT` | `3100` | Port tile service |
| `TILE_SERVICE_THREADS` | `8` | Jumlah thread yang melayani request tile |
| `TILE_CACHE_DIR` | `storage/tile-cache` | Folder cache tile, relatif terhadap folder proyek |
| `TILE_CACHE_MAX_GB` | `5` | Batas ukuran cache; `0` menonaktifkan cache |
| `TILE_JPEG_QUALITY` | `80` | Kualitas JPEG tile |
| `UPLOAD_TIMEOUT_MINUTES` | `120` | Batas waktu satu request upload |

### Menjalankan sebagai service

Express dan tile service adalah dua proses yang harus selalu hidup. Jika tile service mati, slide baru tidak dapat dibuka (`503`) dan upload tersimpan sebagai slide gagal yang dapat diperiksa ulang.

Windows, dengan [NSSM](https://nssm.cc/):

```powershell
nssm install SlideViewerTiles "C:\Program Files\nodejs\node.exe" "D:\path\ke\proyek\scripts\tile-service.js"
nssm set SlideViewerTiles AppDirectory "D:\path\ke\proyek"
nssm install SlideViewer "C:\Program Files\nodejs\node.exe" "D:\path\ke\proyek\index.js"
nssm set SlideViewer AppDirectory "D:\path\ke\proyek"
nssm start SlideViewerTiles
nssm start SlideViewer
```

Linux, dengan pm2 (atau dua unit systemd):

```bash
pm2 start scripts/tile-service.js --name slide-viewer-tiles
pm2 start index.js --name slide-viewer
pm2 save && pm2 startup
```

Di Windows, menambahkan `uploads` dan `storage/tile-cache` ke exclusion Windows Defender mempercepat pembacaan file dan penulisan cache.

### Menjalankan di Linux

```bash
sudo apt install python3-venv mysql-server   # atau mariadb-server
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install nodejs
```

Lalu jalankan `npm install`, pasang tile service seperti di atas, salin `.env.example` ke `.env`, jalankan `npm run build`, kemudian jalankan kedua proses sebagai service. Pasang reverse proxy dengan `client_max_body_size 5g`. Di belakang reverse proxy, isi `TRUST_PROXY=1`, dan isi `COOKIE_SECURE=true` jika memakai HTTPS.

## Log aplikasi

Semua proses dicatat oleh `utils/logger.js` ke folder `logs/` (dibuat otomatis) dan juga ditampilkan di terminal.

| File | Isi |
|---|---|
| `logs/app-YYYY-MM-DD.log` | Seluruh aktivitas hari itu: startup server, request HTTP, login, perubahan data, upload, pemeriksaan slide oleh tile service, dan anotasi |
| `logs/error-YYYY-MM-DD.log` | Hanya baris `WARN` dan `ERROR`, termasuk login yang gagal dan tile service yang tidak dapat dihubungi; cek file ini lebih dulu saat ada masalah |

Tile service mencetak log-nya sendiri (diawali `[tile-service]`) ke terminal tempat ia dijalankan, termasuk request yang lebih lama dari 1 detik.

Contoh baris:

```text
2026-10-18T19:44:51.022+07:00 INFO  [upload] Upload received: KN7.svs {"savedAs":"1792327491014-KN7.svs","sizeMB":268.1,"caseId":3,"by":"admin","ip":"::1"}
2026-10-18T19:44:51.310+07:00 INFO  [upload] Slide 1792327491014-KN7 opened by the tile service {"width":180224,"height":88080,"magnification":40,"vendor":"aperio"}
```

Label dalam kurung siku menunjukkan bagian aplikasi yang mencatat baris tersebut:

- **Server dan HTTP:** `server`, `http`, `app` (error handler)
- **Akun dan akses:** `auth`, `users`, `roles`
- **Data:** `categories`, `cases`, `slides`
- **Upload dan tile:** `upload`, `tiles`
- **Anotasi:** `annotation`

Request tile dan aset statis tidak dicatat karena jumlahnya ribuan per sesi. Polling status slide hanya dicatat pada level `debug`.

| Variabel `.env` | Default | Fungsi |
|---|---|---|
| `LOG_LEVEL` | `info` | Level minimum: `debug`, `info`, `warn`, `error` |
| `LOG_DIR` | `logs` | Lokasi folder log, relatif terhadap folder proyek |
| `LOG_RETENTION_DAYS` | `30` | Log harian yang lebih lama dari ini dihapus otomatis |

## Struktur folder

```text
.
├── app.js                  # Express: sesi, API, tile, dan penyajian React
├── index.js                # memulai server
├── vite.config.mjs         # konfigurasi build dan dev server React
├── config/
│   ├── paths.js
│   ├── permissions.js      # daftar permission dan role bawaan
│   ├── session.js
│   └── upload.js
├── controllers/            # auth, user, role, category, case, slide
├── database/
│   ├── initialize.js       # membuat/migrasi tabel, seed role dan admin
│   ├── pool.js
│   └── schema.sql
├── middleware/
│   ├── auth.js             # requireAuth, requirePermission
│   ├── blankTileMiddleware.js
│   ├── dziMiddleware.js
│   ├── requestLogger.js
│   └── tileProxyMiddleware.js  # meneruskan /slides dan /share-tiles ke tile service
├── models/                 # query MySQL per entitas
├── routes/                 # authRoutes, userRoutes, caseRoutes, slideRoutes
├── scripts/
│   └── tile-service.js     # menjalankan tile service dengan .env yang sama
├── services/
│   ├── slideSourceService.js  # memeriksa apakah slide dapat dibuka oleh tile service
│   ├── tileService.js      # client HTTP ke tile service
│   └── ...
├── tile-service/           # Python + OpenSlide: tile langsung dari file slide
│   ├── app.py
│   └── requirements.txt
├── utils/
│   ├── logger.js
│   └── validation.js
├── client/                 # aplikasi React
│   ├── index.html
│   ├── dist/               # hasil "npm run build" (jangan disunting)
│   └── src/
│       ├── App.jsx         # daftar route
│       ├── api.js          # fetch dan upload dengan progres
│       ├── auth/           # AuthContext (user login dan can())
│       ├── components/     # layout, modal, toast, kartu slide, upload, dll.
│       ├── pages/          # satu file per halaman
│       ├── viewer/         # SlideViewer (OpenSeadragon + anotasi), kontrol, magnifikasi
│       └── styles/
├── public/
│   ├── img/blank-tile.jpg
│   └── slides/             # DZI slide lama hasil konversi vips (dilindungi login)
├── uploads/                # file slide asli; sumber semua tile
├── storage/tile-cache/     # cache tile, boleh dihapus
└── logs/
```

`public/slides/`, `uploads/`, dan `storage/tile-cache/` dibuat otomatis. File di `uploads/` adalah satu-satunya salinan slide, jadi sertakan folder ini dalam backup. File tersebut baru terhapus saat slidenya dihapus.

## Arsitektur

Backend tetap memakai pemisahan route → controller → model/service. Frontend adalah single-page app React yang berkomunikasi dengan backend hanya melalui JSON API.

```text
Browser (React)
  → fetch /api/...                     → requireAuth → requirePermission → Controller → Model/Service → JSON
  → OpenSeadragon /slides/...          → requireAuth → tileProxyMiddleware → tile service
                                         (slide lama: dziMiddleware / file statis / blankTileMiddleware)
  → URL lain (/cases/12, /viewer/5...) → client/dist/index.html, lalu React Router memilih halaman
```

- **`middleware/auth.js`** membaca user dari sesi, memuat permission role-nya, dan menolak request dengan `401` atau `403`. Data user di-cache 15 detik karena request tile sangat banyak.
- **`client/src/viewer/SlideViewer.jsx`** adalah satu viewer OpenSeadragon lengkap: perbesaran, skala, posisi kursor, dan anotasi. Halaman viewer memakainya sekali dengan alat anotasi; halaman bandingkan memakainya hingga empat kali dalam mode ringkas.
- **`client/src/auth/AuthContext.jsx`** menyediakan `can('permission')` untuk menyembunyikan menu dan tombol. Penyembunyian ini hanya untuk kenyamanan; pemeriksaan sebenarnya selalu dilakukan di server.

## Alur utama aplikasi

### Case dan kategori

1. Admin membuat kategori lewat menu **Administrasi → Kategori**, misalnya Histopatologi, Sitologi, atau IHC. Semua kategori, beserta jumlah case-nya, tampil di sidebar halaman Case untuk menyaring daftar case.
2. User dengan `cases.create` membuat case di halaman **Case**, lalu memilih kategori dan status.
3. Halaman case menampilkan info case, area upload, dan semua slide di dalamnya, termasuk slide yang gagal dibuka.
4. Slide dapat dipindahkan ke case lain atau dikeluarkan dari case melalui menu ⋮ pada kartu slide.
5. Case yang masih berisi slide tidak dapat dihapus. Kategori yang masih dipakai case juga tidak dapat dihapus.

Halaman awal (`/`, menu **Slide**) menampilkan galeri semua slide yang siap dilihat. Di kirinya ada sidebar berisi **Semua slide** dan daftar kategori. Slide lama yang sudah ada sebelum fitur case dibuat dapat disaring dengan filter **Slide tanpa case**, lalu dipindahkan ke case dari menu ⋮ pada kartunya. Alamat lama `/library` otomatis dialihkan ke halaman awal.

### Mengunggah slide

1. Di halaman case, pengguna menekan **Unggah slide** atau menyeret file ke halaman. File masuk antrian (panel kanan bawah) dan diunggah satu per satu, juga saat pengguna pindah halaman.
2. Setiap file dikirim per potongan 8 MB (upload resumable, maksimal 5 GB). Server menyimpan potongan di `uploads/.partial/`. Koneksi yang putus dicoba ulang otomatis dan dilanjutkan dari potongan terakhir; setelah tab ditutup atau server restart, memilih file yang sama lagi juga melanjutkan upload. Sesi yang tidak dilanjutkan selama 24 jam dihapus otomatis.
3. Setelah potongan terakhir diterima, server meminta tile service membuka file (kurang dari satu detik) untuk membaca ukuran dan magnifikasinya, lalu membuat baris `ready` dan membalas `201`. Tidak ada proses konversi, jadi slide langsung dapat dibuka.
4. File yang tidak dapat dibaca sebagai slide ditolak dengan `400` dan dihapus. Jika tile service sedang mati, file tetap disimpan sebagai slide `failed`; setelah tile service hidup, pilih menu ⋮ → **Periksa ulang**.
5. Slide yang masih `processing` dari alur konversi lama diperiksa otomatis lewat tile service saat server dimulai.

### Viewer dan anotasi

Viewer berada di `/viewer/:slideId`. User dengan `annotations.edit` mendapat alat geser, persegi, elips, panah, gambar bebas, dan teks, beserta pilihan warna, tombol batalkan, dan hapus semua. User lain melihat anotasi tanpa alat edit.

Setiap anotasi memiliki **nama** dan **deskripsi**, serta mencatat siapa pembuatnya, siapa pengubah terakhirnya, dan kapan. Nama pembuat dicatat oleh server, bukan oleh browser. Panel **Daftar anotasi** di sisi kanan viewer menampilkan semua anotasi: klik salah satunya untuk langsung menuju lokasinya di slide (anotasi itu disorot), lalu isi nama dan deskripsinya. Anotasi baru otomatis terpilih supaya bisa langsung diberi nama. Tombol `Delete` menghapus anotasi yang terpilih.

Penyimpanan memakai nomor revisi. Jika anotasi slide sudah diubah orang lain sejak dimuat, penyimpanan ditolak dengan peringatan dan Anda dapat memuat versi terbaru. Dengan begitu, perubahan orang lain tidak tertimpa diam-diam.

Anotasi digambar di lapisan SVG dengan koordinat piksel slide, sehingga tetap tepat di semua tingkat zoom dan saat slide diputar. Tombol simpan (`Ctrl+S`) mengirim anotasi ke `PUT /api/slides/:slideId/annotations`. Titik oranye pada tombol simpan menandai perubahan yang belum disimpan, dan aplikasi meminta konfirmasi sebelum meninggalkan halaman. Daftar shortcut ada di tombol **?**.

Perbesaran yang ditampilkan dihitung dari rasio piksel layar terhadap piksel slide, dikali perbesaran objektif scanner (`magnification` di database, default 40×). Tombol 1×–80× melompat ke perbesaran standar mikroskop; perbesaran di atas milik scanner adalah zoom digital. Skala (µm) memakai perkiraan `10 / perbesaran` µm per piksel (0,25 µm/px pada 40×).

### Split view (bandingkan slide)

Halaman **Bandingkan Slide** (`/compare?slides=12,15&layout=2`) menampilkan 1–4 panel. Setiap panel memilih slide sendiri dari daftar yang dikelompokkan per case, dan URL-nya dapat dibagikan.

Halaman ini dapat dibuka dari beberapa tempat:

- Halaman case, lewat tombol **Bandingkan semua**, atau dengan mencentang beberapa slide lalu menekan **Bandingkan**.
- Halaman awal (Semua slide), dengan mencentang slide.
- Viewer, lewat tombol bandingkan.

Kontrol di halaman ini:

- **Sinkron**: saat diaktifkan, posisi tiap panel saat itu menjadi titik awal. Setelah itu, geser dan zoom pada panel aktif (bergaris biru) menggerakkan panel lain sejauh jarak fisik yang sama (µm) dan ke perbesaran yang sama. Dengan cara ini potongan serial yang letaknya berbeda di kaca tetap sejajar. Atur posisi masing-masing panel dulu, baru aktifkan Sinkron.
- **Anotasi**: menampilkan atau menyembunyikan anotasi tersimpan di semua panel. Anotasi diedit di viewer tunggal, lewat ikon ↗ pada panel.
- **Tombol zoom, putar, dan fit** di bar atas berlaku untuk semua panel. Shortcut keyboard berlaku untuk panel aktif.

### Berbagi link publik

Link publik membuka slide **tanpa login** dan hanya untuk dilihat, misalnya untuk konsultasi ke dokter di luar sistem. Pembuat link membutuhkan permission `shares.create`.

| Yang dibagikan | Dari mana |
|---|---|
| Satu slide, opsional dengan posisi, zoom, dan rotasi saat ini | Tombol **Bagikan** di viewer, atau menu ⋮ pada kartu slide |
| Tampilan perbandingan (tata letak, slide, posisi tiap panel, status sinkron) | Tombol **Bagikan** di halaman Bandingkan |
| Beberapa slide pilihan (boleh dari case dan kategori berbeda, maksimal 100) | Centang slide di galeri atau halaman case (pilihan tetap tersimpan saat berpindah halaman), lalu **Bagikan** di bar bawah |
| Satu case, atau beberapa case pilihan (maksimal 50) | Tombol **Bagikan** di halaman case, atau centang case di tabel Case |
| Satu kategori | **Bagikan kategori** di galeri kategori, atau ikon berbagi di halaman Kategori |

Pengaturan saat membuat link:

- **Masa berlaku:** 1, 7, 30, atau 90 hari, atau tanpa batas.
- **Password** (opsional): setelah 10 kali salah, percobaan diblokir 15 menit per IP.
- **Anotasi:** tampilkan anotasi tersimpan atau tidak.
- **Catatan klinis:** sembunyikan catatan klinis case.
- **Akses anotasi:** izinkan penerima membuat dan mengedit anotasi. Penerima mengisi nama dulu, lalu menyimpan langsung ke anotasi slide; setiap anotasi yang ia buat atau ubah tercatat dengan namanya dan label "tamu".

Cara kerja link:

- Link berbentuk `/s/<token>`, dengan token acak 32 karakter.
- Tile disajikan lewat `/share-tiles/<token>/...`, dan hanya untuk slide yang termasuk dalam link.
- Link case, kategori, dan case pilihan bersifat hidup: slide yang ditambahkan kemudian ikut terlihat.
- Link slide pilihan dan perbandingan tetap berisi slide yang dipilih saat link dibuat.
- Penerima link berisi beberapa slide dapat membandingkan 2–4 slide berdampingan.

Riwayat link ada di menu **Link Berbagi** pada navigasi atas. Di sana tampil status (aktif, kedaluwarsa, dicabut), jumlah dibuka, dan waktu terakhir dibuka. Link yang dicabut langsung berhenti bekerja. Permission `shares.manage` memungkinkan melihat dan mencabut link milik semua user.

## Endpoint HTTP

Semua endpoint kecuali `POST /api/auth/login` membutuhkan login. Kolom permission menunjukkan permission yang dibutuhkan; jika tercantum lebih dari satu, salah satunya sudah cukup.

| Method | URL | Permission | Fungsi |
|---|---|---|---|
| `POST` | `/api/auth/login` | – | Login dengan `{ username, password }` |
| `POST` | `/api/auth/logout` | – | Logout |
| `GET` | `/api/auth/me` | – | User saat ini beserta daftar permission |
| `PUT` | `/api/auth/password` | – | Ganti password sendiri `{ currentPassword, newPassword }` |
| `GET` | `/api/permissions` | – | Daftar semua permission (untuk halaman role) |
| `GET`, `POST` | `/api/users` | `users.manage` | Daftar user / buat user |
| `PUT`, `DELETE` | `/api/users/:id` | `users.manage` | Ubah user (termasuk reset password) / hapus user |
| `GET` | `/api/roles` | `roles.manage`, `users.manage` | Daftar role beserta permission |
| `POST` | `/api/roles` | `roles.manage` | Buat role `{ name, description, permissions: [] }` |
| `PUT`, `DELETE` | `/api/roles/:id` | `roles.manage` | Ubah / hapus role. Role sistem dan role yang masih dipakai tidak dapat dihapus |
| `GET` | `/api/categories` | – | Daftar kategori |
| `POST` | `/api/categories` | `categories.manage` | Buat kategori `{ name, description, color }` |
| `PUT`, `DELETE` | `/api/categories/:id` | `categories.manage` | Ubah / hapus kategori |
| `GET` | `/api/cases?search=&categoryId=&status=` | `cases.view` | Daftar case |
| `POST` | `/api/cases` | `cases.create` | Buat case `{ caseNumber, title, categoryId, status, description }` |
| `GET` | `/api/cases/:id` | `cases.view` | Detail case beserta semua slide-nya |
| `PUT` | `/api/cases/:id` | `cases.update` | Ubah case |
| `DELETE` | `/api/cases/:id` | `cases.delete` | Hapus case yang tidak berisi slide |
| `POST` | `/api/cases/:id/slides` | `slides.upload` | Unggah slide (multipart, field `slide`); membalas `201` dengan `status` (`ready` atau `failed`) dan `dzi`. File yang bukan slide ditolak `400` |
| `POST` | `/api/cases/:id/uploads` | `slides.upload` | Mulai upload resumable `{ fileName, size }`; membalas `{ id, offset, chunkSize }` |
| `GET` | `/api/uploads/:uploadId` | `slides.upload` | Offset yang sudah diterima, untuk melanjutkan upload |
| `PATCH` | `/api/uploads/:uploadId` | `slides.upload` | Kirim satu potongan (body biner, header `Upload-Offset`); `409` dengan `offset` bila posisinya tidak cocok. Potongan terakhir mendaftarkan slide dan membalas seperti upload biasa |
| `DELETE` | `/api/uploads/:uploadId` | `slides.upload` | Batalkan upload dan hapus potongannya |
| `GET` | `/api/slides?caseId=&unassigned=1` | `slides.view` | Slide berstatus `ready` |
| `GET` | `/api/slides/:id` | `slides.view` | Detail satu slide beserta case-nya |
| `GET` | `/api/slides/:id/status` | `slides.view`, `slides.upload` | Status slide |
| `POST` | `/api/slides/:id/retry` | `slides.upload` | Periksa ulang slide berstatus `failed`; `200` jika kini siap, `422` jika file bukan slide, `503` jika tile service tidak tersedia |
| `PATCH` | `/api/slides/:id` | `cases.update` | Ganti nama atau pindahkan slide `{ originalName, caseId }`; `caseId: null` berarti tanpa case |
| `DELETE` | `/api/slides/:id` | `slides.delete` | Hapus slide, file sumber, cache tile, dan anotasinya |
| `GET` | `/api/slides/:id/annotations` | `slides.view` | Ambil anotasi |
| `PUT` | `/api/slides/:id/annotations` | `annotations.edit` | Simpan (mengganti) anotasi `{ annotations, revision }`, maksimal 5000 item; `409` jika revisi sudah berubah |
| `GET` | `/slides/<nama>.dzi`, `/slides/<nama>_files/...` | `slides.view` | Metadata DZI dan tile |
| `GET` | `/api/shares?all=1` | `shares.create`, `shares.manage` | Riwayat link (milik sendiri; `all=1` untuk semua user, butuh `shares.manage`) |
| `POST` | `/api/shares` | `shares.create` | Buat link `{ type, resourceId, viewState, title, expiresInDays, password, hideClinical, showAnnotations }`; `type`: `slide`, `case`, `category`, `compare`, `slides`, `cases` |
| `DELETE` | `/api/shares/:id` | `shares.create`, `shares.manage` | Cabut link |
| `GET` | `/api/public/shares/:token` | tanpa login | Isi link; `401` jika butuh password, `410` jika dicabut/kedaluwarsa |
| `POST` | `/api/public/shares/:token/unlock` | tanpa login | Buka link berpassword `{ password }` |
| `GET` | `/api/public/shares/:token/slides/:id/annotations` | tanpa login | Anotasi slide dalam link |
| `PUT` | `/api/public/shares/:token/slides/:id/annotations` | tanpa login, link dengan akses anotasi | Simpan anotasi `{ annotations, revision, authorName }` |
| `GET` | `/share-tiles/:token/...` | tanpa login | DZI dan tile slide dalam link |

Kode status untuk request yang ditolak:

- **`400`**: upload tanpa file, atau dengan ekstensi selain `.svs`, `.tif`, `.tiff`.
- **`413`**: file lebih besar dari batas upload.
- **`409`**: nama atau nomor yang sudah dipakai.

## Cara menambahkan halaman

Contoh berikut menambahkan halaman laporan di `/reports` yang hanya boleh dibuka user dengan permission baru `reports.view`.

1. Tambahkan permission di `config/permissions.js`:

   ```js
   { key: 'reports.view', group: 'Laporan', label: 'Melihat laporan' },
   ```

   Permission ini langsung muncul di halaman **Role & Permission** dan otomatis dimiliki Administrator.

2. Buat endpoint di backend (controller dan route), lalu daftarkan route-nya di `app.js` setelah `app.use('/api', requireAuth)`:

   ```js
   // routes/reportRoutes.js
   router.get('/reports', requirePermission('reports.view'), reportController.listReports);
   ```

3. Buat halaman React `client/src/pages/ReportsPage.jsx` yang memanggil `api('/reports')`.
4. Daftarkan route di `client/src/App.jsx`:

   ```jsx
   { path: 'reports', element: guarded(['reports.view'], <ReportsPage />) },
   ```

5. Tambahkan menu di `NAV_SECTIONS` pada `client/src/components/AppLayout.jsx`.

Route React tidak boleh diawali `/api`, `/slides`, atau `/share-tiles`, karena path tersebut dilayani Express.

## Batasan dan catatan

- Slide yang gagal dibuka (misalnya karena tile service mati saat upload) dapat diperiksa ulang dari menu ⋮ → **Periksa ulang** (`POST /api/slides/:id/retry`, permission `slides.upload`), atau dihapus untuk membersihkan file sumbernya. Slide lama yang dulu gagal dikonversi vips juga dapat dipulihkan dengan cara ini selama file sumbernya masih ada.
- Server hanya menerima ekstensi `.svs`, `.tif`, dan `.tiff`, tetapi isi file tidak diperiksa.
- Pembatas percobaan login dan password link disimpan di memori proses, sehingga hanya satu instance server yang boleh berjalan untuk database yang sama. Server memegang kunci MySQL (`GET_LOCK`) selama berjalan; instance kedua akan menolak start dengan pesan di log.
- Semua user dengan `cases.view` atau `slides.view` dapat melihat semua case dan slide. Belum ada pembatasan per case, misalnya hanya case yang ditugaskan.
- Perintah `npm test` belum menjalankan test suite; script tersebut masih berupa placeholder di `package.json`.
