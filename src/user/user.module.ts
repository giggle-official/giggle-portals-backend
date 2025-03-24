import { Module, forwardRef } from "@nestjs/common"
import { UserController } from "./user.controller"
import { UserService } from "./user.service"
import { PrismaService } from "src/common/prisma.service"
import { AuthModule } from "src/auth/auth.module"
import { HttpModule } from "@nestjs/axios"
import { NotificationModule } from "src/notification/notification.module"
import { CreditService } from "src/credit/credit.service"
import { PaymentService } from "src/payment/payment.service"
import { LogsService } from "./logs/logs.service"
import { ApiKeysService } from "./api-keys/api-keys.service"
import { Web3Module } from "src/web3/web3.module"
@Module({
    imports: [forwardRef(() => AuthModule), NotificationModule, HttpModule, forwardRef(() => Web3Module)],
    controllers: [UserController],
    providers: [UserService, PrismaService, PaymentService, CreditService, LogsService, ApiKeysService],
    exports: [UserService, LogsService],
})
export class UserModule {}
