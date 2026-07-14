#!/bin/bash
set -e

echo "=== 🚀 Menjalankan Inisialisasi GriyaPlayer Container ==="

# 1. Jalankan generator konfigurasi dynamic
python3 generate_configs.py

# 2. Jalankan background services (MPD, Snapservers, Nginx)
bash /run_services.sh

# 3. Jalankan Gunicorn Flask App di foreground untuk server log
echo "=== 🎵 Menjalankan Gunicorn Web Player (Port 7777) ==="
exec gunicorn --workers 4 --threads 2 --bind 127.0.0.1:7777 app:app
