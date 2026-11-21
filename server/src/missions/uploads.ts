import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { mkdirSync, createReadStream, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, notFound } from '../errors.ts';
import { requireUser } from '../auth/session.ts';
import { shortId } from '../auth/session.ts';
import { audit } from '../audit.ts';
import { VISIBLE_SQL } from './visibility.ts';

export const MAX_UPLOAD = 25 * 1024 * 1024;
export const DEFAULT_UPLOAD_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'uploads');

type Kind = 'image' | 'audio' | 'video' | 'pdf' | 'doc' | 'txt';
const EXT: Record<string, Kind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video',
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', ppt: 'doc', pptx: 'doc', xls: 'doc', xlsx: 'doc',
  txt: 'txt', md: 'txt', csv: 'txt', log: 'txt', json: 'txt',
};
const TEXT_MIME: Record<string, string> = { txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', log: 'text/plain', json: 'application/json' };

const starts = (b: Buffer, sig: number[] | string, at = 0) => {
  const s = typeof sig === 'string' ? Buffer.from(sig, 'latin1') : Buffer.from(sig);
  return b.length >= at + s.length && b.subarray(at, at + s.length).equals(s);
};
function isUtf8Text(b: Buffer) {
  if (b.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, 1 << 20)); return true; } catch { return false; }
}

/** What the bytes are (never trusting the name or the browser's Content-Type), checked against the extension. */
export function sniff(name: string, b: Buffer): { kind: Kind; mime: string } | { error: string } {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const want = EXT[ext];
  if (!want) return { error: 'This kind of file is not accepted. Use an image, audio, video, PDF, office document or text file.' };
  let got: { kind: Kind; mime: string } | null = null;
  if (starts(b, [0x89, 0x50, 0x4e, 0x47])) got = { kind: 'image', mime: 'image/png' };
  else if (starts(b, [0xff, 0xd8, 0xff])) got = { kind: 'image', mime: 'image/jpeg' };
  else if (starts(b, 'GIF8')) got = { kind: 'image', mime: 'image/gif' };
  else if (starts(b, 'RIFF') && starts(b, 'WEBP', 8)) got = { kind: 'image', mime: 'image/webp' };
  else if (starts(b, 'RIFF') && starts(b, 'WAVE', 8)) got = { kind: 'audio', mime: 'audio/wav' };
  else if (starts(b, '%PDF')) got = { kind: 'pdf', mime: 'application/pdf' };
  else if (starts(b, 'ID3') || starts(b, [0xff, 0xfb]) || starts(b, [0xff, 0xf3]) || starts(b, [0xff, 0xf2])) got = { kind: 'audio', mime: 'audio/mpeg' };
  else if (starts(b, 'OggS')) got = { kind: 'audio', mime: 'audio/ogg' };
  else if (starts(b, 'ftyp', 4)) got = ext === 'm4a' ? { kind: 'audio', mime: 'audio/mp4' } : ext === 'mov' ? { kind: 'video', mime: 'video/quicktime' } : { kind: 'video', mime: 'video/mp4' };
  else if (starts(b, [0x1a, 0x45, 0xdf, 0xa3])) got = { kind: 'video', mime: ext === 'mkv' ? 'video/x-matroska' : 'video/webm' };
  else if (starts(b, [0x50, 0x4b, 0x03, 0x04]) && ['docx', 'xlsx', 'pptx', 'odt'].includes(ext)) got = { kind: 'doc', mime: ext === 'odt' ? 'application/vnd.oasis.opendocument.text' : `application/vnd.openxmlformats-officedocument.${ext === 'docx' ? 'wordprocessingml.document' : ext === 'xlsx' ? 'spreadsheetml.sheet' : 'presentationml.presentation'}` };
  else if (starts(b, [0xd0, 0xcf, 0x11, 0xe0]) && ['doc', 'xls', 'ppt'].includes(ext)) got = { kind: 'doc', mime: ext === 'doc' ? 'application/msword' : ext === 'xls' ? 'application/vnd.ms-excel' : 'application/vnd.ms-powerpoint' };
  else if (starts(b, '{\\rtf')) got = { kind: 'doc', mime: 'application/rtf' };
  else if (want === 'txt' && isUtf8Text(b)) got = { kind: 'txt', mime: TEXT_MIME[ext] ?? 'text/plain' };
  if (!got || got.kind !== want || (ext === 'ogg' && got.kind !== 'audio')) return { error: `The content of "${name}" does not match its .${ext} extension.` };
  return got;
}

export function cleanName(raw: string): string | null {
  const n = String(raw ?? '').normalize('NFC').trim();
  if (!n || n.length > 200 || /[/\\]/.test(n) || n.includes('..') || /[\x00-\x1f\x7f]/.test(n) || n.startsWith('.')) return null;
  return n;
}

export default async function uploadRoutes(app: FastifyInstance) {
  const dir = app.cfg.uploadDir ?? DEFAULT_UPLOAD_DIR;
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  app.post('/uploads', async (req, reply) => {
    const ctx = await requireUser(req);
    if (!req.isMultipart()) throw new ApiError('UPLOAD_REJECTED', 400, 'Send one file as multipart/form-data.');
    const part = await req.file({ limits: { fileSize: MAX_UPLOAD, files: 1 } });
    if (!part) throw new ApiError('UPLOAD_REJECTED', 400, 'No file was sent.');
    const name = cleanName(part.filename);
    let buf: Buffer;
    try { buf = await part.toBuffer(); } catch (e) {
      if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw new ApiError('UPLOAD_REJECTED', 413, 'The file is larger than 25 MB.');
      throw e;
    }
    if (!name) throw new ApiError('UPLOAD_REJECTED', 400, 'The file name is not allowed.');
    if (buf.length === 0) throw new ApiError('UPLOAD_REJECTED', 400, `"${name}" is empty.`);
    const s = sniff(name, buf);
    if ('error' in s) throw new ApiError('UPLOAD_REJECTED', 400, s.error);
    const sha = createHash('sha256').update(buf).digest('hex');
    const path = join(dir, sha);
    if (!existsSync(path)) await writeFile(path, buf, { mode: 0o600 });
    const id = shortId('f');
    const excerpt = s.kind === 'txt' ? buf.subarray(0, 4000).toString('utf8').split('\n').slice(0, 8).join('\n').slice(0, 400) : null;
    await app.db.query('insert into uploads(id, tenant_id, owner_id, sha256, name, mime, kind, size, excerpt) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, ctx.tenantId, ctx.user.id, sha, name, s.mime, s.kind, buf.length, excerpt]);
    await audit(app.db, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'upload.create', subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { kind: s.kind, size: buf.length } });
    return reply.status(201).send({ id, name, kind: s.kind, size: buf.length, mime: s.mime, ...(excerpt ? { excerpt } : {}) });
  });

  app.get('/uploads/:id', async (req, reply) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    if (!/^f-[0-9a-f]{12}$/.test(id)) throw notFound();
    const f = (await app.db.query('select * from uploads where id=$1 and tenant_id=$2', [id, ctx.tenantId])).rows[0];
    if (!f) throw notFound();
    let ok = f.owner_id === ctx.user.id || ctx.user.role === 'admin';
    if (!ok) {
      ok = !!(await app.db.query(
        `select 1 from missions m join mission_revisions r on r.mission_id=m.id where m.tenant_id=$1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')} and r.files @> $4::jsonb limit 1`,
        [ctx.tenantId, ctx.user.role === 'admin', ctx.user.id, JSON.stringify([{ id }])])).rowCount;
    }
    if (!ok) { // a file attached to a message in a conversation the user can see
      ok = !!(await app.db.query(
        `select 1 from message_attachments a join messages x on x.id=a.message_id join conversation_threads c on c.id=x.thread_id join missions m on m.id=c.mission_id
          where a.upload_id=$1 and m.tenant_id=$2 and m.deleted_at is null and ${VISIBLE_SQL('$3', '$4')} limit 1`,
        [id, ctx.tenantId, ctx.user.role === 'admin', ctx.user.id])).rowCount;
    }
    if (!ok) throw notFound();
    const inline = ['image', 'audio', 'video', 'pdf', 'txt'].includes(f.kind);
    reply.header('content-type', f.mime);
    reply.header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    reply.header('content-security-policy', "sandbox; default-src 'none'");
    reply.header('cache-control', 'private, max-age=3600');
    return reply.send(createReadStream(join(dir, f.sha256)));
  });
}
