'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('./config');
const { uid } = require('./util');

const IMAGE_SIGS = [
  {
    mime: 'image/png', ext: 'png',
    test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/jpeg', ext: 'jpg',
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/gif', ext: 'gif',
    test: (b) => b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
  },
  {
    mime: 'image/webp', ext: 'webp',
    test: (b) => b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

function detectImage(buf) {
  for (const s of IMAGE_SIGS) {
    if (s.test(buf)) return s;
  }
  return null;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit && !done) {
        done = true;
        reject(new Error('上传内容超出限制'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
    req.on('aborted', () => { if (!done) { done = true; reject(new Error('上传中断')); } });
  });
}

function parseBoundary(contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  return m[1] || m[2] || null;
}

function splitParts(buf, boundaryRaw) {
  const b = Buffer.from(`--${boundaryRaw}`, 'latin1');
  const parts = [];
  let idx = buf.indexOf(b);
  if (idx < 0) return parts;

  let pos = idx + b.length;
  while (pos < buf.length) {
    if (buf.slice(pos, pos + 2).toString('latin1') === '--') break;
    if (buf.slice(pos, pos + 2).toString('latin1') !== '\r\n') break;
    pos += 2;

    const next = buf.indexOf(b, pos);
    if (next < 0) break;

    let part = buf.slice(pos, next);
    if (part.slice(-2).toString('latin1') === '\r\n') part = part.slice(0, part.length - 2);
    parts.push(part);
    pos = next + b.length;
  }
  return parts;
}

function parsePartHeaders(raw) {
  const text = raw.toString('utf8');
  const hdr = {};
  const lines = text.split('\r\n');
  for (const line of lines) {
    if (line === '') break;
    const i = line.indexOf(':');
    if (i < 0) continue;
    hdr[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return hdr;
}

function fieldFromDisposition(v, key) {
  const m = new RegExp(`${key}="([^"]*)"`).exec(v || '');
  if (m) return m[1];
  const m2 = new RegExp(`${key}=([^;\\s]+)`).exec(v || '');
  return m2 ? m2[1] : null;
}

async function parseMultipart(req) {
  const boundary = parseBoundary(req.headers['content-type']);
  if (!boundary) throw new Error('请求格式不正确');
  const buf = await readBody(req, config.maxUploadBytes);
  const parts = splitParts(buf, boundary);
  const fields = {};
  const files = [];

  for (const part of parts) {
    const sep = part.indexOf('\r\n\r\n');
    if (sep < 0) continue;
    const headerRaw = part.slice(0, sep);
    const bodyBuf = part.slice(sep + 4);
    const hdr = parsePartHeaders(headerRaw);
    const disp = hdr['content-disposition'] || '';
    const name = fieldFromDisposition(disp, 'name') || '';
    const filename = fieldFromDisposition(disp, 'filename');
    if (filename === null) {
      fields[name] = bodyBuf.toString('utf8');
    } else {
      files.push({
        field: name,
        filename,
        contentType: hdr['content-type'] || 'application/octet-stream',
        data: bodyBuf,
      });
    }
  }
  return { fields, files };
}

function saveImage(file, maxBytes) {
  if (!file || !file.data || file.data.length === 0) {
    const e = new Error('没有收到图片');
    e.code = 'NO_FILE';
    throw e;
  }
  if (file.data.length > (maxBytes || config.maxImageBytes)) {
    const e = new Error('图片过大，请压缩后再上传');
    e.code = 'TOO_LARGE';
    throw e;
  }
  const sig = detectImage(file.data);
  if (!sig) {
    const e = new Error('只支持 PNG、JPG、GIF、WebP 格式的图片');
    e.code = 'BAD_TYPE';
    throw e;
  }
  const name = `${uid('img')}.${sig.ext}`;
  const abs = path.join(config.uploadDir, name);
  fs.writeFileSync(abs, file.data);
  return {
    storedName: name,
    absPath: abs,
    bytes: file.data.length,
    mime: sig.mime,
    sha256: crypto.createHash('sha256').update(file.data).digest('hex').slice(0, 16),
  };
}

function removeUpload(name) {
  if (!name) return;
  const safe = path.basename(name);
  const abs = path.join(config.uploadDir, safe);
  if (!abs.startsWith(path.resolve(config.uploadDir))) return;
  if (fs.existsSync(abs)) {
    try { fs.unlinkSync(abs); } catch (e) { /* noop */ }
  }
}

module.exports = { parseMultipart, saveImage, removeUpload, detectImage };
