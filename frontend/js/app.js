/**
 * MASKDETECT - Main Application Logic
 * Core detection pipeline, UI management, and API integration
 */

// ── APPLICATION STATE ─────────────────────────────────────────────────────
const appState = {
  currentTab: 'dashboard',
  isDetecting: false,
  detectedFaces: [],
  sessionStats: { totalFaces: 0, maskOn: 0, noMask: 0 },
  selectedCamera: 0,
  videoFile: null,
  imageFile: null,
  groqKey: localStorage.getItem('groq_api_key') || ''
};

// ── INITIALIZATION ────────────────────────────────────────────────────────
console.log('📄 app.js loaded');

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🔄 DOM Content Loaded - Starting initialization...');
  initializeApp();
});

async function initializeApp() {
  try {
    console.log('🚀 Initializing MaskDetect...');

    // Small delay to ensure other scripts loaded
    await new Promise(r => setTimeout(r, 200));

    // Initialize managers (with null checks)
    try {
      if (typeof notifier !== 'undefined') notifier.init();
    } catch (e) {
      console.warn('notifier.init failed:', e);
    }

    try {
      if (typeof loader !== 'undefined') loader.init();
    } catch (e) {
      console.warn('loader.init failed:', e);
    }

    try {
      if (typeof connectionManager !== 'undefined') {
        connectionManager.startMonitoring(5000);
      }
    } catch (e) {
      console.warn('connectionManager.startMonitoring failed:', e);
    }

    // Initialize theme
    try {
      if (typeof themeManager !== 'undefined') {
        themeManager.initToggle('#theme-toggle');
      }
    } catch (e) {
      console.warn('themeManager.initToggle failed:', e);
    }

    // Register tabs
    registerTabs();

    // Setup event listeners
    setupEventListeners();

    // Load saved preferences
    try {
      loadPreferences();
    } catch (e) {
      console.warn('loadPreferences failed:', e);
    }

    // Show dashboard
    switchTab('dashboard');

    // Check backend connection (async, don't wait)
    try {
      if (typeof connectionManager !== 'undefined' && connectionManager) {
        connectionManager.isAvailable()
          .then(isAvailable => {
            try {
              if (isAvailable) {
                if (typeof notifier !== 'undefined') {
                  setTimeout(() => notifier.success('Backend connected ✅', 3000), 500);
                }
                updateConnectionUI(true);
              } else {
                if (typeof notifier !== 'undefined') {
                  setTimeout(() => notifier.warning('Backend offline', 3000), 500);
                }
                updateConnectionUI(false);
              }
            } catch (e) {
              console.warn('Error after connection check:', e);
            }
          })
          .catch(e => console.warn('Connection check failed:', e));
      }
    } catch (e) {
      console.warn('Connection monitoring setup failed:', e);
    }

    // Load detection history (async, don't wait)
    try {
      loadDetectionHistory().catch(e => console.warn('loadDetectionHistory failed:', e));
    } catch (e) {
      console.warn('loadDetectionHistory setup failed:', e);
    }

    // Setup camera selection
    try {
      setupCameraSelection();
    } catch (e) {
      console.warn('setupCameraSelection failed:', e);
    }

    // Prefill Groq API Key input field
    try {
      const keyInput = document.getElementById('groq-key-input');
      if (keyInput) {
        keyInput.value = appState.groqKey;
      }
    } catch (e) {
      console.warn('Failed to prefill Groq key input:', e);
    }

    console.log('✅ MaskDetect ready');
  } catch (error) {
    console.error('❌ Initialization error:', error);
  }
}

// ── TAB MANAGEMENT ────────────────────────────────────────────────────────
function registerTabs() {
  const tabs = ['dashboard', 'camera', 'image', 'video', 'history', 'analytics', 'settings'];

  tabs.forEach(tabName => {
    const btnId = `tab-${tabName}-btn`;
    const contentId = `tab-${tabName}`;
    const btn = DOM.query(`#${btnId}`);
    const content = DOM.query(`#${contentId}`);

    if (btn && content && typeof tabManager !== 'undefined') {
      try {
        tabManager.register(tabName, {
          button: btn,
          content,
          onShow: () => onTabShow(tabName),
          onHide: () => onTabHide(tabName)
        });
      } catch (e) {
        console.warn(`Failed to register tab ${tabName}:`, e);
      }
    }
  });
}

function switchTab(tabName) {
  console.log(`📑 Switching to tab: ${tabName}`);
  
  // Try using tabManager first
  if (typeof tabManager !== 'undefined') {
    try {
      tabManager.switch(tabName);
      appState.currentTab = tabName;
      return;
    } catch (e) {
      console.warn('tabManager.switch failed:', e);
    }
  }

  // Fallback: manual tab switching
  console.log('Using fallback tab switching...');
  const tabs = ['dashboard', 'camera', 'image', 'video', 'history', 'analytics', 'settings'];

  const NAV_TITLES = {
    dashboard: 'Dashboard', camera: 'Live Camera Detection',
    image: 'Image Analysis', video: 'Video Analysis',
    history: 'Detection History', analytics: 'Analytics & Insights',
    settings: 'Settings'
  };

  tabs.forEach(tab => {
    const content = document.getElementById(`tab-${tab}`);
    const btn = document.getElementById(`tab-${tab}-btn`);

    if (tab === tabName) {
      if (content) {
        content.style.removeProperty('display');
        // Support .tab-panel CSS class system
        content.classList.add('active');
        content.classList.add('tab-active');
      }
      if (btn) btn.classList.add('active');
    } else {
      if (content) {
        content.style.display = 'none';
        content.classList.remove('active');
        content.classList.remove('tab-active');
      }
      if (btn) btn.classList.remove('active');
    }
  });

  // Update topbar title
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = NAV_TITLES[tabName] || tabName;

  appState.currentTab = tabName;
  onTabShow(tabName);
}

async function onTabShow(tabName) {
  console.log(`📑 Showing tab: ${tabName}`);

  switch (tabName) {
    case 'camera':
      // Camera tab is ready
      break;
    case 'image':
      // Image upload is ready
      break;
    case 'video':
      // Video upload is ready
      break;
    case 'history':
      await loadDetectionHistory();
      break;
    case 'analytics':
      await loadAnalytics();
      break;
    case 'dashboard':
      await updateDashboard();
      break;
  }
}

function onTabHide(tabName) {
  if (tabName === 'camera' && appState.isDetecting) {
    stopCamera();
  }
}

// ── CAMERA FUNCTIONALITY ──────────────────────────────────────────────────
async function setupCameraSelection() {
  const select = DOM.query('#camera-select');
  if (!select) return;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');

    select.innerHTML = '';
    videoDevices.forEach((device, index) => {
      const option = DOM.create('option', { value: index.toString() }, [
        device.label || `Camera ${index + 1}`
      ]);
      select.appendChild(option);
    });

    if (videoDevices.length === 0) {
      select.innerHTML = '<option>No cameras found</option>';
      select.disabled = true;
    }
  } catch (error) {
    console.error('Camera enumeration failed:', error);
  }
}

async function toggleCamera() {
  if (appState.isDetecting) {
    stopCamera();
  } else {
    startCamera();
  }
}

async function startCamera() {
  const video = DOM.query('#video');
  const placeholder = DOM.query('#camera-placeholder');
  const canvas = DOM.query('#overlay');

  if (!video) return;

  try {
    loader.show();
    // Reset session stats for the new camera monitoring session
    appState.sessionStats = { totalFaces: 0, maskOn: 0, noMask: 0 };

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    video.srcObject = stream;
    appState.isDetecting = true;

    DOM.hide(placeholder);
    DOM.addClass(DOM.query('#start-camera-btn'), 'btn-danger');
    DOM.query('#start-camera-btn').textContent = '⏹ Stop';

    // Start detection loop (draw loop + throttled backend requests)
    startDetectionLoop(video, canvas);

    notifier.success('Camera started', 2000);
    loader.hide();
  } catch (error) {
    console.error('Camera access failed:', error);
    notifier.error('Camera access denied. Check permissions.', 5000);
    loader.hide();
  }
}

function stopCamera() {
  const video = DOM.query('#video');
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
  }

  appState.isDetecting = false;
  stopDetectionLoop();   // cancel draw loop

  // Clear overlay canvas
  const canvas = DOM.query('#overlay');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  DOM.removeClass(DOM.query('#start-camera-btn'), 'btn-danger');
  DOM.query('#start-camera-btn').textContent = '▶ Start';
  DOM.show(DOM.query('#camera-placeholder'));

  // Save session
  if (appState.sessionStats.totalFaces > 0) {
    MaskAPI.saveCameraSession(
      appState.sessionStats.totalFaces,
      appState.sessionStats.maskOn,
      appState.sessionStats.noMask
    ).catch(console.error);
  }

  // Reset session stats
  appState.sessionStats = { totalFaces: 0, maskOn: 0, noMask: 0 };
}

// ── DETECTION LOOP ────────────────────────────────────────────────────────
// Persistent state – survives between frames
let _lastFaces        = [];    // most recent faces from backend
let _isRequestPending = false; // prevent concurrent backend requests
let _drawLoopId       = null;  // requestAnimationFrame handle
let _lastSentTime     = 0;     // throttle: ms since last backend call
const DETECT_INTERVAL = 300;   // ms between backend calls (≈3-4 fps)

let detectionFrameCount = 0;
let lastDetectionTime   = Date.now();

// Called once when camera starts. Runs two independent loops:
//   1. drawLoop  – runs at ~60 fps, just paints boxes over live video
//   2. fetchLoop – sends one request at a time, every DETECT_INTERVAL ms
function startDetectionLoop(video, canvas) {
  _lastFaces        = [];
  _isRequestPending = false;
  _lastSentTime     = 0;

  function drawLoop(ts) {
    if (!appState.isDetecting) return;

    // ── 1. Keep canvas sized to match video ──────────────────────
    const vw = video.videoWidth  || 640;
    const vh = video.videoHeight || 480;
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width  = vw;
      canvas.height = vh;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── 2. Draw last known bounding boxes ────────────────────────
    _lastFaces.forEach(face => {
      const [x, y, w, h] = face.box;
      const ok       = face.label === 'Mask On';
      const boxColor = ok ? 'rgba(16,185,129,0.95)' : 'rgba(239,68,68,0.95)';
      const txtColor = ok ? '#10B981' : '#EF4444';

      // Glow shadow
      ctx.save();
      ctx.shadowColor = boxColor;
      ctx.shadowBlur  = 8;
      ctx.strokeStyle = boxColor;
      ctx.lineWidth   = 3;
      ctx.strokeRect(x, y, w, h);
      ctx.restore();

      // Label
      const label = `${face.label}  ${Math.round(face.confidence * 100)}%`;
      ctx.font = 'bold 15px Outfit, sans-serif';
      const tw    = ctx.measureText(label).width + 16;
      const lbY   = y > 34 ? y - 32 : y + h + 4;
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(x, lbY, tw, 26);
      ctx.fillStyle = txtColor;
      ctx.fillText(label, x + 8, lbY + 18);
    });

    // ── 3. Fire a backend request if interval has passed ─────────
    const now = performance.now();
    if (!_isRequestPending && (now - _lastSentTime) >= DETECT_INTERVAL
        && video.readyState >= 2) {
      _isRequestPending = true;
      _lastSentTime     = now;

      // Capture frame on a tiny off-screen canvas
      const tmp   = document.createElement('canvas');
      tmp.width   = vw;
      tmp.height  = vh;
      tmp.getContext('2d').drawImage(video, 0, 0, vw, vh);
      const b64 = tmp.toDataURL('image/jpeg', 0.8);

      MaskAPI.predictFrame(b64)
        .then(res => {
          const faces = (res.data && res.data.faces) || [];
          _lastFaces = faces;
          updateStats(faces);
          updateFaceGallery(faces);

          // HUD
          detectionFrameCount++;
          const elapsed = (performance.now() - lastDetectionTime) / 1000;
          if (elapsed >= 1) {
            const fps = (detectionFrameCount / elapsed).toFixed(1);
            const fpsEl = DOM.query('#hud-fps');
            const frEl  = DOM.query('#hud-frames');
            if (fpsEl) DOM.text(fpsEl, fps);
            if (frEl)  DOM.text(frEl, detectionFrameCount);
            lastDetectionTime    = performance.now();
            detectionFrameCount  = 0;
          }
          const cntEl = DOM.query('#hud-count');
          if (cntEl) DOM.text(cntEl, faces.length);
        })
        .catch(err => console.warn('predictFrame error:', err))
        .finally(() => { _isRequestPending = false; });
    }

    _drawLoopId = requestAnimationFrame(drawLoop);
  }

  _drawLoopId = requestAnimationFrame(drawLoop);
}

function stopDetectionLoop() {
  if (_drawLoopId) { cancelAnimationFrame(_drawLoopId); _drawLoopId = null; }
  _lastFaces        = [];
  _isRequestPending = false;
}

function updateDetectionUI(faces, canvas, video) {
  // Sync canvas resolution to the VIDEO's actual pixel dimensions
  const vidW = video.videoWidth  || video.clientWidth  || 640;
  const vidH = video.videoHeight || video.clientHeight || 480;

  if (canvas.width  !== vidW) canvas.width  = vidW;
  if (canvas.height !== vidH) canvas.height = vidH;

  const ctx = canvas.getContext('2d');

  // Clear canvas fully (no dark tint – video already shows through)
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (faces.length === 0) {
    updateFaceGallery(faces);
    const countElement = DOM.query('#hud-count');
    if (countElement) DOM.text(countElement, 0);
    return;
  }

  // Draw bounding boxes (coordinates are already in video-pixel space)
  faces.forEach((face) => {
    const [x, y, w, h] = face.box;
    const isCompliant = face.label === 'Mask On';
    const boxColor  = isCompliant ? 'rgba(16, 185, 129, 0.9)' : 'rgba(239, 68, 68, 0.9)';
    const textColor = isCompliant ? '#10B981' : '#EF4444';

    // Bounding box
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = 3;
    ctx.shadowColor = boxColor;
    ctx.shadowBlur = 6;
    ctx.strokeRect(x, y, w, h);
    ctx.shadowBlur = 0;

    // Label background
    const label = `${face.label}  ${Math.round(face.confidence * 100)}%`;
    ctx.font = 'bold 15px Outfit, sans-serif';
    const textW = ctx.measureText(label).width + 16;
    const labelY = y > 34 ? y - 34 : y + h + 4;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fillRect(x, labelY, textW, 28);

    // Label text
    ctx.fillStyle = textColor;
    ctx.fillText(label, x + 8, labelY + 19);

    // Play sound on violation
    if (!isCompliant && Storage.get('audio-alerts')) {
      playViolationSound();
    }
  });

  // Update face gallery & HUD counter
  updateFaceGallery(faces);
  const countElement = DOM.query('#hud-count');
  if (countElement) {
    DOM.text(countElement, faces.length);
    DOM.addClass(countElement.parentElement, 'detection-count active');
    setTimeout(() => DOM.removeClass(countElement.parentElement, 'detection-count active'), 200);
  }
}

function updateStats(faces) {
  const maskCount = faces.filter(f => f.label === 'Mask On').length;
  const noMaskCount = faces.length - maskCount;

  appState.sessionStats.totalFaces += faces.length;
  appState.sessionStats.maskOn += maskCount;
  appState.sessionStats.noMask += noMaskCount;

  // Update HUD timestamp
  DOM.text(DOM.query('#hud-timestamp'), Format.time(new Date().toISOString()));
}

function updateFaceGallery(faces) {
  const container = DOM.query('#faces-container');
  DOM.empty(container);

  if (faces.length === 0) {
    container.innerHTML = '<div style="color: var(--text-tertiary); font-size: 12px;">No faces detected</div>';
    DOM.text(DOM.query('#face-count'), '0');
    return;
  }

  DOM.text(DOM.query('#face-count'), faces.length);

  const videoElement = DOM.query('#video');

  faces.forEach((face, index) => {
    const isCompliant = face.label === 'Mask On';
    const badgeClass = isCompliant ? 'success' : 'danger';

    // Generate thumbnail by cropping the face from the video element
    let thumbnailEl;
    if (videoElement && videoElement.readyState >= 2) {
      try {
        let [x, y, w, h] = face.box;
        const vw = videoElement.videoWidth;
        const vh = videoElement.videoHeight;
        
        // Ensure crop boundaries are valid and within the video frame
        x = Math.max(0, Math.min(x, vw - 1));
        y = Math.max(0, Math.min(y, vh - 1));
        w = Math.max(1, Math.min(w, vw - x));
        h = Math.max(1, Math.min(h, vh - y));

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w;
        tempCanvas.height = h;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(videoElement, x, y, w, h, 0, 0, w, h);
        const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.9);
        thumbnailEl = DOM.create('img', {
          src: dataUrl,
          style: {
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: '6px'
          }
        });
      } catch (e) {
        console.error('Failed to crop face from live video:', e);
      }
    }

    if (!thumbnailEl) {
      const icon = isCompliant ? '✅' : '⚠️';
      thumbnailEl = document.createTextNode(icon);
    }

    const row = DOM.create('div', {
      class: 'face-row',
      style: {
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }
    }, [
      DOM.create('div', {
        style: {
          width: '40px',
          height: '40px',
          borderRadius: '8px',
          background: 'rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          overflow: 'hidden',
          flexShrink: 0
        }
      }, [thumbnailEl]),
      DOM.create('div', { style: { flex: 1, minWidth: 0 } }, [
        DOM.create('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' } }, [`Person ${index + 1}`]),
        DOM.create('div', { style: { fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' } }, [face.label]),
        DOM.create('div', {
          class: `badge ${badgeClass}`,
          style: { marginTop: '6px', display: 'inline-block' }
        }, [Format.confidence(face.confidence)])
      ])
    ]);

    container.appendChild(row);
  });
}

// ── IMAGE ANALYSIS ───────────────────────────────────────────────────────
function handleImageDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  DOM.removeClass(DOM.query('#drop-zone'), 'drag-over');

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleImageFile(files[0]);
  }
}

function handleDragOver(e) {
  e.preventDefault();
  DOM.addClass(DOM.query('#drop-zone'), 'drag-over');
}

function handleDragLeave(e) {
  e.preventDefault();
  DOM.removeClass(DOM.query('#drop-zone'), 'drag-over');
}

function handleImageSelect(e) {
  if (e.target.files.length > 0) {
    handleImageFile(e.target.files[0]);
  }
}

async function handleImageFile(file) {
  try {
    loader.show();

    const base64 = await fileToBase64(file);
    const result = await MaskAPI.predictImage(base64);
    const faces = result.data.faces || [];

    // Draw results
    drawImageResults(base64, faces);
    updateImageFaceGallery(faces);

    notifier.success(`Detected ${faces.length} faces`, 3000);
    loader.hide();
  } catch (error) {
    console.error('Image analysis failed:', error);
    notifier.error('Image analysis failed', 4000);
    loader.hide();
  }
}

function drawImageResults(base64Image, faces) {
  const img = new Image();
  img.onload = () => {
    const canvas = DOM.query('#image-canvas');
    if (!canvas) return;

    // Set canvas resolution to the image's native size
    canvas.width  = img.width;
    canvas.height = img.height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    // Draw bounding boxes on top of the image
    faces.forEach(face => {
      const [x, y, w, h] = face.box;
      const ok       = face.label === 'Mask On';
      const boxColor = ok ? '#10B981' : '#EF4444';

      // Box with glow
      ctx.save();
      ctx.shadowColor = boxColor;
      ctx.shadowBlur  = 10;
      ctx.strokeStyle = boxColor;
      ctx.lineWidth   = 3;
      ctx.strokeRect(x, y, w, h);
      ctx.restore();

      // Label
      const label = `${face.label}  ${Math.round(face.confidence * 100)}%`;
      ctx.font = 'bold 16px Outfit, sans-serif';
      const tw  = ctx.measureText(label).width + 16;
      const lbY = y > 36 ? y - 34 : y + h + 4;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(x, lbY, tw, 28);
      ctx.fillStyle = boxColor;
      ctx.fillText(label, x + 8, lbY + 20);
    });

    // Show canvas, hide drop-zone — use style.display to override inline styles
    const previewWrap = DOM.query('#image-preview-wrap');
    const uploadArea  = DOM.query('#upload-area');
    if (previewWrap) {
      previewWrap.style.display = 'flex';
      previewWrap.style.alignItems = 'center';
      previewWrap.style.justifyContent = 'center';
    }
    if (uploadArea) uploadArea.style.display = 'none';
    updateImageFaceGallery(faces, img);
  };
  img.src = base64Image;
}

function clearImage() {
  const input = DOM.query('#image-input');
  if (input) input.value = '';

  const previewWrap = DOM.query('#image-preview-wrap');
  const uploadArea  = DOM.query('#upload-area');

  if (previewWrap) previewWrap.style.display = 'none';
  if (uploadArea) {
    uploadArea.style.removeProperty('display');
    uploadArea.style.display = 'flex';
  }

  const canvas = DOM.query('#image-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  updateImageFaceGallery([]);
}

function updateImageFaceGallery(faces, imgElement = null) {
  const container = DOM.query('#image-faces-container');
  if (!container) return;
  DOM.empty(container);

  if (faces.length === 0) {
    container.innerHTML = '<div style="color: var(--text-tertiary); font-size: 12px;">No faces detected</div>';
    DOM.text(DOM.query('#image-face-count'), '0');
    return;
  }

  DOM.text(DOM.query('#image-face-count'), faces.length);

  faces.forEach((face, index) => {
    const isCompliant = face.label === 'Mask On';
    const badgeClass = isCompliant ? 'success' : 'danger';

    // Generate thumbnail by cropping the face from the image element
    let thumbnailEl;
    if (imgElement) {
      try {
        const [x, y, w, h] = face.box;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w;
        tempCanvas.height = h;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(imgElement, x, y, w, h, 0, 0, w, h);
        const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.9);
        thumbnailEl = DOM.create('img', {
          src: dataUrl,
          style: {
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: '6px'
          }
        });
      } catch (e) {
        console.error('Failed to crop face:', e);
      }
    }

    if (!thumbnailEl) {
      const icon = isCompliant ? '✅' : '⚠️';
      thumbnailEl = document.createTextNode(icon);
    }

    const row = DOM.create('div', {
      class: 'face-row',
      style: {
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }
    }, [
      DOM.create('div', {
        style: {
          width: '40px',
          height: '40px',
          borderRadius: '8px',
          background: 'rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          overflow: 'hidden',
          flexShrink: 0
        }
      }, [thumbnailEl]),
      DOM.create('div', { style: { flex: 1, minWidth: 0 } }, [
        DOM.create('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' } }, [`Person ${index + 1}`]),
        DOM.create('div', { style: { fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' } }, [face.label]),
        DOM.create('div', {
          class: `badge ${badgeClass}`,
          style: { marginTop: '6px', display: 'inline-block' }
        }, [Format.confidence(face.confidence)])
      ])
    ]);

    container.appendChild(row);
  });
}

// ── VIDEO ANALYSIS ────────────────────────────────────────────────────────
function handleVideoSelect(e) {
  if (e.target.files.length > 0) {
    appState.videoFile = e.target.files[0];
    showVideoReadyUI();
  }
}

function handleVideoDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  DOM.removeClass(DOM.query('#video-drop-zone'), 'drag-over');

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    appState.videoFile = files[0];
    showVideoReadyUI();
  }
}

function showVideoReadyUI() {
  const file = appState.videoFile;
  DOM.text(DOM.query('#video-filename'), file.name);
  DOM.text(DOM.query('#video-filesize'), `${Format.bytes(file.size)}`);
  DOM.hide(DOM.query('#video-upload'));
  DOM.show(DOM.query('#video-file-ready'));
}

async function startVideoAnalysis() {
  if (!appState.videoFile) return;

  try {
    loader.show();
    DOM.hide(DOM.query('#video-file-ready'));
    DOM.show(DOM.query('#video-progress'));

    const results = {};

    await MaskAPI.predictVideo(appState.videoFile, (data) => {
      if (data.progress !== undefined) {
        const percent = (data.progress / data.total_frames) * 100;
        DOM.query('#progress-bar').style.width = `${percent}%`;
        DOM.text(DOM.query('#progress-msg'), `Processing: Frame ${data.progress} / ${data.total_frames}`);
      } else if (data.total_frames !== undefined) {
        Object.assign(results, data);
        showVideoResults(results);
      }
    });

    loader.hide();
  } catch (error) {
    console.error('Video analysis failed:', error);
    notifier.error('Video analysis failed', 4000);
    loader.hide();
  }
}

function showVideoResults(results) {
  DOM.hide(DOM.query('#video-progress'));

  const compliance = results.compliance_rate?.replace('%', '') || 0;
  const maskCount = results.mask_on_count || 0;
  const noMaskCount = results.no_mask_count || 0;

  const resultsHTML = `
    <div class="card">
      <div class="card-header">
        <h3>Analysis Complete</h3>
      </div>
      <div class="card-body" style="display: flex; flex-direction: column; gap: 20px;">
        <div style="width: 100%; border-radius: var(--radius-lg); overflow: hidden; background: #0a0e17; box-shadow: var(--shadow-md); border: 1px solid var(--border); line-height: 0;">
          <video src="${API_BASE}/video/download/${results.output_video}" controls style="width: 100%; height: auto; max-height: 480px; display: block; object-fit: contain;"></video>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="stat-card success" style="margin-bottom: 0;">
            <div class="stat-number">${maskCount}</div>
            <div class="stat-label">Mask On</div>
          </div>
          <div class="stat-card danger" style="margin-bottom: 0;">
            <div class="stat-number">${noMaskCount}</div>
            <div class="stat-label">Violations</div>
          </div>
        </div>
        <div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Compliance Rate</div>
          <div style="font-size: 32px; font-weight: 700; color: var(--success);">${compliance}%</div>
        </div>
        <button class="btn btn-primary" style="width: 100%;" onclick="downloadVideoResult('${results.output_video}')">
          ⬇ Download Annotated Video
        </button>
      </div>
    </div>
  `;

  DOM.show(DOM.query('#video-results'));
  DOM.html(DOM.query('#video-results'), resultsHTML);
  DOM.show(DOM.query('#video-results'));
}

function clearVideo() {
  appState.videoFile = null;
  DOM.query('#video-file-input').value = '';
  DOM.show(DOM.query('#video-upload'));
  DOM.hide(DOM.query('#video-file-ready'));
  DOM.hide(DOM.query('#video-results'));
}

// ── DETECTION HISTORY ─────────────────────────────────────────────────────
async function loadDetectionHistory() {
  try {
    const { data } = await MaskAPI.getDetections(1, 50);
    const records = data.records || [];

    const tbody = DOM.query('#history-tbody');
    if (!tbody) {
      console.warn('History table body not found');
      return;
    }
    DOM.empty(tbody);

    if (records.length === 0) {
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-tertiary);">No detection history</td></tr>';
      }
      return;
    }

    records.forEach(record => {
      const compliance = Math.round(record.compliance || 0);
      const row = DOM.create('tr', {}, [
        DOM.create('td', {}, [String(Format.datetime(record.timestamp))]),
        DOM.create('td', {}, [
          DOM.create('span', { class: `badge ${record.source.toLowerCase()}` }, [String(record.source)])
        ]),
        DOM.create('td', {}, [String(record.total_faces || 0)]),
        DOM.create('td', { style: { color: 'var(--success)' } }, [String(record.mask_on || 0)]),
        DOM.create('td', { style: { color: 'var(--danger)' } }, [String(record.no_mask || 0)]),
        DOM.create('td', {}, [String(compliance || 0) + '%'])
      ]);
      if (row && tbody) {
        tbody.appendChild(row);
      }
    });
  } catch (error) {
    console.error('Failed to load detection history:', error);
  }
}

async function clearHistory() {
  const shouldClear = await confirm(
    'Clear History',
    'Are you sure you want to delete all detection records? This cannot be undone.',
    'Delete',
    'Cancel'
  );

  if (shouldClear) {
    try {
      await MaskAPI.clearDetections();
      notifier.success('Detection history cleared', 3000);
      loadDetectionHistory();
    } catch (error) {
      notifier.error('Failed to clear history', 3000);
    }
  }
}

// ── DASHBOARD ──────────────────────────────────────────────────────────────
async function updateDashboard() {
  try {
    // Try to fetch stats from backend
    let stats = { total_checked: 0, mask_count: 0, no_mask_count: 0 };
    let health = null;

    try {
      const statsResult = await MaskAPI.stats();
      stats = statsResult.data || stats;
    } catch (e) {
      console.warn('Stats fetch failed, using defaults:', e);
    }

    try {
      const healthResult = await MaskAPI.health();
      health = healthResult.data;
    } catch (e) {
      console.warn('Health check failed:', e);
    }

    // Update stats with fallback values
    const totalEl = DOM.query('#stat-total-detected');
    const maskEl = DOM.query('#stat-mask-on');
    const noMaskEl = DOM.query('#stat-no-mask');
    const complianceEl = DOM.query('#stat-compliance');

    if (totalEl) DOM.text(totalEl, stats.total_checked || 0);
    if (maskEl) DOM.text(maskEl, stats.mask_count || 0);
    if (noMaskEl) DOM.text(noMaskEl, stats.no_mask_count || 0);

    const compliance = stats.total_checked > 0 ?
      ((stats.mask_count / stats.total_checked) * 100).toFixed(1) : 100;
    if (complianceEl) DOM.text(complianceEl, `${Math.round(compliance)}%`);

    // Update status indicators
    const isOnline = health !== null;
    updateConnectionUI(isOnline);

    if (health && health.uptime_s) {
      const uptimeEl = DOM.query('#server-uptime');
      if (uptimeEl) DOM.text(uptimeEl, Format.duration(health.uptime_s * 1000));
    }

    // Refresh the recent violations feed
    try {
      loadViolationsFeed();
    } catch (ve) {
      console.warn('Failed to load violations feed:', ve);
    }
  } catch (error) {
    console.error('Dashboard update failed:', error);
  }
}

// ── ANALYTICS ──────────────────────────────────────────────────────────────
async function loadAnalytics() {
  try {
    const rangeEl = DOM.query('#analytics-range');
    const rangeDays = rangeEl ? rangeEl.value : 'all';

    const { data } = await MaskAPI.getDetections(1, 500);
    let records = data.records || [];

    // Filter by date range
    if (rangeDays !== 'all') {
      const days = parseInt(rangeDays);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      records = records.filter(r => new Date(r.timestamp) >= cutoff);
    }

    // Update subtitle
    const subtitleEl = DOM.query('#analytics-subtitle');
    if (subtitleEl) {
      subtitleEl.textContent = records.length > 0
        ? `Showing ${records.length} sessions${rangeDays !== 'all' ? ` from last ${rangeDays} days` : ' (all time)'}`
        : 'No detection data yet — run a detection to populate analytics';
    }

    if (records.length === 0) {
      // Show empty states
      const emptyEls = ['compliance-chart-empty', 'volume-chart-empty'];
      emptyEls.forEach(id => { const el = DOM.query('#' + id); if (el) el.style.display = 'block'; });
      const chartEls = ['compliance-chart', 'volume-chart'];
      chartEls.forEach(id => { const el = DOM.query('#' + id); if (el) el.style.display = 'none'; });
      return;
    }

    // Show charts
    ['compliance-chart', 'volume-chart'].forEach(id => {
      const el = DOM.query('#' + id);
      if (el) el.style.display = 'block';
    });
    ['compliance-chart-empty', 'volume-chart-empty'].forEach(id => {
      const el = DOM.query('#' + id);
      if (el) el.style.display = 'none';
    });

    // ── Aggregate totals ──────────────────────────────────────
    const totalSessions = records.length;
    const totalFaces   = records.reduce((s, r) => s + (r.total_faces || 0), 0);
    const totalMaskOn  = records.reduce((s, r) => s + (r.mask_on || 0), 0);
    const totalNoMask  = records.reduce((s, r) => s + (r.no_mask || 0), 0);
    const avgCompliance = totalFaces > 0
      ? ((totalMaskOn / totalFaces) * 100)
      : (records.reduce((s, r) => s + (r.compliance || 0), 0) / records.length);

    // ── Compliance Grade ─────────────────────────────────────
    const score = Math.round(avgCompliance);
    let gradeLabel, gradeClass, gradeTitle, gradeSub, recs;
    if (score >= 95)      { gradeLabel = 'A+'; gradeClass = 'A-plus'; gradeTitle = 'Excellent Compliance'; gradeSub = 'Top-tier safety standard maintained'; recs = ['Keep monitoring regularly to maintain standard']; }
    else if (score >= 90) { gradeLabel = 'A';  gradeClass = 'A';      gradeTitle = 'Very Good Compliance'; gradeSub = 'Strong performance, minor room to improve'; recs = ['Increase monitoring during peak hours']; }
    else if (score >= 80) { gradeLabel = 'B';  gradeClass = 'B';      gradeTitle = 'Good Compliance';      gradeSub = 'Meeting acceptable safety thresholds'; recs = ['Schedule awareness campaigns', 'Monitor high-traffic zones']; }
    else if (score >= 70) { gradeLabel = 'C';  gradeClass = 'C';      gradeTitle = 'Fair Compliance';      gradeSub = 'Below target — corrective action needed'; recs = ['Increase enforcement frequency', 'Conduct compliance training']; }
    else if (score >= 55) { gradeLabel = 'D';  gradeClass = 'D';      gradeTitle = 'Poor Compliance';      gradeSub = 'Significant violations detected'; recs = ['Immediate policy review required', 'Install more monitoring zones', 'Review footage for repeat offenders']; }
    else                  { gradeLabel = 'F';  gradeClass = 'F';      gradeTitle = 'Critical Non-compliance'; gradeSub = 'Urgent intervention required'; recs = ['Escalate to management', 'Deploy additional monitors', 'Implement strict access controls']; }

    // ── Populate KPI Strip ────────────────────────────────────
    const setText = (id, val) => { const el = DOM.query('#' + id); if (el) el.textContent = val; };
    setText('an-total-sessions', totalSessions.toLocaleString());
    setText('an-total-faces',    totalFaces.toLocaleString());
    setText('an-mask-on',        totalMaskOn.toLocaleString());
    setText('an-no-mask',        totalNoMask.toLocaleString());
    setText('an-avg-compliance', score + '%');
    setText('an-grade',          gradeLabel);

    // ── Donut chart data ──────────────────────────────────────
    setText('donut-pct',           score + '%');
    setText('legend-mask-on-val',  totalMaskOn.toLocaleString());
    setText('legend-no-mask-val',  totalNoMask.toLocaleString());
    setText('legend-total-val',    totalFaces.toLocaleString());

    // ── Grade badge ───────────────────────────────────────────
    const gradeBadge = DOM.query('#grade-badge');
    if (gradeBadge) {
      gradeBadge.textContent = gradeLabel;
      gradeBadge.className = 'grade-badge ' + gradeClass;
    }
    setText('grade-title', gradeTitle);
    setText('grade-sub',   gradeSub);
    const gradeBar = DOM.query('#grade-bar');
    if (gradeBar) gradeBar.style.width = score + '%';

    const recsContainer = DOM.query('#grade-recommendations');
    if (recsContainer) {
      recsContainer.innerHTML = recs.map(r =>
        `<div class="grade-rec">${r}</div>`
      ).join('');
    }

    // ── Source breakdown table ────────────────────────────────
    const bySource = {};
    records.forEach(r => {
      const src = (r.source || 'unknown').toLowerCase();
      if (!bySource[src]) bySource[src] = { sessions: 0, faces: 0, maskOn: 0, noMask: 0 };
      bySource[src].sessions++;
      bySource[src].faces  += (r.total_faces || 0);
      bySource[src].maskOn += (r.mask_on || 0);
      bySource[src].noMask += (r.no_mask || 0);
    });

    const tbody = DOM.query('#source-breakdown-body');
    if (tbody) {
      const srcIcons = { camera: '📷', image: '🖼', video: '🎬', unknown: '❓' };
      const rows = Object.entries(bySource).map(([src, s]) => {
        const compliance = s.faces > 0 ? Math.round((s.maskOn / s.faces) * 100) : 0;
        const compColor = compliance >= 90 ? '#10b981' : compliance >= 70 ? '#f59e0b' : '#ef4444';
        return `<tr>
          <td><span class="badge ${src}" style="text-transform:capitalize;">${srcIcons[src] || '🔍'} ${src}</span></td>
          <td>${s.sessions}</td>
          <td>${s.faces.toLocaleString()}</td>
          <td style="color:#10b981;font-weight:600;">${s.maskOn.toLocaleString()}</td>
          <td style="color:#ef4444;font-weight:600;">${s.noMask.toLocaleString()}</td>
          <td><span style="font-weight:700;color:${compColor};">${compliance}%</span></td>
          <td>
            <div class="src-bar-wrap">
              <div class="src-bar" style="width:${compliance}%;background:${compColor};"></div>
            </div>
          </td>
        </tr>`;
      });
      tbody.innerHTML = rows.length > 0 ? rows.join('') :
        '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:20px;">No data</td></tr>';
    }

    // ── Draw donut chart ──────────────────────────────────────
    const donutCanvas = DOM.query('#distribution-chart');
    if (donutCanvas) {
      const ctx = donutCanvas.getContext('2d');
      AnalyticsCharts.drawDonut(ctx, [
        { label: 'Mask On', value: totalMaskOn,  color: '#10b981' },
        { label: 'No Mask', value: totalNoMask,  color: '#ef4444' }
      ], 150, 150);
    }

    // ── Sort records chronologically for charts ───────────────
    const sorted = [...records].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // ── Draw compliance area chart ────────────────────────────
    const complianceCanvas = DOM.query('#compliance-chart');
    if (complianceCanvas) {
      const W = complianceCanvas.offsetWidth || 600;
      complianceCanvas.width  = W;
      complianceCanvas.height = 220;
      const ctx = complianceCanvas.getContext('2d');
      const compData = sorted.map(r => ({
        label: Format.time ? Format.time(r.timestamp) : new Date(r.timestamp).toLocaleDateString(),
        compliance: Math.round(r.compliance || 0),
        noMask: r.no_mask || 0
      }));
      AnalyticsCharts.drawAreaChart(ctx, compData, W, 220);
    }

    // ── Draw volume bar chart ─────────────────────────────────
    const volumeCanvas = DOM.query('#volume-chart');
    if (volumeCanvas) {
      const W2 = volumeCanvas.offsetWidth || 600;
      volumeCanvas.width  = W2;
      volumeCanvas.height = 150;
      const ctx = volumeCanvas.getContext('2d');
      const volData = sorted.map(r => ({
        label: Format.time ? Format.time(r.timestamp) : new Date(r.timestamp).toLocaleDateString(),
        value: r.total_faces || 0
      }));
      AnalyticsCharts.drawBarChart(ctx, volData, W2, 150);
    }

  } catch (error) {
    console.error('Analytics load failed:', error);
    if (typeof notifier !== 'undefined') {
      notifier.error('Failed to load analytics data', 3000);
    }
  }
}

// ── Export analytics as CSV ─────────────────────────────────────────────────
window.exportAnalyticsCSV = async function() {
  try {
    const { data } = await MaskAPI.getDetections(1, 500);
    const records = data.records || [];
    if (records.length === 0) {
      if (typeof notifier !== 'undefined') notifier.info('No data to export', 2000);
      return;
    }
    const headers = ['ID', 'Timestamp', 'Source', 'Total Faces', 'Mask On', 'No Mask', 'Compliance %'];
    const rows = records.map(r => [
      r.id, r.timestamp, r.source, r.total_faces || 0,
      r.mask_on || 0, r.no_mask || 0,
      (r.compliance || 0).toFixed(1)
    ]);
    const csv = [headers, ...rows].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `maskdetect-analytics-${Date.now()}.csv`;
    a.click(); URL.revokeObjectURL(url);
    if (typeof notifier !== 'undefined') notifier.success('CSV exported successfully', 2000);
  } catch (e) {
    if (typeof notifier !== 'undefined') notifier.error('Export failed', 2000);
  }
};

// ── ANALYTICS CHART ENGINE ──────────────────────────────────────────────────
const AnalyticsCharts = {

  // Detect if dark mode is active
  isDark() {
    return document.body.classList.contains('dark-mode');
  },

  colors() {
    return this.isDark()
      ? { text: '#94a3b8', grid: 'rgba(255,255,255,0.06)', bg: '#0f1f36', label: '#64748b' }
      : { text: '#64748b', grid: '#f1f5f9', bg: '#ffffff', label: '#94a3b8' };
  },

  // Smooth area + line chart for compliance over time
  drawAreaChart(ctx, data, W, H) {
    if (!data || data.length === 0) return;
    const dark = this.isDark();
    const c = this.colors();

    ctx.clearRect(0, 0, W, H);

    const PAD_L = 44, PAD_R = 16, PAD_T = 12, PAD_B = 36;
    const cW = W - PAD_L - PAD_R;
    const cH = H - PAD_T - PAD_B;

    // Y scale: 0–100 (compliance percentage)
    const yMax = 100;

    // Draw grid lines + Y labels
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const yVal = (yMax / 5) * i;
      const y = PAD_T + cH - (yVal / yMax) * cH;
      ctx.strokeStyle = c.grid;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = c.label;
      ctx.fillText(yVal + '%', PAD_L - 6, y + 4);
    }

    // X labels (show up to 8 to avoid crowding)
    const maxLabels = Math.min(data.length, 8);
    const labelStep = Math.ceil(data.length / maxLabels);
    ctx.textAlign = 'center';
    ctx.fillStyle = c.label;
    data.forEach((d, i) => {
      if (i % labelStep !== 0 && i !== data.length - 1) return;
      const x = PAD_L + (i / Math.max(data.length - 1, 1)) * cW;
      const lbl = d.label.length > 8 ? d.label.slice(-5) : d.label;
      ctx.fillText(lbl, x, H - PAD_B + 14);
    });

    // Draw filled area (compliance)
    const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + cH);
    grad.addColorStop(0, dark ? 'rgba(16,185,129,0.28)' : 'rgba(16,185,129,0.15)');
    grad.addColorStop(1, dark ? 'rgba(16,185,129,0.02)' : 'rgba(16,185,129,0.01)');

    ctx.beginPath();
    data.forEach((d, i) => {
      const x = PAD_L + (i / Math.max(data.length - 1, 1)) * cW;
      const y = PAD_T + cH - (Math.min(d.compliance, 100) / yMax) * cH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    // Close area at bottom
    const lastX = PAD_L + cW;
    ctx.lineTo(lastX, PAD_T + cH);
    ctx.lineTo(PAD_L, PAD_T + cH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Draw compliance line
    ctx.beginPath();
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    data.forEach((d, i) => {
      const x = PAD_L + (i / Math.max(data.length - 1, 1)) * cW;
      const y = PAD_T + cH - (Math.min(d.compliance, 100) / yMax) * cH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw data points on compliance line
    data.forEach((d, i) => {
      const x = PAD_L + (i / Math.max(data.length - 1, 1)) * cW;
      const y = PAD_T + cH - (Math.min(d.compliance, 100) / yMax) * cH;
      ctx.beginPath();
      ctx.arc(x, y, data.length > 30 ? 2 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#10b981';
      ctx.fill();
      ctx.strokeStyle = dark ? '#0f1f36' : '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // Draw violations as red dots on secondary axis
    if (data.some(d => d.noMask > 0)) {
      const maxNoMask = Math.max(...data.map(d => d.noMask), 1);
      data.forEach((d, i) => {
        if (d.noMask <= 0) return;
        const x = PAD_L + (i / Math.max(data.length - 1, 1)) * cW;
        // Map noMask to top 30% of chart
        const normY = PAD_T + cH * 0.10 + (d.noMask / maxNoMask) * cH * 0.30;
        const y = PAD_T + cH - normY + PAD_T;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(239,68,68,0.75)';
        ctx.fill();
      });
    }
  },

  // Grouped bar chart for face volume
  drawBarChart(ctx, data, W, H) {
    if (!data || data.length === 0) return;
    const dark = this.isDark();
    const c = this.colors();

    ctx.clearRect(0, 0, W, H);
    const PAD_L = 40, PAD_R = 12, PAD_T = 10, PAD_B = 30;
    const cW = W - PAD_L - PAD_R;
    const cH = H - PAD_T - PAD_B;
    const maxVal = Math.max(...data.map(d => d.value), 1);

    // Grid + Y axis
    ctx.font = '10px Inter, sans-serif';
    for (let i = 0; i <= 4; i++) {
      const yVal = Math.round((maxVal / 4) * i);
      const y = PAD_T + cH - (yVal / maxVal) * cH;
      ctx.strokeStyle = c.grid;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = c.label;
      ctx.textAlign = 'right';
      ctx.fillText(yVal, PAD_L - 5, y + 4);
    }

    // Bars
    const barW = Math.max(4, (cW / data.length) * 0.65);
    const gapW = (cW / data.length) * 0.35;
    const maxLabels = Math.min(data.length, 10);
    const labelStep = Math.ceil(data.length / maxLabels);

    data.forEach((d, i) => {
      const x = PAD_L + (i / data.length) * cW + gapW / 2;
      const barH = (d.value / maxVal) * cH;
      const y = PAD_T + cH - barH;

      // Bar gradient
      const grad = ctx.createLinearGradient(x, y, x, y + barH);
      grad.addColorStop(0, '#3b82f6');
      grad.addColorStop(1, 'rgba(59,130,246,0.4)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, barW, barH, [3, 3, 0, 0]) : ctx.rect(x, y, barW, barH);
      ctx.fill();

      // X labels
      if (i % labelStep === 0 || i === data.length - 1) {
        const lbl = d.label.length > 6 ? d.label.slice(-5) : d.label;
        ctx.fillStyle = c.label;
        ctx.textAlign = 'center';
        ctx.fillText(lbl, x + barW / 2, H - PAD_B + 14);
      }
    });
  },

  // Donut chart with center hole
  drawDonut(ctx, data, W, H) {
    ctx.clearRect(0, 0, W, H);
    const total = data.reduce((s, d) => s + d.value, 0);
    if (total === 0) {
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No data', W / 2, H / 2);
      return;
    }

    const cx = W / 2, cy = H / 2;
    const outerR = Math.min(W, H) / 2 - 6;
    const innerR = outerR * 0.58;  // donut hole size
    let startAngle = -Math.PI / 2;

    // Draw segments with slight gap
    data.forEach(d => {
      const sweep = (d.value / total) * Math.PI * 2;
      const endAngle = startAngle + sweep;
      const gap = 0.03;

      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle + gap, endAngle - gap);
      ctx.arc(cx, cy, innerR, endAngle - gap, startAngle + gap, true);
      ctx.closePath();
      ctx.fillStyle = d.color;
      ctx.fill();

      startAngle = endAngle;
    });

    // Clear center for donut effect
    ctx.beginPath();
    ctx.arc(cx, cy, innerR - 1, 0, Math.PI * 2);
    ctx.fillStyle = this.isDark() ? 'var(--bg-primary, #0f1f36)' : '#ffffff';
    // Don't actually fill — just rely on the hole drawn above
  }
};


// ── CONNECTION MONITORING ──────────────────────────────────────────────────
function updateConnectionUI(isOnline) {
  try {
    const pill = DOM.query('#conn-pill');
    const hudPill = DOM.query('#hud-conn-status');

    if (!pill) return;

    if (isOnline) {
      // Remove classes individually to avoid space-separated string error
      if (pill.classList.contains('checking')) pill.classList.remove('checking');
      if (pill.classList.contains('offline')) pill.classList.remove('offline');
      pill.classList.add('online');
      const connText = DOM.query('#conn-text');
      if (connText) DOM.text(connText, 'Online');

      if (hudPill) {
        if (hudPill.classList.contains('red')) hudPill.classList.remove('red');
        hudPill.classList.add('green');
        const hudText = DOM.query('#hud-conn-text');
        if (hudText) hudText.textContent = 'Online';
      }
    } else {
      if (pill.classList.contains('checking')) pill.classList.remove('checking');
      if (pill.classList.contains('online')) pill.classList.remove('online');
      pill.classList.add('offline');
      const connText = DOM.query('#conn-text');
      if (connText) DOM.text(connText, 'Offline');

      if (hudPill) {
        if (hudPill.classList.contains('green')) hudPill.classList.remove('green');
        hudPill.classList.add('red');
        const hudText = DOM.query('#hud-conn-text');
        if (hudText) hudText.textContent = 'Offline';
      }
    }
  } catch (e) {
    console.error('Error updating connection UI:', e);
  }
}

// ── EVENT LISTENERS ────────────────────────────────────────────────────────
function setupEventListeners() {
  try {
    // Connection events
    if (document.removeEventListener) {
      try {
        document.removeEventListener('connection:online', null);
      } catch (e) {
        // Ignore error
      }
    }
    document.addEventListener('connection:online', (e) => {
      updateConnectionUI(true);
      const data = e.detail;
      if (data && data.model === 'loaded') {
        const modelPill = DOM.query('#model-pill');
        if (modelPill) DOM.addClass(modelPill, 'online');
        const modelText = DOM.query('#model-text');
        if (modelText) DOM.text(modelText, 'Loaded');
      }
    });

    document.addEventListener('connection:offline', (e) => {
      updateConnectionUI(false);
    });

    // Theme changes
    document.addEventListener('theme:changed', (e) => {
      const btn = DOM.query('#theme-btn');
      if (btn && e.detail) {
        btn.textContent = e.detail.theme === 'dark' ? '☀️ Light' : '🌙 Dark';
      }
    });
  } catch (e) {
    console.error('Error setting up event listeners:', e);
  }
}

// ── UTILITY FUNCTIONS ──────────────────────────────────────────────────────
function playViolationSound() {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.connect(gain);
  gain.connect(audioContext.destination);

  oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
  oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
  gain.gain.setValueAtTime(0.3, audioContext.currentTime);
  gain.gain.setValueAtTime(0, audioContext.currentTime + 0.2);

  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.2);
}

function saveFrame() {
  const canvas = DOM.query('#overlay');
  if (canvas) {
    canvas.toBlob(blob => {
      downloadFile(blob, `frame-${Date.now()}.png`);
    });
  }
}

function downloadVideoResult(filename) {
  window.open(`${API_BASE}/video/download/${filename}?download=1`, '_blank');
}

function loadPreferences() {
  const audioAlerts = Storage.get('audio-alerts', true);
  const autoCapture = Storage.get('auto-capture', true);

  const audioToggle = DOM.query('#audio-alerts');
  const captureToggle = DOM.query('#auto-capture');

  if (audioToggle) audioToggle.checked = audioAlerts;
  if (captureToggle) captureToggle.checked = autoCapture;

  // Save preference changes
  if (audioToggle) {
    audioToggle.addEventListener('change', (e) => {
      Storage.set('audio-alerts', e.target.checked);
    });
  }
  if (captureToggle) {
    captureToggle.addEventListener('change', (e) => {
      Storage.set('auto-capture', e.target.checked);
    });
  }
}

console.log('🎯 MaskDetect v2.0 - Enterprise Edition Loaded');

// ── FALLBACK STUBS (If functions don't exist) ─────────────────────────────
if (typeof updateDashboard === 'undefined') {
  window.updateDashboard = async () => {
    console.log('updateDashboard called (stub)');
  };
}

if (typeof loadAnalytics === 'undefined') {
  window.loadAnalytics = async () => {
    console.log('loadAnalytics called (stub)');
  };
}

if (typeof fileToBase64 === 'undefined') {
  window.fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

if (typeof downloadFile === 'undefined') {
  window.downloadFile = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
}

// No confirm override needed to avoid recursion and stack overflow

// ── GROQ AI DASHBOARD UTILITIES ─────────────────────────────────────────────
window.saveGroqKey = function() {
  const input = document.getElementById('groq-key-input');
  if (input) {
    const key = input.value.trim();
    localStorage.setItem('groq_api_key', key);
    appState.groqKey = key;
    if (typeof notifier !== 'undefined') {
      notifier.success('Groq API Key saved successfully! ✅', 3000);
    }
  }
};

window.toggleCopilot = function() {
  const chatWindow = document.getElementById('copilot-chat-window');
  if (chatWindow) {
    const isHidden = chatWindow.style.display === 'none';
    chatWindow.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) {
      const chatLog = document.getElementById('copilot-chat-log');
      if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
    }
  }
};

window.sendCopilotMessage = async function() {
  const input = document.getElementById('copilot-input');
  const chatLog = document.getElementById('copilot-chat-log');
  if (!input || !chatLog) return;
  
  const text = input.value.trim();
  if (!text) return;
  
  input.value = '';
  
  // Render User Message
  const userMsg = DOM.create('div', {
    style: {
      alignSelf: 'flex-end',
      background: 'var(--primary)',
      color: 'white',
      padding: '10px 14px',
      borderRadius: '12px 12px 0 12px',
      maxWidth: '85%',
      lineHeight: '1.4'
    }
  }, [document.createTextNode(text)]);
  chatLog.appendChild(userMsg);
  chatLog.scrollTop = chatLog.scrollHeight;
  
  // Render Loading Indicator
  const loaderMsg = DOM.create('div', {
    style: {
      alignSelf: 'flex-start',
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border)',
      padding: '10px 14px',
      borderRadius: '12px 12px 12px 0',
      maxWidth: '85%',
      color: 'var(--text-secondary)'
    }
  }, [
    DOM.create('span', { class: 'spinner small', style: { display: 'inline-block', marginRight: '8px', verticalAlign: 'middle' } }),
    document.createTextNode('Copilot is querying database...')
  ]);
  chatLog.appendChild(loaderMsg);
  chatLog.scrollTop = chatLog.scrollHeight;
  
  try {
    const { data } = await MaskAPI.aiQuery(text, appState.groqKey);
    chatLog.removeChild(loaderMsg);
    
    const botMsg = DOM.create('div', {
      style: {
        alignSelf: 'flex-start',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        padding: '12px 14px',
        borderRadius: '12px 12px 12px 0',
        maxWidth: '85%',
        color: 'var(--text-primary)',
        lineHeight: '1.4'
      }
    });
    botMsg.innerHTML = formatMarkdownText(data.answer);
    chatLog.appendChild(botMsg);
  } catch (error) {
    chatLog.removeChild(loaderMsg);
    const errorMsg = DOM.create('div', {
      style: {
        alignSelf: 'flex-start',
        background: 'rgba(239, 68, 68, 0.1)',
        border: '1px solid rgba(239, 68, 68, 0.25)',
        color: 'var(--danger)',
        padding: '10px 14px',
        borderRadius: '12px 12px 12px 0',
        maxWidth: '85%',
        lineHeight: '1.4'
      }
    }, [document.createTextNode(`Error: ${error.message}`)]);
    chatLog.appendChild(errorMsg);
  }
  
  chatLog.scrollTop = chatLog.scrollHeight;
};

window.generateAISummary = async function() {
  const container = document.getElementById('ai-summary-container');
  const btn = document.getElementById('generate-ai-summary-btn');
  if (!container || !btn) return;
  
  btn.disabled = true;
  DOM.empty(container);
  
  container.appendChild(DOM.create('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 0',
      gap: '12px',
      color: 'var(--text-secondary)'
    }
  }, [
    DOM.create('div', { class: 'spinner' }),
    DOM.create('div', { style: { fontSize: '13px', fontWeight: '500' } }, ['Gemini is compiling audit report...'])
  ]));
  
  try {
    const { data } = await MaskAPI.aiSummary(appState.groqKey);
    DOM.empty(container);
    
    const reportWrap = DOM.create('div', {
      style: {
        padding: '8px 4px',
        color: 'var(--text-primary)'
      }
    });
    reportWrap.innerHTML = formatMarkdownText(data.summary);
    
    if (data.demo_mode) {
      const notice = DOM.create('div', {
        style: {
          fontSize: '11px',
          color: 'var(--warning)',
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.25)',
          padding: '8px 12px',
          borderRadius: '6px',
          marginTop: '16px'
        }
      }, [document.createTextNode('⚠️ Running in AI Demo Mode. Add a Groq API Key in Settings to link live SQLite statistics.')]);
      reportWrap.appendChild(notice);
    }
    
    container.appendChild(reportWrap);
  } catch (error) {
    DOM.empty(container);
    container.appendChild(DOM.create('div', {
      style: {
        color: 'var(--danger)',
        padding: '20px',
        textAlign: 'center',
        fontSize: '13px'
      }
    }, [document.createTextNode(`Failed to generate summary: ${error.message}`)]));
  } finally {
    btn.disabled = false;
  }
};

window.loadViolationsFeed = async function() {
  const container = document.getElementById('violations-container');
  const countBadge = document.getElementById('violations-count');
  if (!container) return;
  
  try {
    const { data } = await MaskAPI.getViolations(1, 20);
    const records = data.records || [];
    
    if (countBadge) countBadge.textContent = data.total || 0;
    
    DOM.empty(container);
    
    if (records.length === 0) {
      container.innerHTML = '<div style="color: var(--text-tertiary); font-size: 12px; text-align: center; padding: 20px 0;">No active violations recorded</div>';
      return;
    }
    
    records.forEach(violation => {
      let aiBadgeClass = 'neutral';
      if (violation.ai_status === 'Confirmed Violation') aiBadgeClass = 'danger';
      else if (violation.ai_status?.startsWith('Excused')) aiBadgeClass = 'success';
      else if (violation.ai_status === 'Pending') aiBadgeClass = 'warning';
      
      const row = DOM.create('div', {
        class: 'face-row',
        style: {
          display: 'flex',
          gap: '12px',
          padding: '12px 0',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          alignItems: 'center'
        }
      }, [
        DOM.create('div', {
          style: {
            width: '45px',
            height: '45px',
            borderRadius: '6px',
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid var(--border)',
            flexShrink: 0
          }
        }, [
          DOM.create('img', {
            src: `${API_BASE}/video/download/${violation.image_file}`,
            style: { width: '100%', height: '100%', objectFit: 'cover' }
          })
        ]),
        
        DOM.create('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' } }, [
          DOM.create('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
            `Violation #${violation.id}`,
            DOM.create('span', { style: { fontSize: '10px', color: 'var(--text-tertiary)' } }, [Format.time(violation.timestamp)])
          ]),
          DOM.create('div', { style: { fontSize: '11px', color: 'var(--text-secondary)' } }, [
            `Source: ${violation.source.toUpperCase()} | Conf: ${Math.round(violation.confidence * 100)}%`
          ]),
          DOM.create('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' } }, [
            DOM.create('span', { class: `badge ${aiBadgeClass}`, style: { fontSize: '10px', padding: '2px 6px' } }, [violation.ai_status]),
            violation.ai_reasoning ? 
              DOM.create('span', { style: { fontSize: '11px', color: 'var(--text-tertiary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '180px' }, title: violation.ai_reasoning }, [violation.ai_reasoning]) : 
              DOM.create('button', {
                class: 'btn btn-ghost',
                style: { padding: '2px 6px', fontSize: '10px', minHeight: 'auto', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.03)' },
                onclick: `triggerAIAnalysis(${violation.id})`
              }, ['Verify Context'])
          ])
        ])
      ]);
      
      container.appendChild(row);
    });
  } catch (error) {
    console.error('Failed to load violations feed:', error);
  }
};

window.triggerAIAnalysis = async function(violationId) {
  if (typeof notifier !== 'undefined') {
    notifier.info(`AI analysis triggered for violation #${violationId}...`, 2000);
  }
  try {
    await MaskAPI.verifyViolation(violationId, appState.groqKey);
    loadViolationsFeed();
    if (typeof notifier !== 'undefined') {
      notifier.success(`Violation #${violationId} verified successfully! ✅`, 3000);
    }
  } catch (error) {
    if (typeof notifier !== 'undefined') {
      notifier.error(`AI verification failed: ${error.message}`, 4000);
    }
  }
};

function formatMarkdownText(text) {
  if (!text) return '';
  let html = text;
  
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
    
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`(.*?)`/g, '<code style="background: rgba(255,255,255,0.08); padding: 2px 4px; border-radius: 4px; font-family: monospace;">$1</code>');
  
  html = html.split('\n').map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      return `<li style="margin-left: 16px; margin-top: 4px;">${trimmed.substring(2)}</li>`;
    }
    return line;
  }).join('\n');
  
  html = html.replace(/\n/g, '<br>');
  return html;
}
