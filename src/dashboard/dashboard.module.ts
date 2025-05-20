import { Module } from "@nestjs/common"
import { DashboardController } from "./dashboard.controller"
import { DashboardService } from "./dashboard.service"
import { PrismaService } from "src/common/prisma.service"
import { UtilitiesService } from "src/common/utilities.service"
@Module({
    controllers: [DashboardController],
    providers: [DashboardService, PrismaService, UtilitiesService],
})
export class DashboardModule {}
