import { Processor, WorkerHost } from "@nestjs/bullmq"
import { Job } from "bullmq"
import { PrismaService } from "src/common/prisma.service"
import { Logger } from "@nestjs/common"
import { PinataSDK } from "pinata-web3"
import { UtilitiesService } from "src/common/utilities.service"
import { AssetsService } from "./assets.service"

interface IpfsUploadJobData {
    asset_id: string
}

@Processor("ipfs-upload-queue")
export class IpfsUploadQueue extends WorkerHost {
    private readonly logger = new Logger(IpfsUploadQueue.name)
    constructor(
        private readonly prismaService: PrismaService,
        private readonly utilitiesService: UtilitiesService,
        private readonly assetsService: AssetsService,
    ) {
        super()
    }
    async process(job: Job<IpfsUploadJobData, null, string>): Promise<null> {
        try {
            //upload asset to ipfs
            const asset = await this.prismaService.assets.findUnique({ where: { asset_id: job.data.asset_id } })
            if (!asset) {
                this.logger.error(`Asset not found on process upload to ipfs: ${job.data.asset_id}`)
                return null
            }
            //upload asset to ipfs
            await this.assetsService.uploadAssetToIpfs(asset.path, asset.asset_id)
            return null
        } catch (error) {
            this.logger.error(`Error uploading asset to ipfs: ${error}`)
            return null
        }
    }
}
