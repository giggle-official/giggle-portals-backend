import { Module } from "@nestjs/common"
import { WidgetsController } from "./widgets.controller"
import { WidgetsService } from "./widgets.service"
import { PrismaService } from "src/common/prisma.service"
import { WidgetFactory } from "./widget.factory"
import { LoginFromExternalWidget } from "./implementations/login-from-external.widget"
import { UserModule } from "src/user/user.module"
import { JwtModule } from "@nestjs/jwt"

@Module({
    imports: [UserModule, JwtModule.register({ secret: process.env.SESSION_SECRET })],
    controllers: [WidgetsController],
    providers: [WidgetsService, PrismaService, WidgetFactory, LoginFromExternalWidget],
    exports: [WidgetsService, WidgetFactory],
})
export class WidgetsModule {}
