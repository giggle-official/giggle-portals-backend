import { HttpModule } from "@nestjs/axios"
import { forwardRef, Module } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { UserService } from "src/user/user.service"
import { CreditService } from "src/credit/credit.service"
import { NotificationModule } from "src/notification/notification.module"
import { PaymentService } from "src/payment/payment.service"
import { UtilitiesService } from "src/common/utilities.service"
import { TaskModule } from "src/task/task.module"
import { AssetsModule } from "src/assets/assets.module"
import { FaceSwapController } from "./face-swap/face-swap.controller"
import { FaceSwapService } from "./face-swap/face-swap.service"
import { VideoToVideoController } from "./video-to-video/video-to-video.controller"
import { VideoToVideoService } from "./video-to-video/video-to-video.service"
import { GenerateVideoController } from "./generate-video/generate-video.controller"
import { GenerateVideoService } from "./generate-video/generate-video.service"
import { GenerateImageController } from "./generate-image/generate-image.controller"
import { GenerateImageService } from "./generate-image/generate-image.service"
import { Web3Module } from "src/web3/web3.module"

@Module({
    imports: [
        HttpModule,
        NotificationModule,
        forwardRef(() => TaskModule),
        forwardRef(() => AssetsModule),
        forwardRef(() => Web3Module),
    ],
    controllers: [FaceSwapController, VideoToVideoController, GenerateVideoController, GenerateImageController],
    providers: [
        UtilitiesService,
        PaymentService,
        PrismaService,
        UserService,
        CreditService,
        FaceSwapService,
        VideoToVideoService,
        GenerateVideoService,
        GenerateImageService,
    ],
    exports: [VideoToVideoService, FaceSwapService, GenerateVideoService, GenerateImageService],
})
export class UniversalStimulatorModule {}
