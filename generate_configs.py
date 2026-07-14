import os
import sys

# Tambahkan direktori kerja ke sys.path agar config.py bisa di-import
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.append(BASE_DIR)

try:
    import config
except ImportError:
    print("Error: config.py tidak ditemukan di folder utama.")
    sys.exit(1)

def build_mpd_config(username, mpd_port, http_port):
    return f"""music_directory    "/var/www/navidrome/music"
playlist_directory "/var/lib/mpd/{username}/playlists"
db_file            "/var/lib/mpd/{username}/tag_cache"
log_file           "/var/log/mpd/mpd_{username}.log"
pid_file           "/run/mpd/pid_{username}"
state_file         "/var/lib/mpd/{username}/state"
sticker_file       "/var/lib/mpd/{username}/sticker.sql"

# --- OPTIMASI BUFFER ANTI MACET ---
audio_buffer_size  "4096" 
buffer_before_play "10%"
metadata_to_use    "none"

input_cache {{
    size "16 MB"
}}

user               "mpd"
bind_to_address    "localhost"
port               "{mpd_port}"

input {{
    plugin "curl"
    timeout "120"
}}

audio_output {{
    type    "fifo"
    name    "Snapcast {username}"
    path    "/tmp/snapfifo_{username}"
    format  "48000:16:2"
    always_on "yes"
}}

audio_output {{
    type            "httpd"
    name            "Web Stream {username}"
    encoder         "lame"
    port            "{http_port}"
    bind_to_address "0.0.0.0"
    bitrate         "192"
    format          "44100:16:2"
}}
"""

def build_snapserver_config(username, control_port, stream_port, http_port, snap_stream_name):
    return f"""[server]
port = {control_port}

[stream]
port = {stream_port}
source = pipe:///tmp/snapfifo_{username}?name={snap_stream_name}&sampleformat=48000:16:2

[http]
enabled = true
bind_to_address = 0.0.0.0
port = {http_port}
doc_root = /usr/share/snapserver/snapweb

[tcp]
enabled = false
"""

def build_nginx_config(users_list, referer_map, routes_list):
    # Gabungkan referer map
    referer_str = "\n".join(f'    "~*/snapweb/{u}" {p};' for u, p in referer_map.items())
    
    # Gabungkan routes
    routes_str = "\n".join(f"""    # --- SNAPWEB UI: {u} ---
    location /snapweb/{u}/ {{
        proxy_pass http://127.0.0.1:{p}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }}""" for u, p in routes_list.items())

    return f"""# MAP Referer Browser ke Port HTTP Snapserver yang tepat
map $http_referer $snap_port {{
    default 1780;
{referer_str}
}}

server {{
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # --- 1. GRIYAPLAYER (Port 7777) ---
    location /griyaplayer/ {{
        proxy_pass http://127.0.0.1:7777;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header SCRIPT_NAME /griyaplayer;
        client_max_body_size 50M;
    }}

    # --- 2. INVENTORY (Port 5000) ---
    location /inventory/ {{
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header SCRIPT_NAME /inventory;
    }}

    # --- 3. PORTAL (ROOT) ---
    location / {{
        try_files $uri $uri/ =404;
    }}

    # --- GLOBAL WEBSOCKET & STREAM SNAPWEB ---
    location /jsonrpc {{
        proxy_pass http://127.0.0.1:$snap_port/jsonrpc;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }}
    location /stream {{
        proxy_pass http://127.0.0.1:$snap_port/stream;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }}

{routes_str}
}}
"""

def generate():
    print("🔨 Memulai auto-generasi konfigurasi untuk Docker...")
    
    referer_map = {}
    routes_list = {}
    
    startup_commands = [
        "#!/bin/bash",
        "echo '=== Memulai Inisialisasi Layanan Background ==='",
        "mkdir -p /run/mpd",
        "chown -R mpd:audio /run/mpd",
        "mkdir -p /var/log/mpd",
        "chown -R mpd:audio /var/log/mpd",
    ]

    for idx, (username, u_conf) in enumerate(config.USER_CONFIGS.items()):
        mpd_port = u_conf['mpd_port']
        http_stream_port = u_conf['stream_port']
        snap_stream_name = u_conf.get('snap_stream', username.capitalize())
        
        control_port = 1700 + idx
        tcp_port = 1750 + idx
        snap_http_port = 1780 + idx
        
        referer_map[username] = snap_http_port
        routes_list[username] = snap_http_port
        
        # 1. Tulis file config MPD
        mpd_conf_content = build_mpd_config(username, mpd_port, http_stream_port)
        mpd_conf_path = f"/etc/mpd_{username}.conf"
        with open(mpd_conf_path, 'w') as f:
            f.write(mpd_conf_content)
        print(f"✅ Config MPD dibuat: {mpd_conf_path}")
        
        # 2. Tulis file config Snapserver
        snap_conf_content = build_snapserver_config(username, control_port, tcp_port, snap_http_port, snap_stream_name)
        snap_conf_path = f"/etc/snapserver_{username}.conf"
        with open(snap_conf_path, 'w') as f:
            f.write(snap_conf_content)
        print(f"✅ Config Snapserver dibuat: {snap_conf_path}")
        
        # 3. Tambahkan ke startup_commands
        startup_commands.extend([
            f"echo 'Menjalankan MPD & Snapserver untuk zona: {username}...'",
            f"mkdir -p /var/lib/mpd/{username}/playlists",
            f"chown -R mpd:audio /var/lib/mpd/{username}",
            f"rm -f /tmp/snapfifo_{username}",
            f"mkfifo /tmp/snapfifo_{username}",
            f"chown mpd:audio /tmp/snapfifo_{username}",
            f"chmod 666 /tmp/snapfifo_{username}",
            f"/usr/bin/mpd --no-daemon /etc/mpd_{username}.conf &",
            f"/usr/bin/snapserver -c /etc/snapserver_{username}.conf &",
        ])

    # 4. Tulis file Nginx
    nginx_conf_content = build_nginx_config(list(config.USER_CONFIGS.keys()), referer_map, routes_list)
    nginx_conf_path = "/etc/nginx/sites-available/default"
    with open(nginx_conf_path, 'w') as f:
        f.write(nginx_conf_content)
    print(f"✅ Config Nginx dibuat: {nginx_conf_path}")
    
    # 5. Tambahkan sisa perintah startup
    startup_commands.extend([
        "echo 'Menjalankan Nginx...'",
        "nginx -g 'daemon on;'",
        "echo '=== Seluruh layanan background sudah berjalan! ==='"
    ])
    
    # 6. Tulis startup script
    startup_script_path = "/run_services.sh"
    with open(startup_script_path, 'w') as f:
        f.write("\n".join(startup_commands) + "\n")
    os.chmod(startup_script_path, 0o755)
    print(f"✅ Script Runner dibuat: {startup_script_path}")
    
    print("⭐ Seluruh inisialisasi konfigurasi berhasil selesai!")

if __name__ == "__main__":
    generate()
