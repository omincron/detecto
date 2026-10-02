// Frontend settings from Vite env (frontend/.env). The upload limit must match the
// backend's MAX_UPLOAD_BYTES: the backend is the real check, this one just fails fast.
const parsedMb = Number(import.meta.env.VITE_MAX_UPLOAD_MB);
export const MAX_UPLOAD_MB = Number.isFinite(parsedMb) && parsedMb > 0 ? parsedMb : 10;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
