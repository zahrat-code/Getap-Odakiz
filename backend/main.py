import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from typing import List, Dict, Any
from .models import SessionCreate
from .analyzer import analyze_session

app = FastAPI(
    title="GETAP ODAKİZ API",
    description="Online Bilişsel Testlerde Görüntü İşleme Tabanlı Davranış Analiz ve Karar Destek Modülü API'si",
    version="1.0.0"
)

# CORS Ayarları (Frontend tarayıcıdan sorunsuz erişim için)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Geliştirme aşamasında her yerden erişime izin ver
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Verilerin saklanacağı klasör
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)

def save_session_to_file(session_id: str, data: Dict[str, Any]):
    file_path = os.path.join(DATA_DIR, f"{session_id}.json")
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

def load_session_from_file(session_id: str) -> Dict[str, Any]:
    file_path = os.path.join(DATA_DIR, f"{session_id}.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Oturum bulunamadı.")
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)

@app.post("/api/session", status_code=201)
async def create_session(session: SessionCreate):
    """
    Yeni bir test oturum verisini (telemetri ve webcam takibi) kabul eder, 
    analiz motorunu çalıştırır ve sonuçları kaydeder.
    """
    try:
        # Aynı katılımcı ismiyle kayıt var mı kontrol et (Mükerrer kaydı önle)
        name_lower = session.participant_name.strip().lower()
        for file_name in os.listdir(DATA_DIR):
            if file_name.endswith(".json"):
                file_path = os.path.join(DATA_DIR, file_name)
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if data.get("participant_name", "").strip().lower() == name_lower:
                            raise HTTPException(
                                status_code=400, 
                                detail=f"'{session.participant_name}' ismiyle daha önce bir test kaydı yapılmıştır. Lütfen farklı bir isim giriniz."
                            )
                except HTTPException as he:
                    raise he
                except Exception:
                    pass

        # Pydantic modelini sözlüğe dönüştür
        session_dict = session.dict()
        
        # Analiz motorunu çağır
        analysis_result = analyze_session(session_dict)
        
        # Sonuçları diske kaydet
        save_session_to_file(session.session_id, analysis_result)
        
        return {
            "status": "success",
            "message": "Oturum başarıyla analiz edildi ve kaydedildi.",
            "session_id": session.session_id,
            "metrics": analysis_result["metrics"]
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Analiz sırasında sunucu hatası oluştu: {str(e)}")

@app.get("/api/sessions", response_model=List[Dict[str, Any]])
async def list_sessions():
    """
    Kayıtlı tüm oturumların özet bilgilerini listeler.
    """
    sessions = []
    try:
        for file_name in os.listdir(DATA_DIR):
            if file_name.endswith(".json"):
                file_path = os.path.join(DATA_DIR, file_name)
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    sessions.append({
                        "session_id": data.get("session_id"),
                        "participant_name": data.get("participant_name"),
                        "participant_age": data.get("participant_age"),
                        "has_adhd_diagnosis": data.get("has_adhd_diagnosis", False),
                        "metrics": data.get("metrics"),
                        "telemetry_summary": data.get("telemetry_summary")
                    })
        return sessions
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Oturum listesi okunurken hata: {str(e)}")

@app.get("/api/session/{session_id}", response_model=Dict[str, Any])
async def get_session_details(session_id: str):
    """
    Belirli bir oturumun tüm analiz detaylarını (heatmap, scanpath, timeline ve norm karşılaştırmaları) döner.
    """
    return load_session_from_file(session_id)

@app.delete("/api/session/{session_id}")
async def delete_session(session_id: str):
    """
    Belirtilen oturumu siler.
    """
    file_path = os.path.join(DATA_DIR, f"{session_id}.json")
    if os.path.exists(file_path):
        os.remove(file_path)
        return {"status": "success", "message": f"Oturum {session_id} silindi."}
    else:
        raise HTTPException(status_code=404, detail="Oturum dosyası bulunamadı.")

@app.get("/api/session/check-name/{name}")
async def check_name_exists(name: str):
    """
    Belirtilen katılımcı isminin sistemde daha önce kayıtlı olup olmadığını kontrol eder.
    """
    name_lower = name.strip().lower()
    for file_name in os.listdir(DATA_DIR):
        if file_name.endswith(".json"):
            file_path = os.path.join(DATA_DIR, file_name)
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data.get("participant_name", "").strip().lower() == name_lower:
                        return {"exists": True}
            except Exception:
                pass
    return {"exists": False}

# Statik dosyaları (frontend) sunmak için mount et
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
