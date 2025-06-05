import { forwardRef, Module } from "@nestjs/common"
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
import { DeveloperController } from "./developer/developer.controller"
import { DeveloperService } from "./developer/developer.service"
import { LinkController } from "./link/link.controller"
import { LinkService } from "./link/link.service"
import { PaymentModule } from "src/payment/payment.module"
import { HttpModule } from "@nestjs/axios"
import { UsersService } from "./developer/users.service"

@Module({
    imports: [
        HttpModule,
        forwardRef(() => UserModule),
        forwardRef(() => AuthModule),
        forwardRef(() => IpLibraryModule),
        forwardRef(() => AuthUserModule),
        forwardRef(() => NotificationModule),
        forwardRef(() => WidgetsModule),
        forwardRef(() => PaymentModule),
        JwtModule.register({ secret: process.env.SESSION_SECRET }),
    ],
    controllers: [OpenAppController, AuthController, DeveloperController, LinkController],
    providers: [OpenAppService, PrismaService, AuthService, DeveloperService, LinkService, UsersService],
    exports: [LinkService, OpenAppService],
})
export class OpenAppModule {}
