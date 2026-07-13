from flask import Flask, render_template, request, redirect, url_for, session, jsonify, flash
from werkzeug.utils import secure_filename
import requests, hashlib, random, string, json, os, time
import urllib.parse
from mpd import MPDClient
from werkzeug.middleware.proxy_fix import ProxyFix
import config
import edge_tts
import asyncio


app = Flask(__name__)
app.secret_key = config.SECRET_KEY
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

# Batasi ukuran maksimal upload dari Flask (50 MB)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024 

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
INTERRUPT_FILE = os.path.join(BASE_DIR, 'interrupt_state.json')
QUEUE_DIR = os.path.join(BASE_DIR, 'antrian')

# Buat folder antrian jika belum ada
os.makedirs(QUEUE_DIR, exist_ok=True)

try:
    os.makedirs(UPLOAD_FOLDER, exist_ok=True) 
except Exception as e:
    print(f"Warning: Tidak dapat membuat folder upload. Detail: {e}")

@app.context_processor
def inject_base_url():
    return {'base_url': '/griyaplayer'}

def get_navidrome_params():
    if 'password' not in session: return {}
    salt = ''.join(random.choices(string.ascii_letters + string.digits, k=6))
    token = hashlib.md5((session['password'] + salt).encode('utf-8')).hexdigest()
    return {'u': session['username'], 't': token, 's': salt, 'v': '1.16.1', 'c': 'GriyaPlayer', 'f': 'json'}

def get_user_config():
    return config.USER_CONFIGS.get(session.get('username'), config.USER_CONFIGS['griyapersada'])

@app.before_request
def check_auth():
    allowed_routes = ['index', 'login', 'static']
    if request.endpoint not in allowed_routes and ('username' not in session or 'password' not in session):
        if request.path.startswith('/api/'):
            return jsonify({"status": "error", "message": "Unauthorized"}), 401
        return redirect(url_for('index'))

@app.route('/')
def index():
    if 'username' in session: return redirect(url_for('player'))
    return render_template('login.html')

@app.route('/login', methods=['POST'])
def login():
    username = request.form.get('username')
    password = request.form.get('password')
    
    # Verifikasi username & password langsung ke Navidrome via API Ping
    salt = ''.join(random.choices(string.ascii_letters + string.digits, k=6))
    token = hashlib.md5((password + salt).encode('utf-8')).hexdigest()
    
    params = {
        'u': username,
        't': token,
        's': salt,
        'v': '1.16.1',
        'c': 'GriyaPlayer',
        'f': 'json'
    }
    
    try:
        res = requests.get(f"{config.NAVIDROME_URL}/rest/ping.view", params=params, timeout=5)
        if res.json().get('subsonic-response', {}).get('status') == 'ok':
            session['username'] = username
            session['password'] = password
            session['just_logged_in'] = True
            return redirect(url_for('player'))
        else:
            flash("Username atau Password salah!", "error")
            return redirect(url_for('index'))
    except Exception as e:
        flash("Gagal terhubung ke Server Musik.", "error")
        return redirect(url_for('index'))

@app.route('/player')
def player():
    if 'username' not in session: return redirect(url_for('index'))
    
    # Hapus paksaan logout, biarkan pengguna tetap login jika me-refresh browser
    session.pop('just_logged_in', False)
        
    user_config = get_user_config()
    # Ambil nama stream Snapcast dari config, default ke GriyaPersada jika tidak ada
    snap_stream_name = user_config.get('snap_stream', 'GriyaPersada')
    
    return render_template('player.html', stream_port=user_config['stream_port'], username=session['username'], snap_stream_name=snap_stream_name)

# ================= API NAVIDROME =================
@app.route('/api/songs')
def get_songs():
    params = get_navidrome_params()
    page = request.args.get('page', 1, type=int)
    page_size = 200
    offset = (page - 1) * page_size

    params.update({
        'query': '',
        'songCount': page_size,
        'songOffset': offset,
        'artistCount': 0,
        'albumCount': 0
    })
    try:
        res = requests.get(f"{config.NAVIDROME_URL}/rest/search3.view", params=params, timeout=10)
        res.raise_for_status()
        songs = res.json().get('subsonic-response', {}).get('searchResult3', {}).get('song', [])
        if songs is None: songs = []
        return jsonify({"status": "success", "data": songs, "auth": params})
    except requests.exceptions.RequestException as e:
        print(f"Error fetching songs from Navidrome: {e}")
        return jsonify({"status": "error", "message": "Gagal mengambil data lagu dari server."}), 500

@app.route('/api/albums')
def get_albums():
    params = get_navidrome_params()
    params.update({'type': 'newest', 'size': 50})
    try:
        res = requests.get(f"{config.NAVIDROME_URL}/rest/getAlbumList.view", params=params, timeout=5)
        data = res.json().get('subsonic-response', {}).get('albumList', {}).get('album', [])
        if data is None: data = []
        return jsonify({"status": "success", "data": data, "auth": params})
    except: return jsonify({"status": "error"}), 500

@app.route('/api/album/<album_id>')
def get_album_songs(album_id):
    params = get_navidrome_params()
    params['id'] = album_id
    try:
        res = requests.get(f"{config.NAVIDROME_URL}/rest/getAlbum.view", params=params, timeout=5)
        data = res.json().get('subsonic-response', {}).get('album', {}).get('song', [])
        if data is None: data = []
        return jsonify({"status": "success", "data": data, "auth": params})
    except: return jsonify({"status": "error"}), 500

@app.route('/api/search')
def search_songs():
    params = get_navidrome_params()
    query = request.args.get('q', '')
    if not query: return jsonify({"status": "success", "data": [], "auth": params})
    params.update({'query': query, 'songCount': 50})
    try:
        res = requests.get(f"{config.NAVIDROME_URL}/rest/search3.view", params=params, timeout=5)
        data = res.json().get('subsonic-response', {}).get('searchResult3', {}).get('song', [])
        if data is None: data = []
        return jsonify({"status": "success", "data": data, "auth": params})
    except: return jsonify({"status": "error"}), 500

# ================= SISTEM PLAYLIST JSON =================
def get_playlist_file():
    if 'username' not in session: return None
    return os.path.join(BASE_DIR, f"{session['username']}.json")

def read_playlists():
    filepath = get_playlist_file()
    if filepath and os.path.exists(filepath):
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
                if isinstance(data, list): return {"playlists": data}
                elif isinstance(data, dict): return data
        except: pass
    return {"playlists": []}

def write_playlists(data):
    filepath = get_playlist_file()
    if filepath:
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=4)

@app.route('/api/playlists')
def api_playlists():
    data = read_playlists()
    return jsonify({"status": "success", "data": data.get("playlists", [])})

@app.route('/api/playlist/create', methods=['POST'])
def api_playlist_create():
    req = request.get_json(silent=True) or {}
    name = req.get('name')
    if not name:
        return jsonify({"status": "error", "message": "Nama playlist tidak boleh kosong."}), 400
    
    try:
        data = read_playlists()
        playlists = data.get("playlists", [])
        if any(p.get("name") == name for p in playlists):
            return jsonify({"status": "error", "message": f"Playlist dengan nama '{name}' sudah ada."}), 409

        playlists.append({"name": name, "songs": []})
        data["playlists"] = playlists
        write_playlists(data)
        return jsonify({"status": "success", "message": f"Playlist '{name}' berhasil dibuat."})
    except Exception as e:
        return jsonify({"status": "error", "message": f"Gagal membuat playlist: {str(e)}"}), 500

@app.route('/api/playlist/add', methods=['POST'])
def api_playlist_add():
    req = request.get_json(silent=True) or {}
    song_id, playlist_name = req.get('song_id'), req.get('playlist_name')
    if not song_id or not playlist_name:
        return jsonify({"status": "error", "message": "Parameter tidak lengkap."}), 400

    try:
        data = read_playlists()
        playlists = data.get("playlists", [])
        target_pl = next((p for p in playlists if p.get("name") == playlist_name), None)

        if not target_pl:
            return jsonify({"status": "error", "message": f"Playlist '{playlist_name}' tidak ditemukan."}), 404

        if "songs" not in target_pl: target_pl["songs"] = []
        if song_id in target_pl["songs"]:
            return jsonify({"status": "info", "message": "Lagu sudah ada di dalam playlist."})

        target_pl["songs"].append(song_id)
        write_playlists(data)
        return jsonify({"status": "success", "message": "Lagu berhasil ditambahkan."})
    except Exception as e:
        return jsonify({"status": "error", "message": f"Gagal menambahkan lagu: {str(e)}"}), 500

@app.route('/api/playlist/add_multi', methods=['POST'])
def api_playlist_add_multi():
    req = request.get_json(silent=True) or {}
    song_ids = req.get('song_ids', [])
    playlist_name = req.get('playlist_name')
    if not song_ids or not playlist_name:
        return jsonify({"status": "error", "message": "Parameter tidak lengkap."}), 400

    try:
        data = read_playlists()
        playlists = data.get("playlists", [])
        target_pl = next((p for p in playlists if p.get("name") == playlist_name), None)

        if not target_pl:
            return jsonify({"status": "error", "message": f"Playlist '{playlist_name}' tidak ditemukan."}), 404

        if "songs" not in target_pl: target_pl["songs"] = []
        added_count = 0
        for sid in song_ids:
            if sid not in target_pl["songs"]:
                target_pl["songs"].append(sid)
                added_count += 1
        write_playlists(data)
        return jsonify({"status": "success", "message": f"{added_count} lagu berhasil ditambahkan."})
    except Exception as e:
        return jsonify({"status": "error", "message": f"Gagal menambahkan lagu: {str(e)}"}), 500

@app.route('/api/playlist/remove', methods=['POST'])
def api_playlist_remove():
    req = request.get_json(silent=True) or {}
    song_id, playlist_name = req.get('song_id'), req.get('playlist_name')
    if not song_id or not playlist_name:
        return jsonify({"status": "error", "message": "Parameter tidak lengkap."}), 400

    try:
        data = read_playlists()
        playlists = data.get("playlists", [])
        target_pl = next((p for p in playlists if p.get("name") == playlist_name), None)

        if not target_pl:
            return jsonify({"status": "error", "message": f"Playlist '{playlist_name}' tidak ditemukan."}), 404

        if "songs" not in target_pl or song_id not in target_pl["songs"]:
            return jsonify({"status": "error", "message": "Lagu tidak ditemukan di dalam playlist."}), 404

        target_pl["songs"].remove(song_id)
        write_playlists(data)
        return jsonify({"status": "success", "message": "Lagu berhasil dihapus."})
    except Exception as e:
        return jsonify({"status": "error", "message": f"Gagal menghapus lagu: {str(e)}"}), 500

@app.route('/api/playlist/delete', methods=['POST'])
def api_playlist_delete():
    req = request.get_json(silent=True) or {}
    name = req.get('name')
    if not name: return jsonify({"status": "error", "message": "Nama playlist diperlukan"}), 400
    
    data = read_playlists()
    playlists = data.get("playlists", [])
    
    original_length = len(playlists)
    playlists[:] = [p for p in playlists if p.get("name") != name]
    
    if len(playlists) < original_length:
        data["playlists"] = playlists
        write_playlists(data)
    return jsonify({"status": "success"})

@app.route('/api/playlist/get')
def api_playlist_get():
    name = request.args.get('name')
    data = read_playlists()
    target_pl = next((p for p in data.get("playlists", []) if p.get("name") == name), None)
    if not target_pl: return jsonify({"status": "error"}), 404
    
    params = get_navidrome_params()
    songs_data = []
    for sid in target_pl.get("songs", []):
        try:
            p = params.copy()
            p['id'] = sid
            res = requests.get(f"{config.NAVIDROME_URL}/rest/getSong.view", params=p, timeout=5)
            song_info = res.json().get('subsonic-response', {}).get('song')
            if song_info: songs_data.append(song_info)
        except: continue
    return jsonify({"status": "success", "data": songs_data, "auth": params})

# ================= API OUTLET PLAY =================
@app.route('/api/outlet/list')
def api_outlet_list():
    if 'username' not in session: return jsonify({"status": "error"}), 401
    outlets = []
    # Tampilkan semua outlet KECUALI akun user yang sedang login saat ini
    for u in config.USER_CONFIGS.keys():
        if u.lower() != session['username'].lower():
            outlets.append({"username": u, "name": config.USER_CONFIGS[u].get('snap_stream', u.capitalize())})
    return jsonify({"status": "success", "data": outlets})

@app.route('/api/outlet/playlists')
def api_outlet_playlists():
    target_user = request.args.get('user')
    if not target_user: return jsonify({"status": "error"}), 400
    
    filepath = os.path.join(BASE_DIR, f"{target_user}.json")
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
                if isinstance(data, list): return jsonify({"status": "success", "data": data})
                elif isinstance(data, dict): return jsonify({"status": "success", "data": data.get("playlists", [])})
        except: pass
    return jsonify({"status": "success", "data": []})

@app.route('/api/outlet/playlist/get')
def api_outlet_playlist_get():
    target_user = request.args.get('user')
    name = request.args.get('name')
    if not target_user or not name: return jsonify({"status": "error"}), 400
    
    filepath = os.path.join(BASE_DIR, f"{target_user}.json")
    if not os.path.exists(filepath): return jsonify({"status": "error"}), 404
    
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
        
        playlists = []
        if isinstance(data, list): playlists = data
        elif isinstance(data, dict): playlists = data.get("playlists", [])
        
        target_pl = next((p for p in playlists if p.get("name") == name), None)
        if not target_pl: return jsonify({"status": "error"}), 404
        
        params = get_navidrome_params()
        songs_data = []
        for sid in target_pl.get("songs", []):
            try:
                p = params.copy()
                p['id'] = sid
                res = requests.get(f"{config.NAVIDROME_URL}/rest/getSong.view", params=p, timeout=5)
                song_info = res.json().get('subsonic-response', {}).get('song')
                if song_info: songs_data.append(song_info)
            except: continue
        return jsonify({"status": "success", "data": songs_data, "auth": params})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# ================= API ADMIN (UPLOAD, PAGING & DELETE SYSTEM) =================
@app.route('/api/list_interrupts', methods=['GET'])
def list_interrupts():
    try:
        if 'username' not in session or session['username'].lower() not in ['admin', 'griyapersada']:
            return jsonify({"status": "error", "message": "Unauthorized"}), 403
            
        files = []
        if os.path.exists(UPLOAD_FOLDER):
            # Masukkan juga .webm agar history rekaman Mic ikut terbaca
            files = [f for f in os.listdir(UPLOAD_FOLDER) if f.endswith(('.mp3', '.wav', '.ogg', '.webm'))]
            files.sort(key=lambda x: os.path.getmtime(os.path.join(UPLOAD_FOLDER, x)), reverse=True)
            
        return jsonify({'status': 'success', 'files': files[:3]})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/api/upload_interrupt', methods=['POST'])
def upload_interrupt():
    try:
        if 'username' not in session or session['username'].lower() not in ['admin', 'griyapersada']:
            return jsonify({"status": "error", "message": "Unauthorized"}), 403
        
        if 'audio' not in request.files:
            return jsonify({"status": "error", "message": "No file uploaded"}), 400
            
        file = request.files['audio']
        if file.filename == '':
            return jsonify({"status": "error", "message": "Filename empty"}), 400
            
        if file:
            print(f"[{session['username']}] Menerima upload file: {file.filename}")
            # Dapatkan state interupsi aktif agar file yang sedang disiarkan tidak terhapus
            active_state = get_interrupt_state()
            active_filename = active_state.get('filename') if active_state else None
            print(f"[{session['username']}] Active interrupt filename: {active_filename}")
            
            filename = secure_filename(file.filename)
            filepath = os.path.join(UPLOAD_FOLDER, filename)
            file.save(filepath)
            
            # Batasi maksimal 3 file fisik di server
            all_files = [os.path.join(UPLOAD_FOLDER, f) for f in os.listdir(UPLOAD_FOLDER)]
            all_files = [f for f in all_files if os.path.isfile(f)]
            all_files.sort(key=os.path.getmtime) # Urutkan dari yang terlama
            
            while len(all_files) > 3:
                oldest_file = all_files.pop(0)
                if os.path.basename(oldest_file) != active_filename:
                    try: os.remove(oldest_file)
                    except: pass
                elif len(all_files) > 0:
                    next_oldest = all_files.pop(0)
                    try: os.remove(next_oldest)
                    except: pass
                    
            return jsonify({"status": "success", "filename": filename})
    except Exception as e:
        return jsonify({"status": "error", "message": f"Server Error: {str(e)}"}), 500

@app.route('/api/delete_interrupt', methods=['POST'])
def delete_interrupt():
    try:
        if 'username' not in session or session['username'].lower() not in ['admin', 'griyapersada']:
            return jsonify({"status": "error"}), 403
            
        req = request.get_json(silent=True) or {}
        filename = req.get('filename')
        print(f"[{session['username']}] Menerima permintaan hapus file: {filename}")
        
        if filename:
            filepath = os.path.join(UPLOAD_FOLDER, secure_filename(filename))
            if os.path.exists(filepath):
                os.remove(filepath) # HAPUS FILE FISIK DARI SERVER
                print(f"[{session['username']}] File fisik dihapus: {filepath}")

            
            # Hapus juga file state agar interupsi tidak nyangkut di client lain
            if os.path.exists(INTERRUPT_FILE):
                try: 
                    with open(INTERRUPT_FILE, 'r') as f:
                        data = json.load(f)
                    # FIX: Hanya hapus state interupsi jika file yang dihapus adalah file yang sedang aktif
                    if data.get('filename') == filename:
                        resume_ports = data.get('resume_ports', [])
                        os.remove(INTERRUPT_FILE)
                        # Auto-Resume kembali lagu MPD yang tadi sempat dipause
                        for port in resume_ports:
                            try:
                                c = MPDClient()
                                c.timeout = 2
                                c.connect("localhost", port)
                                c.pause(0)
                                c.disconnect()
                            except: pass
                except: pass
            return jsonify({"status": "success"})
            
        return jsonify({"status": "error"}), 400
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/clear_interrupt', methods=['POST'])
def clear_interrupt():
    if 'username' not in session or session['username'].lower() not in ['admin', 'griyapersada']:
        return jsonify({"status": "error", "message": "Unauthorized"}), 403
        
    req = request.get_json(silent=True) or {}
    target_filename = req.get('filename')
    print(f"[{session['username']}] Menerima permintaan clear interrupt untuk: {target_filename}")
    
    if os.path.exists(INTERRUPT_FILE):
        try:
            with open(INTERRUPT_FILE, 'r') as f:
                data = json.load(f)
            current_filename = data.get('filename')
            print(f"[{session['username']}] Current INTERRUPT_FILE content: {current_filename}")
            if current_filename != target_filename:
                print(f"[{session['username']}] Peringatan: target_filename ({target_filename}) tidak cocok dengan current_filename ({current_filename}). Tidak menghapus.")
            
            # PROTEKSI RACE CONDITION: Hanya hapus state interupsi (File fisik dibiarkan untuk history)
            if current_filename and current_filename == target_filename:
                resume_ports = data.get('resume_ports', [])
                os.remove(INTERRUPT_FILE)
                
                # Auto-Resume kembali lagu MPD yang tadi sempat dipause untuk di seluruh ruangan
                for port in resume_ports:
                    try:
                        c = MPDClient()
                        c.timeout = 2
                        c.connect("localhost", port)
                        c.pause(0)
                        c.disconnect()
                    except: pass
                print(f"[{session['username']}] INTERRUPT_FILE dihapus. (File fisik tetap disimpan)")
        except: pass
    return jsonify({"status": "success"})

@app.route('/api/tts_interrupt', methods=['POST'])
def tts_interrupt():
    if 'username' not in session or session['username'].lower() not in ['admin', 'griyapersada']:
        return jsonify({"status": "error", "message": "Unauthorized"}), 403
        
    req = request.get_json(silent=True) or {}
    text = req.get('text')
    if not text:
        return jsonify({"status": "error", "message": "Teks kosong"}), 400
        
    try:
        # Generate TTS menggunakan edge-tts (Suara Neural Microsoft, sangat natural)
        filename = f"tts_broadcast_{int(time.time())}.mp3"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        
        async def gen_tts():
            # id-ID-GadisNeural adalah suara wanita AI Indonesia yang sangat natural
            comm = edge_tts.Communicate(text, 'id-ID-GadisNeural') 
            await comm.save(filepath)
        asyncio.run(gen_tts())
        
        # Pause SEMUA zona MPD agar Snapserver mati/mute saat siaran
        resume_ports = []
        try:
            for u_name, u_conf in config.USER_CONFIGS.items():
                try:
                    c = MPDClient()
                    c.timeout = 2
                    c.connect("localhost", u_conf['mpd_port'])
                    if c.status().get('state') == 'play':
                        resume_ports.append(u_conf['mpd_port'])
                    c.pause(1)
                    c.disconnect()
                except: pass
        except Exception as e:
            print(f"MPD Pause Error (TTS): {e}")
            
        play_at_ms = int(time.time() * 1000) + 3000 # Beri delay 3 detik agar semua device siap
        
        # Trigger Panggilan (Simpan status interupsi)
        interrupt_data = {
            "filename": filename, 
            "timestamp": int(time.time()),
            "play_at": play_at_ms,
            "full_path": url_for('static', filename='uploads/' + filename),
            "resume_ports": resume_ports
        }
        with open(INTERRUPT_FILE, 'w') as f:
            json.dump(interrupt_data, f)
            
        return jsonify({"status": "success", "filename": filename})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# SISTEM SIARAN (POLLING STATE) - MENGGANTIKAN SOCKET.IO
@app.route('/api/trigger_interrupt', methods=['POST'])
def trigger_interrupt():
    if 'username' not in session or session['username'].lower() not in ['admin', 'griyapersada']:
        return jsonify({"status": "error", "message": "Unauthorized"}), 403
        
    req = request.get_json(silent=True) or {}
    filename = req.get('filename')
    print(f"[{session['username']}] Menerima permintaan trigger interrupt untuk: {filename}")
    
    if filename:
        # Pause SEMUA zona MPD agar Snapserver mati/mute saat siaran
        resume_ports = []
        try:
            for u_name, u_conf in config.USER_CONFIGS.items():
                try:
                    c = MPDClient()
                    c.timeout = 2
                    c.connect("localhost", u_conf['mpd_port'])
                    if c.status().get('state') == 'play':
                        resume_ports.append(u_conf['mpd_port'])
                    c.pause(1)
                    c.disconnect()
                except: pass
        except Exception as e: 
            print(f"MPD Stop Error: {e}")
            
        play_at_ms = int(time.time() * 1000) + 3000 # Beri delay 3 detik agar semua device siap
        
        # Catat Panggilan Baru ke dalam sistem
        interrupt_data = {
            "filename": filename, 
            "timestamp": int(time.time()),
            "play_at": play_at_ms,
            "full_path": url_for('static', filename='uploads/' + filename), # Kirim path lengkap
            "resume_ports": resume_ports
        }
        with open(INTERRUPT_FILE, 'w') as f:
            json.dump(interrupt_data, f)

        return jsonify({"status": "success"})
        
    return jsonify({"status": "error"}), 400

# ================= SISTEM ANTRIAN JSON SERVER =================
def get_queue_file(username):
    return os.path.join(QUEUE_DIR, f"antrian_{username}.json")

def read_queue(username):
    path = get_queue_file(username)
    if os.path.exists(path):
        try:
            with open(path, 'r') as f:
                return json.load(f)
        except: pass
    return {"queue": [], "original": [], "shuffle": False, "repeat": False, "user_added": 0, "current_id": None}

def write_queue(username, data):
    path = get_queue_file(username)
    with open(path, 'w') as f:
        json.dump(data, f)

def get_interrupt_state():
    if os.path.exists(INTERRUPT_FILE):
        try:
            with open(INTERRUPT_FILE, 'r') as f:
                return json.load(f)
        except: pass
    return None

# ================= SERVER PLAYER (MPD) =================
def get_mpd():
    c = MPDClient()
    c.timeout = 15
    c.connect("localhost", get_user_config()['mpd_port'])
    return c

@app.route('/api/mpd/sync')
def mpd_sync():
    try:
        c = get_mpd()
        status = c.status()
        current = c.currentsong()
        print(f"[{session['username']}] MPD Sync - Status: {status.get('state')}, Current Song: {current}")
        playlist_raw = c.playlistinfo()
        c.disconnect()

        curr_id = None
        if current.get('file'):
            try:
                curr_id = urllib.parse.parse_qs(urllib.parse.urlparse(current['file']).query)['id'][0]
            except: pass

        username = session.get('username', '')
        queue_data = read_queue(username)
        
        # --- AUTO REFILL LOGIC (GENERATE BARU SETELAH 50 HABIS) ---
        state = status.get('state')
        current_mpd_idx = int(status.get('song', 0)) if status.get('song') else 0
        playlist_length = int(status.get('playlistlength', 0)) if status.get('playlistlength') else 0
        
        # Jika sedang play dan antrian tinggal sisa <= 2 lagu
        if state == 'play' and playlist_length > 0 and (playlist_length - current_mpd_idx) <= 2:
            full_queue = queue_data.get('full_queue', [])
            current_q = queue_data.get('queue', [])
            is_repeat = queue_data.get('repeat', False)
            is_shuffle = queue_data.get('shuffle', False)
            
            if not is_repeat and full_queue and current_q:
                last_song = current_q[-1]
                next_batch = []
                
                if last_song in full_queue:
                    last_idx = full_queue.index(last_song)
                    # Ambil 50 lagu berikutnya dari antrian master
                    next_batch = full_queue[last_idx+1 : last_idx+1+50]
                    
                if not next_batch:
                    # KITA BERADA DI UJUNG ANTRIAN
                    if is_shuffle:
                        # Generate ulang shuffle
                        new_full = full_queue.copy()
                        random.shuffle(new_full)
                        queue_data['full_queue'] = new_full
                        next_batch = new_full[:50]
                    else:
                        # Balik ke angka 1 (awal antrian)
                        next_batch = full_queue[:50]
                    
                if next_batch:
                    try:
                        c = get_mpd()
                        params = get_navidrome_params()
                        for sid in next_batch:
                            url = f"{config.NAVIDROME_URL}/rest/stream?id={sid}&u={params['u']}&t={params['t']}&s={params['s']}&v=1.12.0&c=GriyaPlayer"
                            c.add(url)
                        c.disconnect()
                        
                        # Tambahkan ke JSON agar UI Client terupdate mulus
                        current_q.extend(next_batch)
                        
                        # Batasi ukuran antrian di memori JSON agar tidak bengkak
                        if len(current_q) > 150:
                            current_q = current_q[-100:]
                            
                        queue_data['queue'] = current_q
                        write_queue(username, queue_data)
                    except Exception as e:
                        print(f"Auto-refill error: {e}")
        # --------------------------------------------------------

        return jsonify({
            "status": "success",
            "server_time": int(time.time() * 1000),
            "state": state,
            "time": status.get('time', "0:0"), 
            "current_song_id": curr_id,
            "current_mpd_info": { 
                "title": current.get("title", "Memuat Judul..."),
                "artist": current.get("artist", "-")
            },
            "repeat": int(status.get('repeat', 0)),
            "random": int(status.get('random', 0)),
            "interrupt": get_interrupt_state(), # KUNCI PAGING SYSTEM
            "queue_data": queue_data # JSON Antrian Master
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})

@app.route('/api/mpd/cmd', methods=['POST'])
def mpd_cmd():
    req = request.get_json(silent=True) or {}
    cmd = req.get('method')
    val = req.get('value')
    
    try:
        c = get_mpd()
        if cmd == "play":
            st = c.status().get('state')
            if st == "pause": c.pause(0)
            elif st == "stop": c.play()
        elif cmd == "pause":
            c.pause(1)
        elif cmd == "resume_playback":
            st = c.status().get('state')
            if st == "pause": c.pause(0)
            elif st == "stop": c.play()
        elif cmd == "next":
            c.next()
            c.pause(1)
            time.sleep(4)
            c.pause(0)
        elif cmd == "prev":
            c.previous()
            c.pause(1)
            time.sleep(4)
            c.pause(0)
        elif cmd == "shuffle_on":
            c.random(1)
        elif cmd == "shuffle_off":
            c.random(0)
        elif cmd == "set_mode":
            is_repeat = val.get('repeat', False)
            c.repeat(1 if is_repeat else 0)
            c.single(1 if is_repeat else 0) 
        elif cmd == "seek":
            time_str = c.status().get('time')
            if time_str:
                tot = float(time_str.split(':')[1])
                target = int((float(val) / 100.0) * tot)
                c.seekcur(target)
        elif cmd == "play_idx":
            c.play(int(val))
            c.pause(1)
            time.sleep(4)
            c.pause(0)
        
        c.disconnect()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})

@app.route('/api/queue/push', methods=['POST'])
def queue_push():
    if 'username' not in session: return jsonify({"status": "error"}), 401
    req = request.get_json(silent=True) or {}
    username = session['username']
    
    ids = req.get('queue', [])
    current_id = req.get('current_id')
    play_now = req.get('play_now', False)
    repeat = req.get('repeat', False)
    
    req['full_queue'] = ids.copy()
    if repeat:
        ids = [current_id] if current_id in ids else (ids[:1] if ids else [])
    else:
        ids = ids[:50]
        
    req['queue'] = ids
    
    write_queue(username, req)
    
    if not ids:
        try:
            c = get_mpd()
            c.clear()
            c.disconnect()
        except: pass
        return jsonify({"status": "success"})
    
    try:
        c = get_mpd()
        params = get_navidrome_params()
        status = c.status()
        
        c.random(0) # Selalu paksa MATI (Shuffle diambil alih JSON)
        c.repeat(1 if repeat else 0)
        c.single(1 if repeat else 0) # Loop native
        
        if play_now or status.get('state') not in ['play', 'pause']:
            c.clear()
            for sid in ids:
                url = f"{config.NAVIDROME_URL}/rest/stream?id={sid}&u={params['u']}&t={params['t']}&s={params['s']}&v=1.12.0&c=GriyaPlayer"
                c.add(url)
            idx = ids.index(current_id) if current_id in ids else 0
            c.play(idx)
            c.pause(1)
            time.sleep(2)
            seek_time = req.get('seek_time', 0)
            if float(seek_time) > 0:
                try: c.seekcur(int(float(seek_time)))
                except: pass
            c.pause(0)
        else:
            # Gapless Update (Merubah antrian tanpa menjeda pemutaran)
            current_mpd_id = status.get('songid')
            if current_mpd_id:
                for p in c.playlistinfo():
                    if p.get('id') != current_mpd_id:
                        try: c.deleteid(p.get('id'))
                        except: pass
                
                idx = ids.index(current_id) if current_id in ids else 0
                for sid in ids[idx+1:]:
                    url = f"{config.NAVIDROME_URL}/rest/stream?id={sid}&u={params['u']}&t={params['t']}&s={params['s']}&v=1.12.0&c=GriyaPlayer"
                    c.add(url)
                for sid in ids[:idx]:
                    url = f"{config.NAVIDROME_URL}/rest/stream?id={sid}&u={params['u']}&t={params['t']}&s={params['s']}&v=1.12.0&c=GriyaPlayer"
                    c.add(url)
        
        c.disconnect()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})

@app.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return redirect(url_for('index'))

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=7777)