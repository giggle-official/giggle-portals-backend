import { forwardRef, Module } from "@nestjs/common"
import { TaskService } from "./task.service"
import { HttpModule } from "@nestjs/axios"
import { PrismaService } from "src/common/prisma.service"
import { PaymentModule } from "src/payment/payment.module"

@Module({
    imports: [HttpModule, forwardRef(() => PaymentModule)],
    providers: [TaskService, PrismaService],
    exports: [TaskService],
})
export class TaskModule {}
