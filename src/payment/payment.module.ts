import { forwardRef, Module } from "@nestjs/common"
import { PaymentService } from "./payment.service"
import { PaymentController } from "./payment.controller"
import { PrismaService } from "src/common/prisma.service"
import { ConfigService } from "@nestjs/config"
import { HttpModule } from "@nestjs/axios"
import { StripeModule } from "nestjs-stripe"
import { CreditService } from "src/credit/credit.service"
import { CreditModule } from "src/credit/credit.module"
import { OrderController } from "./order/order.controller"
import { RewardsPoolController } from "./rewards-pool/rewards-pool.controller"
import { OrderService } from "./order/order.service"
import { UserModule } from "src/user/user.module"
import { Web3Module } from "src/web3/web3.module"
import { OpenAppModule } from "src/open-app/open-app.module"
import { RewardsPoolService } from "./rewards-pool/rewards-pool.service"
import { JwtModule } from "@nestjs/jwt"

@Module({
    imports: [
        HttpModule,
        StripeModule.forRoot({
            apiKey: process.env.STRIPE_SECRET_KEY,
        }),
        forwardRef(() => CreditModule),
        forwardRef(() => UserModule),
        forwardRef(() => Web3Module),
        forwardRef(() => OpenAppModule),
        JwtModule.register({}),
    ],
    controllers: [PaymentController, OrderController, RewardsPoolController],
    providers: [PaymentService, PrismaService, ConfigService, CreditService, OrderService, RewardsPoolService],
    exports: [OrderService, RewardsPoolService],
})
export class PaymentModule {}
