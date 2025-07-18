import { forwardRef, Module, Provider } from "@nestjs/common"
import { AssetsController } from "./assets.controller"
import { AssetsService } from "./assets.service"
import { PrismaService } from "src/common/prisma.service"
import { UtilitiesService } from "src/common/utilities.service"
import { TaskModule } from "src/task/task.module"
import { IpLibraryModule } from "src/ip-library/ip-library.module"
import { UserModule } from "src/user/user.module"
import { HttpModule } from "@nestjs/axios"
import { BullModule } from "@nestjs/bullmq"
import { IpfsUploadQueue } from "./ipfs.upload.queue"

//enable ipfs upload queue only on task slot 1
const queueProviders: Provider[] = []
if (process.env.TASK_SLOT == "1") {
    queueProviders.push(IpfsUploadQueue)
}

@Module({
    imports: [
        TaskModule,
        forwardRef(() => IpLibraryModule),
        forwardRef(() => UserModule),
        HttpModule,
        BullModule.registerQueue({
            name: "ipfs-upload-queue",
        }),
    ],
    controllers: [AssetsController],
    providers: [...queueProviders, AssetsService, PrismaService, UtilitiesService],
    exports: [AssetsService],
})
export class AssetsModule {}
