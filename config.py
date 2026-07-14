# /var/www/navidrome/web/config.py

# --- KONFIGURASI FLASK UTAMA ---
SECRET_KEY = 'gp_bandungan_2026'

# --- KONFIGURASI NAVIDROME ---
NAVIDROME_URL = "http://navidrome:4533"

# --- PEMETAAN USER & MESIN MPD (MULTI-TENANT) ---
# Format: 'username': {'mpd_port': port_kontrol, 'stream_port': port_suara_web}
USER_CONFIGS = {
    'griyapersada': {'mpd_port': 6600, 'stream_port': 8000, 'snap_stream': 'GriyaPersada'},
    'jagat':        {'mpd_port': 6601, 'stream_port': 8001, 'snap_stream': 'Jagat'},
    'dialog':       {'mpd_port': 6602, 'stream_port': 8002, 'snap_stream': 'Dialog'},
    'hugo':         {'mpd_port': 6603, 'stream_port': 8003, 'snap_stream': 'Hugo'},
    'khayangan':    {'mpd_port': 6604, 'stream_port': 8004, 'snap_stream': 'Khayangan'},
    'oobakso':      {'mpd_port': 6605, 'stream_port': 8005, 'snap_stream': 'OO"bakso'},
    'maruti':       {'mpd_port': 6606, 'stream_port': 8006, 'snap_stream': 'Maruti'},
    'ramashinta':   {'mpd_port': 6607, 'stream_port': 8007, 'snap_stream': 'RamaShinta'},
    'lokalfarm':    {'mpd_port': 6608, 'stream_port': 8008, 'snap_stream': 'LokalFarm'},
    'fo':           {'mpd_port': 6609, 'stream_port': 8009, 'snap_stream': 'FO'},
    'vgm':          {'mpd_port': 6610, 'stream_port': 8010, 'snap_stream': 'VGM'},
    "anjani":       {"mpd_port": 6611, "stream_port": 8011, "snap_stream": "Anjani"},
    "pancasona":    {"mpd_port": 6612, "stream_port": 8012, "snap_stream": "Pancasona"},
}