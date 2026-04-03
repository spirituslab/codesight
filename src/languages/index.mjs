import typescript from "./typescript.mjs";
import python from "./python.mjs";

const languages = {
  typescript,
  javascript: {
    ...typescript,
    id: "javascript",
  },
  python,
};

export function getLanguage(langId) {
  return languages[langId] || null;
}

export function getSupportedLanguages() {
  return Object.keys(languages);
}
