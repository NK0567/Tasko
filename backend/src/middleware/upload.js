import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config.js';
import { badRequest } from '../utils/errors.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

const IMAGES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
};
const DOCS = { 'application/pdf': '.pdf' };
const ALL = { ...IMAGES, ...DOCS };

/** Signatures binaires (« magic bytes ») : le type déclaré par le client n'est jamais cru sur parole. */
function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  if (buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(brand)) return 'image/heic';
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${ALL[file.mimetype] || '.bin'}`),
});

function makeUploader(allowed, label) {
  const m = multer({
    storage,
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10, fieldSize: 10 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (allowed[file.mimetype]) return cb(null, true);
      cb(badRequest(`Type de fichier non accepté (${label})`));
    },
  });
  // Vérifie le contenu réel du fichier stocké ; supprime le fichier si la signature ne correspond pas.
  const verify = async (req, _res, next) => {
    if (!req.file) return next();
    try {
      const fh = await fs.promises.open(req.file.path, 'r');
      const buf = Buffer.alloc(16);
      await fh.read(buf, 0, 16, 0);
      await fh.close();
      const real = sniff(buf);
      const declared = req.file.mimetype === 'image/heif' ? 'image/heic' : req.file.mimetype;
      if (!real || !allowed[real] || real !== declared) {
        await fs.promises.unlink(req.file.path).catch(() => {});
        req.file = undefined;
        return next(badRequest(`Contenu du fichier invalide (${label})`));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
  return { single: (field) => [m.single(field), verify] };
}

/** Images + PDF (POST /uploads : photos, preuves, devis). */
export const upload = makeUploader(ALL, 'images jpg, png, webp, gif, heic ou PDF, 5 Mo maximum');
/** Images uniquement (avatar, portfolio). */
export const uploadImage = makeUploader(IMAGES, 'images jpg, png, webp, gif ou heic, 5 Mo maximum');

export const fileUrl = (file) => `/uploads/${path.basename(file.filename)}`;

export function requireFile(req) {
  if (!req.file) throw badRequest('Fichier manquant (champ multipart « file »)');
  return req.file;
}
