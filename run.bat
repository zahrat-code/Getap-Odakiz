@echo off
title GETAP ODAKİZ Başlatıcı
echo ===================================================
echo             GETAP ODAKİZ BAŞLATICI
echo ===================================================
echo.

:: Python kontrolü
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [HATA] Python sisteme kurulu değil veya PATH'e eklenmemiş!
    echo Lütfen Python 3.8+ yükleyin ve kurarken 'Add Python to PATH' seçeneğini işaretleyin.
    pause
    exit /b
)

echo [1/2] Gerekli Python kütüphaneleri kuruluyor (requirements.txt)...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo.
    echo [UYARI] Kütüphane kurulumu sırasında bazı hatalar oluştu.
    echo Lütfen internet bağlantınızı veya python pip yapılandırmasını kontrol edin.
    echo.
)

echo.
echo [2/2] Sunucu başlatılıyor (Uvicorn)...
echo Tarayıcıdan frontend/index.html dosyasını doğrudan açarak veya 
echo yerel sunucu (VS Code Live Server vb.) kullanarak arayüze erişebilirsiniz.
echo Sunucu aktif olduktan sonra test sonuçlarınızı kaydedebilirsiniz.
echo.
echo FastAPI sunucusu http://127.0.0.1:8000 adresinde aktif olacak.
echo Sunucuyu kapatmak için Ctrl+C tuşlarına basın.
echo.
echo ===================================================
echo.

python -m uvicorn backend.main:app --reload --port 8000

pause
