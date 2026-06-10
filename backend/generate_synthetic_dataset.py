import os
import cv2
import random
import numpy as np

def create_synthetic_dataset(output_dir="backend/dataset", count=250):
    classes = ["with_mask", "without_mask"]
    
    # Create directories
    for cls in classes:
        os.makedirs(os.path.join(output_dir, cls), exist_ok=True)
        
    print(f"[INFO] Generating synthetic dataset in: {output_dir}")
    
    for i in range(count):
        # Generate 'without_mask' face
        face_no_mask = generate_synthetic_face(has_mask=False)
        cv2.imwrite(os.path.join(output_dir, "without_mask", f"face_{i:04d}.jpg"), face_no_mask)
        
        # Generate 'with_mask' face
        face_with_mask = generate_synthetic_face(has_mask=True)
        cv2.imwrite(os.path.join(output_dir, "with_mask", f"face_{i:04d}.jpg"), face_with_mask)
        
    print(f"[INFO] Generated {count} images for each class.")

def generate_synthetic_face(has_mask=False):
    # Create a blank 224x224 RGB image with a random solid background color
    bg_color = (random.randint(200, 255), random.randint(200, 255), random.randint(200, 255))
    img = np.zeros((224, 224, 3), dtype=np.uint8)
    img[:] = bg_color
    
    # Face parameters (center, size)
    center = (112, 112)
    axes = (random.randint(65, 80), random.randint(80, 95))
    
    # Skin color (randomized flesh tones)
    skin_b = random.randint(120, 190)
    skin_g = random.randint(140, 210)
    skin_r = random.randint(180, 255)
    skin_color = (skin_b, skin_g, skin_r)
    
    # Draw face oval
    cv2.ellipse(img, center, axes, 0, 0, 360, skin_color, -1)
    # Face outline
    cv2.ellipse(img, center, axes, 0, 0, 360, (skin_b - 30, skin_g - 30, skin_r - 30), 2)
    
    # Eyes parameters
    eye_y = 90 + random.randint(-5, 5)
    eye_x_left = 85 + random.randint(-5, 5)
    eye_x_right = 139 + random.randint(-5, 5)
    eye_size = random.randint(8, 12)
    eye_color = (random.randint(20, 80), random.randint(20, 80), random.randint(20, 80))
    
    # Draw eyes
    cv2.circle(img, (eye_x_left, eye_y), eye_size, (255, 255, 255), -1)
    cv2.circle(img, (eye_x_left, eye_y), eye_size // 2, eye_color, -1)
    cv2.circle(img, (eye_x_right, eye_y), eye_size, (255, 255, 255), -1)
    cv2.circle(img, (eye_x_right, eye_y), eye_size // 2, eye_color, -1)
    
    # Eyebrows
    cv2.line(img, (eye_x_left - 12, eye_y - 12), (eye_x_left + 12, eye_y - 10), (0, 0, 0), 2)
    cv2.line(img, (eye_x_right - 12, eye_y - 10), (eye_x_right + 12, eye_y - 12), (0, 0, 0), 2)

    # Nose
    cv2.line(img, (112, eye_y), (112, 130), (skin_b - 20, skin_g - 20, skin_r - 20), 2)
    cv2.line(img, (112, 130), (117, 130), (skin_b - 25, skin_g - 25, skin_r - 25), 2)

    if has_mask:
        # Draw mask
        mask_types = ["surgical", "fabric", "n95"]
        mask_style = random.choice(mask_types)
        
        if mask_style == "surgical":
            # Surgical blue mask
            mask_color = (random.randint(210, 240), random.randint(180, 200), random.randint(50, 100)) # Blue-ish in BGR
            # Draw mask body covering lower half of face
            pts = np.array([[70, 130], [154, 130], [165, 180], [112, 200], [59, 180]], np.int32)
            cv2.fillPoly(img, [pts], mask_color)
            # Mask borders & pleats
            cv2.polylines(img, [pts], True, (255, 255, 255), 1)
            cv2.line(img, (65, 150), (159, 150), (255, 255, 255), 1)
            cv2.line(img, (62, 165), (162, 165), (255, 255, 255), 1)
            
            # Mask straps to ears
            cv2.line(img, (70, 135), (45, 115), (240, 240, 240), 1)
            cv2.line(img, (70, 175), (45, 125), (240, 240, 240), 1)
            cv2.line(img, (154, 135), (179, 115), (240, 240, 240), 1)
            cv2.line(img, (154, 175), (179, 125), (240, 240, 240), 1)
            
        elif mask_style == "fabric":
            # Fabric black / dark mask
            mask_color = (random.randint(20, 50), random.randint(20, 50), random.randint(20, 50))
            pts = np.array([[68, 125], [156, 125], [168, 175], [112, 205], [56, 175]], np.int32)
            cv2.fillPoly(img, [pts], mask_color)
            cv2.polylines(img, [pts], True, (100, 100, 100), 1)
            
            # Straps
            cv2.line(img, (68, 130), (45, 115), (50, 50, 50), 2)
            cv2.line(img, (68, 170), (45, 125), (50, 50, 50), 2)
            cv2.line(img, (156, 130), (179, 115), (50, 50, 50), 2)
            cv2.line(img, (156, 170), (179, 125), (50, 50, 50), 2)
            
        else: # n95 style (white/yellowish cone shape)
            mask_color = (random.randint(235, 255), random.randint(235, 255), random.randint(235, 255))
            pts = np.array([[75, 130], [149, 130], [158, 175], [112, 205], [66, 175]], np.int32)
            cv2.fillPoly(img, [pts], mask_color)
            # Center fold line
            cv2.line(img, (112, 130), (112, 205), (200, 200, 200), 2)
            cv2.polylines(img, [pts], True, (180, 180, 180), 1)
            
            # Straps
            cv2.line(img, (75, 140), (45, 115), (230, 230, 200), 1)
            cv2.line(img, (75, 165), (45, 125), (230, 230, 200), 1)
            cv2.line(img, (149, 140), (179, 115), (230, 230, 200), 1)
            cv2.line(img, (149, 165), (179, 125), (230, 230, 200), 1)
            
    else:
        # Draw mouth / lips for no-mask face
        mouth_y = 165 + random.randint(-5, 5)
        mouth_w = random.randint(20, 30)
        mouth_h = random.randint(3, 8)
        
        # Draw smile / mouth line
        cv2.ellipse(img, (112, mouth_y), (mouth_w, mouth_h), 0, 0, 180, (50, 50, 200), 2)
        # Lip color
        cv2.ellipse(img, (112, mouth_y), (mouth_w, mouth_h), 0, 0, 180, (100, 100, 230), -1)

    return img

if __name__ == "__main__":
    create_synthetic_dataset("backend/dataset", count=250)
