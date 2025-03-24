import { forwardRef, Module } from "@nestjs/common"
import { PaymentService } from "./payment.service"
import { PaymentController } from "./payment.controller"
import { PrismaService } from "src/common/prisma.service"
import { ConfigService } from "@nestjs/config"
import { HttpModule } from "@nestjs/axios"
import { StripeModule } from "nestjs-stripe"
import { CreditService } from "src/credit/credit.service"
import { CreditModule } from "src/credit/credit.module"
@Module({
    imports: [
        HttpModule,
        StripeModule.forRoot({
            apiKey: process.env.STRIPE_SECRET_KEY,
        }),
        forwardRef(() => CreditModule),
    ],
    controllers: [PaymentController],
    providers: [PaymentService, PrismaService, ConfigService, CreditService],
    exports: [PaymentService],
})
export class PaymentModule {}
