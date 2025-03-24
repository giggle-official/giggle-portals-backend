import { forwardRef, Module } from "@nestjs/common"
import { TaskService } from "./task.service"
import { HttpModule } from "@nestjs/axios"
import { UniversalStimulatorModule } from "src/universal-stimulator/universal-stimulator.module"
import { PrismaService } from "src/common/prisma.service"
import { CreditModule } from "src/credit/credit.module"

@Module({
    imports: [HttpModule, forwardRef(() => UniversalStimulatorModule), forwardRef(() => CreditModule)],
    providers: [TaskService, PrismaService],
    exports: [TaskService],
})
export class TaskModule {}
