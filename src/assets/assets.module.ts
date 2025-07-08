import { forwardRef, Module } from "@nestjs/common"
import { AssetsController } from "./assets.controller"
import { AssetsService } from "./assets.service"
import { PrismaService } from "src/common/prisma.service"
import { UtilitiesService } from "src/common/utilities.service"
import { TaskModule } from "src/task/task.module"
import { IpLibraryModule } from "src/ip-library/ip-library.module"
import { UserModule } from "src/user/user.module"

@Module({
    imports: [TaskModule, forwardRef(() => IpLibraryModule), forwardRef(() => UserModule)],
    controllers: [AssetsController],
    providers: [AssetsService, PrismaService, UtilitiesService],
    exports: [AssetsService],
})
export class AssetsModule {}
