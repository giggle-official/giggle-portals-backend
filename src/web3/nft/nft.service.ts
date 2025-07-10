import { Injectable } from "@nestjs/common"

import { UserJwtExtractDto } from "src/user/user.controller"
import { MintNftReqDto, MyNftReqDto } from "./nft.dto"
import { PrismaService } from "src/common/prisma.service"
import { InjectQueue } from "@nestjs/bullmq"
import { Queue } from "bullmq"

@Injectable()
export class NftService {
    constructor(
        private readonly prisma: PrismaService,
        //@InjectQueue("nft-mint-queue") private readonly nftMintQueue: Queue,
    ) {}
    async mintNft(req: UserJwtExtractDto, body: MintNftReqDto) {
        // todo
    }

    async getMintNftTask(task_id: string) {
        // todo
    }

    async getMyNfts(req: UserJwtExtractDto, query: MyNftReqDto) {
        // todo
    }
}
