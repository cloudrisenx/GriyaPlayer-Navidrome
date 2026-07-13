import time
from mpd import MPDClient

# Konfigurasi Zona Jagat
MPD_HOST = "127.0.0.1"
MPD_PORT = 6601  # Port MPD khusus untuk zona Jagat

# === UBAH BAGIAN INI ===
# Karena kita pakai Direct Disk Access, tulis path RELATIF dari folder /var/www/navidrome/music/
# Contoh: Jika lokasi aslinya /var/www/navidrome/music/Ariel/Bintang.mp3
# Maka cukup tulis: "Ariel/Bintang.mp3"
TEST_SONG_PATH = "maruti/FULL ALBUM LALA ATILA KERONCONG LANGGAM JAWA POPULER.mp3"

def test_jagat():
    client = MPDClient()
    client.timeout = 10
    try:
        print(f"Menghubungkan ke MPD Jagat di {MPD_HOST}:{MPD_PORT}...")
        client.connect(MPD_HOST, MPD_PORT)
        
        print("Membersihkan antrean lama...")
        client.clear()
        
        print(f"Menambahkan lagu langsung dari hardisk: {TEST_SONG_PATH}")
        client.add(TEST_SONG_PATH)
        
        print("Memutar lagu...")
        client.play()
        
        time.sleep(1) # Tunggu sebentar agar MPD memproses file
        status = client.status()
        current_song = client.currentsong()
        
        print("\n" + "="*30)
        print("✅ STATUS BERHASIL!")
        print(f"State MPD : {status.get('state')}")
        print(f"File Lagu : {current_song.get('file')}")
        print("="*30 + "\n")
        
        print("🎧 CARA MENDENGARKAN:")
        print("1. Buka browser di laptop kamu.")
        print("2. Masuk ke alamat Snapweb Jagat:")
        print("   👉 http://192.168.4.40:1781/ ")
        print("3. PENTING: Klik tombol 'Unmute/Play' di web tersebut agar browser mengizinkan suara keluar.")
        
        client.disconnect()
        
    except Exception as e:
        print(f"\n❌ GAGAL: {e}")
        print("Cek apakah nama file sudah benar, dan service MPD Jagat sedang jalan.")
        print("Cek service: sudo systemctl status mpd-jagat")

if __name__ == "__main__":
    test_jagat()
