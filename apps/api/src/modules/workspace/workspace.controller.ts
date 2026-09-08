import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { companyIdOf } from '../../core/context';
import { WorkspaceService } from './workspace.service';

@ApiTags('Workspace')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Get('search')
  search(@Req() req: any, @Query('q') q = '', @Query('limit') limit = '8') {
    return this.workspace.search(companyIdOf(req.user), q, Number(limit) || 8);
  }

  @Get('action-center')
  actionCenter(@Req() req: any) {
    return this.workspace.actionCenter(companyIdOf(req.user), req.user.sub);
  }
}
