FROM ubuntu:22.04

# Hindari prompt interaktif selama instalasi paket
ENV DEBIAN_FRONTEND=noninteractive

# 1. Update repositori dan install runtime packages
RUN apt-get update && apt-get install -y \
    nginx \
    mpd \
    snapserver \
    ffmpeg \
    python3 \
    python3-pip \
    unzip \
    wget \
    curl \
    procps \
    && rm -rf /var/lib/apt/lists/*

# 2. Pasang Snapweb Client (Web UI Snapcast)
RUN mkdir -p /usr/share/snapserver/snapweb \
    && wget -q https://github.com/badaix/snapweb/releases/latest/download/snapweb.zip \
    && unzip -q -o snapweb.zip -d /usr/share/snapserver/snapweb/ \
    && rm snapweb.zip \
    && chown -R mpd:audio /usr/share/snapserver

# 3. Install Python Dependencies secara global
RUN pip3 install --no-cache-dir \
    Flask \
    requests \
    python-mpd2 \
    edge-tts \
    gunicorn \
    werkzeug

# 4. Konfigurasi direktori dan user system
WORKDIR /var/www/navidrome/web

# Salin source code ke dalam image
COPY . .

# Set izin akses eksekusi script
RUN chmod +x entrypoint.sh

# Expose port utama Nginx
EXPOSE 80

# Jalankan container entrypoint
ENTRYPOINT ["/bin/bash", "./entrypoint.sh"]
