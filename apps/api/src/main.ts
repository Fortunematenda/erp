import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { assertJwtSecretForStartup } from './core/security/jwt-secret';

async function bootstrap() {
  assertJwtSecretForStartup();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({ origin: process.env.WEB_ORIGIN?.split(',') ?? ['http://localhost:3000'], credentials: true });
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
