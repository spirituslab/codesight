// Shared mutable state — imported by all modules

export const state = {
  DATA: null, // set from window.CODEBASE_DATA in main.mjs
  currentLevel: 'modules',
  currentModule: null,
  currentSubdir: null,
  currentFile: null,
  cyCode: null,
  cyIdea: null,
  activeIdeaNode: null,
  activeTour: null,
  activeTourStep: 0,
};
