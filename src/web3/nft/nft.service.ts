import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common"
import { UserJwtExtractDto } from "src/user/user.controller"
import { MyNftReqDto, NftDetailResDto } from "./nft.dto"
import { PrismaService } from "src/common/prisma.service"
import { Prisma, user_nfts } from "@prisma/client"
import { isEmail } from "class-validator"

@Injectable()
export class NftService {
    constructor(private readonly prisma: PrismaService) {}
    /** NFT minting is retired: it was the only Redis/BullMQ consumer left and had
     *  no users, so the queue was removed along with the worker. The endpoint stays
     *  registered so existing clients get a clear 503 instead of a 404, and
     *  GET /api/v1/nft/my keeps serving the historical records. */
    async mintNft(): Promise<never> {
        throw new ServiceUnavailableException("NFT minting is no longer available")
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
