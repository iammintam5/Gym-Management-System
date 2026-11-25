import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PtPackagesModule } from '../pt-packages/pt-packages.module';
import {
  MembershipPlansController,
  PublicMembershipPlansController,
} from './membership-plans.controller';
import { MembershipPlansService } from './membership-plans.service';

@Module({
  imports: [DatabaseModule, PtPackagesModule],
  controllers: [
    MembershipPlansController,
    PublicMembershipPlansController,
  ],
  providers: [MembershipPlansService],
  exports: [MembershipPlansService],
})
export class MembershipPlansModule {}
