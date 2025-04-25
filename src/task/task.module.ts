import { forwardRef, Module } from "@nestjs/common"
import { TaskService } from "./task.service"
import { HttpModule } from "@nestjs/axios"
import { PrismaService } from "src/common/prisma.service"
import { CreditModule } from "src/credit/credit.module"

@Module({
    imports: [HttpModule, forwardRef(() => CreditModule)],
    providers: [TaskService, PrismaService],
    exports: [TaskService],
})
export class TaskModule {}
