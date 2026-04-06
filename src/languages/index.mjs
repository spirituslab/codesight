import typescript from "./typescript.mjs";
import python from "./python.mjs";
import c from "./c.mjs";
import cpp from "./cpp.mjs";
import java from "./java.mjs";
import csharp from "./csharp.mjs";
import go from "./go.mjs";
import rust from "./rust.mjs";

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
  csharp,
  go,
  rust,
};

export function getLanguage(langId) {
  return languages[langId] || null;
}

export function getSupportedLanguages() {
  return Object.keys(languages);
}
