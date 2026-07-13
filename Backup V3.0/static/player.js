let currentAuth = {};
let currentSongs = [];  
let songCache = {}; 
let isFetchingCache = {}; 

const NAVIDROME = "http://192.168.4.40:4533";
const MPD_STREAM = `http://192.168.4.40:${STREAM_PORT}`; 

// ================ DUAL AUDIO ENGINE ================
let audio1 = document.getElementById('web-audio');
let audio2 = new Audio();
audio2.preload = "none";

let activeAudio = audio1; 
let isBackgroundBuffering = false;
let isAudioActuallyPlaying = false; 
let autoplayBlocked = false; 

let isPlayAlone = true; 
let currentPlayingId = null; 
let isDragging = false;  
let syncBlockTime = 0; 
let isCmdRunning = false;
let streamTimeOffset = 0; 
let isCalculatingOffset = false;

// STATE LOGIKA
let originalSongs = []; 
let localQueue = [];
let originalLocalQueue = [];
let isShuffleActive = false;
let isLoopActive = false;
let currentMpdState = "stop"; 
let userAddedCount = 0;

// STATE UNTUK PAGINATION BERANDA
let homePage = 1;
let isHomeLoading = false;

// INTERRUPT STATE
let interruptAudio = new Audio();
let lastInterruptTime = parseInt(sessionStorage.getItem('lastInterruptTime')) || 0;
let isInterrupting = false;

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return "0:00";
    let h = Math.floor(seconds / 3600);
    let m = Math.floor((seconds % 3600) / 60);
    let s = Math.floor(seconds % 60).toString().padStart(2, '0');
    if (h > 0) {
        return h + ":" + m.toString().padStart(2, '0') + ":" + s;
    }
    return m + ":" + s;
}

function parseTimeStr(timeStr) {
    if(!timeStr || !timeStr.includes(':')) return 0;
    const parts = timeStr.split(':');
    if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    }
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

function updateSongCache(songs) {
    songs.forEach(s => songCache[s.id] = s);
}

function getBestCoverId(songId) {
    if (!songId) return 0;
    const cached = songCache[songId];
    return cached ? (cached.coverArt || songId) : songId;
}

function getCoverUrl(id) {
    if(!currentAuth.u) return "";
    if(!id || id === "0" || id === "undefined" || id === "null") {
        return `${NAVIDROME}/rest/getCoverArt.view?id=0&u=${currentAuth.u}&t=${currentAuth.t}&s=${currentAuth.s}&v=1.12.0&c=GP`;
    }
    return `${NAVIDROME}/rest/getCoverArt.view?id=${id}&u=${currentAuth.u}&t=${currentAuth.t}&s=${currentAuth.s}&v=1.12.0&c=GP`;
}

function attachAudioEvents(audioEl) {
    audio1.onwaiting = null; audio1.onplaying = null; audio1.onpause = null; audio1.onended = null;
    audio2.onwaiting = null; audio2.onplaying = null; audio2.onpause = null; audio2.onended = null;

    audioEl.onwaiting = () => {
        isAudioActuallyPlaying = false;
        if(!isBackgroundBuffering && !autoplayBlocked) {
            document.getElementById('p_btn').className = 'bx bx-loader-alt bx-spin play-main-btn';
        }
    };
    audioEl.onplaying = () => {
        isAudioActuallyPlaying = true;
        document.getElementById('p_btn').className = 'bx bx-pause-circle play-main-btn';
    };
    audioEl.onpause = () => {
        isAudioActuallyPlaying = false;
        document.getElementById('p_btn').className = 'bx bx-play-circle play-main-btn';
    };
    audioEl.onended = () => {
        if (isPlayAlone && !isInterrupting) {
            cmd('next'); // Logika Repeat, Shuffle, & Looping di-handle sepenuhnya oleh cmd('next')
        }
    };
    audioEl.ontimeupdate = () => {
        // Timer UI untuk Mode "DEVICE INI" (isPlayAlone)
        if (isPlayAlone && !isDragging && !isInterrupting) {
            let cur = audioEl.currentTime || 0;
            let tot = audioEl.duration || 0;
            
            // Simpan detik pemutaran secara real-time
            localStorage.setItem('gp_local_time', cur);

            document.getElementById('t_cur').innerText = formatTime(cur);
            document.getElementById('t_max').innerText = formatTime(tot);
            if (tot > 0) {
                let perc = (cur / tot) * 100;
                document.getElementById('seekSlider').value = perc;
                document.getElementById('seekSlider').style.setProperty('--val', perc + '%');
            } else {
                document.getElementById('seekSlider').value = 0;
                document.getElementById('seekSlider').style.setProperty('--val', '0%');
            }
        }
    };
}
attachAudioEvents(activeAudio);

// WORKAROUND AUTOPLAY BROWSER: Jika diblokir, otomatis play saat user klik / sentuh layar di mana saja
function resumeAutoplay() {
    if (autoplayBlocked && currentMpdState === 'play' && !isBackgroundBuffering && !isInterrupting) {
        console.log("Interaksi user terdeteksi, melanjutkan auto-play...");
        autoplayBlocked = false;
        forceStreamReload(true, false);
    }
}
document.body.addEventListener('click', resumeAutoplay);
document.body.addEventListener('touchstart', resumeAutoplay);
document.body.addEventListener('keydown', resumeAutoplay);

function forceStreamReload(directLoad = false, useOffset = true) {
    // --- PEROMBAKAN TOTAL UNTUK SNAPCAST ---
    // Fungsi ini sekarang TIDAK LAGI memutar audio untuk mode "RUANGAN".
    // Audio "RUANGAN" ditangani 100% oleh Snapweb Player.
    // Fungsi ini dipertahankan hanya untuk menampilkan spinner loading di UI.
    if (!isPlayAlone) {
        console.log("Mode Ruangan (Remote Control). Player web ini tidak memutar suara.");
        document.getElementById('p_btn').className = 'bx bx-loader-alt bx-spin play-main-btn';
        isAudioActuallyPlaying = false;
        return;
    }

    // Fungsi ini dirombak total untuk mengatasi suara 'robot' saat ganti lagu cepat.
    // Pendekatan baru ini lebih 'brutal' tapi lebih stabil:
    // 1. Matikan audio player yang lama secara paksa.
    // 2. Beri jeda sesaat (ini yang user suka, "ada jeda dikit").
    // 3. Buat koneksi BARU ke server stream.
    // Ini mencegah browser menerima data audio yang 'tercampur' antara lagu lama dan baru.

    if (Date.now() < syncBlockTime || isInterrupting) return;

    isBackgroundBuffering = true;
    isAudioActuallyPlaying = false;
    isCalculatingOffset = useOffset;
    streamTimeOffset = 0;
    document.getElementById('p_btn').className = 'bx bx-loader-alt bx-spin play-main-btn';

    // 1. Hentikan dan reset total audio player
    activeAudio.pause();
    activeAudio.removeAttribute('src');
    activeAudio.load();

    // 2. Beri jeda 250ms. Ini penting untuk memberi waktu browser 'melepas' koneksi lama
    // dan juga memberikan efek "jeda" yang lebih nyaman bagi pengguna.
    setTimeout(() => {
        if (isInterrupting) return; // Cek ulang kalau ada interupsi masuk saat jeda

        activeAudio.src = MPD_STREAM + "?ts=" + new Date().getTime();
        activeAudio.load();
        let playPromise = activeAudio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                // Sukses memulai playback, biarkan syncLoop yang mengambil alih dari sini
                isBackgroundBuffering = false;
                autoplayBlocked = false;
            }).catch(e => {
                isBackgroundBuffering = false;
                if (e.name === 'NotAllowedError') {
                    autoplayBlocked = true;
                    document.getElementById('p_btn').className = 'bx bx-play-circle play-main-btn';
                    document.getElementById('c_title').innerText = "TOMBOL PLAY ▶";
                    document.getElementById('c_artist').innerText = "Ketuk untuk izinkan suara";
                }
            });
        }
    }, 250);
}

function fetchMissingMetadata(ids) {
    if (!currentAuth.u) return;
    ids.forEach(id => {
        if (id && !songCache[id] && !isFetchingCache[id]) {
            isFetchingCache[id] = true;
            fetch(`${NAVIDROME}/rest/getSong.view?id=${id}&u=${currentAuth.u}&t=${currentAuth.t}&s=${currentAuth.s}&v=1.12.0&c=GP&f=json`)
            .then(r => {
                if (r.status === 401) { window.location.replace('/'); return {}; }
                return r.json();
            })
            .then(d => {
                if (d && d['subsonic-response'] && d['subsonic-response'].song) {
                    songCache[id] = d['subsonic-response'].song;
                    updateUIQueue(currentPlayingId); 
                    
                    // Update UI Bar bawah jika metadata lagu selesai ditarik
                    if (isPlayAlone && currentPlayingId === id) {
                        document.getElementById('c_title').innerText = songCache[id].title || "Tak Diketahui";
                        document.getElementById('c_artist').innerText = songCache[id].artist || "-";
                        document.getElementById('c_img').src = getCoverUrl(songCache[id].coverArt || id);
                    }
                }
            }).catch(()=>{});
        }
    });
}

async function doLogout() {
    await fetch('logout', { method: 'POST' });
    window.location.replace('/'); 
}

function togglePlayMode() {
    if (isInterrupting) return; // Kunci tombol saat Paging
    isPlayAlone = !isPlayAlone;
    const btn = document.getElementById('modeToggle');
    const icon = document.getElementById('modeIcon');
    const text = document.getElementById('modeText');

    if (isPlayAlone) {
        btn.classList.add('alone');
        icon.className = 'bx bx-mobile-alt';
        text.innerText = "DEVICE INI";
        audio1.pause(); audio1.src = "";
        audio2.pause(); audio2.src = "";
        activeAudio = audio1;

        currentPlayingId = null;
        document.getElementById('p_btn').className = 'bx bx-play-circle play-main-btn';
        
        restoreLocalState();
        
        // Jika memori memang kosong, kembalikan ke tampilan default
        if (!currentPlayingId) {
            localQueue = [];
            originalLocalQueue = [];
            userAddedCount = 0;
            updateUIQueue(null);
            document.getElementById('c_title').innerText = "Pilih Lagu";
            document.getElementById('c_artist').innerText = "-";
            document.getElementById('c_img').src = getCoverUrl(0);
            document.getElementById('t_cur').innerText = "0:00";
            document.getElementById('t_max').innerText = "0:00";
            document.getElementById('seekSlider').value = 0;
            document.getElementById('seekSlider').style.setProperty('--val', '0%');
        }

        if (document.getElementById('btn-snapweb-ui')) document.getElementById('btn-snapweb-ui').style.display = 'none';
        document.querySelectorAll('.btn-add-queue').forEach(el => el.style.display = 'inline-block');
    } else {
        btn.classList.remove('alone');
        icon.className = 'bx bx-speaker';
        text.innerText = "RUANGAN";

        // Hentikan audio lokal (Mode Murni Remote Control)
        activeAudio.pause();
        
        ensureSnapwebButton();
        if (document.getElementById('btn-snapweb-ui')) document.getElementById('btn-snapweb-ui').style.display = 'inline-flex';
        document.querySelectorAll('.btn-add-queue').forEach(el => el.style.display = 'none');

        autoplayBlocked = false;
        syncBlockTime = 0; // Buka kunci sinkronisasi
        syncLoop();        // Paksa sinkronisasi seketika saat beralih mode
    }
}

function setActiveNav(id) {
    document.querySelectorAll('.sidebar .nav-item').forEach(el => el.classList.remove('active'));
    if (document.getElementById(id)) document.getElementById(id).classList.add('active');
}

// ================ ADMIN ROLE & PAGING SYSTEM ================
let isAdmin = false;

function checkAdminRole() {
    if (!currentAuth.u) return;
    if (currentAuth.u.toLowerCase() === 'admin' || currentAuth.u.toLowerCase() === 'griyapersada') {
        isAdmin = true;
        if (!document.getElementById('admin-panel')) {
            const sidebar = document.querySelector('.sidebar');
            const adminHtml = `
                <div id="admin-panel" style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 15px;">
                    <div style="color: #ff4d4d; font-size: 11px; font-weight: 800; letter-spacing: 1.5px; margin-bottom: 8px; padding-left: 12px;">ADMIN PANGGILAN</div>
                    <div class="nav-item" onclick="openAdminUpload()" style="color: #fff; border: 1px solid rgba(255, 77, 77, 0.3);">
                        <i class='bx bx-cloud-upload' style="font-size: 18px; color: #ff4d4d;"></i> Upload Audio
                    </div>
                            <div class="nav-item" onclick="openTTSBroadcast()" id="ttsBtn" style="color: #fff; border: 1px solid rgba(255, 77, 77, 0.3);">
                                <i class='bx bx-message-rounded-dots' id="ttsIcon" style="font-size: 18px; color: #ff4d4d;"></i> <span id="ttsText">Siaran TTS (Teks)</span>
                    </div>
                </div>
            `;
            
            const logoutBtn = Array.from(document.querySelectorAll('.nav-item')).find(el => el.innerText.includes('Keluar'));
            if (logoutBtn) {
                logoutBtn.insertAdjacentHTML('beforebegin', adminHtml);
            } else {
                sidebar.insertAdjacentHTML('beforeend', adminHtml);
            }
        }
    }
}

function openAdminUpload() {
    if (!document.getElementById('uploadModal')) {
        const modalHtml = `
        <div id="uploadModal" class="modal-overlay active" onclick="closeUploadModal(event)">
            <div class="modal-content" style="text-align: center; width: 450px;">
                <h3 style="color: #ff4d4d; margin-bottom: 5px;"><i class='bx bx-broadcast'></i> Interupsi Audio</h3>
                <p style="font-size: 12px; color: var(--muted); margin-bottom: 20px;">File akan menghentikan musik di SEMUA device dan diputar otomatis.</p>
                
                <div id="dropZone" style="border: 2px dashed rgba(255, 77, 77, 0.5); border-radius: 8px; padding: 40px 20px; cursor: pointer; transition: 0.3s; background: rgba(255, 77, 77, 0.05);">
                    <i class='bx bx-cloud-upload' id="uploadIcon" style="font-size: 48px; color: #ff4d4d; margin-bottom: 10px;"></i>
                    <div id="uploadStatusText" style="font-weight: 600; margin-bottom: 4px; color:#fff;">Klik atau Drag & Drop File MP3/WAV</div>
                    <div style="font-size: 11px; color: var(--muted);">Maksimal ukuran: 50MB</div>
                    <input type="file" id="audioInput" accept="audio/mp3, audio/wav, audio/ogg" style="display: none;">
                </div>
                
                <div id="uploadList" style="margin-top: 16px; text-align: left; max-height: 150px; overflow-y: auto;"></div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        const dropZone = document.getElementById('dropZone');
        const audioInput = document.getElementById('audioInput');
        
        dropZone.onclick = () => audioInput.click();
        dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.background = 'rgba(255, 77, 77, 0.15)'; };
        dropZone.ondragleave = () => { dropZone.style.background = 'rgba(255, 77, 77, 0.05)'; };
        dropZone.ondrop = (e) => {
            e.preventDefault();
            dropZone.style.background = 'rgba(255, 77, 77, 0.05)';
            if (e.dataTransfer.files.length) handleFileUpload(e.dataTransfer.files[0]);
        };
        audioInput.onchange = (e) => {
            if (e.target.files.length) handleFileUpload(e.target.files[0]);
        };
        
        fetchInterruptList();
    } else {
        document.getElementById('uploadModal').classList.add('active');
        fetchInterruptList();
    }
}

async function fetchInterruptList() {
    try {
        const res = await fetch('api/list_interrupts').then(r=>r.json());
        if (res.status === 'success' && res.files) {
            const list = document.getElementById('uploadList');
            list.innerHTML = '';
            res.files.forEach(filename => {
                list.insertAdjacentHTML('beforeend', createUploadItemHTML(filename));
            });
        }
    } catch(e) { console.log("Gagal memuat list interupsi", e); }
}

function createUploadItemHTML(filename) {
    return `
    <div style="display: flex; align-items: center; justify-content: space-between; background: var(--elevated); padding: 12px; border-radius: 6px; margin-bottom: 8px; border: 1px solid #333;">
        <div style="display: flex; align-items: center; gap: 12px; overflow: hidden;">
            <i class='bx bxs-file-audio' style="font-size: 24px; color: #ff4d4d;"></i>
            <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; color: #fff;">${filename}</div>
        </div>
        <div style="display:flex; gap: 8px;">
            <button class="btn-green" style="margin: 0; padding: 6px 12px; background: #ff4d4d; color: #fff; font-size: 11px;" onclick="playInterruption('${filename}')">Siarkan ke Semua</button>
            <!-- HAPUS FILE FISIK -->
            <button class="btn-green" style="margin: 0; padding: 6px 10px; background: transparent; border: 1px solid #ff4d4d; color: #ff4d4d; font-size: 11px;" onclick="deleteUploadFile(this, '${filename}')">Hapus</button>
        </div>
    </div>`;
}

function closeUploadModal(e) {
    if(e && e.target.id !== 'uploadModal') return;
    document.getElementById('uploadModal').classList.remove('active');
}

async function handleFileUpload(file) {
    if (!file.type.startsWith('audio/')) { alert("Hanya file audio yang diizinkan!"); return; }
    
    document.getElementById('uploadIcon').className = 'bx bx-loader-alt bx-spin';
    document.getElementById('uploadStatusText').innerText = "Mengunggah File...";

    const formData = new FormData();
    formData.append('audio', file);

    try {
        const res = await fetch('api/upload_interrupt', { method: 'POST', body: formData }).then(r=>r.json());
        
        if (res.status === 'success') {
            const list = document.getElementById('uploadList');
            // Tambahkan item baru ke dalam list (append)
            const newItem = createUploadItemHTML(res.filename);
            
            list.insertAdjacentHTML('beforeend', newItem);
            
            // Batasi tampilan maksimal 3 file (buang yang paling atas jika lebih)
            while (list.children.length > 3) {
                list.removeChild(list.firstElementChild);
            }
        } else {
            alert(res.message || "Gagal mengunggah file.");
        }
    } catch(e) {
        alert("Gagal mengunggah file. Pastikan server mengizinkan file besar.");
    }
    
    document.getElementById('uploadIcon').className = 'bx bx-cloud-upload';
    document.getElementById('uploadStatusText').innerText = "Klik atau Drag & Drop File MP3/WAV";
}

async function deleteUploadFile(btn, filename) {
    btn.parentElement.parentElement.remove();
    try {
        await fetch('api/delete_interrupt', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ filename: filename })
        });
    } catch(e) { console.log("Gagal hapus file di server", e); }
}

async function playInterruption(filename) {
    if(!confirm(`Siarkan ${filename} ke SEMUA device?`)) return;
    closeUploadModal();
    await fetch('api/trigger_interrupt', {
        method: 'POST', 
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ filename: filename })
    });
}

// Fitur Siaran Text-to-Speech (TTS)
function openTTSBroadcast() {
    if (!document.getElementById('ttsModal')) {
        const modalHtml = `
        <div id="ttsModal" class="modal-overlay active" onclick="closeTTSModal(event)">
            <div class="modal-content" style="text-align: center; width: 450px;">
                <h3 style="color: #ff4d4d; margin-bottom: 5px;"><i class='bx bx-message-rounded-dots'></i> Siaran Teks (TTS)</h3>
                <p style="font-size: 12px; color: var(--muted); margin-bottom: 20px;">Ketik pengumuman, sistem akan mengubahnya menjadi suara wanita dan menyiarkannya ke SEMUA device.</p>
                
                <textarea id="ttsInput" rows="4" placeholder="Ketik pesan pengumuman di sini..." style="width: 100%; background: var(--elevated); border: 1px solid #333; color: #fff; padding: 12px; border-radius: 8px; resize: none; font-size: 14px; outline: none; margin-bottom: 16px; font-family: inherit; box-sizing: border-box;"></textarea>
                
                <button id="btnSendTTS" class="btn-green" style="width: 100%; margin: 0; background: #ff4d4d; color: #fff; justify-content: center;" onclick="sendTTSBroadcast()">
                    <i class='bx bx-broadcast'></i> Siarkan ke Semua Device
                </button>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    } else {
        document.getElementById('ttsModal').classList.add('active');
        document.getElementById('ttsInput').value = '';
    }
    setTimeout(() => document.getElementById('ttsInput').focus(), 100);
}

function closeTTSModal(e) {
    if(e && e.target.id !== 'ttsModal') return;
    document.getElementById('ttsModal').classList.remove('active');
}

async function sendTTSBroadcast() {
    const text = document.getElementById('ttsInput').value;
    if (!text || text.trim() === '') {
        alert("Teks tidak boleh kosong!");
        return;
    }
    
    const btn = document.getElementById('btnSendTTS');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Memproses Suara...`;
    btn.disabled = true;
    btn.style.opacity = '0.7';
    
    try {
        const res = await fetch('api/tts_interrupt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        }).then(r => r.json());
        
        if (res.status !== 'success') {
            alert("Gagal menyiarkan TTS: " + res.message);
        } else {
            closeTTSModal();
        }
    } catch(e) {
        alert("Terjadi kesalahan koneksi saat memproses TTS.");
    }
    
    btn.innerHTML = originalText;
    btn.disabled = false;
    btn.style.opacity = '1';
}
// ===============================================================

async function loadSidebarPlaylists() {
    try {
        const fetchRes = await fetch('api/playlists');
        if (fetchRes.status === 401) { window.location.replace('/'); return; }
        const res = await fetchRes.json();
        if(res.status === "success" && res.data) {
            const html = res.data.map(p => `
                <div class="nav-item" style="padding: 10px 12px; font-size: 13px;" onclick="openPlaylist('${p.name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')">
                    <i class='bx bxs-playlist' style="font-size: 18px;"></i> ${p.name}
                </div>
            `).join('');
            document.getElementById('sidebar-playlists').innerHTML = html;
        }
    } catch(e) {}
}

async function searchHomeSongs() {
    const query = document.getElementById('homeSearchInput').value;
    document.getElementById('dynamic-content-list').innerHTML = `<p style="text-align:center; padding:40px;"><i class='bx bx-loader-alt bx-spin' style="font-size: 24px; color:var(--muted)"></i></p>`;
    if(!query) { loadLibrary(); return; }
    try {
        const fetchRes = await fetch(`api/search?q=${encodeURIComponent(query)}`);
        if (fetchRes.status === 401) { window.location.replace('/'); return; }
        const res = await fetchRes.json();

        if(res.status === "success") {
            currentAuth = res.auth;
            checkAdminRole(); 
            currentSongs = res.data.sort((a, b) => a.title.localeCompare(b.title));
            updateSongCache(currentSongs);
            renderSongTable(currentSongs, null, 'dynamic-content-list');
        } else {
             document.getElementById('dynamic-content-list').innerHTML = `<p style="color:var(--muted); text-align:center; padding:40px;">Gagal memuat hasil.</p>`;
        }
    } catch(e) {}
}

function resetHomeSearch() {
    document.getElementById('homeSearchInput').value = '';
    loadLibrary(); 
}

async function fetchMoreHomeSongs() {
    if (isHomeLoading) return;
    isHomeLoading = true;

    const listDiv = document.getElementById('dynamic-content-list');
    const loadMoreDiv = document.getElementById('load-more-container');
    if (loadMoreDiv) loadMoreDiv.innerHTML = `<p><i class='bx bx-loader-alt bx-spin'></i> Memuat...</p>`;

    try {
        const fetchRes = await fetch(`api/songs?page=${homePage}`);
        if (fetchRes.status === 401) { window.location.replace('/'); return; }
        
        const res = await fetchRes.json();
        if(res.status === "success") {
            currentAuth = res.auth;
            checkAdminRole(); 

            if (res.data && res.data.length > 0) {
                currentSongs.push(...res.data);
                updateSongCache(res.data);
                renderSongTable(currentSongs, null, 'dynamic-content-list');
                
                if (res.data.length >= 200) {
                    loadMoreDiv.innerHTML = `<button class="btn-green" onclick="fetchMoreHomeSongs()">Muat Lebih Banyak</button>`;
                    homePage++;
                } else {
                    loadMoreDiv.innerHTML = `<p style="color:var(--muted); font-size: 13px;">-- Akhir dari daftar --</p>`;
                }
            } else {
                if (homePage === 1) {
                    listDiv.innerHTML = `<p style="color:var(--muted); text-align:center; padding:40px;">Tidak ada lagu ditemukan.</p>`;
                }
                loadMoreDiv.innerHTML = `<p style="color:var(--muted); font-size: 13px;">-- Akhir dari daftar --</p>`;
            }
        } else {
            if (homePage === 1) listDiv.innerHTML = `<p style="color:var(--muted); text-align:center; padding:40px;">Gagal memuat lagu dari server.</p>`;
            if (loadMoreDiv) loadMoreDiv.innerHTML = '';
        }
    } catch(e) {
        if (homePage === 1) listDiv.innerHTML = `<p style="color:var(--muted); text-align:center; padding:40px;">Koneksi ke server terputus.</p>`;
        if (loadMoreDiv) loadMoreDiv.innerHTML = '';
    } finally {
        isHomeLoading = false;
    }
}

async function loadLibrary() {
    homePage = 1;
    currentSongs = [];
    setActiveNav('nav-home');
    document.getElementById('page-title').innerText = "Beranda Musik";
    document.getElementById('main-play-btn').style.display = "inline-flex";
    if(document.getElementById('multi-add-btn')) document.getElementById('multi-add-btn').style.display = "inline-flex";
    document.getElementById('dynamic-content').innerHTML = `
        <div class="search-box" style="margin-bottom: 24px;">
            <i class='bx bx-search' style="font-size: 20px; color: var(--muted)"></i>
            <input type="text" id="homeSearchInput" placeholder="Cari lagu di beranda..." onkeyup="if(event.key === 'Enter') searchHomeSongs()">
            <button class="btn-add-outline" onclick="searchHomeSongs()">Cari</button>
            <button class="btn-add-outline" style="border-color: #ff4d4d; color: #ff4d4d;" onclick="resetHomeSearch()">Reset</button>
        </div>
        <div id="dynamic-content-list">
            <p style="text-align:center; padding:40px;"><i class='bx bx-loader-alt bx-spin' style="font-size: 24px; color:var(--muted)"></i></p>
        </div>
        <div id="load-more-container" style="text-align: center; margin: 20px 0;"></div>
    `;

    await fetchMoreHomeSongs();
    loadSidebarPlaylists();
}

async function loadAlbums() {
    setActiveNav('nav-album');
    document.getElementById('page-title').innerText = "Album Terbaru";
    document.getElementById('main-play-btn').style.display = "none";
    if(document.getElementById('multi-add-btn')) document.getElementById('multi-add-btn').style.display = "none";
    document.getElementById('dynamic-content').innerHTML = `<p style="text-align:center; padding:40px;"><i class='bx bx-loader-alt bx-spin' style="font-size:24px; color:var(--muted)"></i></p>`;
    try {
        const fetchRes = await fetch('api/albums');
        if (fetchRes.status === 401) { window.location.replace('/'); return; }
        const res = await fetchRes.json();
        if(res.status === "success") {
            currentAuth = res.auth;
            checkAdminRole();
            renderAlbumGrid(res.data);
        }
    } catch(e) {}
}

async function openAlbum(albumId, albumName) {
    document.getElementById('page-title').innerText = albumName;
    document.getElementById('main-play-btn').style.display = "inline-flex";
    if(document.getElementById('multi-add-btn')) document.getElementById('multi-add-btn').style.display = "inline-flex";
    document.getElementById('dynamic-content').innerHTML = `<p style="text-align:center; padding:40px;"><i class='bx bx-loader-alt bx-spin' style="font-size: 24px; color:var(--muted)"></i></p>`;
    try {
        const fetchRes = await fetch(`api/album/${albumId}`);
        if (fetchRes.status === 401) { window.location.replace('/'); return; }
        const res = await fetchRes.json();
        if(res.status === "success") {
            currentSongs = res.data;
            updateSongCache(currentSongs);
            renderSongTable(currentSongs, null, 'dynamic-content');
        }
    } catch(e) {}
}

async function loadPlaylists() {
    setActiveNav('nav-playlist');
    document.getElementById('page-title').innerText = "Library Saya";
    document.getElementById('main-play-btn').style.display = "none";
    if(document.getElementById('multi-add-btn')) document.getElementById('multi-add-btn').style.display = "none";
    document.getElementById('dynamic-content').innerHTML = `
        <button class="btn-green" onclick="openCreatePlaylistModal()"><i class='bx bx-plus'></i> Buat Playlist Baru</button>
        <div id="playlist-container" style="margin-top: 20px;"><i class='bx bx-loader-alt bx-spin' style="font-size: 24px; color: var(--muted)"></i></div>
    `;
    
    try {
        const fetchRes = await fetch('api/playlists');
        if (fetchRes.status === 401) { window.location.replace('/'); return; }
        const res = await fetchRes.json();

        if(res.status === "success" && res.data.length > 0) {
            let html = '<div class="album-grid">';
            html += res.data.map(p => {
                const coverSrc = (p.songs && p.songs.length > 0) ? getCoverUrl(getBestCoverId(p.songs[0])) : getCoverUrl(0);
                return `
                <div class="album-card" style="position: relative;">
                    <i class='bx bx-trash' title="Hapus Playlist" style="position: absolute; top: 12px; right: 12px; font-size: 20px; color: #ff4d4d; background: rgba(0,0,0,0.6); padding: 6px; border-radius: 50%; cursor: pointer; z-index: 2; transition: 0.2s;" onclick="event.stopPropagation(); deletePlaylist('${p.name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')"></i>
                    <div onclick="openPlaylist('${p.name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')" style="cursor: pointer;">
                        <img src="${coverSrc}" onerror="this.onerror=null; this.src='${getCoverUrl(0)}';">
                        <div class="a-title">${p.name}</div>
                        <div class="a-artist"><i class='bx bx-list-music' style="margin-right:4px;"></i>${p.songs ? p.songs.length : 0} Lagu</div>
                    </div>
                </div>`;
            }).join('');
            html += '</div>';
            document.getElementById('playlist-container').innerHTML = html;
        } else {
            document.getElementById('playlist-container').innerHTML = "<p style='color:var(--muted)'>Belum ada playlist.</p>";
        }
    } catch(e) {}
}

async function deletePlaylist(playlistName) {
    if (!confirm(`Apakah Anda yakin ingin menghapus playlist "${playlistName}" secara permanen?`)) return;
    await fetch('api/playlist/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: playlistName }) });
    loadPlaylists();
    loadSidebarPlaylists(); 
}

function openCreatePlaylistModal() {
    if (document.getElementById('createPlModal')) document.getElementById('createPlModal').remove();
    const modalHtml = `
    <div id="createPlModal" class="modal-overlay active" onclick="this.remove()">
        <div class="modal-content" onclick="event.stopPropagation()" style="width: 350px;">
            <h3 style="margin-bottom: 20px;">Buat Playlist Baru</h3>
            <div class="modal-footer" style="flex-direction: column; gap: 12px;">
                <input type="text" id="newPlaylistNameInput" placeholder="Nama playlist..." style="width: 100%;">
                <button class="btn-green" style="width: 100%; margin:0; justify-content: center;" onclick="handleCreatePlaylist()">Simpan Playlist</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.getElementById('newPlaylistNameInput').focus();
}

async function handleCreatePlaylist() {
    const input = document.getElementById('newPlaylistNameInput');
    const name = input.value.trim();
    if (!name) { input.style.border = '1px solid red'; return; }
    await fetch('api/playlist/create', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name: name }) });
    if (document.getElementById('createPlModal')) document.getElementById('createPlModal').remove();
    loadPlaylists();
    loadSidebarPlaylists();
}

async function openPlaylist(name) {
    document.querySelectorAll('.sidebar .nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('page-title').innerText = name;
    document.getElementById('main-play-btn').style.display = "inline-flex";
    if(document.getElementById('multi-add-btn')) document.getElementById('multi-add-btn').style.display = "inline-flex";
    document.getElementById('dynamic-content').innerHTML = `<p style="text-align:center; padding:40px;"><i class='bx bx-loader-alt bx-spin' style="font-size: 24px; color:var(--muted)"></i></p>`;

    try {
        const fetchRes = await fetch(`api/playlist/get?name=${encodeURIComponent(name)}`);
        if (fetchRes.status === 401) { window.location.replace('/'); return; }
        const res = await fetchRes.json();

        currentSongs = (res.status === "success") ? res.data : [];
        updateSongCache(currentSongs);
        
        let html = `
            <div class="playlist-search-area" style="margin-top: 0; padding-top: 0; border-top: none; margin-bottom: 30px;">
                <div class="search-box" style="margin-bottom: 16px;">
                    <i class='bx bx-search' style="font-size: 20px; color: var(--muted)"></i>
                    <input type="text" id="plSearchInput" placeholder="Cari lagu untuk ditambahkan ke playlist..." onkeyup="if(event.key === 'Enter') searchForPlaylist('${name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')">
                    <button class="btn-add-outline" onclick="searchForPlaylist('${name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')">Cari</button>
                    <button class="btn-add-outline" style="border-color: #ff4d4d; color: #ff4d4d;" onclick="resetPlaylistSearch()">Reset</button>
                </div>
                <div id="plSearchResults"></div>
            </div>
        `;

        if(currentSongs.length > 0) {
            html += `<table><thead><tr><th class="col-idx">#</th><th class="col-title">Judul</th><th class="col-album">Album</th><th class="col-dur"><i class='bx bx-time'></i></th></tr></thead><tbody>`;
            html += currentSongs.map((s, i) => `
                <tr onclick="putarSatu('${s.id}')">
                    <td class="col-idx">${i+1}</td>
                    <td class="col-title">
                        <div style="display:flex; align-items:center; gap:16px">
                            <img src="${getCoverUrl(s.coverArt || s.id)}" onerror="this.onerror=null; this.src='${getCoverUrl(0)}';" style="width:40px;height:40px;border-radius:4px;object-fit:cover;">
                            <div><div style="font-weight:600;color:#fff">${s.title}</div><div style="font-size:12px;color:var(--muted)">${s.artist}</div></div>
                        </div>
                    </td>
                    <td class="col-album">${s.album || '-'}</td>
                    <td class="col-dur">
                        ${Math.floor(s.duration/60)}:${(s.duration%60).toString().padStart(2,'0')}
                        <i class='bx bx-trash' style="font-size: 16px; margin-left: 8px; cursor:pointer; color:#ff4d4d;" title="Hapus" onclick="event.stopPropagation(); removeFromPlaylist('${s.id}', '${name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')"></i>
                    </td>
                </tr>`).join('');
            html += `</tbody></table>`;
        } else {
            html += `<p style="color:var(--muted); margin-bottom: 20px;">Playlist ini masih kosong.</p>`;
        }

        document.getElementById('dynamic-content').innerHTML = html;
    } catch(e) {}
}

function resetPlaylistSearch() {
    document.getElementById('plSearchInput').value = '';
    document.getElementById('plSearchResults').innerHTML = '';
}

async function searchForPlaylist(playlistName) {
    const query = document.getElementById('plSearchInput').value;
    if(!query) return;
    document.getElementById('plSearchResults').innerHTML = `<p style="color:var(--muted)"><i class='bx bx-loader-alt bx-spin'></i> Mencari...</p>`;
    try {
        const fetchRes = await fetch(`api/search?q=${encodeURIComponent(query)}`);
        if (fetchRes.status === 401) { window.location.replace('/'); return; }
        const res = await fetchRes.json();

        if(res.status === "success" && res.data.length > 0) {
            let html = res.data.map(s => `
                <div class="search-result-item">
                    <div style="display:flex; align-items:center; gap:12px">
                        <img src="${getCoverUrl(s.coverArt || s.id)}" onerror="this.onerror=null; this.src='${getCoverUrl(0)}';" style="width:40px; border-radius:4px;">
                        <div>
                            <div style="color:#fff; font-weight:600; font-size:14px;">${s.title}</div>
                            <div style="color:var(--muted); font-size:12px;">${s.artist}</div>
                        </div>
                    </div>
                    <button class="btn-add-outline" onclick="addToPlaylistDirect('${s.id}', '${playlistName.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')">Tambah</button>
                </div>
            `).join('');
            document.getElementById('plSearchResults').innerHTML = html;
        } else {
            document.getElementById('plSearchResults').innerHTML = `<p style="color:var(--muted)">Lagu tidak ditemukan.</p>`;
        }
    } catch(e) {}
}

let selectedSongForPlaylist = null;
async function promptAddToPlaylistModal(songId) {
    selectedSongForPlaylist = songId;
    const modal = document.getElementById('playlistModal');
    const listDiv = document.getElementById('modalPlaylistList');
    
    listDiv.innerHTML = `<p style="text-align:center; color:var(--muted); padding:20px;"><i class='bx bx-loader-alt bx-spin' style="font-size:24px;"></i></p>`;
    modal.classList.add('active');

    try {
        const fetchRes = await fetch('api/playlists');
        if (fetchRes.status === 401) { window.location.replace('/'); return; }
        const res = await fetchRes.json();

        if (res.status === "success" && res.data.length > 0) {
            listDiv.innerHTML = res.data.map(p => {
                const coverSrc = (p.songs && p.songs.length > 0) ? getCoverUrl(getBestCoverId(p.songs[0])) : getCoverUrl(0);
                return `
                <div class="pl-item" onclick="addToPlaylistDirect('${songId}', '${p.name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}', true)">
                    <img src="${coverSrc}" onerror="this.onerror=null; this.src='${getCoverUrl(0)}';">
                    <div class="pl-name">${p.name}</div>
                    <i class='bx bx-list-plus' style="color:var(--muted); font-size: 24px;"></i>
                </div>`;
            }).join('');
        } else {
            listDiv.innerHTML = `<p style="text-align:center; color:var(--muted); font-size: 13px;">Belum ada playlist.</p>`;
        }
    } catch(e) {}
}

function closeModal(e) {
    if(e && e.target.id !== 'playlistModal') return;
    document.getElementById('playlistModal').classList.remove('active');
    if(document.getElementById('newPlaylistInput')) document.getElementById('newPlaylistInput').value = '';
}

async function createAndAddPlaylist() {
    const name = document.getElementById('newPlaylistInput').value.trim();
    if(!name || !selectedSongForPlaylist) return;
    await fetch('api/playlist/create', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name: name }) });
    await addToPlaylistDirect(selectedSongForPlaylist, name, true);
    loadSidebarPlaylists(); 
}

async function addToPlaylistDirect(songId, playlistName, fromModal=false) {
    try {
        const res = await fetch('api/playlist/add', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ song_id: songId, playlist_name: playlistName })
        }).then(r => r.json());
        
        if (res.status === 'success') {
            showToast(`Berhasil menambahkan ke playlist ${playlistName}`);
        } else if (res.status === 'info') {
            showToast(`Lagu sudah ada di playlist ${playlistName}`);
        } else {
            showToast(res.message || "Gagal menambahkan lagu");
        }
    } catch(e) {}
    
    if(fromModal) closeModal();
    else openPlaylist(playlistName);
}

async function removeFromPlaylist(songId, playlistName) {
    if(!confirm("Hapus lagu ini dari playlist?")) return;
    await fetch('api/playlist/remove', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ song_id: songId, playlist_name: playlistName })
    });
    openPlaylist(playlistName);
}

// ================ MULTI ADD TO PLAYLIST ================
function openMultiAddModal() {
    if (!currentSongs || currentSongs.length === 0) {
        showToast("Tidak ada lagu di daftar saat ini.");
        return;
    }
    
    document.getElementById('multiStartIdx').value = 1;
    document.getElementById('multiEndIdx').value = currentSongs.length;
    
    const modal = document.getElementById('multiAddModal');
    const listDiv = document.getElementById('multiPlaylistList');
    listDiv.innerHTML = `<p style="text-align:center; color:var(--muted); padding:20px;"><i class='bx bx-loader-alt bx-spin' style="font-size:24px;"></i></p>`;
    modal.classList.add('active');
    
    fetch('api/playlists').then(r => r.json()).then(res => {
        if (res.status === "success" && res.data.length > 0) {
            listDiv.innerHTML = res.data.map(p => {
                const coverSrc = (p.songs && p.songs.length > 0) ? getCoverUrl(getBestCoverId(p.songs[0])) : getCoverUrl(0);
                return `
                <div class="pl-item" onclick="processMultiAdd('${p.name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')">
                    <img src="${coverSrc}" onerror="this.onerror=null; this.src='${getCoverUrl(0)}';">
                    <div class="pl-name">${p.name}</div>
                    <i class='bx bx-list-plus' style="color:var(--muted); font-size: 24px;"></i>
                </div>`;
            }).join('');
        } else {
            listDiv.innerHTML = `<p style="text-align:center; color:var(--muted); font-size: 13px;">Belum ada playlist.</p>`;
        }
    }).catch(()=>{});
}

function closeMultiAddModal(e) {
    if(e && e.target.id !== 'multiAddModal') return;
    document.getElementById('multiAddModal').classList.remove('active');
    if(document.getElementById('multiNewPlaylistInput')) document.getElementById('multiNewPlaylistInput').value = '';
}

async function createAndAddMultiPlaylist() {
    const name = document.getElementById('multiNewPlaylistInput').value.trim();
    if(!name) { document.getElementById('multiNewPlaylistInput').style.border = '1px solid red'; return; }
    await fetch('api/playlist/create', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name: name }) });
    processMultiAdd(name);
}

async function processMultiAdd(playlistName) {
    let start = parseInt(document.getElementById('multiStartIdx').value) - 1;
    let end = parseInt(document.getElementById('multiEndIdx').value) - 1;
    
    if (isNaN(start) || isNaN(end) || start < 0 || end >= currentSongs.length || start > end) {
        showToast("Rentang nomor tidak valid!");
        return;
    }
    
    closeMultiAddModal();
    const songIds = currentSongs.slice(start, end + 1).map(s => s.id);
    
    try {
        const res = await fetch('api/playlist/add_multi', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ song_ids: songIds, playlist_name: playlistName })
        }).then(r => r.json());
        
        if (res.status === 'success') {
            showToast(res.message);
            loadSidebarPlaylists(); 
        } else {
            showToast(res.message || "Gagal menambahkan lagu");
        }
    } catch(e) {
        showToast("Terjadi kesalahan koneksi.");
    }
}

// ================ TOAST NOTIFICATION ================
function showToast(message) {
    let toast = document.getElementById('gp-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'gp-toast';
        toast.style.cssText = "position: fixed; bottom: 110px; left: 50%; transform: translateX(-50%) translateY(20px); background: var(--accent); color: #000; padding: 10px 20px; border-radius: 30px; font-size: 13px; font-weight: 700; box-shadow: 0 8px 24px rgba(0,0,0,0.5); opacity: 0; pointer-events: none; transition: all 0.3s cubic-bezier(0.3, 0, 0.2, 1); z-index: 9999; display: flex; align-items: center; gap: 8px;";
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<i class='bx bx-check-circle' style='font-size:18px;'></i> ${message}`;
    
    void toast.offsetWidth;
    toast.style.transform = "translateX(-50%) translateY(0)";
    toast.style.opacity = "1";
    
    if (toast.timeoutId) clearTimeout(toast.timeoutId);
    toast.timeoutId = setTimeout(() => {
        toast.style.transform = "translateX(-50%) translateY(20px)";
        toast.style.opacity = "0";
    }, 3000);
}

// ================ PUSH KE SERVER (JSON QUEUE) ================
async function pushQueueToServer(playNow = false, seekTime = 0) {
    if (isPlayAlone) return;
    
    const data = {
        queue: localQueue,
        original: originalLocalQueue,
        current_id: currentPlayingId,
        shuffle: isShuffleActive,
        repeat: isLoopActive,
        user_added: userAddedCount,
        play_now: playNow,
        seek_time: seekTime
    };
    
    await fetch('api/queue/push', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    syncBlockTime = 0;
    syncLoop();
}

async function addToQueue(songId) {
    let curIdx = localQueue.indexOf(currentPlayingId);
    if (curIdx > -1) {
        localQueue.splice(curIdx + 1 + userAddedCount, 0, songId);
    } else {
        localQueue.push(songId);
    }
    
    let origCurIdx = originalLocalQueue.indexOf(currentPlayingId);
    if (origCurIdx > -1) {
        originalLocalQueue.splice(origCurIdx + 1 + userAddedCount, 0, songId);
    } else {
        originalLocalQueue.push(songId);
    }
    userAddedCount++;
    updateUIQueue(currentPlayingId);
    
    let s = songCache[songId];
    if (isPlayAlone) {
        if (s) showToast(`Lagu "${s.title}" diputar selanjutnya`);
    } else {
        await pushQueueToServer(false);
        if (s) showToast(`Lagu "${s.title}" ditambahkan ke antrian ruangan`);
    }
}

async function removeFromQueue(index) {
    const songId = localQueue[index];
    localQueue.splice(index, 1);
    const origIdx = originalLocalQueue.indexOf(songId);
    if(origIdx > -1) originalLocalQueue.splice(origIdx, 1);
    
    updateUIQueue(currentPlayingId);
    
    if (!isPlayAlone) {
        await pushQueueToServer(false);
    }
}

function renderSongTable(songs, playlistName = null, containerId = 'dynamic-content') {
    let html = `<table><thead><tr><th class="col-idx">#</th><th class="col-title">Judul</th><th class="col-album">Album</th><th class="col-dur"><i class='bx bx-time'></i></th></tr></thead><tbody>`;
    if(!songs || songs.length === 0) {
        html += `<tr><td colspan="4" style="text-align:center;">Tidak ada lagu.</td></tr>`;
    } else {
        html += songs.map((s, i) => `
            <tr onclick="putarSatu('${s.id}', false)">
                <td class="col-idx">${i+1}</td>
                <td class="col-title">
                    <div style="display:flex; align-items:center; gap:16px">
                        <img src="${getCoverUrl(s.coverArt || s.id)}" loading="lazy" style="width:40px;height:40px;border-radius:4px; object-fit:cover;" onerror="this.onerror=null; this.src='${getCoverUrl(0)}';">
                        <div><div style="font-weight:600;color:#fff;margin-bottom:2px;">${s.title}</div><div style="font-size:12px;color:var(--muted)">${s.artist}</div></div>
                    </div>
                </td>
                <td class="col-album">${s.album || '-'}</td>
                <td class="col-dur" style="overflow: visible !important; min-width: 120px;">
                    ${Math.floor(s.duration/60)}:${(s.duration%60).toString().padStart(2,'0')}
                    <i class='bx bx-list-plus' style="font-size: 22px; margin-left: 12px; cursor:pointer;" title="Tambah ke Playlist" onclick="event.stopPropagation(); promptAddToPlaylistModal('${s.id}')"></i>
                    <i class='bx bx-add-to-queue' style="font-size: 22px; margin-left: 8px; cursor:pointer;" title="Tambah ke Antrian" onclick="event.stopPropagation(); addToQueue('${s.id}')"></i>
                </td>
            </tr>`).join('');
    }
    html += `</tbody></table>`;
    document.getElementById(containerId).innerHTML = html;
}

function renderAlbumGrid(albums) {
    let html = `<div class="album-grid">`;
    html += albums.map(a => `
        <div class="album-card" onclick="openAlbum('${a.id}', '${a.name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')">
            <img src="${getCoverUrl(a.coverArt || a.id)}" loading="lazy" onerror="this.onerror=null; this.src='${getCoverUrl(0)}';">
            <div class="a-title">${a.name}</div>
            <div class="a-artist"><i class='bx bx-album' style="margin-right:4px;"></i>${a.artist || 'Unknown Artist'}</div>
        </div>`).join('');
    html += `</div>`;
    document.getElementById('dynamic-content').innerHTML = html;
}

// ================ PEMUTARAN (PLAYER LOGIC) ================
async function playAllFromUI() {
    if (isInterrupting) return;
    if(currentSongs.length > 0) putarSatu(currentSongs[0].id, false);
}

async function putarSatu(id, fromQueue = false) {
    if (isInterrupting) return;
    syncBlockTime = Date.now() + 2500; 
    document.getElementById('p_btn').className = 'bx bx-loader-alt bx-spin play-main-btn';
    isAudioActuallyPlaying = false;
    isCalculatingOffset = true;
    streamTimeOffset = 0;
    userAddedCount = 0; // Reset hitungan antrian
    
    let idx = -1;
    if (!fromQueue) {
        // Playback baru dari daftar lagu utama
        document.getElementById('t_cur').innerText = "0:00";
        document.getElementById('seekSlider').value = 0;
        document.getElementById('seekSlider').style.setProperty('--val', '0%');
        originalLocalQueue = currentSongs.map(s => s.id);
        
        if (isShuffleActive) {
            let shuffled = [...originalLocalQueue];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            let clickIdx = shuffled.indexOf(id);
            if (clickIdx > -1) {
                shuffled.splice(clickIdx, 1);
                shuffled.unshift(id); // Jadikan lagu ini nomor 1 teratas di antrian Shuffle
            }
            localQueue = shuffled;
        } else {
            localQueue = [...originalLocalQueue];
            let clickIdx = originalLocalQueue.indexOf(id);
            if (clickIdx > -1) {
                localQueue = originalLocalQueue.slice(clickIdx);
            }
        }
        idx = localQueue.indexOf(id);
    } else {
        // Playback dari klik di antrian
        idx = localQueue.indexOf(id);
    }
    
    if(idx === -1) idx = 0;
    currentPlayingId = localQueue[idx];
    
    if (isPlayAlone) {
        activeAudio.src = `${NAVIDROME}/rest/stream?id=${currentPlayingId}&u=${currentAuth.u}&t=${currentAuth.t}&s=${currentAuth.s}&v=1.12.0&c=GP`;
        activeAudio.play().catch(() => {});
        
        let sCache = songCache[currentPlayingId] || {};
        document.getElementById('c_title').innerText = sCache.title || "Memuat...";
        document.getElementById('c_artist').innerText = sCache.artist || "-";
        
        const cvrId = sCache.coverArt || currentPlayingId;
        document.getElementById('c_img').src = getCoverUrl(cvrId);
        document.getElementById('c_img').onerror = function() { this.onerror=null; this.src=getCoverUrl(0); };
        
        updateUIQueue(currentPlayingId);
    } else {
        autoplayBlocked = false; 
        await pushQueueToServer(true, 0); // Bersihkan, load array baru dan putar sekarang!
        forceStreamReload(true, true);
    }
}

// ================ REMOTE CONTROL ================
async function cmd(method) {
    if (isInterrupting || isCmdRunning) return; // Kunci kontrol saat disiarkan atau API proses
    isCmdRunning = true;
    syncBlockTime = Date.now() + 2500; 

    try {
        if (method === 'next' || method === 'prev') {
            document.getElementById('t_cur').innerText = "0:00";
            document.getElementById('seekSlider').value = 0;
            document.getElementById('seekSlider').style.setProperty('--val', '0%');
            isCalculatingOffset = true;
            streamTimeOffset = 0;
        }

        if (isPlayAlone) {
            if (method === 'play') activeAudio.paused ? activeAudio.play() : activeAudio.pause();
            else if (method === 'next') {
                userAddedCount = 0;
                if (localQueue.length === 0) return;
                if (isLoopActive) {
                    activeAudio.currentTime = 0;
                    activeAudio.play().catch(()=>{});
                } else {
                    let cur = localQueue.indexOf(currentPlayingId);
                    if (cur !== -1 && cur < localQueue.length - 1) {
                        putarSatu(localQueue[cur + 1], true);
                    } else {
                        // Di ujung antrian
                        if (isShuffleActive) {
                            let shuffled = [...originalLocalQueue];
                            for (let i = shuffled.length - 1; i > 0; i--) {
                                const j = Math.floor(Math.random() * (i + 1));
                                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                            }
                            localQueue = shuffled;
                            putarSatu(localQueue[0], true);
                        } else {
                            putarSatu(localQueue[0], true);
                        }
                    }
                }
            } 
            else if (method === 'prev') {
                userAddedCount = 0;
                if (localQueue.length === 0) return;
                if (isLoopActive) {
                    activeAudio.currentTime = 0;
                    activeAudio.play().catch(()=>{});
                } else {
                    let cur = localQueue.indexOf(currentPlayingId);
                    if (cur > 0) {
                        putarSatu(localQueue[cur - 1], true);
                    } else {
                        putarSatu(localQueue[localQueue.length - 1], true);
                    }
                }
            }
        } else { // MODE RUANGAN
            if (method === 'play') {
                if (currentMpdState === "play") {
                    activeAudio.pause();
                    document.getElementById('p_btn').className = 'bx bx-play-circle play-main-btn';
                    await fetch('api/mpd/cmd', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ method: 'pause' }) });
                } else {
                    autoplayBlocked = false;
                    isAudioActuallyPlaying = false;
                    isCalculatingOffset = true;
                    document.getElementById('p_btn').className = 'bx bx-loader-alt bx-spin play-main-btn';
                    await fetch('api/mpd/cmd', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ method: 'play' }) });
                    forceStreamReload(true, false); 
                }
            }
            else if (method === 'next' || method === 'prev') {
                document.getElementById('p_btn').className = 'bx bx-loader-alt bx-spin play-main-btn';
                isAudioActuallyPlaying = false;
                autoplayBlocked = false; 
                isCalculatingOffset = true;
                await fetch('api/mpd/cmd', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ method }) });
                syncBlockTime = 0;
                syncLoop();
            }
        }
        
        // ================ LOGIKA GLOBAL SHUFFLE & REPEAT ================
        if (method === 'shuffle') {
            isShuffleActive = !isShuffleActive;
            let shufBtn = document.getElementById('shuffleBtn');
            
            if (isShuffleActive) {
                if (isLoopActive) {
                    isLoopActive = false;
                    let repBtn = document.getElementById('repeatBtn');
                    if (repBtn) repBtn.classList.remove('active');
                }
                shufBtn.classList.add('active');
                let shuffled = [...originalLocalQueue];
                for (let i = shuffled.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                }
                let curIdx = shuffled.indexOf(currentPlayingId);
                if (curIdx > -1) {
                    shuffled.splice(curIdx, 1);
                    shuffled.unshift(currentPlayingId);
                }
                localQueue = shuffled;
                userAddedCount = 0;
            } else {
                shufBtn.classList.remove('active');
                let clickIdx = originalLocalQueue.indexOf(currentPlayingId);
                if (clickIdx > -1) {
                    localQueue = originalLocalQueue.slice(clickIdx);
                } else {
                    localQueue = [...originalLocalQueue];
                }
                userAddedCount = 0;
            }
            updateUIQueue(currentPlayingId);
            if (!isPlayAlone) await pushQueueToServer(false); 
        }
        else if (method === 'repeat') {
            isLoopActive = !isLoopActive;
            let repBtn = document.getElementById('repeatBtn');
            if (isLoopActive) {
                if (isShuffleActive) {
                    isShuffleActive = false;
                    let shufBtn = document.getElementById('shuffleBtn');
                    if (shufBtn) shufBtn.classList.remove('active');
                    localQueue = [...originalLocalQueue];
                }
                repBtn.classList.add('active');
            } else {
                repBtn.classList.remove('active');
            }
            updateUIQueue(currentPlayingId);
            if (!isPlayAlone) await pushQueueToServer(false);
        }
    } finally {
        isCmdRunning = false;
    }
}

    // ================ TRIGGER INTERUPSI UI ================
    function triggerInterruptUI(filename, playDelay) {
        if (isInterrupting) return; // Cegah dobel trigger
        isInterrupting = true;
        let wasPlayingLocal = false;
        if (isPlayAlone && !activeAudio.paused) {
            wasPlayingLocal = true;
            activeAudio.pause();
        }
        syncBlockTime = Date.now() + 3600000; // Kunci UI Sinkronisasi (Maks 1 Jam)
     
        const alertHtml = `
            <div id="interruptAlert" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(255,0,0,0.95); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#fff; text-align:center;">
                    <h1 style="font-size:36px; margin-bottom:10px;">PANGGILAN INFORMASI</h1>
                ${isAdmin ? `<button onclick="window.cancelInterruptAdmin()" style="margin-top:20px; padding:10px 20px; font-size:14px; background:#fff; color:#ff4d4d; border:none; border-radius:5px; font-weight:bold; cursor:pointer;">Batalkan Siaran Ini</button>` : ''}
            </div>
        `;
        if (!document.getElementById('interruptAlert')) {
            document.body.insertAdjacentHTML('beforeend', alertHtml);
        }
     
        interruptAudio.dataset.mainFilename = filename;

        const endInterrupt = () => {
            const alertBox = document.getElementById('interruptAlert');
            if (alertBox) alertBox.remove();
            
            syncBlockTime = 0; 
            isInterrupting = false;
            
            // Lanjutkan audio lokal jika sedang dalam mode Device Ini
            if (isPlayAlone && wasPlayingLocal) {
                activeAudio.play().catch(()=>{});
            }
        }
        window.endInterruptDirect = endInterrupt;
     
        function endInterruptSequence() {
            endInterrupt();
            if (isAdmin && interruptAudio.dataset.mainFilename) {
                fetch('api/clear_interrupt', { 
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ filename: interruptAudio.dataset.mainFilename })
                }).catch(()=>{});
            }
            delete interruptAudio.dataset.state;
            delete interruptAudio.dataset.mainFilename;
        }

        window.cancelInterruptAdmin = function() {
            if (!confirm("Batalkan siaran ini untuk semua device ruangan?")) return;
            interruptAudio.pause();
            interruptAudio.currentTime = 0;
            endInterruptSequence();
        };

        const handleInterruptError = () => {
            setTimeout(() => {
                if (isInterrupting) endInterruptSequence();
            }, 3000);
        };
     
        interruptAudio.onerror = () => {
            const state = interruptAudio.dataset.state || 'opening';
            console.log(`[Paging] Gagal memuat audio tahap: ${state}. Melanjutkan...`);
            
            // Auto-fallback ke .wav jika .mp3 gagal ditemukan
            if ((state === 'opening' || state === 'closing') && interruptAudio.src.includes('.mp3')) {
                console.log(`Mencoba memuat format .wav untuk ${state}...`);
                interruptAudio.src = interruptAudio.src.replace('.mp3', '.wav');
                interruptAudio.load();
                interruptAudio.play().catch(()=>{});
                return;
            }

            if (state === 'opening') {
                playMainAnnouncement();
            } else if (state === 'main') {
                handleInterruptError();
            } else if (state === 'closing') {
                endInterruptSequence();
            }
        };

        function playMainAnnouncement() {
            interruptAudio.dataset.state = 'main';
            let baseUrl = window.location.pathname.replace('/player', '').replace(/\/$/, '');
            interruptAudio.src = baseUrl + '/static/uploads/' + interruptAudio.dataset.mainFilename + '?t=' + Date.now();
            interruptAudio.load();
            interruptAudio.play().catch(e => console.log("Play interrupted:", e));
        }

        function playClosingJingle() {
            interruptAudio.dataset.state = 'closing';
            let baseUrl = window.location.pathname.replace('/player', '').replace(/\/$/, '');
            interruptAudio.src = baseUrl + '/static/closing.mp3?t=' + Date.now();
            interruptAudio.load();
            interruptAudio.play().catch(e => console.log("Play interrupted:", e));
        }

        interruptAudio.onended = () => {
            const state = interruptAudio.dataset.state || 'opening';
            // Frozen time (jeda) transisi antar file audio
            setTimeout(() => {
                if (!isInterrupting) return;
                if (state === 'opening') playMainAnnouncement();
                else if (state === 'main') playClosingJingle();
                else if (state === 'closing') endInterruptSequence();
            }, 500);
        };
     
        // Pre-load file ke memori segera setelah animasi peringatan muncul
        interruptAudio.dataset.state = 'opening';
        let baseUrl = window.location.pathname.replace('/player', '').replace(/\/$/, '');
        interruptAudio.src = baseUrl + '/static/opening.mp3?t=' + Date.now();
        interruptAudio.load();
        
        let finalDelay = (playDelay && playDelay > 0) ? playDelay : 1000;
     
        // Start play TEPAT bersamaan dengan seluruh device lain berdasarkan waktu server mutlak
        setTimeout(() => {
            if (!isInterrupting) return;
            interruptAudio.play().catch(e => {
                console.log("Auto-play interupsi ditolak oleh browser.", e);
                const alertBox = document.getElementById('interruptAlert');
                if (alertBox && !alertBox.innerHTML.includes("Abaikan Panggilan")) {
                    alertBox.innerHTML += `<br><button onclick="window.endInterruptDirect()" style="padding:10px 20px; background:#fff; color:#f00; border:none; border-radius:5px; margin-top:20px; font-weight:bold; cursor:pointer;">Abaikan Panggilan (Ditolak Browser)</button>`;
                }
            });
        }, finalDelay); 
    }

    // ================ SINKRONISASI JANTUNG UI (POLLING API) ================
    async function syncLoop() {
        // JANGAN return di awal jika isInterrupting agar tetap bisa mendeteksi interupsi BARU
        
        // 1. Cek Interupsi Terlebih Dahulu
        try {
            const fetchRes = await fetch('api/mpd/sync');
            if (fetchRes.status === 401) { window.location.replace('/'); return; }
            const res = await fetchRes.json();
            
            if (res.status === "success" && res.interrupt) {
                // Jika ada timestamp baru, segera eksekusi
                if (res.interrupt.timestamp > lastInterruptTime) {
                    const nowSec = Math.floor(Date.now() / 1000);
                    // Validitas siaran (misal 5 menit saja agar tidak 'basi')
                    if (nowSec - res.interrupt.timestamp < 300) {
                        lastInterruptTime = res.interrupt.timestamp;
                        sessionStorage.setItem('lastInterruptTime', lastInterruptTime);
                        
                        // Jika sedang memutar interupsi lama, hentikan dulu
                        if (isInterrupting) {
                            interruptAudio.pause();
                            interruptAudio.src = "";
                        }
                        
                        // Kalkulasi selisih waktu mutlak agar semua PC Play bersamaan tanpa meleset
                        let playDelay = 2000; 
                        if (res.interrupt.play_at && res.server_time) {
                            playDelay = res.interrupt.play_at - res.server_time;
                        }
                        
                        triggerInterruptUI(res.interrupt.filename, playDelay);
                        return; // Keluar dari loop ini, fokus ke interupsi
                    }
                }
            }

            // Jika device sedang terinterupsi, tapi status di server sudah dihapus Admin (Dibatalkan)
            if (isInterrupting && !res.interrupt) {
                interruptAudio.pause();
                if (window.endInterruptDirect) window.endInterruptDirect();
            }

            // 2. Jika Sedang Interupsi, Berhenti di Sini (Jangan update UI musik)
            if (isInterrupting) return;

            // 3. Cek Kunci UI (Anti-Race Condition)
            if (Date.now() < syncBlockTime) return;

            // ================= UPDATE UI MUSIC =================
            currentMpdState = res.state || 'stop';

            if (!isPlayAlone) {
                // SINKRONKAN SELURUH VARIABEL JS DARI JSON SERVER
                if (res.queue_data && !isCmdRunning && !isDragging) {
                    let qd = res.queue_data;
                    if (qd.queue && qd.queue.length > 0) {
                        localQueue = qd.queue;
                        originalLocalQueue = qd.original || [];
                        isShuffleActive = qd.shuffle || false;
                        isLoopActive = qd.repeat || false;
                    }
                }

                // Update Informasi Lagu
                let currentId = res.current_song_id;
                
                if (currentPlayingId !== null && currentPlayingId !== currentId) {
                    isCalculatingOffset = true;
                    streamTimeOffset = 0;
                    userAddedCount = 0; // Hapus hitungan play-next jika server pindah lagu otomatis
                    currentPlayingId = currentId;
                    pushQueueToServer(false); // Push pembaruan ini ke server JSON
                }
                currentPlayingId = currentId;
                
                let cTitle = res.current_mpd_info ? res.current_mpd_info.title : "-";
                let cArtist = res.current_mpd_info ? res.current_mpd_info.artist : "-";
                
                // Override dengan cache Navidrome jika tersedia (mencegah bug "Memuat Judul...")
                if (autoplayBlocked) {
                    cTitle = "TOMBOL PLAY ▶";
                    cArtist = "Ketuk untuk izinkan suara";
                } else if (currentId && songCache[currentId]) {
                    cTitle = songCache[currentId].title || cTitle;
                    cArtist = songCache[currentId].artist || cArtist;
                } else if (currentMpdState === 'stop') {
                    cTitle = "-";
                    cArtist = "-";
                }

                document.getElementById('c_title').innerText = cTitle;
                document.getElementById('c_artist').innerText = cArtist;

                // Update Cover Art
                if (currentId && currentId !== "undefined") {
                    const cvrId = songCache[currentId] ? (songCache[currentId].coverArt || currentId) : currentId;
                    document.getElementById('c_img').src = getCoverUrl(cvrId);
                } else {
                    document.getElementById('c_img').src = getCoverUrl(0);
                }

                // Fetch missing metadata untuk Antrian
                if (localQueue.length > 0) {
                    let missingIds = localQueue.filter(id => !songCache[id] && !isFetchingCache[id]);
                    if (missingIds.length > 0) fetchMissingMetadata(missingIds);
                }

                updateUIQueue(currentId);

                // Update Durasi & Slider
                if (res.time && !isDragging) {
                    // TAHAN TIMER JIKA AUDIO DEVICE MASIH BUFFERING
                    // Player UI menunggu audio device benar-benar mengeluarkan output
                    let isBufferingWait = (currentMpdState === 'play' && !isAudioActuallyPlaying && isCalculatingOffset);
                    
                    let parts = res.time.split(':');
                    let cur = parseInt(parts[0]) || 0;
                    let tot = parseInt(parts[1]) || 0;
                    
                    // Buka kunci (Selesai Loading) jika server sudah mulai memutar detik lagu baru
                    // ATAU jika halaman baru di-load dan server sudah dalam keadaan play.
                    if ((isCalculatingOffset || !isAudioActuallyPlaying) && currentMpdState === 'play' && cur > 0) {
                        isCalculatingOffset = false;
                        isAudioActuallyPlaying = true; // Selesai Frozen Time
                        isBufferingWait = false;       // Buka blokir update UI
                    }

                    if (!isBufferingWait) {
                        document.getElementById('t_cur').innerText = formatTime(cur);
                        document.getElementById('t_max').innerText = formatTime(tot);
                        
                        if (tot > 0) {
                            let perc = (cur / tot) * 100;
                            document.getElementById('seekSlider').value = perc;
                            document.getElementById('seekSlider').style.setProperty('--val', perc + '%');
                        } else {
                            document.getElementById('seekSlider').value = 0;
                            document.getElementById('seekSlider').style.setProperty('--val', '0%');
                        }
                    }
                }

                // Update Play/Pause Button State
                if (!isBackgroundBuffering) {
                    if (currentMpdState === 'play') {
                        if (autoplayBlocked) {
                            document.getElementById('p_btn').className = 'bx bx-play-circle play-main-btn';
                        } else if (!isAudioActuallyPlaying) {
                            document.getElementById('p_btn').className = 'bx bx-loader-alt bx-spin play-main-btn';
                        } else {
                            document.getElementById('p_btn').className = 'bx bx-pause-circle play-main-btn';
                        }
                    } else {
                        document.getElementById('p_btn').className = 'bx bx-play-circle play-main-btn';
                    }
                }
                
                // Tunda update UI Button dari Polling Server jika API Command masih berjalan (Anti Berkedip/Bug Warna)
                if (!isCmdRunning) {
                    let repBtn = document.getElementById('repeatBtn');
                    let isRep = res.queue_data ? res.queue_data.repeat : (res.repeat == 1);
                    if (repBtn) {
                        if (isRep) {
                            isLoopActive = true;
                            repBtn.classList.add('active');
                        } else {
                            isLoopActive = false;
                            repBtn.classList.remove('active');
                        }
                    }
                    
                    let shufBtn = document.getElementById('shuffleBtn');
                    let isShuf = res.queue_data ? res.queue_data.shuffle : (res.random == 1);
                    if (shufBtn) {
                        if (isShuf) {
                            isShuffleActive = true;
                            shufBtn.classList.add('active');
                        } else {
                            isShuffleActive = false;
                            shufBtn.classList.remove('active');
                        }
                    }
                }
            }

        } catch(e) {
            console.error("Sync Error:", e);
        }
    }

    // ================ RENDER ANTRIAN ================
    function updateUIQueue(activeId) {
        const container = document.getElementById('queueContainer');
        let queueToUse = localQueue; // JSON Server menaungi kedua mode
        
        if (isPlayAlone && typeof saveLocalState === 'function') saveLocalState();

        if (!queueToUse || queueToUse.length === 0) {
            container.innerHTML = "Antrian kosong.";
            return;
        }

        let activeIdx = queueToUse.indexOf(activeId);
        container.innerHTML = queueToUse.map((sid, i) => {
            let sd = songCache[sid];
            let title = sd ? sd.title : "Memuat nama lagu...";
            let artist = sd ? sd.artist : "";
            return `
            <div class="queue-item ${i === activeIdx ? "active" : ""}" onclick="putarSatu('${sid}', true)">
                <div class="queue-item-info">
                    ${i+1}. ${title} <br><small>${artist}</small>
                </div>
                <i class='bx bx-trash' style="font-size: 18px; color: #ff4d4d; opacity: 0.8; transition: 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.8" title="Hapus dari antrian" onclick="event.stopPropagation(); removeFromQueue(${i})"></i>
            </div>
            `;
        }).join('');
    }

    // ================ TARIK WAKTU (SEEK) ================
    window.handleDrag = function(value) {
        isDragging = true;
        document.getElementById('seekSlider').style.setProperty('--val', value + '%');
        const tMaxStr = document.getElementById('t_max').innerText;
        const parts = tMaxStr.split(':');
        const tot = parseInt(parts[0]) * 60 + parseInt(parts[1]);
        const cur = (parseFloat(value) / 100) * tot;
        document.getElementById('t_cur').innerText = formatTime(cur);
    };

    window.handleSeek = async function(value) {
        const numValue = parseFloat(value);
        
        if (isPlayAlone) {
            if (activeAudio && !isNaN(activeAudio.duration)) {
                activeAudio.currentTime = (numValue / 100) * activeAudio.duration;
            }
        } else {
            syncBlockTime = Date.now() + 3000; // Kunci UI selama 3 detik untuk mencegah race condition
            autoplayBlocked = false; 
        isCalculatingOffset = true;
            await fetch('api/mpd/cmd', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ method: 'seek', value: numValue }) });
            forceStreamReload(true, true); 
        }
        setTimeout(() => { isDragging = false; }, 500);
    };

const volumeSlider = document.getElementById('volumeSlider');
volumeSlider.style.setProperty('--val', volumeSlider.value + '%');
volumeSlider.addEventListener('input', (e) => {
    const vol = e.target.value / 100;
    audio1.volume = vol;
    audio2.volume = vol;
    interruptAudio.volume = vol; // Sinkronkan volume admin juga
    
    e.target.style.setProperty('--val', e.target.value + '%');
    
    const icon = document.getElementById('volumeIcon');
    if (e.target.value == 0) icon.className = 'bx bx-volume-mute';
    else if (e.target.value < 50) icon.className = 'bx bx-volume-low';
    else icon.className = 'bx bx-volume-full';
});

function ensureSnapwebButton() {
    if (!document.getElementById('btn-snapweb-ui')) {
        const modeBtn = document.getElementById('modeToggle');
        if (modeBtn) {
            const btnHtml = `<button id="btn-snapweb-ui" style="margin-right: 12px; background: rgba(30, 215, 96, 0.15); border: 1px solid rgba(30, 215, 96, 0.4); color: #1ed760; border-radius: 20px; padding: 6px 12px; font-size: 11px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: 0.2s; text-transform: uppercase; letter-spacing: 0.5px;" onclick="openSnapwebModal(event)"><i class='bx bx-podcast' style="font-size: 14px;"></i> Join Audio</button>`;
            modeBtn.insertAdjacentHTML('beforebegin', btnHtml);
        }
    }
}

window.openSnapwebModal = function(e) {
    if (e) e.stopPropagation();
    
    const host = window.location.hostname;

    // Modal Pintar untuk memilih Ruangan Snapweb (Bisa cross-listen ke user lain)
    const modalHtml = `
    <div id="roomSelectModal" class="modal-overlay active" onclick="this.remove()">
        <div class="modal-content" onclick="event.stopPropagation()" style="width: 320px; text-align: center;">
            <h3 style="color: #4caf50; margin-bottom: 15px;"><i class='bx bx-podcast'></i> Pilih Ruangan Audio</h3>
            <p style="font-size: 12px; color: var(--muted); margin-bottom: 20px;">Pilih ruangan mana yang ingin Anda dengarkan bersama.</p>
            <div style="display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto; text-align: left;">
                ${Object.entries({
                    8000: 'GriyaPersada', 8001: 'Jagat', 8002: 'Dialog',
                    8003: 'Hugo', 8004: 'Khayangan', 8005: 'OO"bakso',
                    8006: 'Maruti', 8007: 'RamaShinta', 8008: 'LokalFarm',
                    8009: 'FO', 8010: 'VGM', 8011: 'Anjani', 8012: 'Pancasona'
                }).map(([port, name]) => {
                    let snapPort = 1780 + (parseInt(port) - 8000);
                    let isMe = (typeof STREAM_PORT !== 'undefined' && parseInt(STREAM_PORT) === parseInt(port));
                    let color = isMe ? '#4caf50' : '#fff';
                    let borderColor = isMe ? '#4caf50' : '#333';
                    let icon = isMe ? 'bx-home-heart' : 'bx-door-open';
                    let textSuffix = isMe ? ' (Ruangan Saya)' : '';
                    
                    return "<button class='btn-add-outline' style='justify-content: flex-start; color: " + color + "; border-color: " + borderColor + "; padding: 10px;' onclick=\"window.open('http://" + host + ":" + snapPort + "/', '_blank'); document.getElementById('roomSelectModal').remove();\"><i class='bx " + icon + "' style='font-size: 18px; margin-right: 8px;'></i> " + name + textSuffix + "</button>";
                }).join('')}
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

window.closeSnapwebModal = function(e) {
}

// ================= OUTLET PLAY (READ-ONLY) =================
function injectOutletNav() {
    if (!document.getElementById('nav-outlet')) {
        const albumNav = document.getElementById('nav-album');
        if (albumNav) {
            const outletHtml = `
                <div class="nav-item" id="nav-outlet" onclick="loadOutlets()">
                    <i class='bx bx-buildings' style="font-size: 18px;"></i> Outlet Play
                </div>
            `;
            albumNav.insertAdjacentHTML('afterend', outletHtml);
        }
    }
}

async function loadOutlets() {
    setActiveNav('nav-outlet');
    document.getElementById('page-title').innerText = "Outlet Play";
    document.getElementById('main-play-btn').style.display = "none";
    if(document.getElementById('multi-add-btn')) document.getElementById('multi-add-btn').style.display = "none";
    document.getElementById('dynamic-content').innerHTML = `<p style="text-align:center; padding:40px;"><i class='bx bx-loader-alt bx-spin' style="font-size: 24px; color:var(--muted)"></i></p>`;
    
    try {
        const fetchRes = await fetch('api/outlet/list');
        if (fetchRes.status === 401) { window.location.replace('/'); return; }
        const res = await fetchRes.json();
        
        if(res.status === "success" && res.data.length > 0) {
            let html = '<div class="album-grid">';
            html += res.data.map(u => {
                let safeUser = u.username.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                let safeName = u.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                return `
                <div class="album-card" onclick="loadOutletPlaylists('${safeUser}', '${safeName}')" style="cursor: pointer; text-align: center; padding: 20px; background: var(--elevated); border: 1px solid #333;">
                    <i class='bx bx-store-alt' style="font-size: 48px; color: #ff4d4d; margin-bottom: 10px;"></i>
                    <div class="a-title" style="text-transform: capitalize; font-size: 16px; margin-bottom: 4px;">${u.name}</div>
                    <div class="a-artist" style="color: var(--muted);">Lihat Playlist</div>
                </div>`;
            }).join('');
            html += '</div>';
            document.getElementById('dynamic-content').innerHTML = html;
        } else {
            document.getElementById('dynamic-content').innerHTML = "<p style='color:var(--muted)'>Tidak ada outlet lain yang tersedia.</p>";
        }
    } catch(e) {}
}

async function loadOutletPlaylists(targetUser, targetName) {
    document.getElementById('page-title').innerText = `Playlist: ${targetName}`;
    document.getElementById('dynamic-content').innerHTML = `<p style="text-align:center; padding:40px;"><i class='bx bx-loader-alt bx-spin' style="font-size: 24px; color:var(--muted)"></i></p>`;
    
    try {
        const fetchRes = await fetch(`api/outlet/playlists?user=${targetUser}`);
        if (fetchRes.status === 401) { window.location.replace('/'); return; }
        const res = await fetchRes.json();

        if(res.status === "success" && res.data.length > 0) {
            let html = '<div class="album-grid">';
            html += res.data.map(p => {
                const coverSrc = (p.songs && p.songs.length > 0) ? getCoverUrl(getBestCoverId(p.songs[0])) : getCoverUrl(0);
                let safeTargetUser = targetUser.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                let safeTargetName = targetName.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                let safePlName = p.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                return `
                <div class="album-card" style="position: relative;">
                    <div onclick="openOutletPlaylist('${safeTargetUser}', '${safeTargetName}', '${safePlName}')" style="cursor: pointer;">
                        <img src="${coverSrc}" onerror="this.onerror=null; this.src='${getCoverUrl(0)}';">
                        <div class="a-title">${p.name}</div>
                        <div class="a-artist"><i class='bx bx-list-music' style="margin-right:4px;"></i>${p.songs ? p.songs.length : 0} Lagu</div>
                    </div>
                </div>`;
            }).join('');
            html += '</div>';
            document.getElementById('dynamic-content').innerHTML = html;
        } else {
            document.getElementById('dynamic-content').innerHTML = "<p style='color:var(--muted)'>Outlet ini belum membuat playlist satupun.</p>";
        }
    } catch(e) {}
}

async function openOutletPlaylist(targetUser, targetName, playlistName) {
    document.getElementById('page-title').innerText = `${playlistName} (${targetName})`;
    document.getElementById('main-play-btn').style.display = "inline-flex";
    if(document.getElementById('multi-add-btn')) document.getElementById('multi-add-btn').style.display = "inline-flex";
    document.getElementById('dynamic-content').innerHTML = `<p style="text-align:center; padding:40px;"><i class='bx bx-loader-alt bx-spin' style="font-size: 24px; color:var(--muted)"></i></p>`;

    try {
        const fetchRes = await fetch(`api/outlet/playlist/get?user=${targetUser}&name=${encodeURIComponent(playlistName)}`);
        if (fetchRes.status === 401) { window.location.replace('/'); return; }
        const res = await fetchRes.json();

        currentSongs = (res.status === "success") ? res.data : [];
        updateSongCache(currentSongs);
        
        let html = ``;
        if(currentSongs.length > 0) {
            html += `<table><thead><tr><th class="col-idx">#</th><th class="col-title">Judul</th><th class="col-album">Album</th><th class="col-dur"><i class='bx bx-time'></i></th></tr></thead><tbody>`;
            html += currentSongs.map((s, i) => `
                <tr onclick="putarSatu('${s.id}')">
                    <td class="col-idx">${i+1}</td>
                    <td class="col-title">
                        <div style="display:flex; align-items:center; gap:16px">
                            <img src="${getCoverUrl(s.coverArt || s.id)}" loading="lazy" style="width:40px;height:40px;border-radius:4px;object-fit:cover;" onerror="this.onerror=null; this.src='${getCoverUrl(0)}';">
                            <div><div style="font-weight:600;color:#fff;margin-bottom:2px;">${s.title}</div><div style="font-size:12px;color:var(--muted)">${s.artist}</div></div>
                        </div>
                    </td>
                    <td class="col-album">${s.album || '-'}</td>
                    <td class="col-dur">
                        ${Math.floor(s.duration/60)}:${(s.duration%60).toString().padStart(2,'0')}
                        <!-- HANYA TOMBOL ANTRIAN, TIDAK ADA TOMBOL DELETE/EDIT KARENA INI READ-ONLY -->
                        <i class='bx bx-add-to-queue' style="font-size: 22px; margin-left: 12px; cursor:pointer;" title="Tambah ke Antrian" onclick="event.stopPropagation(); addToQueue('${s.id}')"></i>
                    </td>
                </tr>`).join('');
            html += `</tbody></table>`;
        } else {
            html += `<p style="color:var(--muted); margin-bottom: 20px;">Playlist ini masih kosong.</p>`;
        }
        
        document.getElementById('dynamic-content').innerHTML = html;
    } catch(e) {}
}

// ================ LOKAL SESSION RECOVERY ================
function saveLocalState() {
    if (!isPlayAlone) return;
    const state = {
        localQueue,
        originalLocalQueue,
        currentPlayingId,
        isShuffleActive,
        isLoopActive,
        userAddedCount
    };
    localStorage.setItem('gp_local_state', JSON.stringify(state));
}

function restoreLocalState() {
    try {
        const saved = localStorage.getItem('gp_local_state');
        if (saved) {
            const parsed = JSON.parse(saved);
            localQueue = parsed.localQueue || [];
            originalLocalQueue = parsed.originalLocalQueue || [];
            currentPlayingId = parsed.currentPlayingId || null;
            isShuffleActive = parsed.isShuffleActive || false;
            isLoopActive = parsed.isLoopActive || false;
            userAddedCount = parsed.userAddedCount || 0;

            if (currentPlayingId) {
                activeAudio.src = `${NAVIDROME}/rest/stream?id=${currentPlayingId}&u=${currentAuth.u}&t=${currentAuth.t}&s=${currentAuth.s}&v=1.12.0&c=GP`;
                
                const savedTime = localStorage.getItem('gp_local_time');
                if (savedTime) {
                    activeAudio.addEventListener('loadedmetadata', function onMeta() {
                        activeAudio.currentTime = parseFloat(savedTime);
                        activeAudio.removeEventListener('loadedmetadata', onMeta);
                    });
                }
                
                let repBtn = document.getElementById('repeatBtn');
                if(repBtn) isLoopActive ? repBtn.classList.add('active') : repBtn.classList.remove('active');
                let shufBtn = document.getElementById('shuffleBtn');
                if(shufBtn) isShuffleActive ? shufBtn.classList.add('active') : shufBtn.classList.remove('active');
                
                // Munculkan Judul & Cover di Player UI Bawah
                let sCache = songCache[currentPlayingId] || {};
                document.getElementById('c_title').innerText = sCache.title || "Memuat...";
                document.getElementById('c_artist').innerText = sCache.artist || "-";
                
                const cvrId = sCache.coverArt || currentPlayingId;
                document.getElementById('c_img').src = getCoverUrl(cvrId);
                document.getElementById('c_img').onerror = function() { this.onerror=null; this.src=getCoverUrl(0); };
                
                let missingIds = localQueue.filter(id => !songCache[id] && !isFetchingCache[id]);
                if (!songCache[currentPlayingId] && !missingIds.includes(currentPlayingId)) missingIds.push(currentPlayingId);
                if (missingIds.length > 0) fetchMissingMetadata(missingIds);
            }
            updateUIQueue(currentPlayingId);
        }
    } catch(e) { console.error("Restore state error:", e); }
}

window.addEventListener('beforeunload', () => {
    if (isPlayAlone && currentPlayingId) {
        localStorage.setItem('gp_local_time', activeAudio.currentTime);
    }
});

// START
async function startApp() {
    await loadLibrary(); 
    ensureSnapwebButton();
    injectOutletNav();
    if (isPlayAlone && document.getElementById('btn-snapweb-ui')) {
        document.getElementById('btn-snapweb-ui').style.display = 'none';
    }
    document.querySelectorAll('.btn-add-queue').forEach(el => el.style.display = 'inline-block');
    
    if (isPlayAlone) {
        restoreLocalState();
    }
    
    syncLoop(); 
    setInterval(syncLoop, 1000); 
}
    
//    =============== TUTUP ANTRIAN KLIK LUAR ================
document.addEventListener('click', (e) => {
    const queuePanel = document.getElementById('queuePanel');
    const queueBtn = document.getElementById('queueBtn');
    if (queuePanel && queuePanel.classList.contains('open')) {
        if (!queuePanel.contains(e.target) && !queueBtn.contains(e.target)) {
            queuePanel.classList.remove('open');
        }
    }
});

startApp();