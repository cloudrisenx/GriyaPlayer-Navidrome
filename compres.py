import os
import subprocess
import json

def get_bitrate(file_path):
    """Mengecek bitrate asli file menggunakan ffprobe"""
    try:
        cmd = [
            'ffprobe', '-v', 'quiet', '-print_format', 'json', 
            '-show_streams', file_path
        ]
        result = subprocess.check_output(cmd).decode('utf-8')
        data = json.loads(result)
        # Ambil bitrate dalam satuan bps, lalu bagi 1000 ke kbps
        bitrate = int(data['streams'][0]['bit_rate']) / 1000
        return bitrate
    except:
        return 0

def compress_audio():
    input_dir = '/var/www/navidrome/music'
    output_dir = '/var/www/navidrome/music_compressed'
    target_kbps = 128

    for root, dirs, files in os.walk(input_dir):
        for file in files:
            if file.lower().endswith(('.mp3', '.flac', '.wav', '.m4a')):
                input_path = os.path.join(root, file)
                rel_path = os.path.relpath(input_path, input_dir)
                output_path = os.path.join(output_dir, rel_path)

                # 1. SKIP jika file sudah ada di folder tujuan
                if os.path.exists(output_path):
                    print(f"⏩ SKIP (Sudah ada): {rel_path}")
                    continue

                # 2. SKIP jika bitrate asli sudah rendah (<= 128kbps)
                current_bitrate = get_bitrate(input_path)
                if 0 < current_bitrate <= target_kbps:
                    print(f"⏩ SKIP (Sudah ringan {int(current_bitrate)}k): {rel_path}")
                    # Opsional: Copy saja filenya tanpa re-encode agar cepat
                    os.makedirs(os.path.dirname(output_path), exist_ok=True)
                    subprocess.run(['cp', input_path, output_path])
                    continue

                # 3. Proses Kompresi
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                print(f"📦 COMPRESSING: {rel_path} ({int(current_bitrate)}k -> 128k)")
                try:
                    cmd = [
                        'ffmpeg', '-y', 
                        '-fflags', '+genpts',        # Generate ulang timestamp yang rusak
                        '-err_detect', 'ignore_err', # Abaikan error data yang tidak fatal
                        '-i', input_path, 
                        '-codec:a', 'libmp3lame', 
                        '-b:a', '128k', 
                        '-ar', '44100',              # Paksa sample rate standar agar stabil
                        output_path, 
                        '-loglevel', 'error'
                    ]
                    subprocess.run(cmd, check=True)
                    print(f"✅ BERHASIL DI-RECOVERY: {rel_path}")
                except subprocess.CalledProcessError:
                    print(f"❌ GAGAL TOTAL (File rusak parah): {file}")
if __name__ == "__main__":
    compress_audio()