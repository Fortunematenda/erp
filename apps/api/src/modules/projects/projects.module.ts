import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NumberingService } from '../../core/common/numbering.service';

@Module({ controllers: [ProjectsController], providers: [PrismaService, NumberingService] })
export class ProjectsModule {}
