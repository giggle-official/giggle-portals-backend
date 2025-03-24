import { Module } from "@nestjs/common"
import { OpenAppController } from "./open-app.controller"
import { OpenAppService } from "./open-app.service"
import { PrismaService } from "src/common/prisma.service"
import { UserModule } from "src/user/user.module"
import { AuthModule } from "src/auth/auth.module"
import { IpLibraryModule } from "src/ip-library/ip-library.module"
import { NotificationModule } from "src/notification/notification.module"
@Module({
    imports: [UserModule, AuthModule, IpLibraryModule, NotificationModule],
    controllers: [OpenAppController],
    providers: [OpenAppService, PrismaService],
})
export class OpenAppModule {}
