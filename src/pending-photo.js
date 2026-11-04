// Conserve la photo le temps de la connexion par e-mail, car elle est trop lourde pour localStorage.
const DB = 'neove'; const STORE = 'photos'; const KEY = 'attente';

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function run(mode, action) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function savePendingPhoto(blob) {
  try { await run('readwrite', (s) => s.put(blob, KEY)); return true; } catch { return false; }
}
export async function takePendingPhoto() {
  try {
    const blob = await run('readonly', (s) => s.get(KEY));
    if (blob) await run('readwrite', (s) => s.delete(KEY));
    return blob ?? null;
  } catch { return null; }
}
// Redimensionne et retire les métadonnées, dont la position GPS éventuelle.
export function compressPhoto(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Conversion impossible'))), 'image/jpeg', 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
    img.src = url;
  });
}
