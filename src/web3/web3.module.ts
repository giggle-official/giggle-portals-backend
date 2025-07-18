import { forwardRef, Module, Provider } from "@nestjs/common"
import { HttpModule } from "@nestjs/axios"
import { BullModule } from "@nestjs/bullmq"
import { GiggleController } from "./giggle/giggle.controller"
import { GiggleService } from "./giggle/giggle.service"
import { AssetsModule } from "src/assets/assets.module"
import { PrismaService } from "src/common/prisma.service"
import { UtilitiesService } from "src/common/utilities.service"
import { UserModule } from "src/user/user.module"
import { IpOnChainService } from "./ip-on-chain/ip-on-chain.service"
import { IpLibraryModule } from "src/ip-library/ip-library.module"
import { PriceController } from "./price/price.controller"
import { PriceService } from "./price/price.service"
import { RewardPoolOnChainService } from "./reward-pool-on-chain/reward-pool-on-chain.service"
import { LaunchAgentService } from "./launch-agent/launch-agent.service"
import { LaunchAgentController } from "./launch-agent/launch-agent.controller"
import { NftController } from "./nft/nft.controller"
import { NftService } from "./nft/nft.service"
import { NftMintQueue } from "./nft/nft-mint.queue"

//enable ipfs upload queue only on task slot 1
const queueProviders: Provider[] = []
if (process.env.TASK_SLOT == "1") {
    queueProviders.push(NftMintQueue)
}

@Module({
    imports: [
        HttpModule,
        BullModule.registerQueue({
            name: "nft-mint-queue",
        }),
        forwardRef(() => AssetsModule),
        forwardRef(() => UserModule),
        forwardRef(() => IpLibraryModule),
    ],
    providers: [
        ...queueProviders,
        GiggleService,
        PrismaService,
        UtilitiesService,
        IpOnChainService,
        PriceService,
        RewardPoolOnChainService,
        LaunchAgentService,
        NftService,
    ],
    controllers: [GiggleController, PriceController, LaunchAgentController, NftController],
    exports: [GiggleService, IpOnChainService, PriceService, LaunchAgentService, RewardPoolOnChainService],
})
export class Web3Module {}
