import { Module } from "@nestjs/common"
import { StatsController } from "./stats.controller"
import { StatsService } from "./stats.service"
import { PrismaService } from "src/common/prisma.service"
import { NotificationModule } from "src/notification/notification.module"

@Module({
    imports: [NotificationModule],
    controllers: [StatsController],
    providers: [StatsService, PrismaService],
    exports: [StatsService],
})
export class StatsModule {}
