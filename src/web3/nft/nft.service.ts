import { BadRequestException, Injectable } from "@nestjs/common"
import { UserJwtExtractDto } from "src/user/user.controller"
import { MintNftReqDto, MyNftReqDto, NftDetailResDto, NftMintJobDataDto } from "./nft.dto"
import { PrismaService } from "src/common/prisma.service"
import { InjectQueue } from "@nestjs/bullmq"
import { Queue } from "bullmq"
import { GiggleService } from "src/web3/giggle/giggle.service"
import { v4 as uuidv4 } from "uuid"
import { UserService } from "src/user/user.service"
import { Prisma, user_nfts } from "@prisma/client"
import { isEmail } from "class-validator"

@Injectable()
export class NftService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly giggleService: GiggleService,
        private readonly userService: UserService,
        @InjectQueue("nft-mint-queue") private readonly nftMintQueue: Queue,
    ) {}
    async mintNft(user: UserJwtExtractDto, body: MintNftReqDto) {
        //check balance
        const userProfile = await this.userService.getProfile(user)
        const userUsdtBalance = await this.giggleService.getUsdcBalance(user)
        if (userUsdtBalance.balance < 6) {
            throw new BadRequestException("Insufficient balance for minting nft, top-up least 6 USDC")
        }

        //check cover asset
        const coverAsset = await this.prisma.assets.findUnique({
            where: { asset_id: body.cover_asset_id, type: "image", user: user.usernameShorted },
        })
        if (!coverAsset) {
            throw new BadRequestException("Cover asset not found or not an image")
        }

        //check video asset
        if (body?.video_asset_id) {
            const videoAsset = await this.prisma.assets.findUnique({
                where: { asset_id: body.video_asset_id, type: "video", user: user.usernameShorted },
            })
            if (!videoAsset) {
                throw new BadRequestException("Video asset not found or not a video")
            }
        }

        const userDetail = await this.prisma.users.findUnique({
            where: { username_in_be: user.usernameShorted },
        })

        const jobId = uuidv4()

        //create data in db
        const nft = await this.prisma.$transaction(async (tx) => {
            const nft = await tx.user_nfts.create({
                data: {
                    user: user.usernameShorted,
                    collection: userDetail.collection,
                    status: "pending",
                    mint_task_id: jobId,
                    cover_asset_id: body.cover_asset_id,
                    video_asset_id: body?.video_asset_id,
                    widget_tag: userProfile?.widget_info?.widget_tag,
                    app_id: userProfile?.widget_info?.app_id,
                },
            })

            //put it to queue
            await this.nftMintQueue.add(
                "mint-nft",
                {
                    user: user.usernameShorted,
                    collection: userDetail.collection,
                    cover_asset_id: body.cover_asset_id,
                    video_asset_id: body?.video_asset_id,
                    name: body.name,
                    description: body.description,
                } as NftMintJobDataDto,
                {
                    jobId: jobId,
                },
            )
            return nft
        })

        return this.mapNftDetail(nft)
    }

    async getMyNfts(req: UserJwtExtractDto, query: MyNftReqDto) {
        let userId = req.usernameShorted
        if (req?.developer_info) {
            if (!query.email || !isEmail(query.email)) {
                throw new BadRequestException("Must be a valid email when requester is developer")
            }
            const user = await this.prisma.users.findUnique({
                where: { email: query.email },
            })
            if (!user) {
                return {
                    nfts: [],
                    total: 0,
                }
            }
            userId = user.username_in_be
        }

        const where: Prisma.user_nftsWhereInput = {
            user: userId,
        }

        if (query.mint) {
            where.mint = query.mint
        }

        if (query.task_id) {
            where.mint_task_id = query.task_id
        }

        if (query.status) {
            where.status = query.status
        }
        const nfts = await this.prisma.user_nfts.findMany({
            where,
            skip: Math.max(0, parseInt(query.page.toString()) - 1) * Math.max(0, parseInt(query.page_size.toString())),
            take: Math.max(0, parseInt(query.page_size.toString()) || 10),
            orderBy: {
                id: "desc",
            },
        })

        const total = await this.prisma.user_nfts.count({ where })

        return {
            nfts: nfts.map((nft) => this.mapNftDetail(nft)),
            total,
        }
    }

    mapNftDetail(nft: user_nfts): NftDetailResDto {
        return {
            user: nft.user,
            mint_task_id: nft.mint_task_id || "",
            mint: nft.mint,
            collection: nft.collection,
            metadata: nft.metadata as object,
            mint_status: nft.status,
            failure_reason: nft.failure_reason,
            signature: nft.signature || "",
            cover_asset_id: nft.cover_asset_id,
            video_asset_id: nft.video_asset_id,
            widget_tag: nft.widget_tag,
            app_id: nft.app_id,
        }
    }
}
