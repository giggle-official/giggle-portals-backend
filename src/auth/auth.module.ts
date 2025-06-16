import { Module, forwardRef } from "@nestjs/common"
import { AuthController } from "./auth.controller"
import { AuthService } from "./auth.service"
import { PrismaService } from "src/common/prisma.service"
import { GoogleStrategy } from "./google.strategy"
import { JwtStrategy } from "./jwt.strategy"
import { LocalStrategy } from "./local.strategy"
import { UserModule } from "src/user/user.module"
import { JwtModule } from "@nestjs/jwt"
import { PassportModule } from "@nestjs/passport"
import { AppStrategy } from "./app.strategy"
import { CodeStrategy } from "./code.strategy"
import { NotificationModule } from "src/notification/notification.module"
import { HttpModule } from "@nestjs/axios"
import { OpenAppModule } from "src/open-app/open-app.module"

@Module({
    imports: [
        forwardRef(() => UserModule),
        PassportModule,
        NotificationModule,
        JwtModule.register({
            secret: process.env.SESSION_SECRET,
            signOptions: { expiresIn: "7d" },
        }),
        HttpModule,
        OpenAppModule,
    ],
    controllers: [AuthController],
    providers: [AuthService, PrismaService, GoogleStrategy, JwtStrategy, LocalStrategy, AppStrategy, CodeStrategy],
    exports: [AuthService],
})
export class AuthModule {}
