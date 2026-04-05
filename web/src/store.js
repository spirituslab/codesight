// web/src/store.js
// Minimal reactive store — components subscribe to state changes via events

class Store extends EventTarget {
  constructor() {
    super();
    this._state = {
      DATA: null,
      currentLevel: 'modules',
      currentModule: null,
      currentSubdir: null,
      currentFile: null,
      sidebarTab: 'explorer',
      chatOpen: false,
      sidebarCollapsed: false,
      activeTour: null,
      activeTourStep: 0,
      activeIdeaNode: null,
      selectedSymbol: null,
    };
  }

  get state() {
    return this._state;
  }

  set(key, value) {
    const old = this._state[key];
    if (old === value) return;
    // For objects with a path property (e.g. currentFile), compare by path
    if (old && value && typeof old === 'object' && typeof value === 'object'
        && old.path && old.path === value.path) return;
    this._state[key] = value;
    this.dispatchEvent(new CustomEvent('state-changed', {
      detail: { key, value },
    }));
  }

  setBatch(updates) {
    let changed = false;
    for (const [key, value] of Object.entries(updates)) {
      if (this._state[key] !== value) {
        this._state[key] = value;
        changed = true;
      }
    }
    if (changed) {
      this.dispatchEvent(new CustomEvent('state-changed', {
        detail: { keys: Object.keys(updates) },
      }));
    }
  }
}

export const store = new Store();
