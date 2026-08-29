// localStorage with the sharp edges filed off. Private-browsing modes throw on
// write and can throw on read, so every access is guarded and simply degrades
// to "this session only".

const PREFIX = 'sosoph.';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return structuredClone(fallback);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...structuredClone(fallback), ...parsed }
      : parsed;
  } catch {
    return structuredClone(fallback);
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch { /* nothing to do */ }
}
