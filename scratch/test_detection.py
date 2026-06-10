import cv2
import numpy as np
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()
DNN_PROTO = BASE_DIR / "backend" / "opencv_dnn" / "deploy.prototxt"
DNN_MODEL = BASE_DIR / "backend" / "opencv_dnn" / "res10_300x300_ssd_iter_140000.caffemodel"

print("Proto path:", DNN_PROTO, DNN_PROTO.exists())
print("Model path:", DNN_MODEL, DNN_MODEL.exists())

face_net = cv2.dnn.readNetFromCaffe(str(DNN_PROTO), str(DNN_MODEL))

# Load a test image (e.g. confusion_matrix.png)
img_path = BASE_DIR / "confusion_matrix.png"
img = cv2.imread(str(img_path))
if img is None:
    print("Failed to load test image, creating dummy image")
    img = np.zeros((480, 640, 3), dtype=np.uint8)

h, w = img.shape[:2]
blob = cv2.dnn.blobFromImage(
    cv2.resize(img, (300, 300)), 1.0,
    (300, 300), (104.0, 177.0, 123.0)
)
face_net.setInput(blob)
detections = face_net.forward()

print(f"Total proposals: {detections.shape[2]}")
count = 0
for i in range(detections.shape[2]):
    confidence = detections[0, 0, i, 2]
    if confidence > 0.05:
        count += 1
        box = detections[0, 0, i, 3:7] * np.array([w, h, w, h])
        (startX, startY, endX, endY) = box.astype("int")
        print(f"Detection {i}: confidence={confidence:.4f}, box=[{startX}, {startY}, {endX}, {endY}]")

print(f"Total detections with confidence > 0.05: {count}")
