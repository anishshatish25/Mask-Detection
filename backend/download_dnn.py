import os
import urllib.request

def download_caffe_model():
    dnn_dir = "backend/opencv_dnn"
    os.makedirs(dnn_dir, exist_ok=True)
    
    urls = {
        "deploy.prototxt": "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/dnn/face_detector/deploy.prototxt",
        "res10_300x300_ssd_iter_140000.caffemodel": "https://github.com/opencv/opencv_3rdparty/raw/dnn_samples_face_detector_20170830/res10_300x300_ssd_iter_140000.caffemodel"
    }
    
    for filename, url in urls.items():
        dest = os.path.join(dnn_dir, filename)
        if not os.path.exists(dest):
            print(f"[INFO] Downloading {filename} to {dest}...")
            urllib.request.urlretrieve(url, dest)
            print(f"[INFO] Successfully downloaded {filename} ({os.path.getsize(dest)} bytes).")
        else:
            print(f"[INFO] File {filename} already exists, skipping download.")

if __name__ == "__main__":
    download_caffe_model()
