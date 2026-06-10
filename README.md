# Face Mask Detection System

A complete real-time face mask detection system combining a fine-tuned **MobileNetV2** binary classifier, a **Flask REST API** backend powered by the **OpenCV DNN Face Detector**, and a clean **client-facing web frontend**.

---

## 📁 File Structure

```
face-mask-detector/
├── backend/
│   ├── app.py                  ← Flask REST API
│   ├── train_model.py          ← MobileNetV2 training script
│   ├── mask_detector.h5        ← trained Keras model (generated)
│   ├── requirements.txt        ← Python dependencies
│   └── opencv_dnn/
│       ├── deploy.prototxt     ← OpenCV face detector architecture
│       └── res10_300x300_ssd_iter_140000.caffemodel  ← face detector weights
├── frontend/
│   └── index.html              ← Dashboard client UI
├── index.html                  ← Root dashboard client UI
└── README.md
```

---

## 🚀 Step-by-Step Setup

### Step 1: Install Dependencies
Open your terminal and install all required packages:
```bash
cd backend
pip install -r requirements.txt
```

### Step 2: Generate Synthetic Dataset & Train
1. Generate the synthetic dataset (250 images per class) if you do not have a real-world dataset:
   ```bash
   python generate_synthetic_dataset.py
   ```
2. Train the MobileNetV2 binary classifier:
   ```bash
   python train_model.py --dataset dataset --model mask_detector.h5 --epochs 15
   ```
   *This trains the network with heavy data augmentation and saves the model as `mask_detector.h5` once complete.*

### Step 3: Run the Backend
Start the Flask backend server:
```bash
python app.py
```
*The API initializes on **http://localhost:5000**, loading `mask_detector.h5` and the OpenCV DNN face detector.*

### Step 4: Open the Frontend
Launch a local HTTP server to serve the frontend (enables webcam and video canvas features):
```bash
# From the project root directory
python -m http.server 8000
```
Then open Chrome and navigate to:
**http://localhost:8000/index.html**

---

## ⚙️ How it Works

1. **Face Detection**: The backend detects faces in base64 frames using the highly accurate **OpenCV DNN** detector (ResNet-10 SSD), handling side profiles and partial faces.
2. **Preprocessing**: Faces are cropped with **15% padding**, resized to **224×224**, and normalized to the **`[0, 1]`** pixel value range.
3. **Classification**: Preprocessed faces are fed into the trained **MobileNetV2** model.
4. **Hard Binary Decision**: If the `with_mask` class probability is **> 0.85**, it is classified as `"Mask On"`. Otherwise, it is classified as `"No Mask"`. There is no uncertain or intermediate state.
5. **Dashboard Updates**: The frontend renders a green box for **"Mask On"** or red box for **"No Mask"**, displays a live compliance timeline, and triggers alarms/captures exclusively when **"No Mask"** is detected.
