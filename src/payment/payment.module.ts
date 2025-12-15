import { forwardRef, Module } from "@nestjs/common"
import { PaymentService } from "./payment.service"
import { PaymentController } from "./payment.controller"
import { PrismaService } from "src/common/prisma.service"
import { ConfigService } from "@nestjs/config"
import { HttpModule } from "@nestjs/axios"
import { StripeModule } from "nestjs-stripe"
import { CreditService } from "./credit/credit.service"
import { OrderController } from "./order/order.controller"
import { RewardsPoolController } from "./rewards-pool/rewards-pool.controller"
import { OrderService } from "./order/order.service"
import { UserModule } from "src/user/user.module"
import { Web3Module } from "src/web3/web3.module"
import { OpenAppModule } from "src/open-app/open-app.module"
import { RewardsPoolService } from "./rewards-pool/rewards-pool.service"
import { JwtModule } from "@nestjs/jwt"
import { PaymentAsiaService } from "./payment-asia/payment-asia.service"
import { CreditController } from "./credit/credit.controller"
import { SalesAgentController } from "./sales-agent/sales-agent.controller"
import { SalesAgentService } from "./sales-agent/sales-agent.service"
import { Credit2cService } from "./credit-2c/credit-2c.service"
import { Credit2cController } from "./credit-2c/credit-2c.controller"
import { WidgetCaslAbilityFactory } from "src/casl/casl-ability.factory/widget-casl-ability.factory"
import { SettleService } from "./settle/settle.service"
import { NotificationModule } from "src/notification/notification.module"
import { SettleController } from "./settle/settle.controller"

@Module({
    imports: [
        HttpModule,
        StripeModule.forRoot({
            apiKey: process.env.STRIPE_SECRET_KEY,
        }),
        forwardRef(() => UserModule),
        forwardRef(() => Web3Module),
        forwardRef(() => OpenAppModule),
        JwtModule.register({}),
        NotificationModule,
    ],
    controllers: [
        PaymentController,
        OrderController,
        RewardsPoolController,
        CreditController,
        SalesAgentController,
        Credit2cController,
        SettleController,
    ],
    providers: [
        PaymentService,
        PrismaService,
        ConfigService,
        CreditService,
        OrderService,
        RewardsPoolService,
        PaymentAsiaService,
        CreditService,
        SalesAgentService,
        Credit2cService,
        WidgetCaslAbilityFactory,
        SettleService,
        SettleController,
    ],
    exports: [OrderService, RewardsPoolService, SalesAgentService, CreditService, SettleService],
})
export class PaymentModule {}
