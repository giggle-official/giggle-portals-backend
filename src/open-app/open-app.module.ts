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
import { WidgetsModule } from "./widgets/widgets.module"
import { DeveloperController } from './developer/developer.controller';
import { DeveloperService } from './developer/developer.service';
import { ShareController } from './share/share.controller';
import { ShareService } from './share/share.service';

@Module({
    imports: [
        UserModule,
        AuthModule,
        IpLibraryModule,
        AuthUserModule,
        NotificationModule,
        WidgetsModule,
        JwtModule.register({ secret: process.env.SESSION_SECRET }),
    ],
    controllers: [OpenAppController, AuthController, DeveloperController, ShareController],
    providers: [OpenAppService, PrismaService, AuthService, DeveloperService, ShareService],
})
export class OpenAppModule {}
