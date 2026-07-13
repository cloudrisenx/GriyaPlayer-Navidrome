#!/bin/bash

# Tentukan lokasi file konfigurasi default Ubuntu
NGINX_CONF="/etc/nginx/sites-available/default"
BACKUP_CONF="/etc/nginx/sites-available/default.backup.$(date +%F_%H-%M-%S)"

echo "=== 1. Mem-backup konfigurasi Nginx saat ini ==="
sudo cp $NGINX_CONF $BACKUP_CONF
echo "Backup aman tersimpan di: $BACKUP_CONF"

echo "=== 2. Membuat file konfigurasi Nginx baru ==="
# Menulis bagian atas (Aplikasi Utama & Mapping Port Snapserver)
sudo tee $NGINX_CONF > /dev/null << 'INNER_EOF_1'
# MAP Referer Browser ke Port HTTP Snapserver yang tepat
map $http_referer $snap_port {
    default 1780;
    "~*/snapweb/griyapersada" 1780;
    "~*/snapweb/jagat" 1781;
    "~*/snapweb/dialog" 1782;
    "~*/snapweb/hugo" 1783;
    "~*/snapweb/khayangan" 1784;
    "~*/snapweb/oobakso" 1785;
    "~*/snapweb/maruti" 1786;
    "~*/snapweb/ramashinta" 1787;
    "~*/snapweb/lokalfarm" 1788;
    "~*/snapweb/fo" 1789;
    "~*/snapweb/vgm" 1790;
    "~*/snapweb/anjani" 1791;
    "~*/snapweb/pancasona" 1792;
}

server {
    listen 80;
    server_name 192.168.4.40;

    root /usr/share/nginx/html;
    index index.html;

    # --- 1. GRIYAPLAYER (Port 7777) ---
    location /griyaplayer/ {
        proxy_pass http://127.0.0.1:7777;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header SCRIPT_NAME /griyaplayer;
        client_max_body_size 50M;
    }

    # --- 2. INVENTORY GRIYA PERSADA (Port 5000) ---
    location /inventory/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header SCRIPT_NAME /inventory;
    }

    # --- 3. PORTAL IK (ROOT) ---
    location / {
        try_files $uri $uri/ =404;
    }

    # --- GLOBAL WEBSOCKET & STREAM SNAPWEB (Dinamis via Map) ---
    location /jsonrpc {
        proxy_pass http://127.0.0.1:$snap_port/jsonrpc;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
    location /stream {
        proxy_pass http://127.0.0.1:$snap_port/stream;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
INNER_EOF_1

# Array User dan Port Snapserver (Termasuk anjani & pancasona)
declare -A users=(
    ["griyapersada"]="1780" ["jagat"]="1781" ["dialog"]="1782"
    ["hugo"]="1783" ["khayangan"]="1784" ["obakso"]="1785"
    ["maruti"]="1786" ["ramashinta"]="1787" ["lokalfarm"]="1788"
    ["fo"]="1789" ["vgm"]="1790" ["anjani"]="1791" ["pancasona"]="1792"
)

# Loop untuk menambahkan rute /snapweb/$user/
for user in "${!users[@]}"; do
    http_port=${users[$user]}
    echo "Menambahkan blok Nginx untuk user: $user (Port $http_port)"
    
    sudo tee -a $NGINX_CONF > /dev/null << INNER_EOF_2

    # --- SNAPWEB UI: $user ---
    location /snapweb/$user/ {
        proxy_pass http://127.0.0.1:$http_port/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
INNER_EOF_2
done

# Menutup blok server
echo "}" | sudo tee -a $NGINX_CONF > /dev/null

echo "=== 3. Mengecek dan Me-restart Nginx ==="
sudo nginx -t

if [ $? -eq 0 ]; then
    sudo systemctl reload nginx
    echo "✅ SELESAI! Nginx diperbarui dengan user baru: anjani & pancasona."
else
    echo "❌ ERROR! Melakukan rollback..."
    sudo cp $BACKUP_CONF $NGINX_CONF
    sudo systemctl reload nginx
fi