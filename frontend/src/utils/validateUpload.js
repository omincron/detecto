// Fast browser-side pre-check, so obviously bad files fail instantly instead of after an
// upload. The backend stays the real validator (magic bytes, decoding); this only looks
// at what the browser already knows: size and the declared type.

// Same lenient list as the backend: octet-stream is what some sources label any file,
// so it goes on to the backend's magic-byte check rather than being rejected here.
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "application/octet-stream"]);

/** Returns a user-facing message if the file should not be uploaded, else null. */
export function validateUpload(file, maxBytes) {
  if (file.size === 0) {
    return "This file is empty.";
  }
  if (file.size > maxBytes) {
    const limitMb = maxBytes / (1024 * 1024);
    return `This file is larger than the ${limitMb} MB limit.`;
  }
  // An empty type means the browser couldn't tell; let the backend decide.
  const type = (file.type || "").split(";")[0].trim().toLowerCase();
  if (type && !ACCEPTED_TYPES.has(type)) {
    return `Only JPEG and PNG images are supported (this file is ${type}).`;
  }
  return null;
}
