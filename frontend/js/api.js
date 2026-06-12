/**
 * MASKDETECT - API Client
 * Unified HTTP client for all backend communication
 */

const API_BASE = localStorage.getItem('API_BASE') || 'http://localhost:5000';

// ── HTTP CLIENT ──────────────────────────────────────────────────────────────
class APIClient {
  constructor(baseURL = API_BASE) {
    this.baseURL = baseURL;
    this.timeout = 30000;
    this.interceptors = { request: [], response: [], error: [] };
  }

  /**
   * Perform HTTP request
   */
  async request(method, path, options = {}) {
    const url = `${this.baseURL}${path}`;
    const config = {
      method,
      headers: options.headers || {},
      ...options
    };

    // Add default headers
    if (!config.headers['Content-Type'] && !(config.body instanceof FormData)) {
      config.headers['Content-Type'] = 'application/json';
    }

    // Run request interceptors
    for (const interceptor of this.interceptors.request) {
      await interceptor(config);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, { ...config, signal: controller.signal });
      clearTimeout(timeoutId);

      let data;
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else if (contentType?.includes('text')) {
        data = await response.text();
      } else if (contentType?.includes('application/pdf')) {
        data = await response.blob();
      } else {
        data = await response.text();
      }

      // Run response interceptors
      for (const interceptor of this.interceptors.response) {
        await interceptor(response, data);
      }

      if (!response.ok) {
        const error = new Error(data?.error || `HTTP ${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return { status: response.status, data };
    } catch (error) {
      // Run error interceptors
      for (const interceptor of this.interceptors.error) {
        await interceptor(error);
      }
      throw error;
    }
  }

  get(path, options) {
    return this.request('GET', path, options);
  }

  post(path, body, options = {}) {
    return this.request('POST', path, {
      ...options,
      body: body instanceof FormData ? body : JSON.stringify(body)
    });
  }

  put(path, body, options = {}) {
    return this.request('PUT', path, {
      ...options,
      body: JSON.stringify(body)
    });
  }

  delete(path, options = {}) {
    return this.request('DELETE', path, options);
  }

  /**
   * Stream response as NDJSON (newline-delimited JSON)
   */
  async streamNDJSON(path, body, onData) {
    const url = `${this.baseURL}${path}`;
    const headers = {};
    if (!(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: body instanceof FormData ? body : JSON.stringify(body)
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            onData(data);
          } catch (e) {
            console.error('NDJSON parse error:', e, line);
          }
        }
      }
    }

    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer);
        onData(data);
      } catch (e) {
        console.error('NDJSON parse error:', e, buffer);
      }
    }
  }
}

// ── SINGLETON INSTANCE ───────────────────────────────────────────────────────
const api = new APIClient();

// ── MASK DETECTION ENDPOINTS ─────────────────────────────────────────────────
const MaskAPI = {
  /**
   * Check backend health
   */
  health() {
    return api.get('/health');
  },

  /**
   * Get system statistics
   */
  stats() {
    return api.get('/stats');
  },

  /**
   * Predict on single frame (camera)
   */
  predictFrame(base64Image) {
    return api.post('/predict/frame', { image: base64Image });
  },

  /**
   * Predict on static image
   */
  predictImage(base64Image) {
    return api.post('/predict/image', { image: base64Image });
  },

  /**
   * Analyze video file with streaming progress
   */
  predictVideo(file, onProgress) {
    const formData = new FormData();
    formData.append('video', file);
    return api.streamNDJSON('/predict/video', formData, onProgress);
  },

  /**
   * Save camera session
   */
  saveCameraSession(totalFaces, maskOn, noMask) {
    return api.post('/camera/session', {
      total_faces: totalFaces,
      mask_on: maskOn,
      no_mask: noMask
    });
  },

  /**
   * Get detection history
   */
  getDetections(page = 1, perPage = 20, source = '') {
    const params = new URLSearchParams({ page, per_page: perPage });
    if (source) params.append('source', source);
    return api.get(`/detections?${params}`);
  },

  /**
   * Clear all detection history
   */
  clearDetections() {
    return api.delete('/detections');
  },

  /**
   * Export detections as CSV
   */
  async exportCSV() {
    const { data } = await api.get('/detections/export/csv');
    downloadFile(new Blob([data], { type: 'text/csv' }), 'mask_detections.csv');
  },

  /**
   * Export detections as PDF
   */
  async exportPDF() {
    const { data } = await api.get('/detections/export/pdf');
    downloadFile(data, 'mask_detection_report.pdf');
  },

  /**
   * Download annotated video
   */
  downloadVideo(filename) {
    return api.get(`/video/download/${filename}?download=1`);
  },

  /**
   * Send email alert
   */
  sendAlert(to, smtpHost, smtpPort, smtpUser, smtpPass, subject, body) {
    return api.post('/alert/email', {
      to, smtp_host: smtpHost, smtp_port: smtpPort,
      smtp_user: smtpUser, smtp_pass: smtpPass,
      subject, body
    });
  }
};

// ── CONNECTION STATE MANAGER ─────────────────────────────────────────────────
class ConnectionManager {
  constructor() {
    this.isOnline = false;
    this.isModelReady = false;
    this.lastCheck = null;
    this.checkInterval = null;
  }

  /**
   * Start monitoring connection
   */
  startMonitoring(interval = 5000) {
    this.checkInterval = setInterval(() => this.checkConnection(), interval);
    this.checkConnection(); // Initial check
  }

  /**
   * Stop monitoring connection
   */
  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check backend connection
   */
  async checkConnection() {
    try {
      const { data } = await MaskAPI.health();
      this.isOnline = true;
      this.isModelReady = data.model === 'loaded' || data.demo_mode;
      this.lastCheck = new Date();
      document.dispatchEvent(new CustomEvent('connection:online', { detail: data }));
      return data;
    } catch (error) {
      this.isOnline = false;
      this.isModelReady = false;
      this.lastCheck = new Date();
      document.dispatchEvent(new CustomEvent('connection:offline', { detail: error }));
      return null;
    }
  }

  /**
   * Check if backend is available
   */
  async isAvailable() {
    const data = await this.checkConnection();
    return data !== null;
  }

  /**
   * Get status summary
   */
  getStatus() {
    return {
      online: this.isOnline,
      modelReady: this.isModelReady,
      lastCheck: this.lastCheck
    };
  }
}

// ── SINGLETON CONNECTION MANAGER ─────────────────────────────────────────────
const connectionManager = new ConnectionManager();

// ── BATCH OPERATIONS ─────────────────────────────────────────────────────────
const BatchOps = {
  /**
   * Process multiple images in parallel
   */
  async processImages(files, concurrency = 3) {
    const results = [];
    const chunks = Arr.chunk(files, concurrency);

    for (const chunk of chunks) {
      const promises = chunk.map(async (file) => {
        try {
          const base64 = await fileToBase64(file);
          const result = await MaskAPI.predictImage(base64);
          return { file: file.name, success: true, data: result.data };
        } catch (error) {
          return { file: file.name, success: false, error: error.message };
        }
      });

      const chunkResults = await Promise.all(promises);
      results.push(...chunkResults);
    }

    return results;
  }
};

// ── FILE UTILITIES ───────────────────────────────────────────────────────────
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function canvasToBase64(canvas, type = 'image/jpeg', quality = 0.9) {
  return canvas.toDataURL(type, quality);
}

// Export API
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { APIClient, api, MaskAPI, connectionManager, BatchOps, fileToBase64, canvasToBase64 };
}
