import { Module } from "@nestjs/common"
import { CreditService } from "./credit.service"
import { PrismaService } from "src/common/prisma.service"
import { PaymentService } from "src/payment/payment.service"
import { HttpModule } from "@nestjs/axios"

@Module({
    imports: [HttpModule],
    providers: [CreditService, PrismaService, PaymentService],
    exports: [CreditService],
})
export class CreditModule {}
