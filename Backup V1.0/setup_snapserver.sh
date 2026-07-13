#!/bin/bash

echo "=== 1. Mengecek & Menginstall Snapserver ==="
sudo apt-get update
sudo apt-get install -y snapserver unzip wget

echo "=== 2. Memastikan Snapweb (Web UI) Terpasang ==="
# Kadang bawaan Ubuntu tidak menyertakan Snapweb, jadi kita unduh langsung rilis resminya
sudo rm -rf /usr/share/snapserver/snapweb
sudo mkdir -p /usr/share/snapserver/snapweb
wget -qO- https://github.com/badaix/snapweb/releases/latest/download/snapweb.zip | sudo tar xvz -C /usr/share/snapserver/snapweb/

echo "=== 3. Mengatur Konfigurasi 11 Ruangan ==="
cat <<EOF | sudo tee /etc/snapserver.conf
[stream]
# Mengambil jalur suara (FIFO) dari ke-11 zona MPD Anda
source = pipe:///tmp/snapfifo_griyapersada?name=GriyaPersada&sampleformat=48000:16:2
source = pipe:///tmp/snapfifo_jagat?name=Jagat&sampleformat=48000:16:2
source = pipe:///tmp/snapfifo_dialog?name=Dialog&sampleformat=48000:16:2
source = pipe:///tmp/snapfifo_hugo?name=Hugo&sampleformat=48000:16:2
source = pipe:///tmp/snapfifo_khayangan?name=Khayangan&sampleformat=48000:16:2
source = pipe:///tmp/snapfifo_obakso?name=Obakso&sampleformat=48000:16:2
source = pipe:///tmp/snapfifo_maruti?name=Maruti&sampleformat=48000:16:2
source = pipe:///tmp/snapfifo_ramashinta?name=RamaShinta&sampleformat=48000:16:2
source = pipe:///tmp/snapfifo_lokalfarm?name=LokalFarm&sampleformat=48000:16:2
source = pipe:///tmp/snapfifo_fo?name=FO&sampleformat=48000:16:2
source = pipe:///tmp/snapfifo_vgm?name=VGM&sampleformat=48000:16:2

[http]
# Mengaktifkan Port 1780 untuk Snapweb Browser
enabled = true
bind_to_address = 0.0.0.0
port = 1780
doc_root = /usr/share/snapserver/snapweb
EOF

echo "=== 4. Merestart Layanan Snapserver ==="
sudo systemctl restart snapserver
sudo systemctl enable snapserver

echo "SELESAI! Mesin sinkronisasi ruangan sudah online."