import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { assertJwtSecretForStartup } from './core/security/jwt-secret';

function configuredWebOrigins(): string[] {
  const raw = process.env.WEB_ORIGIN || 'http://localhost:3000';
  return raw
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function isDevBrowserOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)
    );
  } catch {
    return false;
  }
}

async function bootstrap() {
  assertJwtSecretForStartup();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(helmet());
  const allowed = configuredWebOrigins();
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Non-browser clients (no Origin header) are allowed.
      if (!origin) return callback(null, true);
      if (allowed.includes(origin)) return callback(null, true);
      // Local/dev: accept localhost, 127.0.0.1, and private LAN so login works from Network URL.
      if (process.env.NODE_ENV !== 'production' && isDevBrowserOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin ${origin}`), false);
    },
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors) => {
      const fields: Record<string, string[]> = {};
      const walk = (errs: any[], prefix = '') => {
        for (const e of errs) {
          const key = prefix ? `${prefix}.${e.property}` : e.property;
          if (e.constraints) fields[key] = Object.values(e.constraints);
          if (e.children?.length) walk(e.children, key);
        }
      };
      walk(errors);
      return new BadRequestException({ message: 'Validation failed', errors: fields });
    },
  }));
  const config = new DocumentBuilder().setTitle('NexusERP API').setDescription('Multi-tenant ERP API').setVersion('0.1').addBearerAuth().build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
  await app.listen(Number(process.env.PORT || 4000));
  console.log(`NexusERP API: http://localhost:${process.env.PORT || 4000}/api`);
}
bootstrap();
