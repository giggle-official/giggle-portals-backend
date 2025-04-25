import { forwardRef, Module } from "@nestjs/common"
import { WidgetsController } from "./widgets.controller"
import { WidgetsService } from "./widgets.service"
import { PrismaService } from "src/common/prisma.service"
import { UserModule } from "src/user/user.module"
import { JwtModule } from "@nestjs/jwt"

@Module({
    imports: [forwardRef(() => UserModule), JwtModule.register({ secret: process.env.SESSION_SECRET })],
    controllers: [WidgetsController],
    providers: [WidgetsService, PrismaService],
    exports: [WidgetsService],
})
export class WidgetsModule {}
