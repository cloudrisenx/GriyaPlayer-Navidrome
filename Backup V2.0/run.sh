#!/bin/bash
APP_DIR="/var/www/navidrome/web"

echo "Restarting GriyaPlayer Service..."

# 1. Hanya matikan port 7777
sudo fuser -k 7777/tcp || true
sleep 1

# 2. Jalankan Gunicorn GriyaPlayer
cd $APP_DIR
source venv/bin/activate
gunicorn --workers 4 --threads 2 --bind 127.0.0.1:7777 --daemon app:app

# 3. Refresh Nginx
sudo nginx -t && sudo systemctl restart nginx