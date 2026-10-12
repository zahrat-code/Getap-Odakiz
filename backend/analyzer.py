import pandas as pd
import numpy as np
from scipy.stats import gaussian_kde
from typing import Dict, Any, List

def analyze_session(session_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Oturum verilerini (telemetri ve tracking) Pandas ve NumPy kullanarak analiz eder,
    dikkat, dürtüsellik, psikomotor aktivite indekslerini ve görsel diyagram verilerini hesaplar.
    """
    # Verileri al
    telemetry_list = session_data.get("telemetry", [])
    tracking_list = session_data.get("tracking", [])
    
    # Boş veri kontrolü
    if not telemetry_list or not tracking_list:
        return create_empty_analysis_result(session_data)

    # DataFrame'lere dönüştür
    df_tel = pd.DataFrame([t.dict() if hasattr(t, "dict") else t for t in telemetry_list])
    df_track = pd.DataFrame([tr.dict() if hasattr(tr, "dict") else tr for tr in tracking_list])
    
    # ----------------------------------------------------
    # 1. OTURUM KALİTE VE GÜVEN SKORU HESAPLAMA
    # ----------------------------------------------------
    avg_confidence = float(df_track["confidence"].mean()) if "confidence" in df_track.columns else 0.8
    out_of_frame_ratio = float(df_track["out_of_frame"].mean()) if "out_of_frame" in df_track.columns else 0.0
    
    # FPS kararlılığı (Örnekleme frekansı)
    fps_score = 1.0
    if len(df_track) > 1:
        time_diffs = df_track["timestamp"].diff().dropna() / 1000.0  # saniye cinsinden
        mean_interval = time_diffs.mean()
        if mean_interval > 0:
            actual_fps = 1.0 / mean_interval
            # Hedefimiz 10-15 Hz. 10 FPS altı veya 25 FPS üstü sapmalara göre skor düşer
            if actual_fps < 8:
                fps_score = max(0.4, actual_fps / 10.0)
            elif actual_fps > 30:
                fps_score = 0.9
        else:
            actual_fps = 10.0
    else:
        actual_fps = 10.0
        
    quality_score = int(max(0, min(100, (avg_confidence * 0.6 + (1 - out_of_frame_ratio) * 0.2 + fps_score * 0.2) * 100)))

    # ----------------------------------------------------
    # 2. DİKKAT SÜREKLİLİĞİ / KOPUŞ İNDEKSİ (DKİ) HESAPLAMA
    # ----------------------------------------------------
    # Ekran dışına bakış sapması oranı (gaze_deviation > 0.35 veya kadraj dışı olma)
    look_away_mask = (df_track["gaze_deviation"] > 0.35) | (df_track["out_of_frame"] == True)
    look_away_ratio = float(look_away_mask.mean()) if len(df_track) > 0 else 0.0
    
    # Telemetri metrikleri
    response_times = df_tel[df_tel["response_time"] > 0]["response_time"]
    rt_variability = float(response_times.std()) if len(response_times) > 1 else 100.0
    
    total_targets = len(df_tel[df_tel["event_type"].isin(["STIMULUS_TARGET", "OMISSION_ERROR"])])
    omissions = len(df_tel[df_tel["event_type"] == "OMISSION_ERROR"])
    omission_rate = float(omissions / total_targets) if total_targets > 0 else 0.0
    
    # DKİ Formülü: Ekran dışına bakma (%40) + Reaksiyon Süresi Dalgalanması (%30) + Kaçırma Hataları (%30)
    rt_var_factor = min(rt_variability / 250.0, 1.0) # 250ms sapma maks etki
    dki_raw = (look_away_ratio * 0.4) + (rt_var_factor * 0.3) + (omission_rate * 0.3)
    dki_score = int(max(0, min(100, dki_raw * 100)))

    # ----------------------------------------------------
    # 3. DÜRTÜSELLİK İNDEKSİ (DÜİ) HESAPLAMA
    # ----------------------------------------------------
    # Hatalı basışlar (Commission Errors)
    total_non_targets = len(df_tel[df_tel["event_type"].isin(["STIMULUS_NON_TARGET", "COMMISSION_ERROR"])])
    commissions = len(df_tel[df_tel["event_type"] == "COMMISSION_ERROR"])
    commission_rate = float(commissions / total_non_targets) if total_non_targets > 0 else 0.0
    
    # Çok hızlı tepkiler (Anticipatory Responses: RT < 180ms)
    fast_responses = len(response_times[response_times < 180])
    fast_response_rate = float(fast_responses / len(response_times)) if len(response_times) > 0 else 0.0
    
    # Baş titremesi / Mikro kımıldamalar (Yaw, Pitch, Roll standart sapmalarının toplamı)
    head_cols = ["head_yaw", "head_pitch", "head_roll"]
    head_std_sum = float(df_track[head_cols].std().sum()) if len(df_track) > 1 else 0.5
    head_jitter_factor = min(head_std_sum / 6.0, 1.0) # 6 derecelik toplam dalgalanma sınırı
    
    # DÜİ Formülü: Hatalı basışlar (%50) + Aşırı hızlı tepki (%30) + Baş hareketi dalgalanması (%20)
    dui_raw = (commission_rate * 0.5) + (fast_response_rate * 0.3) + (head_jitter_factor * 0.2)
    dui_score = int(max(0, min(100, dui_raw * 100)))

    # ----------------------------------------------------
    # 4. PSİKOMOTOR AKTİVİTE GÖSTERGESİ (PAG) HESAPLAMA
    # ----------------------------------------------------
    # Üst gövde hareketliliği (Motion Energy) ortalaması ve standart sapması
    mean_motion = float(df_track["upper_body_motion"].mean()) if "upper_body_motion" in df_track.columns else 0.1
    motion_std = float(df_track["upper_body_motion"].std()) if "upper_body_motion" in df_track.columns else 0.05
    
    # PAG Formülü: Ortalama hareket miktarı (%50) + Hareket değişkenliği (%30) + Kadraj dışı kalma sıklığı (%20)
    pag_raw = (mean_motion * 0.5) + (min(motion_std * 4.0, 1.0) * 0.3) + (out_of_frame_ratio * 0.2)
    pag_score = int(max(0, min(100, pag_raw * 100)))

    # ----------------------------------------------------
    # 5. GÖRSEL DİYAGRAM VERİLERİ (HEATMAP & SCANPATH)
    # ----------------------------------------------------
    # Isı Haritası (Heatmap) Grid Verisi
    # Ekranda en çok bakılan 20x20'lik alanları tespit etmek için bakış verilerini grupluyoruz
    grid_size = 20
    df_valid_gaze = df_track[(df_track["gaze_x"] >= 0) & (df_track["gaze_x"] <= 1) & 
                             (df_track["gaze_y"] >= 0) & (df_track["gaze_y"] <= 1)]
    
    heatmap_data = []
    if len(df_valid_gaze) > 0:
        counts, x_edges, y_edges = np.histogram2d(
            df_valid_gaze["gaze_x"].values, 
            df_valid_gaze["gaze_y"].values, 
            bins=grid_size, 
            range=[[0, 1], [0, 1]]
        )
        counts = counts.T # Satır-Sütun uyumu için devriğini alıyoruz
        
        max_val = counts.max() if counts.max() > 0 else 1.0
        for i in range(grid_size):
            for j in range(grid_size):
                val = counts[i, j]
                if val > 0:
                    heatmap_data.append({
                        "x": float((x_edges[j] + x_edges[j+1]) / 2),
                        "y": float((y_edges[i] + y_edges[i+1]) / 2),
                        "value": float(val / max_val)
                    })
    
    # Bakış Yol Haritası (Scanpath / Gaze Plot)
    # Veri miktarını azaltmak ve odaklanma noktalarını (fixation) belirlemek için basit bir gruplama yapıyoruz.
    # Örnekleme: Zaman serisini eşit aralıklı 15-20 ana noktaya indirgiyoruz.
    scanpath_data = []
    if len(df_valid_gaze) > 0:
        step = max(1, len(df_valid_gaze) // 20)
        sampled_track = df_valid_gaze.iloc[::step].copy()
        for idx, row in enumerate(sampled_track.itertuples()):
            scanpath_data.append({
                "sequence": idx + 1,
                "x": float(row.gaze_x),
                "y": float(row.gaze_y),
                "duration": int(df_track["timestamp"].diff().median() * step if len(df_track) > 1 else 100) # Yaklaşık süre (ms)
            })

    # ----------------------------------------------------
    # 6. ENTEGRE ZAMAN ÇİZELGESİ (TIMELINE) VERİSİ
    # ----------------------------------------------------
    # 10 Hz'lik zaman serisini grafik için optimize ederek 100 noktaya indirgiyoruz (downsampling)
    timeline_pts = 100
    timeline_data = []
    if len(df_track) > timeline_pts:
        indices = np.linspace(0, len(df_track) - 1, timeline_pts, dtype=int)
        df_sampled = df_track.iloc[indices]
    else:
        df_sampled = df_track

    # Her nokta için telemetri eşleştirmesi
    for row in df_sampled.itertuples():
        t = row.timestamp
        # O ana en yakın telemetri olayı var mı? (Gözlem pencereleri ± 500 ms)
        close_events = df_tel[abs(df_tel["timestamp"] - t) < 500]
        event_label = ""
        if len(close_events) > 0:
            event_label = close_events.iloc[0]["event_type"]
            
        timeline_data.append({
            "timestamp": float(t),
            "gaze_deviation": float(row.gaze_deviation),
            "motion_energy": float(row.upper_body_motion) if "upper_body_motion" in df_track.columns else 0.0,
            "head_jitter": float(abs(row.head_yaw) + abs(row.head_pitch) + abs(row.head_roll)) / 45.0, # Normalleştirilmiş kımıldama
            "event": event_label
        })

    # ----------------------------------------------------
    # 7. NORM GRUPLARI DAĞILIMI VE KARŞILAŞTIRMA (Gaussian KDE)
    # ----------------------------------------------------
    # Simüle edilmiş norm grupları oluşturuyoruz (ADHD ve Sağlıklı Popülasyon)
    # Bu dağılımlar bilinen gruplar geçerliliğini göstermek için kullanılacaktır.
    np.random.seed(42)
    control_norm = np.random.normal(loc=25, scale=12, size=500)
    control_norm = np.clip(control_norm, 0, 100)
    
    adhd_norm = np.random.normal(loc=70, scale=15, size=500)
    adhd_norm = np.clip(adhd_norm, 0, 100)
    
    # Gaussian KDE eğrileri oluşturma (Grafikte pürüzsüz çizim için)
    x_axis = np.linspace(0, 100, 100)
    control_kde = gaussian_kde(control_norm)
    adhd_kde = gaussian_kde(adhd_norm)
    
    norm_comparison = {
        "x": x_axis.tolist(),
        "control_density": (control_kde(x_axis) / control_kde(x_axis).max()).tolist(), # Normalize edilmiş yoğunluk
        "adhd_density": (adhd_kde(x_axis) / adhd_kde(x_axis).max()).tolist(),
        "participant_score": {
            "dki": dki_score,
            "dui": dui_score,
            "pag": pag_score
        }
    }

    # Sonuç sözlüğünü döndür
    return {
        "session_id": session_data.get("session_id"),
        "participant_name": session_data.get("participant_name"),
        "participant_age": session_data.get("participant_age"),
        "has_adhd_diagnosis": session_data.get("has_adhd_diagnosis", False),
        "metrics": {
            "quality_score": quality_score,
            "attention_lapse_index": dki_score,
            "impulsivity_index": dui_score,
            "psychomotor_activity_index": pag_score
        },
        "heatmap": heatmap_data,
        "scanpath": scanpath_data,
        "timeline": timeline_data,
        "norm_comparison": norm_comparison,
        "telemetry_summary": {
            "total_stimuli": len(df_tel),
            "omissions": int(omissions),
            "commissions": int(commissions),
            "avg_response_time": float(response_times.mean()) if len(response_times) > 0 else 0.0,
            "correct_responses": int(len(df_tel[df_tel["event_type"] == "KEY_PRESS"]) - commissions)
        }
    }

def create_empty_analysis_result(session_data: Dict[str, Any]) -> Dict[str, Any]:
    """Boş veya geçersiz veri durumunda geri dönülecek varsayılan şema."""
    return {
        "session_id": session_data.get("session_id"),
        "participant_name": session_data.get("participant_name"),
        "participant_age": session_data.get("participant_age"),
        "has_adhd_diagnosis": session_data.get("has_adhd_diagnosis", False),
        "metrics": {
            "quality_score": 0,
            "attention_lapse_index": 0,
            "impulsivity_index": 0,
            "psychomotor_activity_index": 0
        },
        "heatmap": [],
        "scanpath": [],
        "timeline": [],
        "norm_comparison": {},
        "telemetry_summary": {
            "total_stimuli": 0,
            "omissions": 0,
            "commissions": 0,
            "avg_response_time": 0.0,
            "correct_responses": 0
        }
    }
