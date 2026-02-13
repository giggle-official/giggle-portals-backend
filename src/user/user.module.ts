import { Module, forwardRef } from "@nestjs/common"
import { UserController } from "./user.controller"
import { ApiKeysController } from "./api-keys/api-keys.controller"
import { UserService } from "./user.service"
import { PrismaService } from "src/common/prisma.service"
import { AuthModule } from "src/auth/auth.module"
import { HttpModule } from "@nestjs/axios"
import { NotificationModule } from "src/notification/notification.module"
import { PaymentService } from "src/payment/payment.service"
import { LogsService } from "./logs/logs.service"
import { ApiKeysService } from "./api-keys/api-keys.service"
import { Web3Module } from "src/web3/web3.module"
import { OpenAppModule } from "src/open-app/open-app.module"
import { UtilitiesService } from "src/common/utilities.service"
import { PaymentModule } from "src/payment/payment.module"
@Module({
    imports: [
        forwardRef(() => AuthModule),
        NotificationModule,
        HttpModule,
        forwardRef(() => Web3Module),
        forwardRef(() => OpenAppModule),
        forwardRef(() => PaymentModule),
    ],
    controllers: [UserController, ApiKeysController],
    providers: [UserService, PrismaService, PaymentService, LogsService, ApiKeysService, UtilitiesService],
    exports: [UserService, LogsService],
})
export class UserModule {}
