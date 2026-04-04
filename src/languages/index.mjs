import typescript from "./typescript.mjs";
import python from "./python.mjs";
import c from "./c.mjs";
import cpp from "./cpp.mjs";
import java from "./java.mjs";

const languages = {
  typescript,
  javascript: {
    ...typescript,
    id: "javascript",
  },
  python,
  c,
  cpp,
  java,
};

export function getLanguage(langId) {
  return languages[langId] || null;
}

export function getSupportedLanguages() {
  return Object.keys(languages);
}
