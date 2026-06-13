"""
app.py  –  Face Mask Detector  –  Flask REST API Backend
"""

import os, io, cv2, csv, ssl, time, uuid, json, base64, random
import logging, smtplib, sqlite3, subprocess, tempfile, threading
import numpy as np
from datetime import datetime
from pathlib import Path
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from flask import Flask, request, jsonify, Response, send_from_directory, make_response
from flask_cors import CORS
from PIL import Image

try:
    import tensorflow as tf
    from tensorflow.keras.models import load_model
    TF_AVAILABLE = True
except ImportError:
    TF_AVAILABLE = False

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-8s  %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger("mask-api")

# ── App ───────────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024   # 100 MB

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent.resolve()
MODEL_PATH  = BASE_DIR / "mask_detector.h5"
DNN_PROTO   = BASE_DIR / "opencv_dnn" / "deploy.prototxt"
DNN_MODEL   = BASE_DIR / "opencv_dnn" / "res10_300x300_ssd_iter_140000.caffemodel"
OUTPUTS_DIR = BASE_DIR / "outputs"
DB_PATH     = BASE_DIR / "detections.db"
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

# ── Locks ─────────────────────────────────────────────────────────────────────
_db_lock = threading.Lock()
_tf_lock = threading.Lock()

# =============================================================================
# DATABASE
# =============================================================================
def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS detections (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                source      TEXT    NOT NULL,
                timestamp   TEXT    NOT NULL,
                total_faces INTEGER NOT NULL DEFAULT 0,
                mask_on     INTEGER NOT NULL DEFAULT 0,
                no_mask     INTEGER NOT NULL DEFAULT 0,
                compliance  REAL    NOT NULL DEFAULT 100.0,
                filename    TEXT    DEFAULT ''
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS violations (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp    TEXT    NOT NULL,
                source       TEXT    NOT NULL,
                image_file   TEXT    NOT NULL,
                label        TEXT    NOT NULL,
                confidence   REAL    NOT NULL,
                ai_status    TEXT    DEFAULT 'Pending',
                ai_reasoning TEXT    DEFAULT ''
            )
        """)
        conn.commit()
    log.info(f"Database initialised at {DB_PATH}")

def db_insert(source, total_faces, mask_on, no_mask, compliance, filename=""):
    ts = datetime.utcnow().isoformat() + "Z"
    with _db_lock:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO detections "
                "(source,timestamp,total_faces,mask_on,no_mask,compliance,filename) "
                "VALUES (?,?,?,?,?,?,?)",
                (source, ts, total_faces, mask_on, no_mask, compliance, filename)
            )
            conn.commit()

def db_insert_violation(source, image_file, label, confidence):
    ts = datetime.utcnow().isoformat() + "Z"
    with _db_lock:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO violations "
                "(timestamp, source, image_file, label, confidence, ai_status, ai_reasoning) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (ts, source, image_file, label, confidence, "Pending", "")
            )
            conn.commit()
            return cursor.lastrowid


# =============================================================================
# GLOBAL STATE
# =============================================================================
keras_model  = None
face_net     = None
model_loaded = False
demo_mode    = False
server_start = datetime.utcnow()

STATS = {"total_checked": 0, "mask_count": 0, "no_mask_count": 0, "errors": 0}

CLASSES        = ["with_mask", "without_mask"]
IMG_SIZE       = 224
CONF_THRESHOLD = 0.50

# =============================================================================
# MODEL LOADING
# =============================================================================
def load_resources():
    global keras_model, face_net, model_loaded, demo_mode

    if TF_AVAILABLE and MODEL_PATH.exists():
        try:
            log.info(f"Loading Keras model: {MODEL_PATH}")
            keras_model = load_model(str(MODEL_PATH))
            keras_model.predict(np.zeros((1, IMG_SIZE, IMG_SIZE, 3), dtype="float32"), verbose=0)
            model_loaded = True
            log.info("Keras model loaded ✓")
        except Exception as e:
            log.warning(f"Model load failed ({e}) – demo mode.")
            demo_mode = True
    else:
        log.warning("TensorFlow not installed or model missing – demo mode.")
        demo_mode = True

    if DNN_PROTO.exists() and DNN_MODEL.exists():
        try:
            face_net = cv2.dnn.readNetFromCaffe(str(DNN_PROTO), str(DNN_MODEL))
            log.info("OpenCV DNN face detector loaded ✓")
        except Exception as e:
            log.error(f"DNN load failed: {e}")
            face_net = None
    else:
        log.error("OpenCV DNN files not found.")

# =============================================================================
# HELPERS
# =============================================================================
def decode_base64_image(b64_string):
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]
    img_bytes = base64.b64decode(b64_string)
    pil_img   = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

def compute_iou(boxA, boxB):
    xA = max(boxA[0], boxB[0]);  yA = max(boxA[1], boxB[1])
    xB = min(boxA[0]+boxA[2], boxB[0]+boxB[2])
    yB = min(boxA[1]+boxA[3], boxB[1]+boxB[3])
    inter = max(0, xB-xA) * max(0, yB-yA)
    union = float(boxA[2]*boxA[3] + boxB[2]*boxB[3] - inter)
    return inter/union if union > 0 else 0.0

def nms(boxes_with_conf, iou_threshold=0.35):
    """Greedy NMS. Input: [(box, conf), ...]. Returns [box, ...]."""
    sorted_items = sorted(boxes_with_conf, key=lambda x: x[1], reverse=True)
    keep = []
    while sorted_items:
        curr_box, _ = sorted_items.pop(0)
        keep.append(curr_box)
        sorted_items = [it for it in sorted_items
                        if compute_iou(curr_box, it[0]) < iou_threshold]
    return keep

# --------------- face detectors -----------------------------------------------
def detect_faces_dnn(img, conf_threshold=0.5, min_size=40):
    """OpenCV DNN detection. Returns [(x,y,w,h), ...]."""
    if face_net is None:
        return []
    h, w = img.shape[:2]
    blob = cv2.dnn.blobFromImage(cv2.resize(img, (300,300)), 1.0,
                                  (300,300), (104., 177., 123.))
    face_net.setInput(blob)
    dets = face_net.forward()
    candidates = []
    for i in range(dets.shape[2]):
        conf = float(dets[0, 0, i, 2])
        if conf < conf_threshold:
            continue
        box = dets[0, 0, i, 3:7] * np.array([w, h, w, h])
        x1, y1, x2, y2 = box.astype(int)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w-1, x2), min(h-1, y2)
        bw, bh  = x2-x1, y2-y1
        if bw < min_size or bh < min_size:
            continue
        aspect = bw / max(bh, 1)
        if aspect < 0.5 or aspect > 1.8:
            continue
        # slight top-padding so forehead is included
        pad = int(bh * 0.06)
        y1  = max(0, y1 - pad)
        bh  = min(int(bh * 1.04), h - y1)
        candidates.append(((x1, y1, bw, bh), conf))
    return nms(candidates, iou_threshold=0.35)

def detect_faces_haar(img, min_size=40):
    """Haar cascade fallback (only used when DNN finds nothing). Returns [(x,y,w,h), ...]."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    haar = cv2.CascadeClassifier(
        os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml"))
    detected = haar.detectMultiScale(gray, scaleFactor=1.05, minNeighbors=6,
                                      minSize=(min_size, min_size),
                                      flags=cv2.CASCADE_SCALE_IMAGE)
    faces = []
    for (x, y, fw, fh) in (detected if len(detected) > 0 else []):
        if 0.5 <= fw/max(fh,1) <= 1.8:
            faces.append((x, y, fw, fh))
    return faces

def _run_detection(img, conf_threshold, min_size):
    """
    Run DNN first; only fall back to Haar if DNN returns nothing.
    All coordinates are in 'img' space.
    """
    boxes = detect_faces_dnn(img, conf_threshold=conf_threshold, min_size=min_size)
    if not boxes:
        haar = detect_faces_haar(img, min_size=min_size)
        boxes = nms([(b, 0.5) for b in haar], iou_threshold=0.35)
    return boxes

def detect_faces_camera(img):
    """
    Camera mode: fast single-pass detection on a downscaled 320×240 frame.
    conf=0.30, min_size=20 to catch small / slightly tilted faces.
    """
    h, w = img.shape[:2]
    max_faces = min(8, max(1, (w*h)//(100*100)))
    boxes = _run_detection(img, conf_threshold=0.30, min_size=20)
    return boxes[:max_faces]

def detect_faces_image(img):
    """
    Static image mode: upscale to ≥1200px longest-edge, then detect.
    Returns boxes in ORIGINAL image coordinates.
    """
    orig_h, orig_w = img.shape[:2]
    orig_max = max(orig_w, orig_h)
    scale = (1200.0 / orig_max) if orig_max < 1200 else 1.0
    if scale > 1.01:
        det_img = cv2.resize(img, (int(orig_w*scale), int(orig_h*scale)),
                             interpolation=cv2.INTER_LINEAR)
    else:
        det_img, scale = img, 1.0

    det_h, det_w = det_img.shape[:2]
    # min_size = 5 % of det image short-edge, but at least 40 px
    min_s = max(40, int(min(det_w, det_h) * 0.05))
    boxes_det = _run_detection(det_img, conf_threshold=0.40, min_size=min_s)

    # scale back to original image coordinates
    orig_min = max(15, int(min(orig_w, orig_h) * 0.03))
    results = []
    for (x, y, bw, bh) in boxes_det:
        rx, ry   = int(x/scale), int(y/scale)
        rbw, rbh = int(bw/scale), int(bh/scale)
        if rbw < orig_min or rbh < orig_min:
            continue
        aspect = rbw / max(rbh, 1)
        if aspect < 0.4 or aspect > 2.2:
            continue
        results.append((rx, ry, rbw, rbh))
    return results

def detect_faces_video(img):
    """
    Video frame mode: use full resolution (no downscale), conf=0.22, min_size=18.
    Designed for high-res portrait / landscape video where faces may be small.
    """
    h, w = img.shape[:2]
    # Downscale only for very large frames to keep inference time reasonable
    MAX_DIM = 1920
    scale = min(1.0, MAX_DIM / max(h, w))
    if scale < 0.99:
        small = cv2.resize(img, (int(w*scale), int(h*scale)), interpolation=cv2.INTER_LINEAR)
    else:
        small, scale = img, 1.0

    # dynamic min_size: 3 % of detection-image short-edge
    det_min = max(18, int(min(small.shape[1], small.shape[0]) * 0.03))
    boxes_small = _run_detection(small, conf_threshold=0.22, min_size=det_min)

    # map back to original frame coordinates
    boxes = [(int(x/scale), int(y/scale), int(bw/scale), int(bh/scale))
             for (x, y, bw, bh) in boxes_small]
    # filter obvious nonsense
    orig_min = max(15, int(min(w, h) * 0.02))
    valid = []
    for (x, y, bw, bh) in boxes:
        if bw < orig_min or bh < orig_min:
            continue
        if not (0.4 <= bw/max(bh,1) <= 2.2):
            continue
        valid.append((x, y, bw, bh))
    return valid

# ── face classification ───────────────────────────────────────────────────────
def preprocess_face(frame, box):
    x, y, w, h = box
    px, py = int(w*0.15), int(h*0.15)
    x1 = max(0, x-px);  y1 = max(0, y-py)
    x2 = min(frame.shape[1], x+w+px)
    y2 = min(frame.shape[0], y+h+py)
    roi = frame[y1:y2, x1:x2]
    roi = cv2.resize(roi, (IMG_SIZE, IMG_SIZE))
    roi = cv2.cvtColor(roi, cv2.COLOR_BGR2RGB).astype("float32") / 255.0
    return np.expand_dims(roi, 0)

def classify_faces_batch(face_arrays):
    if not face_arrays:
        return []
    batch = np.concatenate(face_arrays, axis=0)
    with _tf_lock:
        preds = keras_model.predict(batch, verbose=0)
    results = []
    for p in preds:
        wm, nm = float(p[0]), float(p[1])
        if wm > CONF_THRESHOLD:
            results.append({"label": "Mask On",  "confidence": round(wm, 2)})
        else:
            results.append({"label": "No Mask", "confidence": round(nm, 2)})
    return results

def classify_single(face_arr):
    with _tf_lock:
        p = keras_model.predict(face_arr, verbose=0)[0]
    wm, nm = float(p[0]), float(p[1])
    return {"label": "Mask On",  "confidence": round(wm, 2)} if wm > CONF_THRESHOLD \
      else {"label": "No Mask", "confidence": round(nm, 2)}

def demo_classify():
    r = random.random()
    lbl  = "Mask On"  if r < 0.60 else "No Mask"
    conf = round(random.uniform(0.86, 0.99), 2)
    return {"label": lbl, "confidence": conf}

def run_classify_on_boxes(frame, boxes):
    """Classify a list of boxes; returns list of result dicts."""
    if demo_mode:
        return [demo_classify() for _ in boxes]
    if not boxes:
        return []
    arrs = []
    for box in boxes:
        try:
            arrs.append(preprocess_face(frame, box))
        except Exception:
            arrs.append(np.zeros((1, IMG_SIZE, IMG_SIZE, 3), dtype="float32"))
    try:
        return classify_faces_batch(arrs)
    except Exception:
        return [classify_single(a) for a in arrs]

# =============================================================================
# PERSON TRACKER (for video)
# =============================================================================
class PersonTracker:
    """
    Tracks faces across video frames.
    - Once a person gets an ID they KEEP it for the whole video.
    - Matching uses IoU first, then normalised centre-distance.
    - Stale tracks become MORE permissive (larger effective dist_thr) so a
      person who temporarily left frame is re-matched rather than re-numbered.
    """
    def __init__(self, iou_thr=0.25, dist_thr=1.6, max_stale=600):
        self.persons    = {}
        self.next_id    = 1
        self.iou_thr    = iou_thr
        self.dist_thr   = dist_thr   # base normalised-distance threshold
        self.max_stale  = max_stale
        self._fidx      = 0

    # ── geometry helpers ────────────────────────────────────────
    def _iou(self, a, b):
        x1 = max(a[0], b[0]); y1 = max(a[1], b[1])
        x2 = min(a[0]+a[2], b[0]+b[2]); y2 = min(a[1]+a[3], b[1]+b[3])
        if x2 <= x1 or y2 <= y1: return 0.0
        inter = (x2-x1)*(y2-y1)
        union = a[2]*a[3] + b[2]*b[3] - inter
        return inter / union if union > 0 else 0.0

    def _norm_dist(self, a, b):
        cx1 = a[0]+a[2]/2.0; cy1 = a[1]+a[3]/2.0
        cx2 = b[0]+b[2]/2.0; cy2 = b[1]+b[3]/2.0
        dist  = ((cx1-cx2)**2 + (cy1-cy2)**2)**0.5
        avg_d = ((a[2]**2+a[3]**2)**0.5 + (b[2]**2+b[3]**2)**0.5) / 2.0
        return dist / avg_d if avg_d > 0 else float("inf")

    def _score(self, stored_box, new_box, stale):
        iou = self._iou(stored_box, new_box)
        if iou >= self.iou_thr:
            return 2.0 + iou   # definite match via overlap

        nd = self._norm_dist(stored_box, new_box)

        # Fixed distance threshold.
        # dist_thr=1.6 means:
        #   same person moving ~0.4 diagonals between frames → always matches (0.4 < 1.6)
        #   two distinct people 2.1 diagonals apart         → never merges  (2.1 > 1.6)
        if nd >= self.dist_thr:
            return -1.0   # definitively a different person

        prox = 1.0 - nd / self.dist_thr
        return prox   # 0 < score < 1

    # ── public API ──────────────────────────────────────────────
    def update(self, box, label, confidence, timestamp, thumbnail):
        self._fidx += 1
        best_pid, best_score = None, -1.0

        for pid, p in self.persons.items():
            stale = self._fidx - p["last_frame"]
            s     = self._score(p["box"], box, stale)
            if s > best_score:
                best_score, best_pid = s, pid

        if best_pid is not None and best_score > 0.0:
            p = self.persons[best_pid]
            # EMA position update — α higher for fresh detections, lower when stale
            stale = self._fidx - p["last_frame"]
            alpha = 0.80 if stale <= 2 else 0.60
            ox, oy, ow, oh = p["box"]
            nx, ny, nw, nh = box
            p["box"]        = (int(alpha*nx+(1-alpha)*ox),
                               int(alpha*ny+(1-alpha)*oy),
                               int(alpha*nw+(1-alpha)*ow),
                               int(alpha*nh+(1-alpha)*oh))
            p["label"]      = label
            p["confidence"] = confidence
            p["last_frame"] = self._fidx
            return best_pid

        # Genuinely new person — assign next sequential ID
        pid = self.next_id
        self.persons[pid] = {
            "person_id":  pid,
            "box":        box,
            "label":      label,
            "confidence": confidence,
            "first_seen": timestamp,
            "thumbnail":  thumbnail,
            "last_frame": self._fidx,
        }
        self.next_id += 1
        return pid

    def get_unique_persons(self):
        return list(self.persons.values())

    def reset(self):
        self.persons = {}
        self.next_id = 1
        self._fidx   = 0

# =============================================================================
# ROUTES
# =============================================================================

# ── health / stats ────────────────────────────────────────────────────────────
@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status":       "ok",
        "model":        "loaded" if model_loaded else ("demo" if demo_mode else "not_loaded"),
        "demo_mode":    demo_mode,
        "dnn_detector": "loaded" if face_net is not None else "unavailable",
        "uptime_s":     int((datetime.utcnow()-server_start).total_seconds()),
        "server_time":  datetime.utcnow().isoformat()+"Z",
        "tf_version":   tf.__version__ if TF_AVAILABLE else "not_installed",
    }), 200

@app.route("/stats", methods=["GET"])
def stats():
    return jsonify({
        "total_checked": STATS["total_checked"],
        "mask_count":    STATS["mask_count"],
        "no_mask_count": STATS["no_mask_count"],
    }), 200

# ── camera session save ───────────────────────────────────────────────────────
@app.route("/camera/session", methods=["POST"])
def save_camera_session():
    """
    POST /camera/session
    Body: {total_faces, mask_on, no_mask}
    Saves a live-camera session summary to the DB.
    """
    data   = request.get_json(force=True) or {}
    total  = max(0, int(data.get("total_faces", 0)))
    mask_c = max(0, int(data.get("mask_on",     0)))
    no_m_c = max(0, int(data.get("no_mask",     0)))
    if total == 0:
        return jsonify({"message": "No faces – session not saved."}), 200
    comp = (mask_c / total * 100) if total > 0 else 100.0
    db_insert("camera", total, mask_c, no_m_c, comp)
    log.info(f"Camera session saved: faces={total} mask={mask_c} no_mask={no_m_c}")
    return jsonify({"message": "Camera session saved."}), 200

# ── live camera prediction ─────────────────────────────────────────────────────
@app.route("/predict/frame", methods=["POST"])
@app.route("/predict",       methods=["POST"])
def predict():
    """
    POST /predict  or  /predict/frame
    Body: {image: "<base64>"}
    Returns face boxes + mask classification.
    """
    t0 = time.time()
    try:
        if request.is_json:
            b64 = (request.get_json(force=True) or {}).get("image", "")
        elif request.form.get("image"):
            b64 = request.form["image"]
        else:
            b64 = request.data.decode("utf-8").strip()
        if not b64:
            return jsonify({"error": "No image provided."}), 400
        frame = decode_base64_image(b64)
    except Exception as e:
        STATS["errors"] += 1
        return jsonify({"error": f"Invalid image: {e}"}), 400

    try:
        boxes = detect_faces_camera(frame)
    except Exception as e:
        STATS["errors"] += 1
        return jsonify({"error": f"Detection failed: {e}"}), 500

    valid_boxes = [(x,y,w,h) for (x,y,w,h) in boxes
                   if w >= 20 and h >= 20 and 0.4 <= w/max(h,1) <= 2.2]
    clfs = run_classify_on_boxes(frame, valid_boxes)

    results = []
    for (x,y,w,h), clf in zip(valid_boxes, clfs):
        STATS["total_checked"] += 1
        if clf["label"] == "Mask On": STATS["mask_count"] += 1
        else:                          STATS["no_mask_count"] += 1

        violation_id = None
        if clf["label"] == "No Mask":
            try:
                px, py = int(w*0.1), int(h*0.1)
                x1 = max(0, int(x)-px)
                y1 = max(0, int(y)-py)
                x2 = min(frame.shape[1], int(x)+int(w)+px)
                y2 = min(frame.shape[0], int(y)+int(h)+py)
                roi = frame[y1:y2, x1:x2]
                if roi.size > 0:
                    violation_filename = f"violation_{uuid.uuid4().hex}.jpg"
                    violation_path = OUTPUTS_DIR / violation_filename
                    cv2.imwrite(str(violation_path), roi)
                    violation_id = db_insert_violation("camera", violation_filename, clf["label"], float(clf["confidence"]))
            except Exception as e:
                log.warning(f"Failed to save camera violation: {e}")

        res_item = {"label": clf["label"], "confidence": float(clf["confidence"]),
                    "box": [int(x), int(y), int(w), int(h)]}
        if violation_id:
            res_item["violation_id"] = violation_id
        results.append(res_item)

    ms = round((time.time()-t0)*1000, 1)
    log.info(f"predict  faces={len(results)}  "
             f"{'  '.join(r['label'] for r in results) or 'none'}  {ms}ms"
             f"{'  [DEMO]' if demo_mode else ''}")
    return jsonify({"faces": results, "face_count": len(results),
                    "inference_ms": ms, "demo_mode": demo_mode,
                    "timestamp": datetime.utcnow().isoformat()+"Z"}), 200

# ── static image prediction ────────────────────────────────────────────────────
@app.route("/predict/image", methods=["POST"])
def predict_image():
    """
    POST /predict/image
    Body: {image: "<base64>"}
    Returns face boxes + mask classification in ORIGINAL image coordinates.
    """
    t0 = time.time()
    try:
        data = request.get_json(force=True) or {}
        b64  = data.get("image", "")
        if not b64:
            return jsonify({"error": "No image provided."}), 400
        frame = decode_base64_image(b64)
    except Exception as e:
        return jsonify({"error": f"Invalid image: {e}"}), 400

    if frame is None or frame.size == 0:
        return jsonify({"error": "Failed to decode image."}), 400

    boxes = detect_faces_image(frame)
    clfs  = run_classify_on_boxes(frame, boxes)

    results = []
    for (x,y,bw,bh), clf in zip(boxes, clfs):
        violation_id = None
        if clf["label"] == "No Mask":
            try:
                px, py = int(bw*0.1), int(bh*0.1)
                x1 = max(0, int(x)-px)
                y1 = max(0, int(y)-py)
                x2 = min(frame.shape[1], int(x)+int(bw)+px)
                y2 = min(frame.shape[0], int(y)+int(bh)+py)
                roi = frame[y1:y2, x1:x2]
                if roi.size > 0:
                    violation_filename = f"violation_{uuid.uuid4().hex}.jpg"
                    violation_path = OUTPUTS_DIR / violation_filename
                    cv2.imwrite(str(violation_path), roi)
                    violation_id = db_insert_violation("image", violation_filename, clf["label"], float(clf["confidence"]))
            except Exception as e:
                log.warning(f"Failed to save image violation: {e}")

        res_item = {"label": clf["label"], "confidence": float(clf["confidence"]),
                    "box": [int(x), int(y), int(bw), int(bh)]}
        if violation_id:
            res_item["violation_id"] = violation_id
        results.append(res_item)

    total  = len(results)
    mask_c = sum(1 for r in results if r["label"] == "Mask On")
    no_m_c = total - mask_c
    comp   = (mask_c/total*100) if total > 0 else 100.0
    db_insert("image", total, mask_c, no_m_c, comp)

    ms = round((time.time()-t0)*1000, 1)
    log.info(f"predict_image  faces={total}  {ms}ms")
    return jsonify({"faces": results, "face_count": total,
                    "inference_ms": ms, "demo_mode": demo_mode}), 200

# ── video prediction (streaming NDJSON) ───────────────────────────────────────
@app.route("/predict/video", methods=["POST"])
def predict_video():
    """
    POST /predict/video  (multipart, key='video')
    Streams NDJSON: progress lines then one final report line.
    """
    if "video" not in request.files:
        return jsonify({"error": "No video file under key 'video'"}), 400
    file = request.files["video"]
    if file.filename == "":
        return jsonify({"error": "Empty filename"}), 400
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".mp4", ".avi", ".mov"]:
        return jsonify({"error": f"Unsupported type '{ext}'"}), 400

    # Save upload NOW before generator runs (Flask closes file refs lazily)
    tmp_in = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    tmp_in_path = tmp_in.name
    tmp_in.close()
    try:
        file.save(tmp_in_path)
        log.info(f"Saved video {os.path.getsize(tmp_in_path)//1024} KB → {tmp_in_path}")
    except Exception as e:
        try: os.remove(tmp_in_path)
        except: pass
        return jsonify({"error": f"Save failed: {e}"}), 500

    def generate(saved_path):
        SKIP_N          = 10
        MAX_REPORT_ROWS = 80

        # ── open video ────────────────────────────────────────────
        cap = cv2.VideoCapture(saved_path)
        if not cap.isOpened():
            yield _jline({"error": "Cannot open video file"})
            _rm(saved_path)
            return

        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps <= 0 or np.isnan(fps): fps = 30.0
        vid_w  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        vid_h  = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        n_frames = max(1, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))

        # ── output resolution ─────────────────────────────────────
        portrait = vid_h > vid_w
        if portrait:
            out_w = 360
            out_h = int(360 * vid_h / max(vid_w, 1))
            out_h += out_h % 2        # must be even for libx264
        else:
            out_w, out_h = 640, 360

        # ── video writer ──────────────────────────────────────────
        tmp_out = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
        tmp_out_path = tmp_out.name
        tmp_out.close()

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(tmp_out_path, fourcc, fps, (out_w, out_h))
        if not writer.isOpened():
            cap.release()
            yield _jline({"error": "VideoWriter failed to open"})
            _rm(saved_path, tmp_out_path)
            return

        log.info(f"Video {vid_w}x{vid_h}  {'portrait' if portrait else 'landscape'}  "
                 f"{n_frames}fr @ {fps:.1f}fps  out={out_w}x{out_h}  skip={SKIP_N}")

        # dist_thr=1.6: keeps two people 2.1 diagonals apart as separate tracks,
        # while the same person moving ~0.4 diagonals always re-matches.
        tracker = PersonTracker(iou_thr=0.25, dist_thr=1.6, max_stale=600)

        sx = out_w / max(vid_w, 1)
        sy = out_h / max(vid_h, 1)

        frame_idx    = 0
        processed    = 0
        prev_faces   = []
        violations   = []
        per_frame    = []

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            ts_s   = frame_idx / fps
            ts_str = f"{int(ts_s//60)}:{int(ts_s%60):02d}"

            if frame_idx % SKIP_N == 0:
                faces = []
                try:
                    boxes = detect_faces_video(frame)
                    clfs  = run_classify_on_boxes(frame, boxes)

                    for (x, y, bw, bh), clf in zip(boxes, clfs):
                        label      = clf["label"]
                        confidence = float(clf["confidence"])

                        # crop thumbnail
                        px, py = int(bw*0.1), int(bh*0.1)
                        cx1 = max(0, x-px);  cy1 = max(0, y-py)
                        cx2 = min(frame.shape[1], x+bw+px)
                        cy2 = min(frame.shape[0], y+bh+py)
                        roi = frame[cy1:cy2, cx1:cx2]
                        b64t = ""
                        if roi.size > 0:
                            try:
                                _, buf = cv2.imencode(".jpg", roi)
                                b64t = base64.b64encode(buf).decode()
                            except Exception:
                                pass

                        pid = tracker.update((x,y,bw,bh), label, confidence, ts_str, b64t)
                        faces.append({"person_id": int(pid), "label": label,
                                       "confidence": confidence, "box": [x,y,bw,bh]})
                        if label == "No Mask" and ts_str not in violations:
                            violations.append(ts_str)

                except Exception as fe:
                    log.warning(f"Frame {frame_idx}: {fe}")

                prev_faces = faces
                processed += 1
                if faces and len(per_frame) < MAX_REPORT_ROWS:
                    per_frame.append({"frame": frame_idx, "time": ts_str, "faces": faces})
            else:
                faces = prev_faces

            # ── annotate output frame ─────────────────────────────
            out_frame = cv2.resize(frame, (out_w, out_h), interpolation=cv2.INTER_LINEAR)
            for f in faces:
                x, y, bw, bh = f["box"]
                ox, oy = int(x*sx), int(y*sy)
                ow, oh = int(bw*sx), int(bh*sy)
                color  = (0, 220, 100) if f["label"] == "Mask On" else (50, 50, 255)
                cv2.rectangle(out_frame, (ox, oy), (ox+ow, oy+oh), color, 2)
                txt   = f"P{f['person_id']}: {f['label']} {int(f['confidence']*100)}%"
                fscale = 0.42 if portrait else 0.50
                cv2.putText(out_frame, txt, (ox, max(oy-8, 14)),
                            cv2.FONT_HERSHEY_SIMPLEX, fscale, color, 1, cv2.LINE_AA)
            writer.write(out_frame)

            # ── progress tick ─────────────────────────────────────
            if frame_idx % 15 == 0 or frame_idx == n_frames - 1:
                yield _jline({"progress": frame_idx, "total_frames": n_frames})

            frame_idx += 1

        cap.release()
        writer.release()

        # ── FFmpeg → browser-compatible H.264 ────────────────────
        out_filename = f"out_{uuid.uuid4().hex}.mp4"
        out_path     = OUTPUTS_DIR / out_filename
        ffmpeg_cmd   = [
            "ffmpeg", "-y", "-i", tmp_out_path,
            "-vcodec", "libx264", "-preset", "ultrafast",
            "-crf", "28", "-pix_fmt", "yuv420p",
            "-threads", "0", "-movflags", "+faststart",
            str(out_path)
        ]
        try:
            r = subprocess.run(ffmpeg_cmd, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, timeout=180)
            if r.returncode != 0:
                log.error(f"FFmpeg: {r.stderr.decode()[:400]}")
                import shutil; shutil.copy(tmp_out_path, out_path)
        except Exception as e:
            log.error(f"FFmpeg error: {e}")
            import shutil; shutil.copy(tmp_out_path, out_path)

        _rm(saved_path, tmp_out_path)

        # ── build final report ────────────────────────────────────
        persons   = tracker.get_unique_persons()
        
        # Record video violations in the database
        for p in persons:
            if p["label"] == "No Mask":
                try:
                    b64_data = p.get("thumbnail", "")
                    if b64_data:
                        img_data = base64.b64decode(b64_data)
                        violation_filename = f"violation_{uuid.uuid4().hex}.jpg"
                        violation_path = OUTPUTS_DIR / violation_filename
                        with open(violation_path, "wb") as vf:
                            vf.write(img_data)
                        db_insert_violation("video", violation_filename, p["label"], float(p["confidence"]))
                except Exception as ve:
                    log.warning(f"Failed to record video violation: {ve}")

        n_persons = len(persons)
        n_mask    = sum(1 for p in persons if p["label"] == "Mask On")
        n_nomask  = n_persons - n_mask
        comp_pct  = (n_mask / n_persons * 100) if n_persons > 0 else 100.0

        STATS["total_checked"] += n_persons
        STATS["mask_count"]    += n_mask
        STATS["no_mask_count"] += n_nomask

        slim_persons = [{"person_id": p["person_id"], "label": p["label"],
                          "confidence": p["confidence"], "first_seen": p["first_seen"],
                          "thumbnail": p.get("thumbnail", "")}
                        for p in persons]

        report = {
            "total_frames":          frame_idx,
            "processed_frames":      processed,
            "total_faces":           n_persons,
            "mask_on_count":         n_mask,
            "no_mask_count":         n_nomask,
            "violation_timestamps":  violations,
            "compliance_rate":       f"{comp_pct:.1f}%",
            "output_video":          out_filename,
            "per_frame_results":     per_frame,
            "unique_persons":        slim_persons,
        }
        yield _jline(report)
        yield "\n"   # flush final chunk

        # ── persist to DB ─────────────────────────────────────────
        try:
            db_insert("video", n_persons, n_mask, n_nomask, comp_pct,
                      filename=out_filename)
        except Exception as db_e:
            log.warning(f"DB insert failed: {db_e}")

    resp = Response(generate(tmp_in_path), mimetype="application/x-json-stream")
    resp.headers["X-Accel-Buffering"] = "no"
    resp.headers["Cache-Control"]     = "no-cache"
    return resp

# ── helper for the generator ──────────────────────────────────────────────────
def _jline(obj):
    return json.dumps(obj) + "\n"

def _rm(*paths):
    for p in paths:
        try:
            if p and os.path.exists(p):
                os.remove(p)
        except Exception:
            pass

# ── video download ────────────────────────────────────────────────────────────
@app.route("/video/download/<filename>", methods=["GET"])
def download_video(filename):
    as_attachment = request.args.get("download", "0") == "1"
    return send_from_directory(str(OUTPUTS_DIR), filename,
                               as_attachment=as_attachment)

# =============================================================================
# DETECTION HISTORY ROUTES
# =============================================================================
@app.route("/detections", methods=["GET"])
def list_detections():
    page     = max(1, int(request.args.get("page",     1)))
    per_page = max(1, min(200, int(request.args.get("per_page", 20))))
    source   = request.args.get("source", "")
    offset   = (page-1) * per_page

    with get_db() as conn:
        where  = "WHERE source=?" if source else ""
        params_rows = (source, per_page, offset) if source else (per_page, offset)
        params_cnt  = (source,) if source else ()
        rows  = conn.execute(
            f"SELECT * FROM detections {where} ORDER BY id DESC LIMIT ? OFFSET ?",
            params_rows).fetchall()
        total, = conn.execute(
            f"SELECT COUNT(*) FROM detections {where}", params_cnt).fetchone()

    return jsonify({"records": [dict(r) for r in rows], "total": total,
                    "page": page, "per_page": per_page,
                    "pages": max(1, (total+per_page-1)//per_page)}), 200

@app.route("/detections", methods=["DELETE"])
def clear_detections():
    with _db_lock:
        with get_db() as conn:
            conn.execute("DELETE FROM detections"); conn.commit()
    return jsonify({"message": "All records deleted."}), 200

@app.route("/detections/export/csv", methods=["GET"])
def export_csv():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id,source,timestamp,total_faces,mask_on,no_mask,compliance,filename "
            "FROM detections ORDER BY id DESC").fetchall()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["ID","Source","Timestamp","Total Faces","Mask On","No Mask","Compliance %","Filename"])
    for r in rows:
        w.writerow([r["id"],r["source"],r["timestamp"],r["total_faces"],
                    r["mask_on"],r["no_mask"],f"{r['compliance']:.1f}",r["filename"]])
    resp = make_response(buf.getvalue().encode("utf-8"))
    resp.headers["Content-Type"]        = "text/csv"
    resp.headers["Content-Disposition"] = "attachment; filename=mask_detections.csv"
    return resp

@app.route("/detections/export/pdf", methods=["GET"])
def export_pdf():
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.lib.units import cm
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.enums import TA_CENTER
    except ImportError:
        return jsonify({"error": "reportlab not installed"}), 500

    with get_db() as conn:
        rows = conn.execute(
            "SELECT id,source,timestamp,total_faces,mask_on,no_mask,compliance,filename "
            "FROM detections ORDER BY id DESC").fetchall()

    n = len(rows)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=2*cm, rightMargin=2*cm,
                            topMargin=2*cm, bottomMargin=2*cm)
    styles = getSampleStyleSheet()
    title_s = ParagraphStyle("T", parent=styles["Title"],
                              alignment=TA_CENTER, fontSize=18, spaceAfter=8)
    sub_s   = ParagraphStyle("S", parent=styles["Normal"],
                              alignment=TA_CENTER, fontSize=10,
                              textColor=colors.HexColor("#64748B"), spaceAfter=16)
    story = [
        Paragraph("MaskDetect – Detection Report", title_s),
        Paragraph(f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC", sub_s),
        Spacer(1, 0.3*cm),
    ]

    total_f  = sum(r["total_faces"] for r in rows)
    total_m  = sum(r["mask_on"]     for r in rows)
    total_nm = sum(r["no_mask"]     for r in rows)
    avg_c    = (sum(r["compliance"] for r in rows)/n) if n else 100.0

    summary = Table(
        [["Total Scans","Total Faces","Mask On","No Mask","Avg Compliance"],
         [str(n), str(total_f), str(total_m), str(total_nm), f"{avg_c:.1f}%"]],
        colWidths=[3.2*cm]*5, repeatRows=1)
    summary.setStyle(TableStyle([
        ("BACKGROUND",    (0,0),(-1,0),  colors.HexColor("#1E293B")),
        ("TEXTCOLOR",     (0,0),(-1,0),  colors.white),
        ("FONTNAME",      (0,0),(-1,0),  "Helvetica-Bold"),
        ("FONTSIZE",      (0,0),(-1,-1), 9),
        ("ALIGN",         (0,0),(-1,-1), "CENTER"),
        ("VALIGN",        (0,0),(-1,-1), "MIDDLE"),
        ("ROWBACKGROUNDS",(0,1),(-1,-1), [colors.HexColor("#F8FAFC"), colors.white]),
        ("GRID",          (0,0),(-1,-1), 0.5, colors.HexColor("#CBD5E1")),
        ("TOPPADDING",    (0,0),(-1,-1), 6),
        ("BOTTOMPADDING", (0,0),(-1,-1), 6),
    ]))
    story.append(summary)
    story.append(Spacer(1, 0.5*cm))

    det_hdr = ["#","Source","Timestamp","Faces","Mask On","No Mask","Compliance"]
    det_data = [det_hdr] + [
        [str(r["id"]), r["source"].capitalize(),
         r["timestamp"][:19].replace("T"," "),
         str(r["total_faces"]), str(r["mask_on"]), str(r["no_mask"]),
         f"{r['compliance']:.1f}%"]
        for r in rows[:200]
    ]
    detail = Table(det_data, colWidths=[1*cm,2*cm,5*cm,1.8*cm,2*cm,2*cm,2.8*cm],
                   repeatRows=1)
    detail.setStyle(TableStyle([
        ("BACKGROUND",    (0,0),(-1,0),  colors.HexColor("#3B82F6")),
        ("TEXTCOLOR",     (0,0),(-1,0),  colors.white),
        ("FONTNAME",      (0,0),(-1,0),  "Helvetica-Bold"),
        ("FONTSIZE",      (0,0),(-1,-1), 7.5),
        ("ALIGN",         (0,0),(-1,-1), "CENTER"),
        ("VALIGN",        (0,0),(-1,-1), "MIDDLE"),
        ("ROWBACKGROUNDS",(0,1),(-1,-1), [colors.HexColor("#EFF6FF"), colors.white]),
        ("GRID",          (0,0),(-1,-1), 0.4, colors.HexColor("#BFDBFE")),
        ("TOPPADDING",    (0,0),(-1,-1), 4),
        ("BOTTOMPADDING", (0,0),(-1,-1), 4),
    ]))
    story.append(detail)
    doc.build(story)

    resp = make_response(buf.getvalue())
    resp.headers["Content-Type"]        = "application/pdf"
    resp.headers["Content-Disposition"] = "attachment; filename=mask_detection_report.pdf"
    return resp

# =============================================================================
# EMAIL ALERT ROUTE
# =============================================================================
@app.route("/alert/email", methods=["POST"])
def send_alert_email():
    data      = request.get_json(force=True) or {}
    to        = data.get("to",        "").strip()
    smtp_host = data.get("smtp_host", "smtp.gmail.com").strip()
    smtp_port = int(data.get("smtp_port", 587))
    smtp_user = data.get("smtp_user", "").strip()
    smtp_pass = data.get("smtp_pass", "").strip()
    subject   = data.get("subject",   "[MaskDetect] Violation Alert").strip()
    body_text = data.get("body",      "A mask violation was detected.").strip()

    if not to or not smtp_user or not smtp_pass:
        return jsonify({"error": "Missing required fields: to, smtp_user, smtp_pass"}), 400

    html = f"""
    <html><body style="font-family:Arial,sans-serif;color:#1E293B;">
      <div style="max-width:520px;margin:auto;border:1px solid #e2e8f0;
                  border-radius:12px;overflow:hidden;">
        <div style="background:#EF4444;padding:20px 24px;">
          <h2 style="color:#fff;margin:0;">&#9888; Mask Violation Alert</h2>
        </div>
        <div style="padding:24px;">
          <p style="white-space:pre-line;">{body_text}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;">
          <p style="font-size:12px;color:#64748B;">
            Sent by MaskDetect &mdash;
            {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC
          </p>
        </div>
      </div>
    </body></html>
    """
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = smtp_user
        msg["To"]      = to
        msg.attach(MIMEText(body_text, "plain"))
        msg.attach(MIMEText(html,      "html"))

        ctx = ssl.create_default_context()
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as srv:
            srv.ehlo(); srv.starttls(context=ctx); srv.login(smtp_user, smtp_pass)
            srv.sendmail(smtp_user, to, msg.as_string())

        log.info(f"Alert email sent to {to}")
        return jsonify({"message": f"Alert email sent to {to}."}), 200
    except smtplib.SMTPAuthenticationError:
        return jsonify({"error": "SMTP auth failed – check app password."}), 401
    except smtplib.SMTPException as e:
        return jsonify({"error": f"SMTP error: {e}"}), 500
    except Exception as e:
        return jsonify({"error": f"Email failed: {e}"}), 500

# =============================================================================
# GROQ AI SERVICE INTEGRATION
# =============================================================================
def call_groq_api(api_key, model_name, messages, response_json=False):
    """
    Sends a request to the Groq API using urllib.request.
    Zero external dependencies.
    """
    import urllib.request
    import urllib.error
    
    url = "https://api.groq.com/openai/v1/chat/completions"
    
    payload = {
        "model": model_name,
        "messages": messages,
        "temperature": 0.2
    }
    if response_json:
        payload["response_format"] = {"type": "json_object"}
        
    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=req_data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            res_body = response.read().decode("utf-8")
            res_json = json.loads(res_body)
            text = res_json["choices"][0]["message"]["content"]
            return text, None
    except urllib.error.HTTPError as e:
        try:
            err_msg = e.read().decode("utf-8")
        except Exception:
            err_msg = str(e)
        log.error(f"Groq API HTTP Error: {e.code} - {err_msg}")
        return None, f"HTTP Error {e.code}: {err_msg}"
    except Exception as e:
        log.error(f"Groq API Connection Error: {e}")
        return None, str(e)

@app.route("/violations", methods=["GET"])
def list_violations():
    page     = max(1, int(request.args.get("page",     1)))
    per_page = max(1, min(200, int(request.args.get("per_page", 20))))
    offset   = (page-1) * per_page

    with get_db() as conn:
        rows  = conn.execute(
            "SELECT * FROM violations ORDER BY id DESC LIMIT ? OFFSET ?",
            (per_page, offset)).fetchall()
        total, = conn.execute(
            "SELECT COUNT(*) FROM violations").fetchone()

    return jsonify({
        "records": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total+per_page-1)//per_page)
    }), 200

@app.route("/predict/ai_summary", methods=["POST"])
def ai_summary():
    groq_key = request.headers.get("x-groq-key", "").strip()
    
    # 1. Fetch compliance statistics from DB
    try:
        with get_db() as conn:
            total_records = conn.execute("SELECT COUNT(*) FROM detections").fetchone()[0] or 0
            avg_compliance = conn.execute("SELECT AVG(compliance) FROM detections").fetchone()[0] or 100.0
            total_faces = conn.execute("SELECT SUM(total_faces) FROM detections").fetchone()[0] or 0
            mask_on = conn.execute("SELECT SUM(mask_on) FROM detections").fetchone()[0] or 0
            no_mask = conn.execute("SELECT SUM(no_mask) FROM detections").fetchone()[0] or 0
            total_violations = conn.execute("SELECT COUNT(*) FROM violations").fetchone()[0] or 0
            
            recent_rows = conn.execute("SELECT timestamp, source, total_faces, mask_on, no_mask, compliance FROM detections ORDER BY id DESC LIMIT 5").fetchall()
            recent_list = [dict(r) for r in recent_rows]
            
        stats_summary = {
            "total_detection_sessions": total_records,
            "overall_average_compliance_rate": f"{avg_compliance:.1f}%",
            "total_faces_scanned": total_faces,
            "total_masks_on": mask_on,
            "total_no_masks_violations": no_mask,
            "individual_violations_recorded_in_feed": total_violations,
            "recent_sessions": recent_list
        }
    except Exception as db_err:
        return jsonify({"error": f"Database read failed: {db_err}"}), 500

    # 2. Call Groq API or use fallback
    if not groq_key:
        demo_text = (
            "### AI Compliance Summary (Demo Mode)\n\n"
            f"* **Overview:** A total of **{total_faces} faces** have been scanned across **{total_records} sessions**. "
            f"The overall compliance rate currently stands at **{avg_compliance:.1f}%**.\n"
            f"* **Key Findings:** There are **{no_mask} violations** logged in the database, with **{total_violations} individual violations** saved in the Recent Violations Feed.\n"
            "* **Compliance Pattern:** Scans show high mask compliance during shift-start periods. A mild compliance drop usually correlates with lunch breaks (approx. 1:30 PM - 2:30 PM).\n"
            "* **Action Recommendations:**\n"
            "  1. Maintain regular audio reminders in building exits during peak hours.\n"
            "  2. Add a visual compliance monitor at the main lobby terminal."
        )
        return jsonify({"summary": demo_text, "demo_mode": True}), 200

    prompt = (
        "You are an expert Safety Audit Manager. Based on the following mask compliance log summary data, "
        "write a brief, professional executive compliance audit report. Highlight trends, peaks, anomalies, "
        "and suggest concrete safety improvements. Keep it under 200 words and use clean Markdown formatting with bullet points.\n\n"
        f"Data:\n{json.dumps(stats_summary, indent=2)}"
    )
    
    messages = [
        {"role": "system", "content": "You are an expert Safety Audit Manager."},
        {"role": "user", "content": prompt}
    ]
    
    text, err = call_groq_api(groq_key, "llama-3.3-70b-versatile", messages)
    if err:
        # Fallback to alternative model if versatile not available
        text, err = call_groq_api(groq_key, "llama-3.1-8b-instant", messages)
        if err:
            return jsonify({"error": f"Groq API Error: {err}"}), 500
        
    return jsonify({"summary": text, "demo_mode": False}), 200

@app.route("/predict/ai_query", methods=["POST"])
def ai_query():
    groq_key = request.headers.get("x-groq-key", "").strip()
    data = request.get_json(force=True) or {}
    user_query = data.get("query", "").strip()
    
    if not user_query:
        return jsonify({"error": "Query is required"}), 400

    if not groq_key:
        demo_answer = (
            f"**[Demo Mode - No API Key]**\n\n"
            f"You asked: *\"{user_query}\"*\n\n"
            "To unlock live database queries, please enter your Groq API Key in the **Settings** tab. "
            "Here is a simulated response based on your request:\n"
            "* **Overall Compliance:** 94.2%\n"
            "* **Active Sessions:** 4 recorded today\n"
            "* **Violations Alert:** Safety reminders have been sent out."
        )
        return jsonify({"answer": demo_answer, "demo_mode": True}), 200

    # 1. Translate user query to SQL using Groq
    local_time = datetime.now().isoformat()
    system_instruction = (
        "You translate natural language questions into SQLite queries. "
        "The database has two tables:\n"
        "1. detections (id, source, timestamp, total_faces, mask_on, no_mask, compliance, filename)\n"
        "2. violations (id, timestamp, source, image_file, label, confidence, ai_status, ai_reasoning)\n\n"
        f"Today's date and time is: {local_time}.\n"
        "Write ONLY the raw SQLite query inside a ```sql ... ``` block. Do not write any other explanation."
    )
    
    messages = [
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": f"Generate a SQLite query for: '{user_query}'"}
    ]
    
    sql_text, err = call_groq_api(groq_key, "llama-3.3-70b-versatile", messages)
    if err:
        sql_text, err = call_groq_api(groq_key, "llama-3.1-8b-instant", messages)
        if err:
            return jsonify({"error": f"AI translation failed: {err}"}), 500
        
    query_str = sql_text.strip()
    if "```sql" in query_str:
        query_str = query_str.split("```sql")[1].split("```")[0].strip()
    elif "```" in query_str:
        query_str = query_str.split("```")[1].split("```")[0].strip()

    if not query_str.lower().startswith("select"):
        return jsonify({"error": "For safety, only SELECT queries are permitted."}), 400

    # 2. Run the SQL query against SQLite
    try:
        with get_db() as conn:
            db_res = conn.execute(query_str).fetchall()
            rows_data = [dict(r) for r in db_res[:50]]
    except Exception as db_err:
        return jsonify({
            "error": f"SQL Execution Error: {db_err}",
            "generated_sql": query_str
        }), 400

    # 3. Feed the results back to Groq to draft the final response
    answer_prompt = (
        f"The user asked a compliance question: '{user_query}'\n"
        f"We ran this generated SQL query: '{query_str}'\n"
        f"And retrieved these database records:\n{json.dumps(rows_data, indent=2)}\n\n"
        "Answer the user's question clearly, drawing details directly from the database results. "
        "Keep it concise, friendly, and format any tables or lists using Markdown."
    )
    
    answer_messages = [
        {"role": "user", "content": answer_prompt}
    ]
    
    final_answer, err2 = call_groq_api(groq_key, "llama-3.3-70b-versatile", answer_messages)
    if err2:
        final_answer, err2 = call_groq_api(groq_key, "llama-3.1-8b-instant", answer_messages)
        if err2:
            return jsonify({"error": f"AI summary failed: {err2}", "raw_sql_data": rows_data}), 500

    return jsonify({
        "answer": final_answer,
        "query": query_str,
        "demo_mode": False
    }), 200

@app.route("/predict/verify_violation/<int:violation_id>", methods=["POST"])
def verify_violation(violation_id):
    groq_key = request.headers.get("x-groq-key", "").strip()

    with get_db() as conn:
        violation = conn.execute("SELECT * FROM violations WHERE id=?", (violation_id,)).fetchone()
    
    if not violation:
        return jsonify({"error": f"Violation ID {violation_id} not found."}), 404
        
    image_filename = violation["image_file"]
    image_filepath = OUTPUTS_DIR / image_filename
    
    if not image_filepath.exists():
        return jsonify({"error": "Violation snapshot file missing."}), 404

    if not groq_key:
        statuses = [
            ("Confirmed Violation", "No mask is visible on the user's face."),
            ("Confirmed Violation", "Face detected with no nose or mouth covering."),
            ("Excused Exception: Eating/Drinking", "The user appears to be holding a beverage or food item near their mouth."),
            ("Excused Exception: Adjusting Mask", "The user is holding the straps of their mask, adjusting its fit.")
        ]
        status, reason = random.choice(statuses)
        
        with _db_lock:
            with get_db() as conn:
                conn.execute(
                    "UPDATE violations SET ai_status=?, ai_reasoning=? WHERE id=?",
                    (status, f"[Demo Mode] {reason}", violation_id)
                )
                conn.commit()
                
        return jsonify({"id": violation_id, "ai_status": status, "ai_reasoning": f"[Demo Mode] {reason}", "demo_mode": True}), 200

    try:
        with open(image_filepath, "rb") as img_f:
            b64_image = base64.b64encode(img_f.read()).decode("utf-8")
    except Exception as img_err:
        return jsonify({"error": f"Failed to read image crop: {img_err}"}), 500

    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Analyze the cropped face image of a person flagged for not wearing a mask. "
                        "Determine if it is a Confirmed Violation, or if there is a visible context/excuse "
                        "(e.g., eating/drinking, adjusting mask).\n\n"
                        "Provide a JSON response matching this exact schema:\n"
                        "{\n"
                        "  \"ai_status\": \"Must be exactly one of: 'Confirmed Violation', 'Excused Exception: Eating/Drinking', 'Excused Exception: Adjusting Mask', or 'Other Exception'\",\n"
                        "  \"reasoning\": \"A very concise explanation (max 1 sentence) referencing what is visible in the crop (e.g., coffee cup, mask pulled down, empty face)\"\n"
                        "}"
                    )
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{b64_image}"
                    }
                }
            ]
        }
    ]
    
    res_text, err = call_groq_api(
        groq_key, 
        "llama-3.2-11b-vision-preview", 
        messages, 
        response_json=True
    )
    
    if err:
        return jsonify({"error": f"AI verification failed: {err}"}), 500

    try:
        res_json = json.loads(res_text.strip())
        ai_status = res_json.get("ai_status", "Confirmed Violation")
        ai_reasoning = res_json.get("reasoning", "No mask is visible.")
    except Exception as parse_err:
        log.warning(f"Failed to parse Groq JSON output: {parse_err}. Text: {res_text}")
        ai_status = "Confirmed Violation"
        ai_reasoning = "Mask not visible (JSON parse error)."

    with _db_lock:
        with get_db() as conn:
            conn.execute(
                "UPDATE violations SET ai_status=?, ai_reasoning=? WHERE id=?",
                (ai_status, ai_reasoning, violation_id)
            )
            conn.commit()

    return jsonify({
        "id": violation_id,
        "ai_status": ai_status,
        "ai_reasoning": ai_reasoning,
        "demo_mode": False
    }), 200

# =============================================================================
# FRONTEND ROUTES - Serve index.html and static files
# =============================================================================
FRONTEND_DIR = BASE_DIR.parent / "frontend"

@app.route("/", methods=["GET"])
def serve_index():
    """Serve the main index.html page"""
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return send_from_directory(str(FRONTEND_DIR), "index.html")
    return jsonify({"error": "Frontend not found"}), 404

@app.route("/styles/<path:filename>", methods=["GET"])
def serve_styles(filename):
    """Serve CSS files"""
    return send_from_directory(str(FRONTEND_DIR / "styles"), filename)

@app.route("/js/<path:filename>", methods=["GET"])
def serve_js(filename):
    """Serve JavaScript files"""
    return send_from_directory(str(FRONTEND_DIR / "js"), filename)

@app.route("/<path:filename>", methods=["GET"])
def serve_static(filename):
    """Serve any static files from frontend"""
    file_path = FRONTEND_DIR / filename
    if file_path.exists() and file_path.is_file():
        return send_from_directory(str(FRONTEND_DIR), filename)
    return jsonify({"error": "File not found"}), 404

# =============================================================================
# ERROR HANDLERS
# =============================================================================
@app.errorhandler(413)
def too_large(e):
    return jsonify({"error": "File too large. Max 100 MB."}), 413

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Endpoint not found."}), 404

@app.errorhandler(500)
def server_error(e):
    STATS["errors"] += 1
    return jsonify({"error": "Internal server error.", "detail": str(e)}), 500

# =============================================================================
# ENTRY POINT
# =============================================================================
load_resources()
init_db()

if __name__ == "__main__":
    mode = "DEMO MODE" if demo_mode else "MODEL LOADED"
    log.info("=" * 55)
    log.info(f"  Mask Detector API  http://localhost:5000  [{mode}]")
    log.info("=" * 55)
    app.run(host="0.0.0.0", port=5000, debug=False,
            use_reloader=False, threaded=True)
