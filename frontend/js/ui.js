/**
 * MASKDETECT - UI Interaction Module
 * Tab switching, modals, notifications, theme switching
 */

// ── THEME MANAGEMENT ──────────────────────────────────────────────────────────
class ThemeManager {
  constructor() {
    this.theme = Storage.get('theme', 'light');
    this.apply(this.theme);
  }

  /**
   * Apply theme
   */
  apply(theme) {
    this.theme = theme;
    Storage.set('theme', theme);

    if (theme === 'dark') {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }

    document.dispatchEvent(new CustomEvent('theme:changed', { detail: { theme } }));
  }

  /**
   * Toggle between light and dark
   */
  toggle() {
    this.apply(this.theme === 'dark' ? 'light' : 'dark');
  }

  /**
   * Get current theme
   */
  getCurrent() {
    return this.theme;
  }

  /**
   * Initialize theme toggle button
   */
  initToggle(selector) {
    const btn = DOM.query(selector);
    if (!btn) return;

    btn.onclick = () => this.toggle();
    this.updateToggleButton(btn);

    document.addEventListener('theme:changed', () => {
      this.updateToggleButton(btn);
    });
  }

  updateToggleButton(btn) {
    btn.textContent = this.theme === 'dark' ? '☀️' : '🌙';
    btn.title = `Switch to ${this.theme === 'dark' ? 'light' : 'dark'} mode`;
  }
}

const themeManager = new ThemeManager();

// ── NOTIFICATION SYSTEM ──────────────────────────────────────────────────────
class NotificationManager {
  constructor() {
    this.container = null;
    this.notifications = [];
  }

  /**
   * Initialize notification container
   */
  init(containerId = 'notifications-container') {
    this.container = DOM.query(`#${containerId}`);
    if (!this.container) {
      this.container = DOM.create('div', { id: containerId });
      this.container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-width: 400px;
      `;
      document.body.appendChild(this.container);
    }
  }

  /**
   * Show notification
   */
  show(message, type = 'info', duration = 4000) {
    if (!this.container) this.init();

    const id = generateId();
    const notification = DOM.create('div', {
      class: `alert alert-${type} animate-slideIn`,
      id: `notif-${id}`
    }, [
      DOM.create('div', { class: 'alert-icon' }, [
        type === 'success' ? '✅' :
          type === 'danger' ? '❌' :
            type === 'warning' ? '⚠️' : 'ℹ️'
      ]),
      DOM.create('div', { class: 'alert-content' }, [message]),
      DOM.create('button', { class: 'alert-close', onclick: `document.getElementById('notif-${id}').remove()` }, ['×'])
    ]);

    this.container.appendChild(notification);
    this.notifications.push(id);

    if (duration > 0) {
      setTimeout(() => {
        notification.remove();
        this.notifications = this.notifications.filter(n => n !== id);
      }, duration);
    }

    return id;
  }

  success(message, duration = 4000) {
    return this.show(message, 'success', duration);
  }

  error(message, duration = 5000) {
    return this.show(message, 'danger', duration);
  }

  warning(message, duration = 4000) {
    return this.show(message, 'warning', duration);
  }

  info(message, duration = 3000) {
    return this.show(message, 'info', duration);
  }
}

const notifier = new NotificationManager();

// ── TAB MANAGEMENT ────────────────────────────────────────────────────────────
class TabManager {
  constructor() {
    this.currentTab = null;
    this.tabs = new Map();
  }

  /**
   * Register tab
   */
  register(tabName, { button, content, onShow, onHide }) {
    this.tabs.set(tabName, { button, content, onShow, onHide });

    if (button) {
      button.addEventListener('click', () => this.switch(tabName));
    }
  }

  /**
   * Switch to tab
   */
  switch(tabName) {
    if (!this.tabs.has(tabName)) {
      console.warn(`Tab "${tabName}" not found`);
      return;
    }

    // Hide current tab
    if (this.currentTab) {
      const current = this.tabs.get(this.currentTab);
      if (current.button) DOM.removeClass(current.button, 'active');
      if (current.content) {
        current.content.style.display = 'none';
        current.content.classList.remove('tab-active');
      }
      if (current.onHide) current.onHide();
    }

    // Show new tab — remove inline display:none, then set correct display mode
    const tab = this.tabs.get(tabName);
    if (tab.button) DOM.addClass(tab.button, 'active');
    if (tab.content) {
      tab.content.style.removeProperty('display');   // clear inline first
      tab.content.classList.add('tab-active');
      tab.content.style.display = (tabName === 'dashboard') ? 'flex' : 'block';
    }
    if (tab.onShow) tab.onShow();

    this.currentTab = tabName;
    Storage.set('activeTab', tabName);
    document.dispatchEvent(new CustomEvent('tab:changed', { detail: { tab: tabName } }));
  }

  /**
   * Get current tab
   */
  getCurrent() {
    return this.currentTab;
  }
}

const tabManager = new TabManager();

// ── MODAL MANAGEMENT ──────────────────────────────────────────────────────────
class ModalManager {
  constructor() {
    this.modals = new Map();
    this.activeModal = null;
  }

  /**
   * Create modal
   */
  create(id, { title, content, buttons = [], size = 'medium' }) {
    const overlay = DOM.create('div', { class: 'modal-overlay', id: `modal-${id}` });
    const modal = DOM.create('div', { class: `modal modal-${size}` });

    if (title) {
      const header = DOM.create('div', { class: 'modal-header' });
      DOM.append(header,
        DOM.create('h3', { style: { margin: 0 } }, [title]),
        DOM.create('button', {
          class: 'modal-close',
          onclick: () => this.close(id)
        }, ['×'])
      );
      modal.appendChild(header);
    }

    if (content) {
      const body = DOM.create('div', { class: 'modal-body' });
      if (typeof content === 'string') {
        body.innerHTML = content;
      } else {
        body.appendChild(content);
      }
      modal.appendChild(body);
    }

    if (buttons.length > 0) {
      const footer = DOM.create('div', { class: 'modal-footer' });
      buttons.forEach(btn => {
        const button = DOM.create('button', {
          class: `btn btn-${btn.variant || 'primary'}`,
          onclick: () => {
            if (btn.onClick) btn.onClick();
            if (btn.close !== false) this.close(id);
          }
        }, [btn.label]);
        footer.appendChild(button);
      });
      modal.appendChild(footer);
    }

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    this.modals.set(id, overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close(id);
    });

    return overlay;
  }

  /**
   * Open modal
   */
  open(id) {
    const modal = this.modals.get(id);
    if (!modal) {
      console.warn(`Modal "${id}" not found`);
      return;
    }

    if (this.activeModal && this.activeModal !== id) {
      this.close(this.activeModal);
    }

    DOM.addClass(modal, 'active');
    this.activeModal = id;
  }

  /**
   * Close modal
   */
  close(id) {
    const modal = this.modals.get(id);
    if (!modal) return;

    DOM.removeClass(modal, 'active');
    if (this.activeModal === id) {
      this.activeModal = null;
    }
  }

  /**
   * Destroy modal
   */
  destroy(id) {
    const modal = this.modals.get(id);
    if (!modal) return;

    this.close(id);
    setTimeout(() => {
      modal.remove();
      this.modals.delete(id);
    }, 300);
  }
}

const modalManager = new ModalManager();

// ── LOADING INDICATOR ──────────────────────────────────────────────────────────
class LoadingIndicator {
  constructor() {
    this.container = null;
    this.counter = 0;
  }

  /**
   * Initialize loading container
   */
  init(containerId = 'loading-container') {
    this.container = DOM.query(`#${containerId}`);
    if (!this.container) {
      this.container = DOM.create('div', { id: containerId });
      this.container.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: var(--primary);
        z-index: 9998;
        opacity: 0;
        transition: opacity 0.2s;
      `;
      document.body.appendChild(this.container);
    }
  }

  /**
   * Show loading indicator
   */
  show() {
    if (!this.container) this.init();
    this.counter++;
    this.container.style.opacity = '1';
  }

  /**
   * Hide loading indicator
   */
  hide() {
    this.counter = Math.max(0, this.counter - 1);
    if (this.counter === 0) {
      this.container.style.opacity = '0';
    }
  }
}

const loader = new LoadingIndicator();

// ── CONFIRM DIALOG ────────────────────────────────────────────────────────────
async function confirm(title, message, okText = 'OK', cancelText = 'Cancel') {
  return new Promise((resolve) => {
    const id = generateId();
    modalManager.create(id, {
      title,
      content: DOM.create('p', {}, [message]),
      buttons: [
        { label: cancelText, variant: 'outline', onClick: () => resolve(false) },
        { label: okText, variant: 'primary', onClick: () => resolve(true) }
      ]
    });
    modalManager.open(id);
  });
}

// ── TOAST MESSAGES ────────────────────────────────────────────────────────────
function toast(message, options = {}) {
  const {
    type = 'info',
    duration = 3000,
    position = 'bottom-right'
  } = options;

  return notifier.show(message, type, duration);
}

// ── PROGRESS INDICATOR ────────────────────────────────────────────────────────
class ProgressTracker {
  constructor() {
    this.progress = 0;
    this.callbacks = [];
  }

  update(value) {
    this.progress = Math.min(100, Math.max(0, value));
    this.callbacks.forEach(cb => cb(this.progress));
  }

  increment(amount = 10) {
    this.update(this.progress + amount);
  }

  reset() {
    this.update(0);
  }

  onUpdate(callback) {
    this.callbacks.push(callback);
  }

  getProgress() {
    return this.progress;
  }
}

const progressTracker = new ProgressTracker();

// ── DROPDOWN MENU ──────────────────────────────────────────────────────────────
class Dropdown {
  constructor(triggerId) {
    this.trigger = DOM.query(`#${triggerId}`);
    this.menu = null;
    this.isOpen = false;

    if (this.trigger) {
      this.trigger.addEventListener('click', () => this.toggle());
    }
  }

  setMenu(menuElement) {
    this.menu = menuElement;
    document.addEventListener('click', (e) => {
      if (!this.trigger.contains(e.target) && !this.menu.contains(e.target)) {
        this.close();
      }
    });
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    if (this.menu) {
      DOM.show(this.menu);
      this.isOpen = true;
    }
  }

  close() {
    if (this.menu) {
      DOM.hide(this.menu);
      this.isOpen = false;
    }
  }
}

// ── FORM VALIDATION ──────────────────────────────────────────────────────────
class FormValidator {
  constructor(formId) {
    this.form = DOM.query(`#${formId}`);
    this.errors = {};
    this.rules = {};
  }

  /**
   * Add validation rule
   */
  rule(fieldName, rules) {
    this.rules[fieldName] = rules;
    return this;
  }

  /**
   * Validate form
   */
  validate() {
    this.errors = {};
    const fields = this.form.querySelectorAll('[name]');

    fields.forEach(field => {
      const name = field.name;
      const value = field.value;
      const fieldRules = this.rules[name];

      if (!fieldRules) return;

      if (fieldRules.required && !Validate.required(value)) {
        this.addError(name, 'This field is required');
      }

      if (fieldRules.email && value && !Validate.email(value)) {
        this.addError(name, 'Invalid email address');
      }

      if (fieldRules.minLength && !Validate.minLength(value, fieldRules.minLength)) {
        this.addError(name, `Minimum ${fieldRules.minLength} characters required`);
      }

      if (fieldRules.maxLength && !Validate.maxLength(value, fieldRules.maxLength)) {
        this.addError(name, `Maximum ${fieldRules.maxLength} characters allowed`);
      }

      if (fieldRules.custom && !fieldRules.custom(value)) {
        this.addError(name, fieldRules.message || 'Invalid value');
      }
    });

    return this.errors;
  }

  addError(fieldName, message) {
    if (!this.errors[fieldName]) {
      this.errors[fieldName] = [];
    }
    this.errors[fieldName].push(message);
  }

  hasErrors() {
    return Object.keys(this.errors).length > 0;
  }

  getErrors(fieldName) {
    return this.errors[fieldName] || [];
  }
}

// Export modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    themeManager, notifier, tabManager, modalManager,
    loader, progressTracker, confirm, toast,
    Dropdown, FormValidator
  };
}
