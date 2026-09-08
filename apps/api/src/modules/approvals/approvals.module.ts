import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalService } from './approval.service';
@Module({ imports: [AuthModule], controllers: [ApprovalsController], providers: [ApprovalService], exports: [ApprovalService] })
export class ApprovalsModule {}
