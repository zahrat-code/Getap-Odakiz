from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class TelemetryEvent(BaseModel):
    timestamp: float = Field(..., description="Olayın gerçekleştiği milisaniye zaman damgası")
    event_type: str = Field(..., description="Olay türü: 'STIMULUS_TARGET', 'STIMULUS_NON_TARGET', 'KEY_PRESS', 'OMISSION_ERROR', 'COMMISSION_ERROR'")
    stimulus: str = Field(..., description="Ekranda gösterilen harf/uyaran (örn: 'A', 'X')")
    response_time: float = Field(..., description="Tepki süresi (milisaniye, cevap yoksa -1)")

class TrackingPoint(BaseModel):
    timestamp: float = Field(..., description="Zaman damgası (milisaniye)")
    gaze_x: float = Field(..., description="Tahmini bakış X koordinatı (ekrana göre normalize 0-1)")
    gaze_y: float = Field(..., description="Tahmini bakış Y koordinatı (ekrana göre normalize 0-1)")
    gaze_deviation: float = Field(..., description="Ekran merkezinden uzaklık sapması (0-1)")
    head_yaw: float = Field(..., description="Baş yaw açısı (derece)")
    head_pitch: float = Field(..., description="Baş pitch açısı (derece)")
    head_roll: float = Field(..., description="Baş roll açısı (derece)")
    upper_body_motion: float = Field(..., description="Üst gövde hareketliliği / hareket enerjisi (0-1)")
    out_of_frame: bool = Field(..., description="Yüzün kadraj dışı kalma durumu")
    confidence: float = Field(..., description="Yüz tespiti güven skoru (0-1)")

class SessionCreate(BaseModel):
    session_id: str
    participant_name: str
    participant_age: int
    has_adhd_diagnosis: bool = False
    telemetry: List[TelemetryEvent]
    tracking: List[TrackingPoint]
    calibration: Optional[Dict[str, Any]] = None
