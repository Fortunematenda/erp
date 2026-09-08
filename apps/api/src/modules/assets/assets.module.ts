import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { AssetsController } from './assets.controller';
@Module({ imports: [FinanceModule], controllers: [AssetsController] })
export class AssetsModule {}
