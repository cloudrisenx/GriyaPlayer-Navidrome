# /var/www/navidrome/web/config.py

# --- KONFIGURASI FLASK UTAMA ---
SECRET_KEY = 'gp_bandungan_2026'

# --- KONFIGURASI NAVIDROME ---
NAVIDROME_URL = "http://192.168.4.40:4533"

# --- PEMETAAN USER & MESIN MPD (MULTI-TENANT) ---
# Format: 'username': {'mpd_port': port_kontrol, 'stream_port': port_suara_web}
USER_CONFIGS = {
    'griyapersada': {'mpd_port': 6600, 'stream_port': 8000},
    'jagat':        {'mpd_port': 6601, 'stream_port': 8001},
    'dialog':       {'mpd_port': 6602, 'stream_port': 8002},
    'hugo':         {'mpd_port': 6603, 'stream_port': 8003},
    'khayangan':    {'mpd_port': 6604, 'stream_port': 8004},
    'obakso':       {'mpd_port': 6605, 'stream_port': 8005},
    'maruti':       {'mpd_port': 6606, 'stream_port': 8006},
    'ramashinta':   {'mpd_port': 6607, 'stream_port': 8007},
    'lokalfarm':    {'mpd_port': 6608, 'stream_port': 8008},
    'fo':           {'mpd_port': 6609, 'stream_port': 8009},
    'vgm':          {'mpd_port': 6610, 'stream_port': 8010}
}