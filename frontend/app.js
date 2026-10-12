// GETAP ODAKİZ Frontend Kontrolcüsü (app.js)

// API Yapılandırması
const API_BASE_URL = "http://localhost:8000";

// Global Oturum Değişkenleri
let currentSession = {
    session_id: "",
    participant_name: "",
    participant_age: 9,
    has_adhd_diagnosis: false,
    telemetry: [],
    tracking: []
};

// Yeni Eklenen Premium Özellik Değişkenleri
let allLoadedSessions = []; // Arama ve filtreleme için geçmiş oturum listesi
let activeReportData = null;  // PDF indirme için o anki aktif rapor verisi
let focusLostFrames = 0;      // Ekrana odaklanma uyarısı için ardışık kadraj dışı kare sayısı

// Web Kamerası & Görüntü İşleme Değişkenleri
let videoElement = null;
let overlayCanvas = null;
let overlayCtx = null;
let cameraHelper = null;
let faceMesh = null;

// Görüntü İşleme Takip Değerleri
let lastFrameTime = Date.now();
let fpsCount = 0;
let actualFps = 0;
let isFaceMeshLoaded = false;
let isTrackingActive = false;

// Üst Gövde Hareketlilik (Motion Energy) Değişkenleri
let motionCanvas = null;
let motionCtx = null;
let prevFrameData = null;
let currentMotionEnergy = 0;

// Kalibrasyon Değişkenleri
let isCalibrating = false;
let calibrationStep = 0;
let calibrationData = []; // Kalibrasyon noktalarındaki göz durumları
const calibrationPoints = [
    { x: 0.5, y: 0.5, label: "Merkez" },
    { x: 0.1, y: 0.1, label: "Sol Üst" },
    { x: 0.9, y: 0.1, label: "Sağ Üst" },
    { x: 0.1, y: 0.9, label: "Sol Alt" },
    { x: 0.9, y: 0.9, label: "Sağ Alt" }
];
let calibrationOffsets = { scaleX: 1.0, scaleY: 1.0, centerX: 0.5, centerY: 0.5 };

// CPT Test Motoru Değişkenleri
let isTestActive = false;
let cptTimer = null;
let cptStimuli = [];
let cptIndex = 0;
let lastStimulusTime = 0;
let wasKeyPressedForCurrent = false;
let currentLetter = "";
const targetLetters = "ABCDEFGHJKLMNOPQRSTUVWYZ"; // X hariç hepsi hedef
const stimuliList = ["A", "B", "X", "C", "D", "X", "E", "F", "G", "X", "H", "J", "X", "K", "L", "M", "N", "X", "O", "P", "Q", "R", "S", "X", "T", "U", "V", "W", "Y", "Z"]; // 30 uyaran, 6 non-target (X)

// Grafik Nesnesi Referansları
let timelineChartInstance = null;
let normChartInstance = null;

// Sayfa Yüklendiğinde
window.addEventListener("DOMContentLoaded", () => {
    videoElement = document.getElementById("webcam-video");
    overlayCanvas = document.getElementById("overlay-canvas");
    overlayCtx = overlayCanvas.getContext("2d");
    
    // Gizli canvas'ı motion energy analizi için oluştur
    motionCanvas = document.createElement("canvas");
    motionCanvas.width = 80;
    motionCanvas.height = 60;
    motionCtx = motionCanvas.getContext("2d");

    // Klavye dinleyicisi (CPT testi için)
    window.addEventListener("keydown", handleTestKeyPress);
    
    // Başlangıçta oturum listesini yükle
    loadSessionsList();
    
    // Görüntü İşleme Modelini Kur
    initFaceMesh();
});

// ----------------------------------------------------
// SAYFA/GÖRÜNÜM YÖNLENDİRME
// ----------------------------------------------------
function switchView(viewId) {
    document.querySelectorAll(".view-panel").forEach(panel => {
        panel.classList.remove("active");
    });
    const targetPanel = document.getElementById(viewId);
    if (targetPanel) {
        targetPanel.classList.add("active");
    }
    
    // Navigasyon butonlarını güncelle
    const isReportDashboard = viewId === "view-dashboard" || viewId === "view-report";
    document.getElementById("nav-test-btn").classList.toggle("active", !isReportDashboard);
    document.getElementById("nav-reports-btn").classList.toggle("active", isReportDashboard);

    // Görünüme özel temizleme veya yüklemeler
    if (viewId === "view-setup") {
        stopWebcam();
    }
    if (viewId === "view-dashboard") {
        loadSessionsList();
        stopWebcam();
    }
}

// ----------------------------------------------------
// WEB CAM & MEDIAPIPE BAĞLANTILARI
// ----------------------------------------------------
function initFaceMesh() {
    faceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });

    faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true, // Göz bebeği takibi için kritik
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    faceMesh.onResults(onFaceMeshResults);
}

async function startWebcam() {
    if (cameraHelper) return;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, frameRate: { ideal: 30 } },
            audio: false
        });
        videoElement.srcObject = stream;
        
        // Canvas boyutlarını video ile eşle
        videoElement.onloadedmetadata = () => {
            overlayCanvas.width = videoElement.videoWidth;
            overlayCanvas.height = videoElement.videoHeight;
        };

        cameraHelper = new Camera(videoElement, {
            onFrame: async () => {
                if (videoElement.paused || videoElement.ended) return;
                await faceMesh.send({ image: videoElement });
            },
            width: 640,
            height: 480
        });
        
        cameraHelper.start();
        document.getElementById("camera-container").classList.add("active");
    } catch (err) {
        console.error("Kamera başlatılamadı:", err);
        alert("Web kamerasına erişim sağlanamadı. Lütfen kamera izinlerini kontrol edin.");
    }
}

function stopWebcam() {
    isTrackingActive = false;
    if (cameraHelper) {
        cameraHelper.stop();
        cameraHelper = null;
    }
    if (videoElement && videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
        videoElement.srcObject = null;
    }
    document.getElementById("camera-container").classList.remove("active");
    updateStatusIndicator("status-detect", "red", "Kapalı");
    updateStatusIndicator("status-fps", "red", "0 FPS");
}

// ----------------------------------------------------
// GÖRÜNTÜ İŞLEME VE ÖZNİTELİK ÇIKARIMI (CORE ALGORİTMA)
// ----------------------------------------------------
function onFaceMeshResults(results) {
    isFaceMeshLoaded = true;
    
    // FPS Hesaplama
    fpsCount++;
    const now = Date.now();
    if (now - lastFrameTime >= 1000) {
        actualFps = fpsCount;
        fpsCount = 0;
        lastFrameTime = now;
        updateStatusIndicator("status-fps", actualFps >= 10 ? "green" : "yellow", `${actualFps} FPS`);
    }

    // Canvas temizleme
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Gövde Hareket Enerjisi (Motion Energy) Analizi
    calculateMotionEnergy();

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        // Yüz bulunamadı
        updateStatusIndicator("status-detect", "red", "Yüz Görünmüyor");
        
        // CPT aktifse odak kaybını tetikle (yüz görünmüyor)
        if (isTestActive) {
            handleFocusLoss(true);
        }
        
        if (isTrackingActive) {
            logTrackingPoint(0.5, 0.5, 1.0, 0.0, 0.0, 0.0, currentMotionEnergy, true, 0.0);
        }
        return;
    }

    updateStatusIndicator("status-detect", "green", "Yüz Algılandı");
    const landmarks = results.multiFaceLandmarks[0];

    // Landmark Koordinatlarından Temel Noktaları Belirle
    // MediaPipe indexler:
    // Sol Göz Bebeği (Left Iris Center): 468
    // Sağ Göz Bebeği (Right Iris Center): 473
    // Alın (Forehead): 10
    // Çene (Chin): 152
    // Sol Şakak (Left Temple): 234
    // Sağ Şakak (Right Temple): 454
    const leftIris = landmarks[468];
    const rightIris = landmarks[473];
    const forehead = landmarks[10];
    const chin = landmarks[152];
    const leftFaceEdge = landmarks[234];
    const rightFaceEdge = landmarks[454];

    // 1. BAŞ POZU TAHMİNİ (YAW, PITCH, ROLL)
    // Basit geometrik yaklaşımla açı tahmini
    // Yaw: Sol/Sağ gözün çene çizgisine olan oran farkı
    const yawDistLeft = Math.abs(leftIris.x - leftFaceEdge.x);
    const yawDistRight = Math.abs(rightFaceEdge.x - rightIris.x);
    const headYaw = ((yawDistRight - yawDistLeft) / (yawDistLeft + yawDistRight)) * 80; // Tahmini derece (-40 ile 40 arası)

    // Pitch: Burun-alın ve burun-çene oran değişimi
    const nose = landmarks[4];
    const pitchDistTop = Math.abs(forehead.y - nose.y);
    const pitchDistBottom = Math.abs(nose.y - chin.y);
    const headPitch = ((pitchDistTop / pitchDistBottom) - 0.7) * 90; // Derece

    // Roll: İki göz arasındaki açı eğimi
    const dx = rightIris.x - leftIris.x;
    const dy = rightIris.y - leftIris.y;
    const headRoll = Math.atan2(dy, dx) * (180 / Math.PI); // Derece

    // 2. GÖZ BAKIK PROXY TAHMİNİ (Gaze Proxy)
    // Göz kapakları içindeki göz bebeği oranlarına göre ekran bakış noktasını hesaplıyoruz
    // Sol Göz Kenarları: İç (133), Dış (33)
    // Sağ Göz Kenarları: İç (362), Dış (263)
    const leftEyeOuter = landmarks[33];
    const leftEyeInner = landmarks[133];
    const rightEyeInner = landmarks[362];
    const rightEyeOuter = landmarks[263];

    // Göz bebeklerinin yatayda nerede durduğunu oranlıyoruz (0 = Dış, 1 = İç)
    const leftGazeRatio = (leftIris.x - leftEyeOuter.x) / (leftEyeInner.x - leftEyeOuter.x);
    const rightGazeRatio = (rightIris.x - rightEyeInner.x) / (rightEyeOuter.x - rightEyeInner.x);
    const avgGazeRatioX = (leftGazeRatio + rightGazeRatio) / 2;

    // Göz dikey oranı (Açıklık)
    const leftEyeTop = landmarks[159];
    const leftEyeBottom = landmarks[145];
    const leftEyeHeight = Math.abs(leftEyeTop.y - leftEyeBottom.y);
    const leftEyeWidth = Math.abs(leftEyeInner.x - leftEyeOuter.x);
    const leftEyeOpenness = leftEyeHeight / leftEyeWidth;

    // Bakış koordinatlarını kalibrasyon oranlarına göre normalize et
    // Basit bir ölçekleme ve merkez kaydırma yapıyoruz.
    let rawGazeX = (avgGazeRatioX - 0.3) / 0.4; // 0.3-0.7 aralığını 0-1'e yay
    let rawGazeY = (leftEyeOpenness - 0.15) / 0.15; // Dikey dikey kırpma
    
    // Kalibrasyon Katsayılarını Uygula
    let gazeX = (rawGazeX - calibrationOffsets.centerX) * calibrationOffsets.scaleX + 0.5;
    let gazeY = (rawGazeY - calibrationOffsets.centerY) * calibrationOffsets.scaleY + 0.5;

    // Sınırları sınırla
    gazeX = Math.max(0, Math.min(1, gazeX));
    gazeY = Math.max(0, Math.min(1, gazeY));

    // Sapma (Ekran merkezinden uzaklık - 0.5, 0.5)
    const dxCenter = gazeX - 0.5;
    const dyCenter = gazeY - 0.5;
    const gazeDeviation = Math.sqrt(dxCenter * dxCenter + dyCenter * dyCenter) * 2; // 0 ile 1.4 arasında

    // Kalite tespiti güveni
    const confidence = 0.95;

    // 3. EKRANDA MESH ÇİZME (GÖRSEL ŞÖLEN)
    drawFaceMeshWireframe(landmarks);

    // Eğer kalibrasyon aktifse verileri topla
    if (isCalibrating) {
        calibrationData.push({ rawX: rawGazeX, rawY: rawGazeY });
    }

    // Eğer test aktifse zaman serisine kaydet (Yaklaşık 10 Hz hızında filtrelemek için)
    if (isTrackingActive) {
        logTrackingPoint(gazeX, gazeY, gazeDeviation, headYaw, headPitch, headRoll, currentMotionEnergy, false, confidence);
        
        // Ekrana odaklanma kontrolü (0.40'tan büyük sapma veya göz kırpma harici uzun kapalı kalma)
        const isOutOfFocus = gazeDeviation > 0.40;
        handleFocusLoss(isOutOfFocus);
    }
}

// Yüz Landmark Mesh'ini Ekrana Çizme (Sadece ana hatları çizerek performans koruyoruz)
function drawFaceMeshWireframe(landmarks) {
    overlayCtx.strokeStyle = "rgba(0, 210, 255, 0.35)";
    overlayCtx.lineWidth = 1;
    
    // Gözler, Ağız ve Yüz Çerçevesini çiz
    const drawOutline = (indices) => {
        overlayCtx.beginPath();
        indices.forEach((idx, i) => {
            const pt = landmarks[idx];
            const px = pt.x * overlayCanvas.width;
            const py = pt.y * overlayCanvas.height;
            if (i === 0) overlayCtx.moveTo(px, py);
            else overlayCtx.lineTo(px, py);
        });
        overlayCtx.closePath();
        overlayCtx.stroke();
    };

    // Sol Göz (Dış Çerçeve)
    drawOutline([33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]);
    // Sağ Göz (Dış Çerçeve)
    drawOutline([362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]);
    // Dış Dudaklar
    drawOutline([61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 95]);
    
    // Göz bebeklerine küçük neon odak noktaları koy
    const drawPupil = (irisPt) => {
        overlayCtx.beginPath();
        overlayCtx.arc(irisPt.x * overlayCanvas.width, irisPt.y * overlayCanvas.height, 4, 0, 2 * Math.PI);
        overlayCtx.fillStyle = "#0df";
        overlayCtx.shadowColor = "#0df";
        overlayCtx.shadowBlur = 8;
        overlayCtx.fill();
        overlayCtx.shadowBlur = 0; // Kapat
    };
    drawPupil(landmarks[468]);
    drawPupil(landmarks[473]);
}

// Canvas Piksel Karşılaştırma Yöntemiyle Üst Gövde Hareket Analizi (Motion Energy Analysis - MEA)
function calculateMotionEnergy() {
    if (!videoElement) return;
    
    // Küçük canvas'a video karesini çiz (performans için 80x60)
    motionCtx.drawImage(videoElement, 0, 0, motionCanvas.width, motionCanvas.height);
    const frameData = motionCtx.getImageData(0, 0, motionCanvas.width, motionCanvas.height);
    
    if (prevFrameData) {
        let diffSum = 0;
        const totalPixels = frameData.data.length / 4;
        
        for (let i = 0; i < frameData.data.length; i += 4) {
            // R, G, B piksel farklarının mutlak değerini topla
            const rDiff = Math.abs(frameData.data[i] - prevFrameData.data[i]);
            const gDiff = Math.abs(frameData.data[i+1] - prevFrameData.data[i+1]);
            const bDiff = Math.abs(frameData.data[i+2] - prevFrameData.data[i+2]);
            
            // Eğer değişim belirli bir gürültü eşiğini (threshold) aşıyorsa harekete ekle
            const avgDiff = (rDiff + gDiff + bDiff) / 3;
            if (avgDiff > 18) {
                diffSum += avgDiff;
            }
        }
        
        // Hareket enerjisini 0-1 aralığında normalize et
        currentMotionEnergy = Math.min(1.0, (diffSum / (totalPixels * 255)) * 12.0); // 12x çarpan duyarlılık içindir
        
        // Gösterge durum ışıklarını güncelle
        let level = "Sakin";
        let color = "green";
        if (currentMotionEnergy > 0.45) {
            level = "Yüksek (Fidgeting)";
            color = "red";
        } else if (currentMotionEnergy > 0.18) {
            level = "Orta (Kıpırdanma)";
            color = "yellow";
        }
        updateStatusIndicator("status-motion", color, level);
    }
    
    prevFrameData = frameData;
}

// Durum ışıklarını güncelleyen yardımcı fonksiyon
function updateStatusIndicator(prefix, colorClass, text) {
    const light = document.getElementById(`${prefix}-light`);
    const txt = document.getElementById(`${prefix}-text`);
    if (light && txt) {
        light.className = `status-indicator ${colorClass}`;
        txt.innerText = text;
    }
}

// Gerçek Zamanlı Ekrana Odaklanma Uyarısı Kontrolü
function handleFocusLoss(lost) {
    const warningDiv = document.getElementById("cpt-focus-warning");
    const panel = document.getElementById("cpt-panel");
    if (!warningDiv || !panel) return;

    if (lost) {
        focusLostFrames++;
        if (focusLostFrames >= 12) { // Yaklaşık 1.2 saniye süren sapma
            warningDiv.style.display = "block";
            panel.style.borderColor = "var(--error)";
            panel.style.boxShadow = "0 0 20px rgba(239, 68, 68, 0.4)";
        }
    } else {
        focusLostFrames = 0;
        warningDiv.style.display = "none";
        panel.style.borderColor = "var(--border-color)";
        panel.style.boxShadow = "none";
    }
}

// 10 Hz Örnekleme hızında veri noktası kaydı (100ms aralıklarla)
let lastLoggedTime = 0;
function logTrackingPoint(gx, gy, dev, yaw, pitch, roll, motion, outOfFrame, conf) {
    const elapsed = Date.now() - currentSession.telemetry[0]?.timestamp; // Test başlangıcına göre relative ms
    const absNow = Date.now();
    
    // 95ms'den kısa aralıklarla log almayarak 10Hz frekansını koruyoruz
    if (absNow - lastLoggedTime < 95) return;
    lastLoggedTime = absNow;

    currentSession.tracking.push({
        timestamp: Number(elapsed || 0),
        gaze_x: Number(gx),
        gaze_y: Number(gy),
        gaze_deviation: Number(dev),
        head_yaw: Number(yaw),
        head_pitch: Number(pitch),
        head_roll: Number(roll),
        upper_body_motion: Number(motion),
        out_of_frame: Boolean(outOfFrame),
        confidence: Number(conf)
    });
}

// ----------------------------------------------------
// ETKİLEŞİMLİ GÖZ KALİBRASYON AKIŞI
// ----------------------------------------------------
async function startCalibrationSetup() {
    const name = document.getElementById("participant-name").value.trim();
    const age = parseInt(document.getElementById("participant-age").value);
    const hasAdhd = document.getElementById("adhd-diagnosis").checked;
    
    if (!name) {
        alert("Lütfen katılımcı adı soyadı girin.");
        return;
    }

    // İsmin daha önce kullanılıp kullanılmadığını backend'den doğrula
    try {
        const response = await fetch(`${API_BASE_URL}/api/session/check-name/${encodeURIComponent(name)}`);
        if (response.ok) {
            const resData = await response.json();
            if (resData.exists) {
                alert(`"${name}" ismiyle daha önce bir test kaydı oluşturulmuştur. Kayıtların karışmaması için lütfen farklı veya benzersiz bir isim (örn: "Ali 2" veya "Ali Yılmaz") giriniz.`);
                return;
            }
        }
    } catch (err) {
        console.warn("İsim benzersizlik doğrulaması sunucu hatası nedeniyle atlandı:", err);
    }

    // Oturumu sıfırla ve yapılandır
    currentSession = {
        session_id: "ODK-" + Math.floor(100000 + Math.random() * 900000),
        participant_name: name,
        participant_age: age || 9,
        has_adhd_diagnosis: hasAdhd,
        telemetry: [],
        tracking: []
    };

    switchView("view-calibration");
    startWebcam();
}

async function runCalibrationCycle() {
    document.getElementById("start-cal-btn").disabled = true;
    document.getElementById("cal-instruction").style.display = "none";
    
    const dot = document.getElementById("cal-dot");
    dot.style.display = "block";
    
    const delay = (ms) => new Promise(res => setTimeout(res, ms));
    const rawPoints = [];

    for (let i = 0; i < calibrationPoints.length; i++) {
        const pt = calibrationPoints[i];
        
        // Noktayı ekranda konumlandır (yüzdelik koordinatlar)
        dot.style.left = `${pt.x * 100}%`;
        dot.style.top = `${pt.y * 100}%`;
        
        // Kalibrasyon noktasının oturması için 1 sn bekle
        await delay(1000);
        
        // Sonraki 1 sn boyunca göz koordinatlarını kaydet
        isCalibrating = true;
        calibrationData = [];
        await delay(1000);
        isCalibrating = false;
        
        // Bu noktanın ortalama göz bebeği oranını hesapla
        if (calibrationData.length > 0) {
            const avgRawX = calibrationData.reduce((s, p) => s + p.rawX, 0) / calibrationData.length;
            const avgRawY = calibrationData.reduce((s, p) => s + p.rawY, 0) / calibrationData.length;
            rawPoints.push({ targetX: pt.x, targetY: pt.y, rawX: avgRawX, rawY: avgRawY });
        }
    }
    
    dot.style.display = "none";
    
    // Kalibrasyon Katsayılarını (Scale & Offset) Hesapla
    if (rawPoints.length >= 2) {
        // En uç noktaları bularak genişlik-yükseklik katsayılarını hesaplıyoruz
        const xs = rawPoints.map(p => p.rawX);
        const ys = rawPoints.map(p => p.rawY);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        calibrationOffsets.centerX = (minX + maxX) / 2;
        calibrationOffsets.centerY = (minY + maxY) / 2;
        calibrationOffsets.scaleX = 0.8 / (maxX - minX || 0.1); // 0.8 ekran genişliği hedefi
        calibrationOffsets.scaleY = 0.8 / (maxY - minY || 0.1);
    }
    
    // Tamamlandı durumunu göster
    const inst = document.getElementById("cal-instruction");
    inst.style.display = "block";
    inst.innerHTML = `
        <h3 style="color: var(--success);">Kalibrasyon Başarılı!</h3>
        <p style="color: var(--text-muted); margin-bottom: 1.5rem;">
            Göz odak sınırları belirlendi. Artık testi başlatabilirsiniz.
        </p>
    `;
    
    document.getElementById("start-test-btn").disabled = false;
}

// ----------------------------------------------------
// BİLİŞSEL TEST (CPT) STATE MACHINE & EVENTS
// ----------------------------------------------------
function startCognitiveTest() {
    switchView("view-test");
    document.getElementById("test-session-id").innerText = currentSession.session_id;
    
    const letterDisplay = document.getElementById("cpt-display-letter");
    const hint = document.getElementById("cpt-keyboard-hint");
    const focusDot = document.getElementById("cpt-focus-dot");
    
    letterDisplay.innerText = "";
    focusDot.style.display = "block";
    hint.innerText = "Hazırlanın... Test başlıyor.";

    isTestActive = true;
    isTrackingActive = true;
    cptIndex = 0;
    currentSession.telemetry = [];
    currentSession.tracking = [];
    
    // 3 saniye odaklanma noktasını gösterdikten sonra CPT akışını başlat
    setTimeout(() => {
        focusDot.style.display = "none";
        runCptStimulusLoop();
    }, 3000);
}

function runCptStimulusLoop() {
    if (!isTestActive) return;
    
    const progress = document.getElementById("cpt-progress-bar");
    const letterDisplay = document.getElementById("cpt-display-letter");
    
    // Test bitti mi?
    if (cptIndex >= stimuliList.length) {
        finishTest();
        return;
    }

    // İlerlemeyi güncelle
    progress.style.width = `${(cptIndex / stimuliList.length) * 100}%`;

    // Harfi seç ve ekrana bas
    currentLetter = stimuliList[cptIndex];
    wasKeyPressedForCurrent = false;
    lastStimulusTime = Date.now();
    
    letterDisplay.innerText = currentLetter;
    letterDisplay.className = "cpt-letter flash";
    
    // Zaman loglama
    const testRelativeTime = Date.now() - (currentSession.telemetry[0]?.timestamp || Date.now());

    // Uyaran olayını telemetriye kaydet (İlk olay için başlangıç sıfır)
    const isTarget = currentLetter !== "X";
    currentSession.telemetry.push({
        timestamp: currentSession.telemetry.length === 0 ? Date.now() : testRelativeTime,
        event_type: isTarget ? "STIMULUS_TARGET" : "STIMULUS_NON_TARGET",
        stimulus: currentLetter,
        response_time: -1.0
    });

    // 500 ms gösterimden sonra harfi ekrandan kaldır (Inter-Stimulus Interval)
    setTimeout(() => {
        if (!isTestActive) return;
        letterDisplay.innerText = "";
        letterDisplay.className = "cpt-letter";
    }, 500);

    // 1500 ms toplam adım süresi sonunda bir sonraki harfe geç
    cptTimer = setTimeout(() => {
        // Eğer hedef harf gelmişse ve hiç basılmamışsa -> Omission Error (Kaçırma)
        if (currentLetter !== "X" && !wasKeyPressedForCurrent) {
            logCptError("OMISSION_ERROR");
        }
        
        cptIndex++;
        runCptStimulusLoop();
    }, 1500);
}

// Boşluk (Space) tuş basımı yakalayıcı
function handleTestKeyPress(e) {
    if (!isTestActive || e.code !== "Space" || wasKeyPressedForCurrent) return;
    
    e.preventDefault(); // Sayfanın aşağı kaymasını engelle
    wasKeyPressedForCurrent = true;
    
    const rt = Date.now() - lastStimulusTime;
    
    // Telemetri olayında tuş basımını güncelle
    const activeTelIndex = currentSession.telemetry.length - 1;
    if (activeTelIndex >= 0) {
        currentSession.telemetry[activeTelIndex].response_time = rt;
        
        if (currentLetter === "X") {
            // Non-target harfe basıldı -> Commission Error (Dürtüsel Hatalı Basış)
            currentSession.telemetry[activeTelIndex].event_type = "COMMISSION_ERROR";
        } else {
            // Hedefe doğru zamanda basıldı
            currentSession.telemetry[activeTelIndex].event_type = "KEY_PRESS";
        }
    }
}

// Hata olaylarını loglama fonksiyonu
function logCptError(errorType) {
    const activeTelIndex = currentSession.telemetry.length - 1;
    if (activeTelIndex >= 0) {
        currentSession.telemetry[activeTelIndex].event_type = errorType;
    }
}

function abortTest() {
    isTestActive = false;
    isTrackingActive = false;
    clearTimeout(cptTimer);
    stopWebcam();
    switchView("view-setup");
    alert("Test yarıda kesildi.");
}

// Test tamamlandığında verileri Backend'e gönder
async function finishTest() {
    isTestActive = false;
    isTrackingActive = false;
    clearTimeout(cptTimer);
    stopWebcam();
    
    document.getElementById("cpt-display-letter").innerText = "✓";
    document.getElementById("cpt-keyboard-hint").innerText = "Test tamamlandı! Veriler sunucuya gönderiliyor...";

    // Telemetri zaman damgalarını bağıl milisaniyeye sabitle
    const startAbsTime = currentSession.telemetry[0].timestamp;
    currentSession.telemetry.forEach(t => {
        if (t.timestamp === startAbsTime) {
            t.timestamp = 0;
        } else {
            t.timestamp = t.timestamp; // zaten relative ayarlanmıştı
        }
    });

    try {
        const response = await fetch(`${API_BASE_URL}/api/session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(currentSession)
        });
        
        if (response.ok) {
            const resData = await response.json();
            alert("Veriler başarıyla analiz edildi. Rapor sayfasına yönlendiriliyorsunuz.");
            showReportDetails(resData.session_id);
        } else {
            const err = await response.json();
            alert(`Sunucu hatası: ${err.detail || "Veriler kaydedilemedi."}`);
            switchView("view-setup");
        }
    } catch (err) {
        console.error(err);
        alert("Sunucuya bağlanılamadı. Python FastAPI sunucusunun aktif olduğundan emin olun.");
        switchView("view-setup");
    }
}

// ----------------------------------------------------
// UZMAN PANELİ - OTURUM LİSTELEME VE FİLTRELEME
// ----------------------------------------------------
async function loadSessionsList() {
    const tbody = document.getElementById("sessions-table-body");
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">Yükleniyor...</td></tr>`;

    try {
        const response = await fetch(`${API_BASE_URL}/api/sessions`);
        if (!response.ok) throw new Error("Veri okunamadı.");
        
        const sessions = await response.json();
        allLoadedSessions = sessions; // Arama/filtreleme için hafızada sakla
        
        // Arama kutularını sıfırla
        document.getElementById("search-participant").value = "";
        document.getElementById("filter-diagnosis").value = "ALL";
        document.getElementById("filter-age").value = "ALL";

        renderSessionsTable(sessions);
    } catch (err) {
        console.error(err);
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; color: var(--error);">
                    Sunucu bağlantı hatası. API aktif mi? (Hata: ${err.message})
                </td>
            </tr>
        `;
    }
}

// Oturum listesini tabloya basan fonksiyon
function renderSessionsTable(sessions) {
    const tbody = document.getElementById("sessions-table-body");
    
    if (sessions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">Kayıtlı/uygun oturum bulunamadı.</td></tr>`;
        return;
    }

    tbody.innerHTML = "";
    sessions.forEach(s => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${s.participant_name}</strong></td>
            <td>${s.participant_age}</td>
            <td>
                <span class="badge ${s.has_adhd_diagnosis ? 'badge-adhd' : 'badge-control'}">
                    ${s.has_adhd_diagnosis ? 'DEHAB' : 'Kontrol'}
                </span>
            </td>
            <td><strong style="color: var(--accent-cyan);">${s.metrics.attention_lapse_index}</strong></td>
            <td><strong style="color: var(--accent-purple);">${s.metrics.impulsivity_index}</strong></td>
            <td><strong style="color: var(--warning);">${s.metrics.psychomotor_activity_index}</strong></td>
            <td><span style="color: var(--success); font-weight:600;">${s.metrics.quality_score}%</span></td>
            <td>
                <button class="table-action-btn" onclick="showReportDetails('${s.session_id}')">Detay Gör</button>
                <button class="table-action-btn" style="background: rgba(239, 68, 68, 0.15); color: var(--error); border-color: rgba(239, 68, 68, 0.2); margin-left: 0.5rem;" onclick="deleteSession('${s.session_id}')">Sil</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Arama girdileri değiştiğinde filtreleme yapan fonksiyon
function filterSessionsList() {
    const query = document.getElementById("search-participant").value.toLowerCase().trim();
    const diagnosis = document.getElementById("filter-diagnosis").value;
    const ageGroup = document.getElementById("filter-age").value;

    const filtered = allLoadedSessions.filter(s => {
        // 1. İsim ile arama
        const matchesQuery = s.participant_name.toLowerCase().includes(query);
        
        // 2. Tanı grubuna göre filtreleme
        let matchesDiagnosis = true;
        if (diagnosis === "CONTROL") matchesDiagnosis = !s.has_adhd_diagnosis;
        else if (diagnosis === "ADHD") matchesDiagnosis = s.has_adhd_diagnosis;

        // 3. Yaş grubuna göre filtreleme
        let matchesAge = true;
        const age = s.participant_age;
        if (ageGroup === "KIDS") matchesAge = age >= 6 && age <= 12;
        else if (ageGroup === "TEENS") matchesAge = age >= 13 && age <= 18;
        else if (ageGroup === "ADULTS") matchesAge = age >= 19;

        return matchesQuery && matchesDiagnosis && matchesAge;
    });

    renderSessionsTable(filtered);
}

async function deleteSession(id) {
    if (!confirm("Bu oturumu silmek istediğinizden emin misiniz?")) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/session/${id}`, { method: "DELETE" });
        if (response.ok) {
            loadSessionsList();
        }
    } catch (err) {
        alert("Silme işlemi başarısız.");
    }
}

// ----------------------------------------------------
// RAPOR DETAY SAYFASI GÖSTERME VE ÇİZİMLER
// ----------------------------------------------------
async function showReportDetails(sessionId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/session/${sessionId}`);
        if (!response.ok) throw new Error("Oturum detayları alınamadı.");
        
        const data = await response.json();
        activeReportData = data; // PDF indirme işlemi için sakla
        
        switchView("view-report");

        // Üst bilgi kartı
        document.getElementById("report-participant-name").innerText = data.participant_name;
        document.getElementById("report-participant-age").innerText = data.participant_age;
        document.getElementById("report-participant-diagnosis").innerText = data.has_adhd_diagnosis ? "DEHAB" : "Kontrol";
        document.getElementById("report-session-id").innerText = data.session_id;

        // İndeksler ve Karar Destek Metinleri
        const metrics = data.metrics;
        document.getElementById("val-dki").innerText = metrics.attention_lapse_index;
        document.getElementById("val-dui").innerText = metrics.impulsivity_index;
        document.getElementById("val-pag").innerText = metrics.psychomotor_activity_index;
        document.getElementById("val-quality").innerText = `${metrics.quality_score}%`;

        // İndeks alt yorumlarını belirle
        setIndexLabel("dki", metrics.attention_lapse_index, "Odak kaybı");
        setIndexLabel("dui", metrics.impulsivity_index, "Dürtüsel eğilim");
        setIndexLabel("pag", metrics.psychomotor_activity_index, "Yerinde duramama");
        setIndexLabel("quality", metrics.quality_score, "Veri hassasiyeti", true);

        // Klinik Karar Bildirimi
        let verdict = "";
        if (metrics.attention_lapse_index > 65 && metrics.psychomotor_activity_index > 65) {
            verdict = "Katılımcı test esnasında yüksek düzeyde dikkat kopuşları yaşamış ve eş zamanlı olarak yoğun psikomotor hareketlilik (hiperaktivite göstergeleri) sergilemiştir. Davranış profili DEHAB normlarına yakınlık göstermektedir.";
        } else if (metrics.attention_lapse_index > 60) {
            verdict = "Ölçümler, test boyunca yüksek seviyede odak kaybı ve ekrandan uzaklaşma olayları kaydetmiştir. Tepki süresi değişkenliği ile birleştiğinde, dikkat dağınıklığı profili ön plandadır.";
        } else if (metrics.impulsivity_index > 65) {
            verdict = "Katılımcının aşırı hızlı reaksiyon süreleri (RT < 180ms) ve uyaran kısıtlamasına uymayarak yaptığı hatalı basışlar (commission error) yüksek dürtüsellik profiline işaret etmektedir.";
        } else if (metrics.psychomotor_activity_index > 60) {
            verdict = "Test boyunca üst gövde hareket enerjisinde ve kımıldamalarda artış gözlemlenmiştir. Dikkat seviyesi stabil olmakla birlikte, fiziksel hareketlilik yüksektir.";
        } else {
            verdict = "Katılımcının göz odak kararlılığı, baş pozu stabilitesi ve tepki profili normlar dahilindedir. Test boyunca dikkat sürekliliği korunmuş, dürtüsel veya hiperaktif davranışlar gözlemlenmemiştir.";
        }
        document.getElementById("report-expert-verdict").innerText = verdict;

        // Test Özeti istatistikleri
        const summary = data.telemetry_summary;
        document.getElementById("stat-total-stimuli").innerText = summary.total_stimuli;
        document.getElementById("stat-correct-hits").innerText = summary.correct_responses;
        document.getElementById("stat-omissions").innerText = summary.omissions;
        document.getElementById("stat-commissions").innerText = summary.commissions;
        document.getElementById("stat-avg-rt").innerText = `${Math.round(summary.avg_response_time)} ms`;

        // ------------------------------------------------
        // 1. ISITMA HARİTASI (HEATMAP) CANVAS ÇİZİMİ
        // ------------------------------------------------
        drawHeatmap(data.heatmap);

        // ------------------------------------------------
        // 2. BAKIŞ GEÇİŞLERİ (SCANPATH) CANVAS ÇİZİMİ
        // ------------------------------------------------
        drawScanpath(data.scanpath);

        // ------------------------------------------------
        // 3. MULTIMODAL ZAMAN ÇİZELGESİ GRAFİĞİ (CHART.JS)
        // ------------------------------------------------
        buildTimelineChart(data.timeline);

        // ------------------------------------------------
        // 4. BİLİNEN GRUPLAR NORM GRAFİĞİ (CHART.JS)
        // ------------------------------------------------
        buildNormChart(data.norm_comparison);

    } catch (err) {
        console.error(err);
        alert(`Rapor detayları yüklenemedi: ${err.message}`);
    }
}

// İndeks seviyelerine göre yorum yazan yardımcı
function setIndexLabel(indexId, val, descText, isQuality = false) {
    const p = document.getElementById(`label-${indexId}`);
    if (!p) return;
    if (isQuality) {
        if (val > 80) { p.innerText = "Yüksek veri güvenliği"; p.style.color = "var(--success)"; }
        else if (val > 50) { p.innerText = "Kabul edilebilir veri kalitesi"; p.style.color = "var(--warning)"; }
        else { p.innerText = "Düşük güvenilirlik. Ortamı kontrol edin!"; p.style.color = "var(--error)"; }
    } else {
        if (val > 65) { p.innerText = `Yüksek ${descText}`; p.style.color = "var(--error)"; }
        else if (val > 40) { p.innerText = `Orta derece ${descText}`; p.style.color = "var(--warning)"; }
        else { p.innerText = `Stabil / Düşük ${descText}`; p.style.color = "var(--success)"; }
    }
}

// HTML5 Canvas ile Heatmap (Isı Haritası) Çizimi
function drawHeatmap(points) {
    const canvas = document.getElementById("heatmap-canvas");
    const ctx = canvas.getContext("2d");
    
    // Canvas çözünürlüğünü ayarla
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Koyu arka plan
    ctx.fillStyle = "#03060f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Her noktayı ısı yarıçapı ile çiz
    points.forEach(pt => {
        const x = pt.x * canvas.width;
        const y = pt.y * canvas.height;
        const radius = 35; // Isı yarıçapı
        
        // Radyal gradyan oluşturarak renk geçişi sağlıyoruz
        const grad = ctx.createRadialGradient(x, y, 2, x, y, radius);
        
        // Isı değerine göre gradyan renklerini ayarla
        const val = pt.value; // 0 ile 1 arası normalize
        grad.addColorStop(0, `rgba(255, ${Math.floor(255 * (1-val))}, 0, ${val * 0.75})`);
        grad.addColorStop(0.5, `rgba(0, 255, 0, ${val * 0.3})`);
        grad.addColorStop(1, "rgba(0, 0, 255, 0)");
        
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fill();
    });

    // CPT uyarım bölgesini sembolik olarak çiz
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(canvas.width * 0.35, canvas.height * 0.3, canvas.width * 0.3, canvas.height * 0.4);
    ctx.setLineDash([]);
}

// HTML5 Canvas ile Scanpath / Gaze Plot (Bakış Rotaları) Çizimi
function drawScanpath(points) {
    const canvas = document.getElementById("scanpath-canvas");
    const ctx = canvas.getContext("2d");
    
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#03060f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (points.length === 0) return;

    // 1. Çizgileri çiz (Gaze geçiş yolları)
    ctx.strokeStyle = "rgba(0, 210, 255, 0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((pt, i) => {
        const x = pt.x * canvas.width;
        const y = pt.y * canvas.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 2. Odaklanma Çemberlerini çiz
    points.forEach((pt) => {
        const x = pt.x * canvas.width;
        const y = pt.y * canvas.height;
        
        // Çember yarıçapı odaklanma süresiyle doğru orantılı (en az 10px, en çok 28px)
        const radius = Math.max(10, Math.min(28, pt.duration / 30)); 
        
        // Dış parlayan halka
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(157, 78, 221, 0.6)"; // Mor şeffaf odak
        ctx.fill();
        ctx.strokeStyle = "#0df"; // Cyan kenar
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        // Numaralandırma
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px Outfit";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(pt.sequence, x, y);
    });
}

// Zaman Hizalı Grafik (Chart.js)
function buildTimelineChart(timeline) {
    if (timelineChartInstance) {
        timelineChartInstance.destroy();
    }
    
    const ctx = document.getElementById("timeline-chart").getContext("2d");
    
    const labels = timeline.map(t => Math.round(t.timestamp / 1000) + "s");
    const gazeDeviationData = timeline.map(t => t.gaze_deviation * 100);
    const motionData = timeline.map(t => t.motion_energy * 100);
    const jitterData = timeline.map(t => t.head_jitter * 100);
    
    // Olay noktalarını (Errors/Clicks) grafik üzerinde işaretlemek için
    const pointBackgroundColors = [];
    const pointRadii = [];
    const pointLabels = [];

    timeline.forEach(t => {
        if (t.event === "COMMISSION_ERROR") {
            pointBackgroundColors.push("#ef4444"); // kırmızı
            pointRadii.push(6);
            pointLabels.push("Hatalı Basış (Commission)");
        } else if (t.event === "OMISSION_ERROR") {
            pointBackgroundColors.push("#f59e0b"); // turuncu
            pointRadii.push(6);
            pointLabels.push("Kaçırma (Omission)");
        } else if (t.event === "KEY_PRESS") {
            pointBackgroundColors.push("#10b981"); // yeşil
            pointRadii.push(4);
            pointLabels.push("Doğru Tepki");
        } else {
            pointBackgroundColors.push("rgba(79, 70, 229, 0)");
            pointRadii.push(0);
            pointLabels.push("");
        }
    });

    timelineChartInstance = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [
                {
                    label: "Bakış Sapması (%)",
                    data: gazeDeviationData,
                    borderColor: "#0df",
                    backgroundColor: "rgba(0, 210, 255, 0.05)",
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3
                },
                {
                    label: "Gövde Hareketliliği (%)",
                    data: motionData,
                    borderColor: "#f59e0b",
                    backgroundColor: "transparent",
                    borderWidth: 2,
                    borderDash: [5, 5],
                    tension: 0.3
                },
                {
                    label: "Bilişsel Olaylar (Eşikler)",
                    data: gazeDeviationData.map((v, i) => pointRadii[i] > 0 ? v : null),
                    borderColor: "transparent",
                    backgroundColor: pointBackgroundColors,
                    pointBackgroundColor: pointBackgroundColors,
                    pointRadius: pointRadii,
                    pointHoverRadius: 8,
                    showLine: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: "#9ca3af", font: { family: "Outfit" } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const index = context.dataIndex;
                            const eventName = pointLabels[index];
                            let standardVal = context.dataset.label + ": " + Math.round(context.raw) + "%";
                            if (eventName) {
                                return [standardVal, "Olay: " + eventName];
                            }
                            return standardVal;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    ticks: { color: "#9ca3af" }
                },
                y: {
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    ticks: { color: "#9ca3af" },
                    min: 0,
                    max: 100
                }
            }
        }
    });
}

// Norm Dağılım Karşılaştırma Grafiği (Gaussian KDE)
function buildNormChart(normData) {
    if (normChartInstance) {
        normChartInstance.destroy();
    }

    const ctx = document.getElementById("norm-chart").getContext("2d");
    
    // Katılımcının puanı
    const myScore = normData.participant_score.dki; // DKİ'ye göre dağılımı gösteriyoruz
    
    // Katılımcı için dikey referans çizgisi oluşturma eklentisi (Chart.js custom plugin)
    const scoreLinePlugin = {
        id: "scoreLine",
        afterDraw: (chart) => {
            const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
            const xPos = x.getPixelForValue(myScore);
            
            ctx.save();
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 2.5;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(xPos, top);
            ctx.lineTo(xPos, bottom);
            ctx.stroke();
            
            // Etiket yaz
            ctx.fillStyle = "#fff";
            ctx.font = "bold 11px Outfit";
            ctx.fillText("KATILIMCI SKORU (" + myScore + ")", xPos + 8, top + 15);
            ctx.restore();
        }
    };

    normChartInstance = new Chart(ctx, {
        type: "line",
        data: {
            labels: normData.x.map(v => Math.round(v)),
            datasets: [
                {
                    label: "Sağlıklı Popülasyon (Kontrol)",
                    data: normData.control_density,
                    borderColor: "#10b981",
                    backgroundColor: "rgba(16, 185, 129, 0.08)",
                    fill: true,
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.4
                },
                {
                    label: "DEHAB Bildirilen Popülasyon",
                    data: normData.adhd_density,
                    borderColor: "#ef4444",
                    backgroundColor: "rgba(239, 68, 68, 0.08)",
                    fill: true,
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.4
                }
            ]
        },
        plugins: [scoreLinePlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: "#9ca3af", font: { family: "Outfit" } }
                }
            },
            scales: {
                x: {
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    ticks: { color: "#9ca3af" },
                    min: 0,
                    max: 100,
                    title: { display: true, text: "İndeks Puanı (DKİ)", color: "#9ca3af" }
                },
                y: {
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    ticks: { display: false }, // Yoğunluk değerlerini gizliyoruz (norm katsayısı)
                    title: { display: true, text: "Popülasyon Yoğunluğu", color: "#9ca3af" }
                }
            }
        }
    });
}

// Rapor içeriğini PDF olarak indiren fonksiyon (html2pdf)
function downloadPDFReport() {
    if (!activeReportData) {
        alert("İndirilecek aktif rapor bulunamadı.");
        return;
    }

    const btn = document.getElementById("download-pdf-btn");
    btn.innerText = "⏳ PDF Hazırlanıyor...";
    btn.disabled = true;

    const element = document.getElementById("printable-report-area");
    
    // PDF çıktı ayarları (koyu tema koruması için arka plan rengi #0b0f19 olarak sabitlenir)
    const opt = {
        margin:       0.2,
        filename:     `GETAP_ODAKIZ_Raporu_${activeReportData.participant_name.replace(/\s+/g, '_')}_${activeReportData.session_id}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { 
            scale: 2, 
            useCORS: true, 
            backgroundColor: '#0b0f19', 
            width: 1080,
            windowWidth: 1080,
            scrollX: 0,
            scrollY: 0
        }, // html2canvas yakalama genişliği ve sanal pencere genişliği 1080px olarak eşitlendi, kaydırma sıfırlandı
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }, // Dikey (Portrait) formatı
        pagebreak:    { mode: ['css', 'legacy'] } // html2pdf__page-break sınıfını ve CSS kurallarını tanıması için güncellendi
    };

    html2pdf().set(opt).from(element).save().then(() => {
        btn.innerText = "📥 PDF Raporu İndir";
        btn.disabled = false;
    }).catch(err => {
        console.error("PDF oluşturma hatası:", err);
        alert("PDF oluşturulurken bir hata oluştu.");
        btn.innerText = "📥 PDF Raporu İndir";
        btn.disabled = false;
    });
}
