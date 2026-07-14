# Docker Setup Guide: GriyaPlayer-Navidrome 🐳

Panduan ini menjelaskan arsitektur Docker, langkah instalasi, konfigurasi, dan pemeliharaan untuk menjalankan GriyaPlayer dan Navidrome secara lokal atau di server menggunakan Docker Compose.

---

## 🏗️ Arsitektur Kontainer

Sistem dideploy menggunakan **Docker Compose** yang mengelola dua container utama:

```
                  ┌────────────────────────────────────────┐
                  │               HOST LAN                 │
                  └───────────────────┬────────────────────┘
                                      │ (Port 80 & 4533)
                                      ▼
                  ┌────────────────────────────────────────┐
                  │             DOCKER BRIDGE              │
                  └─────────┬────────────────────┬─────────┘
                            │                    │
                            ▼ (HTTP Gateway)     ▼ (API/Stream)
 ┌──────────────────────────────────────┐   ┌─────────────────────────┐
 │           griyaplayer-app            │   │    navidrome-server     │
 │ ──────────────────────────────────── │   │ ─────────────────────── │
 │ • Nginx (Reverse Proxy Port 80)      │   │ • Navidrome Server      │
 │ • Gunicorn + Flask (Port 7777)       │◄──┼─── (Port 4533)          │
 │ • 13 x MPD Sockets (6600-6612)       │   │                         │
 │ • 13 x Snapservers (1750-1762 Stream)│   │                         │
 └──────────────────┬───────────────────┘   └────────────┬────────────┘
                    │                                    │
                    └───────────────┬────────────────────┘
                                    ▼ (Mount Volume)
                       ┌─────────────────────────┐
                       │   Project Root (Host)   │
                       │ ─────────────────────── │
                       │ • ./music/ (Raw Audio)  │
                       │ • ./navidrome_data/     │
                       └─────────────────────────┘
```

1. **`griyaplayer-app` (Custom Image)**:
   * **Nginx**: Berjalan sebagai gateway di port `80`, merouting Web UI player (`/griyaplayer/`) dan merouting WebSocket client audio secara dinamis menggunakan header `HTTP_REFERER`.
   * **Gunicorn/Flask**: Memproses logika web player, REST api, dan playlist.
   * **MPD (Music Player Daemon)**: 13 instance MPD berjalan di latar belakang untuk men-decode musik.
   * **Snapserver**: 13 instance Snapserver memproses PCM audio dari MPD dan mendistribusikannya ke speaker fisik atau browser client.
2. **`navidrome-server` (Official Image)**:
   * Berjalan di port `4533` sebagai server database musik dan library player.

---

## 📋 Persyaratan Sistem

* **Windows**: Docker Desktop dengan WSL2 backend terpasang dan aktif.
* **Linux**: Docker Engine & Docker Compose CLI terpasang.
* Memiliki folder musik berisi file audio (`.mp3`, `.wav`, `.ogg`, atau `.flac`).

---

## 🚀 Langkah Instalasi & Menjalankan

### Langkah 1: Kloning Repositori
Kloning kode sumber dari GitHub ke komputer Anda:
```bash
git clone git@github.com:cloudrisenx/GriyaPlayer-Navidrome.git
cd GriyaPlayer-Navidrome
```

### Langkah 2: Buat Folder Penyimpanan Musik
Sistem menggunakan relative volume mapping. Folder berikut akan dibuat otomatis (atau buat manual di project root):
* `./music` : Folder tempat Anda meletakkan file lagu.
* `./music_compressed` : Folder output untuk hasil kompresi lagu.
* `./navidrome_data` : Database penyimpanan internal Navidrome.

### Langkah 3: Bangun & Jalankan Container
Jalankan perintah ini di terminal Anda:
```bash
docker compose build
docker compose up -d
```
Perintah ini akan men-download resource, mengompilasi image `griyaplayer`, dan menjalankannya di latar belakang.

---

## ⚙️ Langkah Konfigurasi Awal

### 1. Inisialisasi Navidrome
1. Buka browser dan akses **[http://localhost:4533/](http://localhost:4533/)**.
2. Daftarkan akun **Administrator** baru.
3. Masuk ke menu **Settings (ikon gerigi) -> Users** dan tambahkan user baru sesuai nama ruangan di [config.py](file:///G:/Project_magang/GriyaPlayer-Navidrome/config.py) (contoh: `griyapersada`, `jagat`, `dialog`, `hugo`, dll.) dan beri password.
4. Salin file-file lagu Anda ke dalam folder `./music/`. Navidrome akan melakukan scan library otomatis setiap 1 menit.

### 2. Jalankan GriyaPlayer Web UI
1. Buka browser dan akses **[http://localhost/griyaplayer/](http://localhost/griyaplayer/)** (wajib diakhiri dengan garis miring `/`).
2. Login menggunakan username ruangan (contoh: `griyapersada`) dan password yang telah Anda buat di Navidrome pada langkah sebelumnya.
3. Web Player siap digunakan.

---

## 🛠️ Perintah Pemeliharaan (Maintenance)

* **Melihat Log Aplikasi**:
  ```bash
  docker compose logs -f griyaplayer
  ```
* **Melihat Log Navidrome**:
  ```bash
  docker compose logs -f navidrome
  ```
* **Merestart Layanan**:
  ```bash
  docker compose restart
  ```
* **Mematikan Container**:
  ```bash
  docker compose down
  ```
* **Melakukan Rebuild (setelah update file config.py)**:
  ```bash
  docker compose build
  docker compose up -d
  ```

---

## 📦 Apa itu GitHub Packages?

Di halaman GitHub repositori Anda, terdapat bagian bernama **Packages**. 

**GitHub Packages** adalah layanan hosting paket perangkat lunak (termasuk Docker Container Registry - `ghcr.io`) yang memungkinkan Anda meng-upload image Docker yang sudah jadi langsung ke GitHub.

### Manfaat Menggunakan GitHub Packages untuk GriyaPlayer:
1. **Instalasi Lebih Cepat (Tanpa Compile)**:
   Saat ini, user harus men-download seluruh source code, lalu menjalankan `docker compose build` untuk mengompilasi image di komputer lokal (butuh waktu beberapa menit).
   Jika di-publish ke GitHub Packages, user cukup menulis `image: ghcr.io/cloudrisenx/griyaplayer:latest` di file compose-nya. Docker akan langsung menarik image matang dari GitHub dalam hitungan detik tanpa perlu compile local.
2. **Keamanan & Konsistensi**:
   Image yang dipasang di production dipastikan 100% identik dengan yang lolos testing di server development.
3. **Kemudahan Integrasi CI/CD**:
   Anda dapat menyetel **GitHub Actions** agar setiap kali ada update di branch `main`, GitHub akan otomatis melakukan compile Docker image dan mem-publish-nya ke halaman Packages secara otomatis.
