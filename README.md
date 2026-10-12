# GETAP ODAKİZ – Karar Destek Modülü


## مقدمة
GETAP ODAKİZ هو نظام اختبار إدراكي على الويب يُستخدم لتقييم اضطراب فرط الحركة وتشتت الانتباه (ADHD). يعتمد على تتبع العين في الوقت الفعلي باستخدام **MediaPipe FaceMesh**، ويقدم مؤشرات معيارية:
- **مؤشر الانتباه (DKİ)**
- **مؤشر الاندفاع (DÜİ)**
- **مؤشر فرط النشاط (PAG)**
- **درجة جودة البيانات**

تتميز الواجهة بنمط **dark‑mode glassmorphism** حديث مع ألوان متناغمة وحركات خفيفة (micro‑animations) لتجربة مستخدم فاخرة.

## Key Features
- **Participant setup** – name, age, optional diagnosis flag.
- **Camera calibration** – ensures proper lighting and face detection.
- **Continuous Attention Test (CPT‑X)** – press space for every letter except “X”.
- **Real‑time heatmaps & scanpaths** visualising gaze distribution.
- **Expert dashboard** – filter sessions, view detailed reports, export PDF.
- **Exportable PDF reports** with charts, timelines, and expert verdict.

## Tech Stack
- **Frontend**: Vanilla HTML, CSS, JavaScript, Chart.js, html2pdf.js, MediaPipe FaceMesh.
- **Backend**: FastAPI (Python) with Uvicorn, pandas & scipy for data processing.
- **Deployment**: Run `run.bat` to install dependencies and start the server at `http://127.0.0.1:8000`.

## Running Locally
```bash
# Install dependencies and start server
run.bat
```
Open `frontend/index.html` in a browser (or via a local server) to interact with the app.

## License
This project is open‑source. Feel free to fork, modify, and contribute.


