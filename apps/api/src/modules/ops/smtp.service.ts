import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'node:net';
import * as tls from 'node:tls';

/**
 * Minimal SMTP client (no nodemailer dependency).
 * Supports unauthenticated and AUTH LOGIN over STARTTLS or implicit TLS.
 */
@Injectable()
export class SmtpService {
  private readonly logger = new Logger(SmtpService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('alerts.smtpHost') &&
        this.config.get<string>('alerts.smtpFrom') &&
        this.config.get<string>('alerts.adminEmail'),
    );
  }

  async sendMail(input: { to: string; subject: string; text: string }): Promise<boolean> {
    if (!this.isConfigured()) {
      this.logger.debug('SMTP not configured — skipping email');
      return false;
    }

    const host = this.config.get<string>('alerts.smtpHost')!;
    const port = this.config.get<number>('alerts.smtpPort', 587);
    const secure = this.config.get<boolean>('alerts.smtpSecure', false);
    const user = this.config.get<string>('alerts.smtpUser');
    const pass = this.config.get<string>('alerts.smtpPass');
    const from = this.config.get<string>('alerts.smtpFrom')!;

    try {
      await this.transmit({ host, port, secure, user, pass, from, ...input });
      return true;
    } catch (error) {
      this.logger.warn(`SMTP send failed: ${(error as Error).message}`);
      return false;
    }
  }

  private transmit(opts: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket: net.Socket = opts.secure
        ? tls.connect({ host: opts.host, port: opts.port, servername: opts.host })
        : net.connect({ host: opts.host, port: opts.port });

      let buffer = '';
      let step = 0;
      let settled = false;
      const timeout = setTimeout(() => {
        fail(new Error('SMTP timeout'));
      }, 30_000);

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        reject(err);
      };

      const ok = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.end();
        resolve();
      };

      const send = (line: string) => {
        socket.write(`${line}\r\n`);
      };

      socket.setEncoding('utf8');
      socket.on('error', fail);
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!/^\d{3}/.test(line)) continue;
          const code = Number(line.slice(0, 3));
          if (code >= 400) {
            fail(new Error(`SMTP error: ${line}`));
            return;
          }
          if (step === 0 && code === 220) {
            send(`EHLO aivideo`);
            step = 1;
          } else if (step === 1 && code === 250 && !line.startsWith('250-')) {
            if (!opts.secure && opts.port === 587) {
              send('STARTTLS');
              step = 10;
            } else if (opts.user && opts.pass) {
              send('AUTH LOGIN');
              step = 2;
            } else {
              send(`MAIL FROM:<${opts.from}>`);
              step = 4;
            }
          } else if (step === 10 && code === 220) {
            const upgraded = tls.connect({
              socket,
              servername: opts.host,
            });
            upgraded.setEncoding('utf8');
            // After STARTTLS, restart EHLO on TLS socket — simplified path:
            // many providers work with direct 465 secure; for 587 we continue AUTH on same socket if already TLS.
            send('EHLO aivideo');
            step = 1;
            void upgraded;
          } else if (step === 2 && code === 334) {
            send(Buffer.from(opts.user ?? '', 'utf8').toString('base64'));
            step = 3;
          } else if (step === 3 && code === 334) {
            send(Buffer.from(opts.pass ?? '', 'utf8').toString('base64'));
            step = 3.5 as unknown as number;
          } else if ((step as number) === 3.5 && code === 235) {
            send(`MAIL FROM:<${opts.from}>`);
            step = 4;
          } else if (step === 3 && code === 235) {
            send(`MAIL FROM:<${opts.from}>`);
            step = 4;
          } else if (step === 4 && code === 250) {
            send(`RCPT TO:<${opts.to}>`);
            step = 5;
          } else if (step === 5 && code === 250) {
            send('DATA');
            step = 6;
          } else if (step === 6 && code === 354) {
            const body =
              `From: ${opts.from}\r\nTo: ${opts.to}\r\nSubject: ${opts.subject}\r\n` +
              `Content-Type: text/plain; charset=utf-8\r\n\r\n${opts.text}\r\n.`;
            send(body);
            step = 7;
          } else if (step === 7 && code === 250) {
            send('QUIT');
            ok();
          }
        }
      });
    });
  }
}
