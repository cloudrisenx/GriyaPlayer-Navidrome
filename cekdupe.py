import os
from mutagen.mp3 import MP3
from mutagen.easyid3 import EasyID3
from collections import defaultdict

print("🗑️  CEK & HAPUS DUPLIKAT LAGU OTOMATIS\n")

duplicates = defaultdict(list)
total_mp3 = 0

# Scan semua sub-folder
for root, dirs, files in os.walk("."):
    for file in files:
        if file.lower().endswith(".mp3"):
            filepath = os.path.join(root, file)
            total_mp3 += 1
            
            try:
                audio = MP3(filepath, ID3=EasyID3)
                title = audio.get("title", ["Unknown"])[0]
                artist = audio.get("artist", ["Unknown"])[0]
                key = f"{artist} - {title}".strip()
            except:
                key = f"[NO METADATA] {file}"
            
            duplicates[key].append(filepath)

# Tampilkan & Proses Duplikat
print("="*80)
print("📊 HASIL SCAN DUPLIKASI")
print("="*80)

found = False
deleted_count = 0

for key, paths in duplicates.items():
    if len(paths) > 1:
        found = True
        print(f"\n🔴 DUPLIKAT DITEMUKAN ({len(paths)}x):")
        print(f"   {key}")
        print("   Lokasi:")
        for i, p in enumerate(paths, 1):
            print(f"      {i}. {os.path.relpath(p)}")

        # Preview & Pilihan
        while True:
            pilihan = input("\nPilih aksi:\n1. Hapus semua kecuali yang pertama (REKOMENDASI)\n2. Skip (biarkan)\n3. Hapus SEMUA duplikat\nMasukkan 1/2/3: ").strip()
            
            if pilihan == "1":
                # Hapus semua kecuali yang pertama
                for path in paths[1:]:
                    try:
                        os.remove(path)
                        print(f"   🗑️  Dihapus: {os.path.basename(path)}")
                        deleted_count += 1
                    except Exception as e:
                        print(f"   ❌ Gagal hapus: {os.path.basename(path)}")
                break
                
            elif pilihan == "2":
                print("   ⏭️  Diskip")
                break
                
            elif pilihan == "3":
                confirm = input("⚠️  Yakin hapus SEMUA? (y/n): ").strip().lower()
                if confirm == "y":
                    for path in paths:
                        try:
                            os.remove(path)
                            print(f"   🗑️  Dihapus: {os.path.basename(path)}")
                            deleted_count += 1
                        except:
                            pass
                break
            else:
                print("Pilihan tidak valid, coba lagi.")

if not found:
    print("✅ Tidak ada duplikat yang ditemukan!")

print("\n" + "="*80)
print(f"Total MP3 discan     : {total_mp3}")
print(f"Total duplikat dihapus: {deleted_count}")
print("Selesai!")

input("\nTekan Enter untuk keluar...")