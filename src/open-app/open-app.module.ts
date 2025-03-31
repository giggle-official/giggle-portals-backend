import { Module } from "@nestjs/common"
import { OpenAppController } from "./open-app.controller"
import { OpenAppService } from "./open-app.service"
import { PrismaService } from "src/common/prisma.service"
import { UserModule } from "src/user/user.module"
import { AuthModule } from "src/auth/auth.module"
import { IpLibraryModule } from "src/ip-library/ip-library.module"
import { NotificationModule } from "src/notification/notification.module"
import { JwtModule } from "@nestjs/jwt"
import { AuthController } from "./auth/auth.controller"
import { AuthService } from "./auth/auth.service"
import { AuthModule as AuthUserModule } from "src/auth/auth.module"
import { WidgetsController } from './widgets/widgets.controller';
import { WidgetsService } from './widgets/widgets.service';
@Module({
    imports: [
        UserModule,
        AuthModule,
        IpLibraryModule,
        AuthUserModule,
        NotificationModule,
        JwtModule.register({ secret: process.env.SESSION_SECRET }),
    ],
    controllers: [OpenAppController, AuthController, WidgetsController],
    providers: [OpenAppService, PrismaService, AuthService, WidgetsService],
})
export class OpenAppModule {}
