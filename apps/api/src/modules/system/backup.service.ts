import { BadRequestException, Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { promisify } from 'util';

const ejec = promisify(execFile);

@Injectable()
export class BackupService {
  constructor(private prisma: PrismaService) {}

  private storageDir() { return process.env.BACKUP_DIR || path.join(process.cwd(), 'storage', 'backups'); }
  private retention() { return Number(process.env.BACKUP_RETENTION) || 10; }
  private encKey(): Buffer | null {
    const k = process.env.BACKUP_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
    return k ? crypto.createHash('sha256').update(k).digest() : null;
  }

  private async findPgDump(): Promise<string> {
    const candidates: string[] = [];
    if (process.env.PG_DUMP_PATH) candidates.push(process.env.PG_DUMP_PATH);
    for (const base of ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL']) {
      try {
        const versions = (await fs.readdir(base)).filter((n) => /^\d+(\.\d+)?$/.test(n)).sort((a, b) => parseInt(b.split('.')[0]) - parseInt(a.split('.')[0]));
        for (const v of versions) candidates.push(path.join(base, v, 'bin', 'pg_dump.exe'));
      } catch {}
    }
    for (const c of candidates) {
      try { await fs.access(c); return c; } catch {}
    }
    return 'pg_dump';
  }

  private async findAllPgDumps(): Promise<string[]> {
    const out: string[] = [];
    for (const base of ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL']) {
      try {
        const versions = (await fs.readdir(base)).filter((n) => /^\d+(\.\d+)?$/.test(n)).sort((a, b) => parseInt(b.split('.')[0]) - parseInt(a.split('.')[0]));
        for (const v of versions) out.push(path.join(base, v, 'bin', 'pg_dump.exe'));
      } catch {}
    }
    return out.length ? out : ['pg_dump'];
  }

  private databaseUrl(): string {
    const u = process.env.DATABASE_URL || '';
    return u.split('?')[0];
  }

  private encrypt(data: Buffer): { cipher: Buffer; iv: Buffer; tag: Buffer } {
    const key = this.encKey()!;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(data), cipher.final()]);
    return { cipher: enc, iv, tag: cipher.getAuthTag() };
  }

  async create(): Promise<any> {
    await fs.mkdir(this.storageDir(), { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `nexuserp-${ts}.dump`;
    const filePath = path.join(this.storageDir(), filename);
    const url = this.databaseUrl();
    let raw: Buffer;
    try {
      const dumps = await this.findAllPgDumps();
      let lastErr = '';
      let ok = false;
      for (const dump of dumps) {
        try { await ejec(dump, ['--dbname=' + url, '--format=custom', '--no-owner', '--no-privileges', '--file=' + filePath], { maxBuffer: 1024 * 1024 * 50, windowsHide: true }); ok = true; break; }
        catch (e: any) { lastErr = e.message; await fs.unlink(filePath).catch(() => {}); }
      }
      if (!ok) throw new Error(lastErr || 'pg_dump failed');
      raw = await fs.readFile(filePath);
    } catch (e: any) {
      await this.prisma.backup.create({ data: { filename, filePath, status: 'FAILED' } });
      throw new BadRequestException(`Backup failed: ${e.message}. Ensure pg_dump is available and DATABASE_URL is set.`);
    }
    let encrypted = false; let iv: Buffer | undefined; let tag: Buffer | undefined;
    let key = this.encKey();
    if (key) {
      const { cipher, iv: ivb, tag: tagb } = this.encrypt(raw);
      await fs.writeFile(filePath, Buffer.concat([ivb, cipher, tagb]));
      raw = await fs.readFile(filePath); iv = ivb; tag = tagb; encrypted = true;
    }
    const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
    const size = raw.length;
    const backup = await this.prisma.backup.create({ data: { filename, filePath, size, sha256, encrypted, status: 'DONE' } });
    await this.applyRetention();
    return { ...backup, iv: iv?.toString('hex'), tag: tag?.toString('hex') };
  }

  async list() { return this.prisma.backup.findMany({ orderBy: { createdAt: 'desc' } }); }

  async download(id: string) {
    const b = await this.prisma.backup.findUnique({ where: { id } });
    if (!b) throw new BadRequestException('Backup not found');
    const exists = await fs.access(b.filePath).then(() => true).catch(() => false);
    if (!exists) throw new BadRequestException('Backup file missing');
    return b;
  }

  async restore(id: string): Promise<any> {
    const b = await this.prisma.backup.findUnique({ where: { id } });
    if (!b) throw new BadRequestException('Backup not found');
    if (b.status !== 'DONE') throw new BadRequestException('Can only restore a completed backup');
    const exists = await fs.access(b.filePath).then(() => true).catch(() => false);
    if (!exists) throw new BadRequestException('Backup file missing');
    const url = this.databaseUrl();
    // Pre-create a safety snapshot of the current state before destructive restore
    try { await this.create(); } catch {}
    const dumps = await this.findAllPgDumps();
    const restoreTools = dumps.map((d) => d.replace('.exe', '').replace('pg_dump', 'pg_restore.exe'));
    let lastErr = '';
    for (const pgRestore of restoreTools) {
      try { await ejec(pgRestore, ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--dbname=' + url, b.filePath], { maxBuffer: 1024 * 1024 * 50, windowsHide: true }); lastErr = ''; break; }
      catch (e: any) { lastErr = e.message; }
    }
    if (lastErr) throw new BadRequestException(`Restore failed: ${lastErr}`);
    await this.prisma.backup.update({ where: { id }, data: { status: 'RESTORED' } });
    return { ok: true, message: 'Database restored from backup.' };
  }

  private async applyRetention() {
    const keep = this.retention();
    const done = await this.prisma.backup.findMany({ where: { status: 'DONE' }, orderBy: { createdAt: 'desc' }, skip: keep });
    for (const d of done) {
      await fs.unlink(d.filePath).catch(() => {});
      await this.prisma.backup.update({ where: { id: d.id }, data: { status: 'EXPIRED' } });
    }
  }
}
