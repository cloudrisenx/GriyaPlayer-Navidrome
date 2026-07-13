#!/bin/bash

# Daftar user/zona beserta Port MPD dan Port HTTP Web Stream-nya
declare -A users=(
    ["griyapersada"]="6600 8000"
    ["jagat"]="6601 8001"
    ["dialog"]="6602 8002"
    ["hugo"]="6603 8003"
    ["khayangan"]="6604 8004"
    ["obakso"]="6605 8005"
    ["maruti"]="6606 8006"
    ["ramashinta"]="6607 8007"
    ["lokalfarm"]="6608 8008"
)

echo "Memulai Auto-Provisioning 9 Zona MPD Griya Persada..."

for user in "${!users[@]}"; do
    # Pecah data port dari array
    read mpd_port http_port <<< "${users[$user]}"
    echo "Sedang memproses zona: $user (MPD: $mpd_port, Web: $http_port)..."

    # 1. Buat folder database khusus agar tidak bentrok
    mkdir -p /var/lib/mpd/$user/playlists
    chown -R mpd:audio /var/lib/mpd/$user

    # 2. Buat Pipa Suara (FIFO) untuk Snapcast
    rm -f /tmp/snapfifo_$user
    mkfifo /tmp/snapfifo_$user
    chown mpd:audio /tmp/snapfifo_$user
    chmod 666 /tmp/snapfifo_$user

    # 3. Tulis file konfigurasi MPD
    cat <<EOF > /etc/mpd_$user.conf
music_directory    "/var/www/navidrome/music"
playlist_directory "/var/lib/mpd/$user/playlists"
db_file            "/var/lib/mpd/$user/tag_cache"
log_file           "/var/log/mpd/mpd_$user.log"
pid_file           "/run/mpd/pid_$user"
state_file         "/var/lib/mpd/$user/state"
sticker_file       "/var/lib/mpd/$user/sticker.sql"

user               "mpd"
bind_to_address    "localhost"
port               "$mpd_port"

audio_output {
    type    "fifo"
    name    "Snapcast $user"
    path    "/tmp/snapfifo_$user"
    format  "48000:16:2"
}

audio_output {
    type            "httpd"
    name            "Web Stream $user"
    encoder         "lame"
    port            "$http_port"
    bind_to_address "0.0.0.0"
    bitrate         "320"
    format          "44100:16:2"
}
EOF

    # 4. Tulis Service Systemd agar auto-start saat Ubuntu restart
    cat <<EOF > /etc/systemd/system/mpd-$user.service
[Unit]
Description=Music Player Daemon khusus $user
After=network.target sound.target

[Service]
ExecStart=/usr/bin/mpd --no-daemon /etc/mpd_$user.conf
User=mpd
Group=audio
Restart=always

[Install]
WantedBy=multi-user.target
EOF

    # 5. Aktifkan dan jalankan!
    systemctl daemon-reload
    systemctl enable mpd-$user
    systemctl restart mpd-$user

done

echo "BERHASIL! Semua 9 zona MPD sudah online dan berjalan di background."
