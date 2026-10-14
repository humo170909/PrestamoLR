const KEY = "lromero:saved-emails";
export const MAX_SAVED_EMAILS = 2;

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

function write(list: string[]): string[] {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* almacenamiento no disponible */
  }
  return list;
}

export const getSavedEmails = (): string[] => read();

/** Guarda hasta MAX_SAVED_EMAILS. Los primeros se conservan; para añadir otro hay que olvidar uno. */
export function saveEmail(email: string): string[] {
  const clean = email.trim().toLowerCase();
  const list = read();
  if (list.includes(clean) || list.length >= MAX_SAVED_EMAILS) return list;
  return write([...list, clean]);
}

export function removeEmail(email: string): string[] {
  const clean = email.trim().toLowerCase();
  return write(read().filter((e) => e !== clean));
}
