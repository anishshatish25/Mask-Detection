"""
train_model.py
==============
Face Mask Detector - MobileNetV2 Transfer Learning
"""

import os
import sys
import argparse
import warnings
warnings.filterwarnings("ignore")

import numpy as np
import matplotlib
matplotlib.use("Agg")           # headless backend - no display needed
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

from sklearn.preprocessing import LabelBinarizer
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix

import seaborn as sns
from imutils import paths
import cv2

import tensorflow as tf
from tensorflow.keras.preprocessing.image import (
    ImageDataGenerator, img_to_array, load_img
)
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.layers import (
    AveragePooling2D, GlobalAveragePooling2D,
    Dense, Dropout, Flatten, Input, Rescaling
)
from tensorflow.keras.models import Model
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.utils import to_categorical
from tensorflow.keras.callbacks import (
    ModelCheckpoint, EarlyStopping, ReduceLROnPlateau, CSVLogger
)

# ---------------------------------------------
# CONFIGURATION
# ---------------------------------------------
IMG_SIZE    = 224
BATCH_SIZE  = 32
INIT_LR     = 1e-4
CLASSES     = ["with_mask", "without_mask"]

# ---------------------------------------------
# ARGUMENT PARSER
# ---------------------------------------------
ap = argparse.ArgumentParser(
    description="Train MobileNetV2 face mask classifier"
)
ap.add_argument(
    "-d", "--dataset",
    default="dataset",
    help="Path to dataset root (contains with_mask/ and without_mask/)"
)
ap.add_argument(
    "-m", "--model",
    default="mask_detector.h5",
    help="Output path for trained Keras model (.h5)"
)
ap.add_argument(
    "-e", "--epochs",
    type=int,
    default=20,
    help="Number of fine-tuning epochs (default: 20)"
)
ap.add_argument(
    "--no-augment",
    action="store_true",
    help="Disable data augmentation"
)
args = vars(ap.parse_args())


# ---------------------------------------------
# STEP 1: LOAD & PREPROCESS IMAGES
# ---------------------------------------------
print("\n[INFO] Loading images from dataset...")

dataset_paths = [args["dataset"]]
real_dataset_path = "c:/Users/anish/OneDrive/Desktop/Face Mask Detection/data"
if os.path.exists(real_dataset_path):
    dataset_paths.append(real_dataset_path)
    print(f"[INFO] Found real-world dataset at: {real_dataset_path}")
else:
    print(f"[WARNING] Real-world dataset not found at: {real_dataset_path}")

image_paths = []
for d_path in dataset_paths:
    paths_in_dir = list(paths.list_images(d_path))
    print(f"[INFO] Found {len(paths_in_dir)} images in {d_path}")
    image_paths.extend(paths_in_dir)

if len(image_paths) == 0:
    print("[ERROR] No images found in any dataset directory.")
    sys.exit(1)

# Shuffle the combined list of paths to mix domains before loading
np.random.seed(42)
np.random.shuffle(image_paths)

data   = []
labels = []
skipped = 0

for i, img_path in enumerate(image_paths, 1):
    # Infer class label from parent folder name
    label = os.path.basename(os.path.dirname(img_path))
    if label not in CLASSES:
        skipped += 1
        continue

    try:
        img = load_img(img_path, target_size=(IMG_SIZE, IMG_SIZE))
        arr = img_to_array(img)
        arr = arr / 255.0   # Normalize to [0, 1]
        data.append(arr)
        labels.append(label)
    except Exception as e:
        print(f"[WARNING] Could not load {img_path}: {e}")
        skipped += 1

    if i % 100 == 0:
        print(f"          {i}/{len(image_paths)} loaded...")

print(f"[INFO] Total loaded : {len(data)}")
print(f"[INFO] Skipped      : {skipped}")
if skipped == len(image_paths):
    print("[ERROR] No valid images were loaded. Check dataset folder structure.")
    sys.exit(1)

# Class distribution
unique, counts = np.unique(labels, return_counts=True)
for u, c in zip(unique, counts):
    print(f"          {u}: {c} images")

# One-hot encode
lb     = LabelBinarizer()
labels = lb.fit_transform(labels)
labels = to_categorical(labels, num_classes=len(CLASSES))

data   = np.array(data,   dtype="float32")
labels = np.array(labels, dtype="float32")

# Train / Validation split (80 / 20)
(trainX, testX, trainY, testY) = train_test_split(
    data, labels,
    test_size=0.20,
    stratify=labels,
    random_state=42
)
print(f"[INFO] Train: {len(trainX)} | Validation: {len(testX)}")


# ---------------------------------------------
# STEP 2: BUILD DATASETS
# ---------------------------------------------
train_ds = tf.data.Dataset.from_tensor_slices((trainX, trainY))
val_ds = tf.data.Dataset.from_tensor_slices((testX, testY))

if not args["no_augment"]:
    print("[INFO] Data augmentation: ENABLED")
    def augment(image, label):
        image = tf.image.random_flip_left_right(image)
        image = tf.image.random_brightness(image, max_delta=0.25)
        scale = tf.random.uniform([], 0.85, 1.15)
        new_size = tf.cast(tf.cast(IMG_SIZE, tf.float32) * scale, tf.int32)
        image = tf.image.resize(image, [new_size, new_size])
        image = tf.image.resize_with_crop_or_pad(image, IMG_SIZE, IMG_SIZE)
        image = tf.clip_by_value(image, 0.0, 1.0)
        return image, label
    
    train_ds = train_ds.shuffle(buffer_size=len(trainX))
    train_ds = train_ds.map(augment, num_parallel_calls=tf.data.AUTOTUNE)
else:
    print("[INFO] Data augmentation: DISABLED")
    train_ds = train_ds.shuffle(buffer_size=len(trainX))

train_ds = train_ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)
val_ds = val_ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)


# ---------------------------------------------
# STEP 3: BUILD MODEL
# ---------------------------------------------
print("[INFO] Building MobileNetV2 model...")

inputs = Input(shape=(224, 224, 3))
# Scale from [0, 1] to [-1, 1] internally for MobileNetV2 feature extractor
scaled = Rescaling(scale=2.0, offset=-1.0)(inputs)

base = MobileNetV2(input_tensor=scaled, include_top=False, weights='imagenet')
base.trainable = False

x = GlobalAveragePooling2D()(base.output)
x = Dense(128, activation='relu')(x)
x = Dropout(0.4)(x)
out = Dense(2, activation='softmax')(x)

model = Model(inputs, out)
# Use 1e-3 LR as standard for training only top layers
model.compile(optimizer=Adam(1e-3), loss='categorical_crossentropy', metrics=['accuracy'])

print(model.summary())
print(f"[INFO] Trainable params: {sum(p.numpy().size for p in model.trainable_weights):,}")


# ---------------------------------------------
# STEP 4: CALLBACKS
# ---------------------------------------------
callbacks = [
    ModelCheckpoint(
        args["model"],
        monitor="val_accuracy",
        save_best_only=True,
        verbose=1
    ),
    EarlyStopping(
        monitor="val_accuracy",
        patience=8,
        restore_best_weights=True,
        verbose=1
    ),
    ReduceLROnPlateau(
        monitor="val_loss",
        factor=0.5,
        patience=3,
        min_lr=1e-7,
        verbose=1
    ),
    CSVLogger("training_log.csv"),
]


# ---------------------------------------------
# STEP 5: TRAINING
# ---------------------------------------------
print(f"\n[INFO] Training model for {args['epochs']} epochs...")

H = model.fit(
    train_ds,
    validation_data=val_ds,
    epochs=args["epochs"],
    callbacks=callbacks,
    verbose=1
)


# ---------------------------------------------
# STEP 6: EVALUATE
# ---------------------------------------------
print("\n[INFO] Evaluating on validation set...")
predY  = model.predict(val_ds, batch_size=BATCH_SIZE)
predY_classes = np.argmax(predY, axis=1)
trueY_classes = np.argmax(testY, axis=1)

report = classification_report(
    trueY_classes,
    predY_classes,
    target_names=lb.classes_
)
print(report)

with open("classification_report.txt", "w") as f:
    f.write("Face Mask Detector - Classification Report\n")
    f.write("=" * 45 + "\n\n")
    f.write(report)
print("[INFO] Saved classification_report.txt")

# Val accuracy / loss
val_loss, val_acc = model.evaluate(val_ds, verbose=0)
print(f"[INFO] Validation Accuracy : {val_acc*100:.2f}%")
print(f"[INFO] Validation Loss     : {val_loss:.4f}")


# ---------------------------------------------
# STEP 7: PLOTS
# ---------------------------------------------

# --- Training Accuracy / Loss ---
epochs_range = range(1, len(H.history["accuracy"]) + 1)

fig, axes = plt.subplots(1, 2, figsize=(14, 5))
fig.suptitle("MobileNetV2 Mask Detector - Training History", fontsize=14, fontweight="bold")

axes[0].plot(epochs_range, H.history["accuracy"],     label="Train Accuracy", color="#2563EB", linewidth=2)
axes[0].plot(epochs_range, H.history["val_accuracy"], label="Val Accuracy",   color="#16A34A", linewidth=2, linestyle="--")
axes[0].set_title("Accuracy")
axes[0].set_xlabel("Epoch")
axes[0].set_ylabel("Accuracy")
axes[0].legend()
axes[0].grid(True, alpha=0.3)
axes[0].yaxis.set_major_formatter(ticker.PercentFormatter(xmax=1.0))

axes[1].plot(epochs_range, H.history["loss"],     label="Train Loss", color="#DC2626", linewidth=2)
axes[1].plot(epochs_range, H.history["val_loss"], label="Val Loss",   color="#EA580C", linewidth=2, linestyle="--")
axes[1].set_title("Loss")
axes[1].set_xlabel("Epoch")
axes[1].set_ylabel("Loss")
axes[1].legend()
axes[1].grid(True, alpha=0.3)

plt.tight_layout()
plt.savefig("training_accuracy.png", dpi=150, bbox_inches="tight")
plt.close()
print("[INFO] Saved training_accuracy.png")

# --- Confusion Matrix ---
cm = confusion_matrix(trueY_classes, predY_classes)
fig, ax = plt.subplots(figsize=(6, 5))
sns.heatmap(
    cm,
    annot=True,
    fmt="d",
    cmap="Blues",
    xticklabels=lb.classes_,
    yticklabels=lb.classes_,
    ax=ax,
    linewidths=0.5,
    linecolor="white",
    cbar=False,
    annot_kws={"size": 14, "weight": "bold"}
)
ax.set_title("Confusion Matrix", fontsize=13, fontweight="bold", pad=12)
ax.set_xlabel("Predicted Label", fontsize=11)
ax.set_ylabel("True Label",      fontsize=11)
plt.tight_layout()
plt.savefig("confusion_matrix.png", dpi=150, bbox_inches="tight")
plt.close()
print("[INFO] Saved confusion_matrix.png")


# ---------------------------------------------
# STEP 8: SAVE KERAS MODEL
# ---------------------------------------------
model.save(args["model"])
print(f"[INFO] Keras model saved to: {args['model']}")

# Export to TF.js format
print("[INFO] Attempting to export model to TF.js format...")
try:
    import tensorflowjs as tfjs
    model_dir = os.path.dirname(args["model"]) or "."
    export_dir = os.path.abspath(os.path.join(model_dir, "..", "model_export"))
    if not os.path.exists(export_dir):
        os.makedirs(export_dir, exist_ok=True)
    tfjs.converters.save_keras_model(model, export_dir)
    print(f"[INFO] Model successfully exported to TF.js format at: {export_dir}")
except Exception as e:
    print(f"[WARNING] TF.js model export skipped/failed: {e}")
    print("          Ensure 'tensorflowjs' is installed to export model format.")

print("[INFO] All done!")
