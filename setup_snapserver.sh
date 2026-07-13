#!/bin/bash

echo "=== 1. Mengecek & Menginstall Snapserver ==="
sudo apt-get update
sudo apt-get install -y snapserver unzip wget

# --- PERBAIKAN: Pastikan User snapserver ada ---
if ! id "snapserver" &>/dev/null; then
    echo "User snapserver tidak ditemukan, membuat user baru..."
    sudo useradd -r -M -s /usr/sbin/nologin snapserver
fi

echo "=== 2. Memastikan Snapweb (Web UI) Terpasang ==="
sudo rm -rf /usr/share/snapserver/snapweb
sudo mkdir -p /usr/share/snapserver/snapweb
cd /tmp
wget -q https://github.com/badaix/snapweb/releases/latest/download/snapweb.zip
sudo unzip -q -o snapweb.zip -d /usr/share/snapserver/snapweb/
rm snapweb.zip

# --- PERBAIKAN: Beri izin akses folder web ke user mpd agar bebas hambatan ---
sudo chown -R mpd:audio /usr/share/snapserver

echo "=== 3. Membersihkan Master Snapserver Lama ==="
sudo systemctl stop snapserver
sudo systemctl disable snapserver
sudo rm -f /etc/systemd/system/snapserver.service
sudo rm -f /etc/snapserver.conf

declare -A users=(
    ["griyapersada"]="1700 1750 1780"
    ["jagat"]="1701 1751 1781"
    ["dialog"]="1702 1752 1782"
    ["hugo"]="1703 1753 1783"
    ["khayangan"]="1704 1754 1784"
    ["oobakso"]="1705 1755 1785"
    ["maruti"]="1706 1756 1786"
    ["ramashinta"]="1707 1757 1787"
    ["lokalfarm"]="1708 1758 1788"
    ["fo"]="1709 1759 1789"
    ["vgm"]="1710 1760 1790"
    ["anjani"]="1711 1761 1791"
    ["pancasona"]="1712 1762 1792"
)

for user in "${!users[@]}"; do
    read control_port stream_port http_port <<< "${users[$user]}"
    echo "Menyiapkan Snapserver Mandiri: $user (Web Port: $http_port)..."

    cat <<EOF | sudo tee /etc/snapserver_$user.conf > /dev/null
[server]
port = $control_port

[stream]
source = pipe:///tmp/snapfifo_$user?name=${user^}&sampleformat=48000:16:2

[http]
enabled = true
bind_to_address = 0.0.0.0
port = $http_port
doc_root = /usr/share/snapserver/snapweb

[tcp]
enabled = true
port = $stream_port
EOF

    sudo chown mpd:audio /etc/snapserver_$user.conf

    cat <<EOF | sudo tee /etc/systemd/system/snapserver-$user.service > /dev/null
[Unit]
Description=Snapcast server khusus $user
After=network.target sound.target mpd-$user.service
Wants=mpd-$user.service

[Service]
ExecStart=/usr/bin/snapserver -c /etc/snapserver_$user.conf
User=mpd
Group=audio
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable snapserver-$user
    sudo systemctl restart snapserver-$user
done

echo "SELESAI! 11 Mesin Snapserver Mandiri Terisolasi sudah online!"