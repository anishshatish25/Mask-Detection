/**
 * MASKDETECT - Utility Functions
 * Common helper functions for the application
 */

// ── LOCAL STORAGE ────────────────────────────────────────────────────────────
const Storage = {
  get(key, defaultValue = null) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : defaultValue;
    } catch (e) {
      console.error(`Storage.get("${key}") failed:`, e);
      return defaultValue;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error(`Storage.set("${key}") failed:`, e);
      return false;
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      console.error(`Storage.remove("${key}") failed:`, e);
      return false;
    }
  },

  clear() {
    try {
      localStorage.clear();
      return true;
    } catch (e) {
      console.error('Storage.clear() failed:', e);
      return false;
    }
  }
};

// ── FORMATTING ───────────────────────────────────────────────────────────────
const Format = {
  percentage(value, decimals = 1) {
    return `${Number(value).toFixed(decimals)}%`;
  },

  number(value) {
    return new Intl.NumberFormat('en-US').format(Math.round(value));
  },

  bytes(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
  },

  datetime(isoString) {
    if (!isoString) return '—';
    try {
      return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(new Date(isoString));
    } catch (e) {
      return isoString;
    }
  },

  date(isoString) {
    if (!isoString) return '—';
    try {
      return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }).format(new Date(isoString));
    } catch (e) {
      return isoString;
    }
  },

  time(isoString) {
    if (!isoString) return '—';
    try {
      return new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(new Date(isoString));
    } catch (e) {
      return isoString;
    }
  },

  duration(ms) {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  },

  confidence(value) {
    return `${Math.round(value * 100)}%`;
  }
};

// ── DOM UTILITIES ────────────────────────────────────────────────────────────
const DOM = {
  query(selector) {
    return document.querySelector(selector);
  },

  queryAll(selector) {
    return document.querySelectorAll(selector);
  },

  create(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === 'class') {
        el.className = value;
      } else if (key === 'style') {
        Object.assign(el.style, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        el.setAttribute(key, value);
      }
    });
    children.forEach(child => {
      if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child));
      } else if (typeof child === 'number') {
        el.appendChild(document.createTextNode(String(child)));
      } else if (child && child.nodeType) {
        el.appendChild(child);
      }
    });
    return el;
  },

  html(element, html) {
    if (typeof html === 'undefined') return element.innerHTML;
    element.innerHTML = html;
    return element;
  },

  text(element, text) {
    if (typeof text === 'undefined') return element.textContent;
    element.textContent = text;
    return element;
  },

  addClass(element, ...classes) {
    element.classList.add(...classes);
    return element;
  },

  removeClass(element, ...classes) {
    element.classList.remove(...classes);
    return element;
  },

  toggleClass(element, className) {
    element.classList.toggle(className);
    return element;
  },

  hasClass(element, className) {
    return element.classList.contains(className);
  },

  setAttr(element, attrs) {
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === null) {
        element.removeAttribute(key);
      } else {
        element.setAttribute(key, value);
      }
    });
    return element;
  },

  getAttr(element, attr) {
    return element.getAttribute(attr);
  },

  show(element) {
    element.classList.remove('hidden');
    return element;
  },

  hide(element) {
    element.classList.add('hidden');
    return element;
  },

  toggle(element, show) {
    if (show === undefined) {
      element.classList.toggle('hidden');
    } else if (show) {
      DOM.show(element);
    } else {
      DOM.hide(element);
    }
    return element;
  },

  on(element, event, handler) {
    element.addEventListener(event, handler);
    return () => element.removeEventListener(event, handler);
  },

  off(element, event, handler) {
    element.removeEventListener(event, handler);
    return element;
  },

  emit(element, eventName, detail = {}) {
    element.dispatchEvent(new CustomEvent(eventName, { detail }));
    return element;
  },

  empty(element) {
    element.innerHTML = '';
    return element;
  },

  append(element, ...children) {
    children.forEach(child => {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else if (child) {
        element.appendChild(child);
      }
    });
    return element;
  }
};

// ── ARRAY UTILITIES ──────────────────────────────────────────────────────────
const Arr = {
  chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  },

  unique(array, key) {
    if (!key) return [...new Set(array)];
    const seen = new Set();
    return array.filter(item => {
      const val = item[key];
      if (seen.has(val)) return false;
      seen.add(val);
      return true;
    });
  },

  groupBy(array, key) {
    return array.reduce((acc, item) => {
      const group = item[key];
      if (!acc[group]) acc[group] = [];
      acc[group].push(item);
      return acc;
    }, {});
  },

  sumBy(array, key) {
    return array.reduce((sum, item) => sum + (item[key] || 0), 0);
  },

  maxBy(array, key) {
    return Math.max(...array.map(item => item[key] || 0));
  },

  minBy(array, key) {
    return Math.min(...array.map(item => item[key] || 0));
  },

  sortBy(array, key, ascending = true) {
    return [...array].sort((a, b) => {
      const aVal = a[key];
      const bVal = b[key];
      if (aVal < bVal) return ascending ? -1 : 1;
      if (aVal > bVal) return ascending ? 1 : -1;
      return 0;
    });
  }
};

// ── DATE/TIME UTILITIES ──────────────────────────────────────────────────────
const DateTime = {
  now() {
    return new Date();
  },

  toISO(date = new Date()) {
    return date.toISOString();
  },

  fromISO(isoString) {
    return new Date(isoString);
  },

  addHours(date, hours) {
    const result = new Date(date);
    result.setHours(result.getHours() + hours);
    return result;
  },

  addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  },

  startOfDay(date = new Date()) {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  },

  endOfDay(date = new Date()) {
    const result = new Date(date);
    result.setHours(23, 59, 59, 999);
    return result;
  },

  daysAgo(days) {
    return DateTime.addDays(DateTime.now(), -days);
  }
};

// ── DEBOUNCE & THROTTLE ──────────────────────────────────────────────────────
function debounce(fn, delay = 300) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

function throttle(fn, limit = 300) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// ── VALIDATION ───────────────────────────────────────────────────────────────
const Validate = {
  email(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  },

  url(url) {
    try {
      new URL(url);
      return true;
    } catch (e) {
      return false;
    }
  },

  required(value) {
    return value !== null && value !== undefined && value !== '';
  },

  minLength(value, min) {
    return value && value.length >= min;
  },

  maxLength(value, max) {
    return !value || value.length <= max;
  },

  range(value, min, max) {
    return value >= min && value <= max;
  }
};

// ── COPY TO CLIPBOARD ────────────────────────────────────────────────────────
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    console.error('Copy to clipboard failed:', e);
    return false;
  }
}

// ── DOWNLOAD ─────────────────────────────────────────────────────────────────
function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── HASH/ID GENERATION ───────────────────────────────────────────────────────
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── PROMISE UTILITIES ────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retry(fn, maxAttempts = 3, delayMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === maxAttempts - 1) throw e;
      await sleep(delayMs);
    }
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    Storage, Format, DOM, Arr, DateTime,
    debounce, throttle, Validate, copyToClipboard, downloadFile,
    generateId, generateUUID, sleep, retry
  };
}
