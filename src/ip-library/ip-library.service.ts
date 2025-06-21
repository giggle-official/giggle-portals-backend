import { BadRequestException, forwardRef, Inject, Injectable, Ip, Logger, NotFoundException } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import {
    AddShareCountDto,
    AvailableParentIpDto,
    CreateIpDto,
    EditIpDto,
    GenreDto,
    GetListParams,
    IpLibraryDetailDto,
    IpLibraryListDto,
    IpNameCheckDto,
    IpSignatureClipDto,
    IpSignatureClipMetadataDto,
    IpSummaryDto,
    IpSummaryWithChildDto,
    PurchasedIpDto,
    PurchaseStrategyDto,
    PurchaseStrategyType,
    SetVisibilityDto,
    LaunchIpTokenDto,
    UntokenizeDto,
    IpEvents,
    IpEventsDetail,
    EventDto,
    IpBindAppsDto,
} from "./ip-library.dto"
import { app_bind_ips, assets, Prisma } from "@prisma/client"
import { UtilitiesService } from "src/common/utilities.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { AssetsService } from "src/assets/assets.service"
import { UserService } from "src/user/user.service"
import { CreditService } from "src/credit/credit.service"
import { GiggleService } from "src/web3/giggle/giggle.service"
import { IpOnChainService } from "src/web3/ip-on-chain/ip-on-chain.service"
import { Observable, Subscriber } from "rxjs"
import { CreateIpTokenDto, CreateIpTokenGiggleResponseDto, SSEMessage } from "src/web3/giggle/giggle.dto"
import { PinataSDK } from "pinata-web3"
import { AssetDetailDto } from "src/assets/assets.dto"
import { PriceService } from "src/web3/price/price.service"
import { OnChainDetailDto } from "src/web3/ip-on-chain/ip-on-chain.dto"
import { OrderStatus } from "src/payment/order/order.dto"
import { RewardsPoolService } from "src/payment/rewards-pool/rewards-pool.service"
import { ParseLaunchLaunchPlanResponseDto } from "src/web3/launch-agent/launch-agent.dto"
import { LaunchAgentService } from "src/web3/launch-agent/launch-agent.service"

@Injectable()
export class IpLibraryService {
    private readonly logger = new Logger(IpLibraryService.name)
    public static readonly SHARE_TO_GIGGLE_USDT_AMOUNT = 6
    public static readonly DEFAULT_LICENSOR_RATIO = 45
    public static readonly DEFAULT_PLATFORM_RATIO = 5
    public static readonly DEFAULT_COMMUNITY_RATIO = 5
    public static readonly DEFAULT_TREASURY_RATIO = 45
    public static readonly DEFAULT_LICENSE_PRICE = 1 // remix video price per minute

    constructor(
        private readonly prismaService: PrismaService,
        private readonly utilitiesService: UtilitiesService,

        @Inject(forwardRef(() => AssetsService))
        private readonly assetsService: AssetsService,

        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,

        @Inject(forwardRef(() => CreditService))
        private readonly creditService: CreditService,

        @Inject(forwardRef(() => GiggleService))
        private readonly giggleService: GiggleService,

        @Inject(forwardRef(() => IpOnChainService))
        private readonly ipOnChainService: IpOnChainService,

        @Inject(forwardRef(() => PriceService))
        private readonly priceService: PriceService,

        @Inject(forwardRef(() => RewardsPoolService))
        private readonly rewardsPoolService: RewardsPoolService,

        @Inject(forwardRef(() => LaunchAgentService))
        private readonly launchAgentService: LaunchAgentService,
    ) {}

    getLaunchIpTokenSteps(): EventDto[] {
        return IpEventsDetail.filter((item) =>
            [
                IpEvents.DATA_VALIDATING,
                IpEvents.IP_ASSET_TO_IPFS,
                IpEvents.IP_TOKEN_CREATING,
                IpEvents.IP_TOKEN_CREATING_REWARD_POOL,
                IpEvents.IP_TOKEN_RUN_STRATEGY,
                IpEvents.IP_TOKEN_CREATED_ON_CHAIN,
            ].includes(item.event),
        )
    }

    getGenres(): GenreDto[] {
        return [
            {
                name: "Novel",
                value: "novel",
            },
            {
                name: "Film",
                value: "film",
            },
            {
                name: "TV Show",
                value: "tv",
            },
            {
                name: "Short Drama",
                value: "drama",
            },
            {
                name: "Community",
                value: "community",
            },
            {
                name: "Culture",
                value: "culture",
            },
            {
                name: "MAGA",
                value: "maga",
            },
            {
                name: "Mascot",
                value: "mascot",
            },
            {
                name: "Utility",
                value: "utility",
            },
            {
                name: "Funny",
                value: "funny",
            },
            {
                name: "Meme",
                value: "meme",
            },
            {
                name: "Others",
                value: "others",
            },
        ]
    }

    getTerritories() {
        return [
            {
                name: "Asia",
                value: "asia",
                children: [
                    {
                        name: "China",
                        value: "china",
                    },
                    {
                        name: "Japan",
                        value: "japan",
                    },
                    {
                        name: "South Korea",
                        value: "south-korea",
                    },
                    {
                        name: "India",
                        value: "india",
                    },
                    {
                        name: "Singapore",
                        value: "singapore",
                    },
                    {
                        name: "Malaysia",
                        value: "malaysia",
                    },
                    {
                        name: "Thailand",
                        value: "thailand",
                    },
                    {
                        name: "Vietnam",
                        value: "vietnam",
                    },
                    {
                        name: "Philippines",
                        value: "philippines",
                    },
                    {
                        name: "Indonesia",
                        value: "indonesia",
                    },
                ],
            },
            {
                name: "Europe",
                value: "europe",
                children: [
                    {
                        name: "United Kingdom",
                        value: "united-kingdom",
                    },
                    {
                        name: "Germany",
                        value: "germany",
                    },
                    {
                        name: "France",
                        value: "france",
                    },
                    {
                        name: "Italy",
                        value: "italy",
                    },
                    {
                        name: "Spain",
                        value: "spain",
                    },
                    {
                        name: "Netherlands",
                        value: "netherlands",
                    },
                    {
                        name: "Switzerland",
                        value: "switzerland",
                    },
                    {
                        name: "Sweden",
                        value: "sweden",
                    },
                    {
                        name: "Russia",
                        value: "russia",
                    },
                    {
                        name: "Poland",
                        value: "poland",
                    },
                ],
            },
            {
                name: "North America",
                value: "na",
                children: [
                    {
                        name: "United States",
                        value: "united-states",
                    },
                    {
                        name: "Canada",
                        value: "canada",
                    },
                    {
                        name: "Mexico",
                        value: "mexico",
                    },
                ],
            },
            {
                name: "South America",
                value: "sa",
                children: [
                    {
                        name: "Brazil",
                        value: "brazil",
                    },
                    {
                        name: "Argentina",
                        value: "argentina",
                    },
                    {
                        name: "Chile",
                        value: "chile",
                    },
                    {
                        name: "Colombia",
                        value: "colombia",
                    },
                    {
                        name: "Peru",
                        value: "peru",
                    },
                ],
            },
            {
                name: "Africa",
                value: "africa",
                children: [
                    {
                        name: "South Africa",
                        value: "south-africa",
                    },
                    {
                        name: "Egypt",
                        value: "egypt",
                    },
                    {
                        name: "Nigeria",
                        value: "nigeria",
                    },
                    {
                        name: "Kenya",
                        value: "kenya",
                    },
                    {
                        name: "Morocco",
                        value: "morocco",
                    },
                ],
            },
            {
                name: "Oceania",
                value: "oceania",
                children: [
                    {
                        name: "Australia",
                        value: "australia",
                    },
                    {
                        name: "New Zealand",
                        value: "new-zealand",
                    },
                ],
            },
            {
                name: "Middle East",
                value: "middle-east",
                children: [
                    {
                        name: "United Arab Emirates (UAE)",
                        value: "united-arab-emirates",
                    },
                    {
                        name: "Saudi Arabia",
                        value: "saudi-arabia",
                    },
                    {
                        name: "Israel",
                        value: "israel",
                    },
                    {
                        name: "Turkey",
                        value: "turkey",
                    },
                    {
                        name: "Qatar",
                        value: "qatar",
                    },
                ],
            },
        ]
    }

    async getList(
        params: GetListParams,
        is_public: boolean | null,
        user?: UserJwtExtractDto, // note: this is the user params to filter the ip
        ids?: number[],
        app_id?: string,
        request_user?: UserJwtExtractDto, // note: this is the user who is requesting the list
    ): Promise<IpLibraryListDto> {
        const where: Prisma.ip_libraryWhereInput = {}

        if (is_public !== null) {
            where.is_public = is_public
        }

        const include: Prisma.ip_libraryInclude = {
            user_info: true,
            ip_signature_clips: true,
            ip_library_child: true,
            ip_share_count: true,
            app_bind_ips: true,
            _count: {
                select: {
                    ip_comments: true,
                },
            },
        }
        const skip =
            Math.max(0, parseInt(params.page.toString()) - 1) * Math.max(0, parseInt(params.page_size.toString()))
        const take = Math.max(0, parseInt(params.page_size.toString()) || 10)

        if (params.genre) {
            const genres = params.genre.split(",")
            const genreList = this.getGenres()
            where.AND = genres.map((item) => {
                const _g = genreList.find((genre) => genre.value === item) as any
                if (_g) {
                    return {
                        genre: {
                            array_contains: _g,
                        },
                    }
                }
                return null
            })
        }

        let orCondition: Prisma.ip_libraryWhereInput[] = []
        if (params.search) {
            orCondition = [
                ...orCondition,
                {
                    name: {
                        contains: params.search,
                    },
                },
                {
                    imdb_code: {
                        equals: params.search,
                    },
                },
                {
                    director: {
                        path: "$.name",
                        string_contains: params.search,
                    },
                },
            ]
        }

        if (params.tag) {
            where.ip_library_tags = {
                some: {
                    tag: params.tag,
                },
            }
            include.ip_library_tags = {
                orderBy: {
                    priority: "desc",
                },
            }
        }

        if (orCondition.length > 0) {
            where.OR = orCondition
        }

        if (user) {
            where.owner = user.usernameShorted
        }

        if (params.owner) {
            where.owner = params.owner
            params.launched_to_giggle = "true"
        }

        if (params.launched_to_giggle === "true") {
            where.token_info = {
                path: "$.mint",
                not: null,
            }
        } else if (params.launched_to_giggle === "false") {
            where.token_info = {
                path: "$.mint",
                equals: Prisma.DbNull,
            }
        }

        if (ids) {
            where.id = {
                in: ids,
            }
        }

        if (params.is_top === "true") {
            where.ip_library_child = {
                none: {},
            }
        }

        if (params.ip_level) {
            where.ip_levels = parseInt(params.ip_level)
        }

        if (app_id) {
            //request from app
            const app = await this.prismaService.apps.findUnique({
                where: { app_id },
                include: {
                    app_bind_ips: true,
                },
            })
            const rootIp = app.app_bind_ips.map((item) => item.ip_id)?.[0]
            if (!app || !rootIp) {
                throw new BadRequestException("App not found or app not bind to any ip")
            }
            //where.owner = app.creator
            const childIps = await this.prismaService.ip_library_child.findMany({
                where: {
                    parent_ip: rootIp,
                },
            })

            //third level ip
            const thirdLevelIps = await this.prismaService.ip_library_child.findMany({
                where: {
                    parent_ip: {
                        in: childIps.map((item) => item.ip_id),
                    },
                },
            })
            where.id = {
                in: [...childIps.map((item) => item.ip_id), ...thirdLevelIps.map((item) => item.ip_id)],
            }
        }

        if (params.token_mint) {
            where.token_mint = params.token_mint
        }

        let orderBy: Prisma.ip_libraryOrderByWithRelationInput = {
            created_at: "desc",
        }
        if (params?.sort_field) {
            const field = params.sort_field
            if (["price", "market_cap", "trade_volume", "change1h", "change5m", "change24h"].includes(field)) {
                orderBy = {
                    view_ip_token_prices: {
                        [field]: params.sort_by || "desc",
                    },
                }
            } else {
                orderBy = {
                    [field]: params.sort_by || "desc",
                }
            }
        }

        const data = await this.prismaService.ip_library.findMany({
            where,
            include,
            orderBy,
            skip,
            take,
        })
        const count = await this.prismaService.ip_library.count({
            where,
        })
        const result: IpSummaryWithChildDto[] = await Promise.all(
            data.map(async (item) => {
                const cover_images = item.cover_images as any[]
                item?.cover_images && delete item.cover_images
                const cover_image =
                    cover_images?.length > 0 && cover_images[0]?.key
                        ? await this.utilitiesService.createS3SignedUrl(
                              cover_images[0].key,
                              await this.utilitiesService.getIpLibraryS3Info(),
                          )
                        : null
                const cover_hash = cover_images?.[0]?.hash || null
                const cover_asset_id = await this.getCoverAssetId(item.id)
                const meta_data = item.meta_data as any
                const child_ip_info = await this._getChildIps({
                    ip_id: item.id,
                    is_public,
                    take: 100,
                    user,
                    request_user,
                })

                const apps = await this.getIpBindApps(item.app_bind_ips)
                const res = {
                    id: item.id,
                    name: item.name,
                    ticker: item.ticker,
                    description: item.description,
                    likes: item.likes,
                    comments: item._count.ip_comments,
                    is_user_liked: await this.isUserLiked(item.id, request_user),
                    share_count: item.ip_share_count?.share_count || 0,
                    cover_asset_id,
                    can_purchase: false,
                    on_chain_detail: item.on_chain_detail as any,
                    cover_image: cover_image,
                    cover_hash,
                    creation_guide_lines: item.creation_guide_lines,
                    is_top: item.ip_library_child.length === 0,
                    ip_level: item.ip_levels,
                    is_public: item.is_public,
                    token_info: this._processTokenInfo(item.token_info as any, item.current_token_info as any),
                    meta_data,
                    creator_id: item.user_info?.username_in_be || "",
                    creator: item.user_info?.username || "",
                    creator_description: item.user_info?.description || "",
                    creator_followers: item.user_info?.followers || 0,
                    creator_avatar: item.user_info?.avatar || "",
                    governance_right: true,
                    child_ip_info,
                    ip_signature_clips: await this._processIpSignatureClips(item.ip_signature_clips as any[]),
                    apps,
                }
                return res
            }),
        )
        return {
            data: result,
            count,
        }
    }

    async detail(
        id: string,
        is_public: boolean | null,
        user?: UserJwtExtractDto, // note: this is the user params to filter the ip
        request_user?: UserJwtExtractDto, // note: this is the user who is requesting the detail
    ): Promise<IpLibraryDetailDto> {
        const where: Prisma.ip_libraryWhereUniqueInput = { id: parseInt(id) }

        if (is_public !== null) {
            where.is_public = is_public
        }

        if (user) {
            where.owner = user.usernameShorted
        }

        const data = await this.prismaService.ip_library.findUnique({
            where,
            include: {
                user_info: true,
                ip_signature_clips: true,
                ip_share_count: true,
                ip_library_child: true,
                app_bind_ips: true,
                _count: {
                    select: {
                        ip_comments: true,
                    },
                },
            },
        })
        if (!data) {
            throw new NotFoundException("IP library not found or you don't have permission to access this ip")
        }
        const s3Info = await this.utilitiesService.getIpLibraryS3Info()

        let cover_image = null
        let cover_hash = null
        if (data?.cover_images) {
            const cover_images = data.cover_images as any[]
            cover_image =
                cover_images?.length > 0 && cover_images[0]?.key
                    ? await this.utilitiesService.createS3SignedUrl(cover_images[0].key, s3Info)
                    : null
            cover_hash = cover_images[0]?.hash
        }

        //get parent ip info
        let parentIpInfo: IpSummaryDto[] = []
        if (data.ip_library_child.length > 0) {
            const parentWhere: Prisma.ip_libraryWhereInput = {
                id: {
                    in: data.ip_library_child.map((item) => item.parent_ip),
                },
            }
            if (is_public !== null) {
                parentWhere.is_public = is_public
            }
            const parentIps = await this.prismaService.ip_library.findMany({
                where: parentWhere,
                include: {
                    ip_signature_clips: true,
                    ip_library_child: true,
                    ip_share_count: true,
                    app_bind_ips: true,
                    user_info: true,
                    _count: {
                        select: {
                            ip_comments: true,
                        },
                    },
                },
            })
            for (const item of parentIps) {
                let cover_image = ""
                let cover_hash = ""
                const coverImage = (item.cover_images as any[]).length > 0 ? item.cover_images[0] : null
                cover_image = coverImage?.key
                    ? await this.utilitiesService.createS3SignedUrl(coverImage.key, s3Info)
                    : null
                cover_hash = coverImage?.hash
                parentIpInfo.push({
                    id: item.id,
                    name: item.name,
                    ticker: item.ticker,
                    description: item.description,
                    can_purchase: false,
                    cover_asset_id: await this.getCoverAssetId(item.id),
                    cover_image,
                    cover_hash,
                    creation_guide_lines: item.creation_guide_lines,
                    likes: item.likes,
                    comments: item._count.ip_comments,
                    share_count: item.ip_share_count?.share_count || 0,
                    is_top: item.ip_library_child.length === 0,
                    ip_level: item.ip_levels,
                    is_user_liked: await this.isUserLiked(item.id, request_user),
                    is_public: item.is_public,
                    on_chain_detail: item.on_chain_detail as any,
                    token_info: this._processTokenInfo(item.token_info as any, item.current_token_info as any),
                    meta_data: item.meta_data as any,
                    creator_id: item.user_info?.username_in_be || "",
                    creator: item.user_info?.username || "",
                    creator_description: item.user_info?.description || "",
                    creator_followers: item.user_info?.followers || 0,
                    creator_avatar: item.user_info?.avatar || "",
                    governance_right: true,
                    ip_signature_clips: await this._processIpSignatureClips(item.ip_signature_clips as any[]),
                    apps: await this.getIpBindApps(item.app_bind_ips),
                })
            }
        }

        //extra info
        const extra_info = data.extra_info as any

        const meta_data = data.meta_data as any
        const child_ip_info = await this._getChildIps({
            ip_id: data.id,
            is_public,
            take: 100,
            user,
            request_user,
        })
        const res = {
            genre: data?.genre as { name: string }[],
            on_chain_status: data.on_chain_status,
            token_info: this._processTokenInfo(data.token_info as any, data.current_token_info as any),
            id: data.id,
            name: data.name,
            ticker: data.ticker,
            description: data.description,
            cover_image,
            cover_hash,
            likes: data.likes,
            creation_guide_lines: data.creation_guide_lines,
            comments: data._count.ip_comments,
            is_user_liked: await this.isUserLiked(data.id, request_user),
            is_top: data.ip_library_child === null,
            ip_level: data.ip_levels,
            is_public: data.is_public,
            share_count: data.ip_share_count?.share_count || 0,
            creator_id: data.user_info?.username_in_be || "",
            creator: data.user_info?.username || "",
            creator_description: data.user_info?.description || "",
            creator_followers: data.user_info?.followers || 0,
            creator_avatar: data.user_info?.avatar || "",
            cover_asset_id: await this.getCoverAssetId(data.id),
            meta_data,
            ip_signature_clips: await this._processIpSignatureClips(data.ip_signature_clips as any[]),
            parent_ip_info: parentIpInfo,
            on_chain_detail: data.on_chain_detail as any,
            can_purchase: false,
            child_ip_info,
            extra_info: {
                twitter: extra_info?.twitter || "",
                website: extra_info?.website || "",
                telegram: extra_info?.telegram || "",
                tiktok: extra_info?.tiktok || "",
                instagram: extra_info?.instagram || "",
            },
            governance_right: true,
            apps: await this.getIpBindApps(data.app_bind_ips),
        }
        return res
    }

    processMetaData(meta_data: any): Record<string, any> {
        if (JSON.stringify(meta_data).length > 1024 * 1024 * 2) {
            //2mb
            throw new BadRequestException("Meta data is too large")
        }
        return meta_data
    }

    async editIp(user: UserJwtExtractDto, body: EditIpDto): Promise<IpLibraryDetailDto> {
        const data = await this.prismaService.ip_library.findUnique({
            where: { id: parseInt(body.id.toString()), owner: user.usernameShorted },
        })
        if (!data) {
            throw new NotFoundException("IP library not found")
        }

        if (data.token_info) {
            throw new BadRequestException("Cannot edit ip on chain or token info")
        }

        const meta_data = this.processMetaData(body.meta_data as any)

        const { imageAsset, videoAsset } = await this.processAssets(
            user,
            "edit",
            parseInt(body.image_id.toString()),
            parseInt(body.video_id?.toString() || "0"),
            parseInt(body.id.toString()),
        )

        const ipDetailBeforeUpdate = await this.detail(body.id.toString(), null)

        const result = await this.prismaService.$transaction(async (tx) => {
            const ipLibrary = await tx.ip_library.update({
                where: { id: parseInt(body.id.toString()) },
                data: {
                    ...(body.description && { description: body.description }),
                    ...((body.twitter || body.website || body.telegram || body.tiktok || body.instagram) && {
                        extra_info: {
                            twitter: body.twitter || "",
                            website: body.website || "",
                            telegram: body.telegram || "",
                            tiktok: body.tiktok || "",
                            instagram: body.instagram || "",
                        },
                    }),
                    ...(body.meta_data && {
                        meta_data,
                    }),
                    ...(imageAsset && {
                        cover_images: [
                            {
                                key: imageAsset.path,
                                hash: imageAsset.ipfs_key,
                            },
                        ],
                    }),
                },
            })

            //remove old ip signature clips
            await tx.ip_signature_clips.deleteMany({
                where: { ip_id: ipLibrary.id },
            })
            //remove old related ip
            await this.assetsService.clearRelatedIp(user, ipDetailBeforeUpdate.id)

            if (videoAsset) {
                await tx.ip_signature_clips.create({
                    data: {
                        ip_id: ipLibrary.id,
                        name: ipLibrary.name,
                        description: ipLibrary.description,
                        object_key: videoAsset.path,
                        ipfs_hash: videoAsset.ipfs_key.split("/").pop(),
                        thumbnail: videoAsset.thumbnail,
                        asset_id: videoAsset.id,
                        video_info: (videoAsset.asset_info as any)?.videoInfo,
                    },
                })

                //relate to new ip
                await this.assetsService.relateToIp(user, {
                    ip_id: ipDetailBeforeUpdate.id,
                    asset_id: videoAsset.id,
                })
            }

            return ipLibrary
        })
        return await this.detail(body.id.toString(), null, user)
    }

    async signatureClipDetail(id: string) {
        const data = await this.prismaService.ip_signature_clips.findUnique({
            where: { id: parseInt(id) },
            select: {
                id: true,
                name: true,
                description: true,
                object_key: true,
            },
        })
        const s3Info = await this.utilitiesService.getIpLibraryS3Info()
        const signedUrl = data.object_key
            ? await this.utilitiesService.createS3SignedUrl(data.object_key, s3Info)
            : null
        return {
            ...data,
            signed_url: signedUrl,
        }
    }

    async checkRemixToAsset(user: UserJwtExtractDto, remixId: number): Promise<assets> {
        const data = await this.prismaService.ip_signature_clips.findUnique({
            where: { id: remixId },
        })
        if (!data) {
            throw new NotFoundException("Signature clip not found")
        }

        let assetRecord = await this.prismaService.assets.findFirst({
            where: {
                user: user.usernameShorted,
                source_video: remixId,
                type: "video",
                category: "ip-clips",
            },
        })

        if (!assetRecord) {
            //create asset to user
            assetRecord = await this.assetsService.createAsset({
                user: user.usernameShorted,
                type: "video",
                category: "ip-clips",
                name: data.name,
                path: data.object_key,
                path_optimized: undefined,
                thumbnail: data.thumbnail,
                asset_info: data.video_info,
                exported_by: null,
                source_video: remixId,
                ipfs_key: "",
            })
        }
        return assetRecord
    }

    async processAssets(
        user: UserJwtExtractDto,
        type: "create" | "edit",
        image_id: number,
        video_id?: number,
        ip_id?: number,
    ): Promise<{ imageAsset: AssetDetailDto; videoAsset: AssetDetailDto }> {
        let imageAsset: AssetDetailDto | null = null
        try {
            imageAsset = await this.assetsService.getAsset(user, image_id)

            if (imageAsset.type !== "image") {
                throw new BadRequestException("Image asset is not an image")
            }
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw new NotFoundException("Image asset not found")
            } else {
                throw error
            }
        }

        let videoAsset: AssetDetailDto | null = null
        if (video_id) {
            try {
                videoAsset = await this.assetsService.getAsset(user, video_id)
            } catch (error) {
                if (error instanceof NotFoundException) {
                    throw new NotFoundException("Video asset not found")
                } else {
                    throw error
                }
            }

            if (videoAsset.type !== "video") {
                throw new BadRequestException("Video asset is not a video")
            }

            if (type === "create") {
                if (videoAsset.related_ip_libraries.length > 0) {
                    throw new BadRequestException("Video asset is already related to an ip")
                }
            } else {
                const isRelatedToOtherIp = videoAsset.related_ip_libraries.find((item) => item.id !== ip_id)
                if (isRelatedToOtherIp && videoAsset.related_ip_libraries.length > 0) {
                    throw new BadRequestException("Video asset is already related to an ip")
                }
            }
        }
        return await this.uploadAssetToIpfs(imageAsset, videoAsset)
    }

    async validatePurchaseStrategy(purchase_strategy: PurchaseStrategyDto) {
        switch (purchase_strategy.type) {
            case PurchaseStrategyType.AGENT:
                if (!purchase_strategy.strategy_detail) {
                    return false
                }
                if (purchase_strategy.agent_id) {
                    const agent = await this.prismaService.launch_agents.findUnique({
                        where: { agent_id: purchase_strategy.agent_id },
                    })
                    if (!agent || !agent.strategy_response) {
                        return false
                    }
                }
                return true
            case PurchaseStrategyType.DIRECT:
                return (
                    purchase_strategy.percentage >= 1 &&
                    purchase_strategy.percentage <= 98 &&
                    purchase_strategy.percentage % 1 === 0
                )
            case PurchaseStrategyType.NONE:
                return true
            default:
                return false
        }
    }

    /**
     * process create ip
     * !!!IMPORTANT: consider 3 levels of ip if you want modify this function !!!
     */
    async createIp(user: UserJwtExtractDto, body: CreateIpDto): Promise<IpLibraryDetailDto> {
        if (!(await this._checkCreateIpPermission(user, body))) {
            throw new BadRequestException("you have no permission or license to create this ip")
        }
        const meta_data = this.processMetaData(body.meta_data as any)

        let ipLevel: number = 1

        if (body.parent_ip_library_id) {
            const parentIpInfo = await this.prismaService.ip_library.findUnique({
                where: { id: body.parent_ip_library_id },
            })
            if (!parentIpInfo) {
                throw new BadRequestException("Parent ip not found")
            }

            ipLevel = 2

            const is3rdLevelIp = await this.prismaService.ip_library_child.findFirst({
                where: { ip_id: parentIpInfo.id },
            })

            if (is3rdLevelIp) {
                const ipOrder = await this.prismaService.third_level_ip_orders.findFirst({
                    where: {
                        creation_data: {
                            path: "$.name",
                            equals: body.name,
                        },
                    },
                })
                if (!ipOrder) {
                    throw new BadRequestException("ip order not found")
                }
                if (
                    ipOrder.current_status !== OrderStatus.COMPLETED &&
                    ipOrder.current_status !== OrderStatus.REWARDS_RELEASED
                ) {
                    throw new BadRequestException("ip order status error")
                }
                ipLevel = 3
            } else if (parentIpInfo.owner !== user.usernameShorted) {
                throw new BadRequestException("you have no permission to use this parent ip")
            }
        }

        const { imageAsset, videoAsset } = await this.processAssets(
            user,
            "create",
            parseInt(body.image_id.toString()),
            parseInt(body.video_id?.toString() || "0"),
        )

        const result = await this.prismaService.$transaction(async (tx) => {
            const ipLibrary = await tx.ip_library.create({
                data: {
                    owner: user.usernameShorted,
                    name: body.name,
                    ticker: body.ticker,
                    description: body.description,
                    ip_levels: ipLevel,
                    extra_info: {
                        twitter: body?.twitter || "",
                        website: body?.website || "",
                        telegram: body?.telegram || "",
                        tiktok: body?.tiktok || "",
                        instagram: body?.instagram || "",
                    },
                    meta_data,
                    cover_images: [
                        {
                            key: imageAsset.path,
                            hash: imageAsset.ipfs_key,
                            asset_id: imageAsset.id,
                        },
                    ],
                    is_public: true,
                    on_chain_status: "ready",
                },
            })
            if (videoAsset) {
                await tx.ip_signature_clips.create({
                    data: {
                        ip_id: ipLibrary.id,
                        name: body.name,
                        description: body.description,
                        object_key: videoAsset.path,
                        ipfs_hash: videoAsset?.ipfs_key?.split("/").pop(),
                        thumbnail: videoAsset.thumbnail,
                        asset_id: videoAsset.id,
                        video_info: (videoAsset.asset_info as any)?.videoInfo,
                    },
                })
            }
            if (body.parent_ip_library_id) {
                await tx.ip_library_child.create({
                    data: {
                        parent_ip: body.parent_ip_library_id,
                        ip_id: ipLibrary.id,
                    },
                })
            }

            return ipLibrary
        })

        if (videoAsset) {
            await this.assetsService.relateToIp(user, {
                ip_id: result.id,
                asset_id: videoAsset.id,
            })
        }

        return await this.detail(result.id.toString(), null, user)
    }

    async clearIpWhenConnectionClosed(ipId: number) {
        const ip = await this.prismaService.ip_library.findFirst({
            where: { id: ipId },
        })
        if (ip) {
            await this.prismaService.ip_library.delete({ where: { id: ipId } })
        }
    }

    launchIpToken(user: UserJwtExtractDto, body: LaunchIpTokenDto): Observable<SSEMessage> {
        return new Observable((subscriber) => {
            this.processLaunchIpToken(user, body, subscriber).catch((error) => {
                subscriber.error(error)
            })
        })
    }

    async ipNameCheck(dto: IpNameCheckDto) {
        const ip = await this.prismaService.ip_library.findFirst({
            where: { name: dto.name },
        })
        if (ip) {
            throw new BadRequestException("IP name already exists")
        }
        return {}
    }

    async addShareCount(dto: AddShareCountDto, user: UserJwtExtractDto): Promise<IpLibraryDetailDto> {
        const ip = await this.prismaService.ip_library.findFirst({
            where: { id: dto.id },
        })
        if (!ip) {
            throw new NotFoundException("IP not found")
        }
        const currentShareCount = await this.prismaService.ip_share_count.findFirst({
            where: { ip_id: dto.id },
        })

        await this.prismaService.ip_share_count.upsert({
            where: { ip_id: dto.id },
            update: {
                share_count: currentShareCount?.share_count + 1,
            },
            create: { ip_id: dto.id, share_count: 1 },
        })

        return await this.detail(dto.id.toString(), null, null, user)
    }

    async processLaunchIpToken(
        user: UserJwtExtractDto,
        body: LaunchIpTokenDto,
        subscriber: Subscriber<SSEMessage>,
    ): Promise<void> {
        //validate purchase strategy
        subscriber.next({
            event: IpEvents.CREATION_STEPS,
            data: this.getLaunchIpTokenSteps(),
            event_detail: IpEventsDetail.find((item) => item.event === IpEvents.CREATION_STEPS),
        })

        subscriber.next({
            event: IpEvents.DATA_VALIDATING,
            event_detail: IpEventsDetail.find((item) => item.event === IpEvents.DATA_VALIDATING),
        })

        if (!(await this.validatePurchaseStrategy(body.purchase_strategy))) {
            throw new BadRequestException("invalid purchase strategy")
        }

        const { create_amount, buy_amount } = await this._computeNeedUsdc(body.purchase_strategy)
        let ipId = body.ip_id

        try {
            const ipOwner = await this.prismaService.ip_library.findFirst({
                where: { id: body.ip_id, owner: user.usernameShorted },
            })

            if (!ipOwner) {
                throw new NotFoundException("IP not found")
            }

            const ipDetail = await this.detail(ipId.toString(), null)

            const existingTokenInfo = await this.prismaService.asset_to_meme_record.findFirst({
                where: {
                    ip_id: {
                        array_contains: {
                            ip_id: ipId,
                        },
                    },
                },
            })

            if (existingTokenInfo || ipDetail.token_info) {
                throw new BadRequestException("IP already shared to giggle")
            }

            const ipCoverKey = await this.prismaService.ip_library.findUnique({
                where: { id: ipId },
                select: { cover_images: true },
            })

            if (!ipCoverKey?.cover_images?.[0]?.key) {
                throw new BadRequestException("IP does not have cover image")
            }

            //consume usdt
            const needUsdt = create_amount + buy_amount
            let userWalletAddr = user.wallet_address
            if (needUsdt > 0) {
                //check usdc balance
                const usdcBalance = await this.giggleService.getUsdcBalance(user)
                if (usdcBalance.balance < needUsdt) {
                    throw new BadRequestException("insufficient usdc balance")
                }
                userWalletAddr = usdcBalance.address
            }

            const mintParams: CreateIpTokenDto = {
                asset_id: ipDetail.ip_signature_clips?.[0]?.asset_id || null,
                name: ipDetail.name,
                ticker: ipDetail.ticker,
                description: ipDetail.description,
                cover_image: "", //this empty because we use cover_s3_key to upload cover image
                twitter: ipDetail.extra_info?.twitter,
                telegram: ipDetail.extra_info?.telegram,
                website: ipDetail.extra_info?.website,
                cover_s3_key: ipCoverKey?.cover_images?.[0]?.key,
                createAmount: create_amount,
            }

            if (buy_amount > 0 && body.purchase_strategy.type === PurchaseStrategyType.DIRECT) {
                mintParams.buyAmount = buy_amount
            }

            const tokenRes = await this.giggleService.processIpToken(
                user,
                ipId,
                mintParams,
                subscriber,
                false, //do not complete subscriber here
            )

            const tokenInfo = await this.prismaService.asset_to_meme_record.findFirst({
                where: {
                    ip_id: {
                        array_contains: {
                            ip_id: ipId,
                        },
                    },
                },
            })

            if (!tokenRes || !tokenInfo) {
                throw new BadRequestException("Failed to create ip token")
            }

            const tokenMint = (tokenInfo?.token_info as any)?.mint
            if (!tokenMint) {
                throw new BadRequestException("Failed to get token mint")
            }

            await this.prismaService.ip_library.update({
                where: { id: ipId },
                data: {
                    token_info: tokenInfo?.token_info,
                    token_mint: tokenMint,
                },
            })

            //create pool
            subscriber.next({
                event: IpEvents.IP_TOKEN_CREATING_REWARD_POOL,
                event_detail: IpEventsDetail.find((item) => item.event === IpEvents.IP_TOKEN_CREATING_REWARD_POOL),
            })

            //create rewards pool if not exists

            await this.rewardsPoolService.createRewardsPool(ipId, userWalletAddr, user.email)

            //run strategy if purchase strategy is agent

            if (body.purchase_strategy.type === PurchaseStrategyType.AGENT) {
                subscriber.next({
                    event: IpEvents.IP_TOKEN_RUN_STRATEGY,
                    data: tokenMint,
                    event_detail: IpEventsDetail.find((item) => item.event === IpEvents.IP_TOKEN_RUN_STRATEGY),
                })
                await this.launchAgentService.start(
                    body.purchase_strategy.agent_id,
                    {
                        token_mint: tokenMint,
                        user_email: user.email,
                        ip_id: ipId,
                    },
                    user,
                    subscriber,
                )
            }
            subscriber.next({
                event: IpEvents.IP_TOKEN_CREATED_ON_CHAIN,
                event_detail: IpEventsDetail.find((item) => item.event === IpEvents.IP_TOKEN_CREATED_ON_CHAIN),
                data: await this.detail(ipId.toString(), null),
            })
            subscriber.complete()
        } catch (error) {
            let returnError = error?.message || "Failed to share to giggle"
            this.logger.error("Error sharing to giggle", error, `user: ${user.email}, body: ${JSON.stringify(body)}`)
            subscriber.error(returnError)
            subscriber.complete()
        }
    }

    private async _getChildIps(params: {
        ip_id: number
        is_public: boolean | null
        take?: number
        user?: UserJwtExtractDto
        request_user?: UserJwtExtractDto
    }): Promise<IpSummaryDto[]> {
        let { ip_id, is_public, take, user, request_user } = params
        if (!take) {
            take = 100
        }

        const where: Prisma.ip_library_childWhereInput = {
            parent_ip: ip_id,
        }
        const childIps = await this.prismaService.ip_library_child.findMany({
            where,
            orderBy: { id: "desc" },
            take,
        })

        if (childIps.length === 0) {
            return []
        }

        const detailWhere: Prisma.ip_libraryWhereInput = {
            id: {
                in: await Promise.all(childIps.map(async (item) => item.ip_id)),
            },
        }
        if (is_public !== null) {
            detailWhere.is_public = is_public
        }

        if (user) {
            detailWhere.owner = user.usernameShorted
        }

        const childIpsDetail = await this.prismaService.ip_library.findMany({
            where: detailWhere,
            orderBy: { created_at: "desc" },
            include: {
                ip_signature_clips: true,
                ip_share_count: true,
                user_info: true,
                app_bind_ips: true,
                _count: {
                    select: {
                        ip_comments: true,
                    },
                },
            },
        })

        const s3Info = await this.utilitiesService.getIpLibraryS3Info()
        let childIpsSummary: IpSummaryWithChildDto[] = []
        await Promise.all(
            childIpsDetail.map(async (item) => {
                const onChainDetail = item.on_chain_detail as any
                let coverImage = item.cover_images?.[0]
                if (coverImage) {
                    coverImage = await this.utilitiesService.createS3SignedUrl(coverImage.key, s3Info)
                }
                const res: IpSummaryWithChildDto = {
                    id: item.id,
                    name: item.name,
                    ticker: item.ticker,
                    is_public: item.is_public,
                    description: item.description,
                    cover_asset_id: await this.getCoverAssetId(item.id),
                    cover_image: coverImage,
                    cover_hash: item?.cover_images?.[0]?.hash,
                    likes: item.likes,
                    comments: item._count.ip_comments,
                    share_count: item.ip_share_count?.share_count || 0,
                    is_top: false,
                    ip_level: item.ip_levels,
                    creation_guide_lines: item.creation_guide_lines,
                    is_user_liked: await this.isUserLiked(item.id, request_user),
                    token_info: this._processTokenInfo(item.token_info as any, item.current_token_info as any),
                    on_chain_detail: onChainDetail,
                    meta_data: item.meta_data as any,
                    can_purchase: false,
                    creator_id: item.user_info?.username_in_be || "",
                    creator: item.user_info?.username || "",
                    creator_description: item.user_info?.description || "",
                    creator_followers: item.user_info?.followers || 0,
                    creator_avatar: item.user_info?.avatar || "",
                    governance_right: true,
                    ip_signature_clips: await this._processIpSignatureClips(item.ip_signature_clips as any[]),
                    child_ip_info: await this._getChildIps({
                        ip_id: item.id,
                        is_public,
                        take: 100,
                        user,
                        request_user,
                    }),
                    apps: await this.getIpBindApps(item.app_bind_ips),
                }
                childIpsSummary.push(res)
            }),
        )
        return childIpsSummary
    }

    private async _removeIp(ip_id: number) {
        await this.prismaService.ip_library.deleteMany({
            where: { id: ip_id },
        })
        await this.prismaService.ip_signature_clips.deleteMany({
            where: { ip_id: ip_id },
        })
        await this.prismaService.ip_library_child.deleteMany({
            where: { ip_id: ip_id },
        })
        await this.prismaService.ip_library_tags.deleteMany({
            where: { ip_id: ip_id },
        })
        await this.prismaService.asset_related_ips.deleteMany({
            where: { ip_id: ip_id },
        })
    }

    _generateCreateIpRelatedIp(ip_id: number): string {
        return `create-ip-${ip_id}`
    }

    async registerToken(user: UserJwtExtractDto, ip_id: number) {
        const ip = await this.prismaService.ip_library.findUnique({
            where: {
                id: ip_id,
            },
        })

        if (!ip) {
            throw new BadRequestException("IP not found")
        }

        const userInfo = await this.prismaService.users.findUnique({
            where: { username_in_be: user.usernameShorted },
        })

        if (!userInfo.is_admin && ip.owner !== user.usernameShorted) {
            throw new BadRequestException("You are not allowed to register token for this ip")
        }

        const memeRecord = await this.prismaService.asset_to_meme_record.findFirst({
            where: {
                ip_id: {
                    array_contains: {
                        ip_id: ip.id,
                    },
                },
            },
        })
        if (!memeRecord) {
            throw new BadRequestException("Meme record not found")
        }

        try {
            const registerTokenResponse = await this.ipOnChainService.registerToken({
                ip_id: ip.id,
                record_id: memeRecord.id,
            })
            if (!registerTokenResponse.isSucc) {
                throw new BadRequestException("Failed to register token" + registerTokenResponse.err.message)
            }
            return { success: true, data: registerTokenResponse.res }
        } catch (error) {
            throw new BadRequestException("Failed to register token" + error.message)
        }
    }

    async uploadAssetToIpfs(
        imageAsset: AssetDetailDto,
        videoAsset?: AssetDetailDto,
    ): Promise<{ imageAsset: AssetDetailDto; videoAsset: AssetDetailDto }> {
        return { imageAsset, videoAsset }
        /*subscriber.next({
            event: IpEvents.ASSET_PROCESSING,
            message: IpEventsDetail[IpEvents.ASSET_PROCESSING].summary,
        })

        if (!imageAsset.ipfs_key) {
            //upload cover image to ipfs
            const uploadUrl = await this.giggleService.uploadCoverImageFromS3(imageAsset.path)

            if (!uploadUrl.key || !uploadUrl.url) {
                throw new BadRequestException("Failed to upload cover image")
            }

            await this.prismaService.assets.update({
                where: { id: imageAsset.id },
                data: {
                    ipfs_key: uploadUrl.key,
                },
            })
            imageAsset.ipfs_key = uploadUrl.key
        }

        if (!videoAsset) {
            return { imageAsset, videoAsset }
        }

        if (videoAsset && !videoAsset.ipfs_key) {
            //upload video to ipfs
            try {
                const pinata = new PinataSDK({
                    pinataJwt: process.env.PINATA_JWT,
                    pinataGateway: process.env.PINATA_GATEWAY,
                })

                const s3Info = await this.utilitiesService.getIpLibraryS3Info()
                const s3Client = await this.utilitiesService.getS3ClientByS3Info(s3Info)

                const headObject = await s3Client
                    .headObject({ Bucket: s3Info.s3_bucket, Key: videoAsset.path })
                    .promise()
                const totalSize = headObject.ContentLength
                let uploadedSize = 0

                //sleep 500ms to wait for the file to be uploaded to s3
                await new Promise((resolve) => setTimeout(resolve, 500))
                const fileStream = s3Client
                    .getObject({ Bucket: s3Info.s3_bucket, Key: videoAsset.path })
                    .createReadStream()

                let currentProgress = 0
                let progressInterval: NodeJS.Timeout

                progressInterval = setInterval(() => {
                    subscriber.next({
                        event: IpEvents.VIDEO_UPLOADING,
                        message: IpEventsDetail[IpEvents.VIDEO_UPLOADING].label,
                        data: currentProgress,
                    })
                }, 100)

                fileStream.on("data", (chunk) => {
                    uploadedSize += chunk.length
                    currentProgress = (uploadedSize / totalSize) * 100
                })

                fileStream.on("end", () => {
                    clearInterval(progressInterval)
                    subscriber.next({
                        event: IpEvents.VIDEO_UPLOADING,
                        message: IpEventsDetail[IpEvents.VIDEO_UPLOADING].label,
                        data: 100,
                    })
                })

                const pinataResult = await pinata.upload.stream(fileStream)

                await this.prismaService.assets.update({
                    where: { id: videoAsset.id },
                    data: {
                        ipfs_key: pinataResult.IpfsHash,
                    },
                })
                videoAsset.ipfs_key = pinataResult.IpfsHash
            } catch (error) {
                this.logger.error(error)
                throw new BadRequestException("Failed to upload video to ipfs")
            }
        }
        return { imageAsset, videoAsset }
        */
    }

    async getCoverAssetId(ip_id: number): Promise<number> {
        const ip = await this.prismaService.ip_library.findFirst({
            where: { id: ip_id },
            select: { cover_images: true, owner: true },
        })

        if (ip?.cover_images?.[0]?.asset_id) {
            return ip?.cover_images?.[0]?.asset_id
        }

        const coverAsset = await this.prismaService.assets.findFirst({
            where: { user: ip.owner, ipfs_key: ip?.cover_images?.[0]?.hash },
        })

        if (coverAsset?.id) {
            ip.cover_images[0] = { ...ip.cover_images[0], asset_id: coverAsset.id }
        }

        await this.prismaService.ip_library.update({
            where: { id: ip_id },
            data: { cover_images: ip.cover_images },
        })

        return coverAsset?.id
    }

    private _processTokenInfo(
        originalTokenInfo: CreateIpTokenGiggleResponseDto,
        currentTokenInfo: any,
    ): CreateIpTokenGiggleResponseDto | null {
        if (!originalTokenInfo) {
            return null
        }
        return {
            ...originalTokenInfo,
            market_cap: currentTokenInfo?.marketCap || originalTokenInfo?.market_cap,
            change1h: currentTokenInfo?.change1h || "0",
            change5m: currentTokenInfo?.change5m || "0",
            change24h: currentTokenInfo?.change24h || "0",
            price: currentTokenInfo?.price || originalTokenInfo?.price,
            visitLink: currentTokenInfo?.tradingUri || originalTokenInfo?.visitLink,
            volume: currentTokenInfo?.tradeVolume || "0",
            on_exchange: currentTokenInfo?.on_exchange || false,
            poolAddress: currentTokenInfo?.poolAddress || "",
        }
    }

    async getAvailableParentIps(user: UserJwtExtractDto) {
        // Get all IPs owned by the user
        const ownedIps = await this.prismaService.ip_library.findMany({
            where: {
                owner: user.usernameShorted,
                is_public: true,
            },
            select: {
                id: true,
                name: true,
                ticker: true,
            },
            orderBy: {
                id: "desc",
            },
        })

        // Get purchased IPs with available licenses
        const purchasedIps = await this.prismaService.ip_license_orders.findMany({
            where: {
                owner: user.usernameShorted,
                remain_quantity: {
                    gt: 0,
                },
                ip_info: {
                    is_public: true,
                },
            },
            select: {
                ip_id: true,
            },
            distinct: ["ip_id"],
        })

        const purchasedIpIds = purchasedIps.map((ip) => ip.ip_id)

        const purchasedIpDetails = await this.prismaService.ip_library.findMany({
            where: {
                id: {
                    in: purchasedIpIds,
                },
                is_public: true,
            },
            select: {
                id: true,
                name: true,
                ticker: true,
            },
        })

        // Create a lookup of all owned IPs for quick access
        const ownedIpMap = new Map<number, AvailableParentIpDto>()
        for (const ip of ownedIps) {
            ownedIpMap.set(ip.id, {
                id: ip.id,
                name: ip.name,
                ticker: ip.ticker,
                children: [],
            })
        }

        // Get ALL parent-child relationships for owned IPs (both as parent or child)
        const allIpIds = ownedIps.map((ip) => ip.id)
        const ipRelationships = await this.prismaService.ip_library_child.findMany({
            where: {
                OR: [{ parent_ip: { in: allIpIds } }, { ip_id: { in: allIpIds } }],
            },
            select: {
                parent_ip: true,
                ip_id: true,
            },
        })

        // Create a map of parent IDs to their children
        const parentToChildrenMap = new Map<number, number[]>()
        for (const relation of ipRelationships) {
            if (!parentToChildrenMap.has(relation.parent_ip)) {
                parentToChildrenMap.set(relation.parent_ip, [])
            }
            parentToChildrenMap.get(relation.parent_ip).push(relation.ip_id)
        }

        // Create a set of all IPs that are children (to identify root IPs)
        const childIpIds = new Set<number>()
        for (const relation of ipRelationships) {
            childIpIds.add(relation.ip_id)
        }

        // Find root IPs (owned IPs that are not children of any other IP)
        const rootIpIds = ownedIps.map((ip) => ip.id).filter((id) => !childIpIds.has(id))

        // Build a 2-level tree (parent and children only, no grandchildren)
        const ownedIpTree: AvailableParentIpDto[] = []

        // Process each root IP
        for (const rootId of rootIpIds) {
            const rootIp = ownedIpMap.get(rootId)
            if (!rootIp) continue

            // Get direct children of this root
            const childIds = parentToChildrenMap.get(rootId) || []
            const children: AvailableParentIpDto[] = []

            // Add each direct child that the user owns
            for (const childId of childIds) {
                const childIp = ownedIpMap.get(childId)
                if (childIp) {
                    // Add child without its children (empty array)
                    children.push({
                        id: childIp.id,
                        name: childIp.name,
                        ticker: childIp.ticker,
                        children: [], // No grandchildren
                    })
                }
            }

            // Add root with its children
            ownedIpTree.push({
                id: rootIp.id,
                name: rootIp.name,
                ticker: rootIp.ticker,
                children: children,
            })
        }

        // Convert purchased IPs to DTO format
        const purchasedIpList: PurchasedIpDto[] = purchasedIpDetails.map((ip) => ({
            id: ip.id,
            name: ip.name,
            ticker: ip.ticker,
        }))

        return {
            owned: ownedIpTree,
            purchased: purchasedIpList,
        }
    }

    private async _computeNeedUsdc(
        purchase_strategy: PurchaseStrategyDto,
    ): Promise<{ create_amount: number; buy_amount: number }> {
        let create_amount = IpLibraryService.SHARE_TO_GIGGLE_USDT_AMOUNT
        let buy_amount = 0

        if (purchase_strategy.type === PurchaseStrategyType.DIRECT) {
            const buyPercentage = purchase_strategy.percentage
            if (buyPercentage > 0 && buyPercentage <= 98) {
                const convertResult = await this.priceService.getPercentageToCredits(buyPercentage)
                buy_amount = convertResult.usdc
            }
        } else if (purchase_strategy.type === PurchaseStrategyType.AGENT) {
            const agent = await this.prismaService.launch_agents.findUnique({
                where: { agent_id: purchase_strategy.agent_id },
            })
            if (agent?.strategy_response) {
                const { estimated_cost } = agent.strategy_response as any as ParseLaunchLaunchPlanResponseDto
                if (estimated_cost) {
                    buy_amount = await this.launchAgentService.getStrategyEstimatedUsdc(
                        estimated_cost.total_estimated_sol,
                    )
                }
            }
        }
        return { create_amount: create_amount, buy_amount: buy_amount }
    }

    async setIpVisibility(user: UserJwtExtractDto, body: SetVisibilityDto): Promise<IpLibraryDetailDto> {
        const ip = await this.prismaService.ip_library.findUnique({
            where: { id: body.id },
        })
        if (!ip) {
            throw new BadRequestException("IP not found or you are not the owner of this IP")
        }

        const userInfo = await this.prismaService.users.findUnique({
            where: { username_in_be: user.usernameShorted },
        })

        if (ip.owner !== user.usernameShorted && !userInfo?.is_admin) {
            throw new BadRequestException("You are not the owner of this IP")
        }

        //toggle from giggle
        await this.giggleService.toggleIpVisibility(ip.id, body.is_public)

        //update local db
        await this.prismaService.ip_library.update({
            where: { id: body.id },
            data: { is_public: body.is_public },
        })
        return await this.detail(body.id.toString(), null)
    }

    async _checkCreateIpPermission(user: UserJwtExtractDto, ipInfo: CreateIpDto): Promise<boolean> {
        const userInfo = await this.userService.getProfile(user)
        if (!ipInfo.parent_ip_library_id && !userInfo.can_create_ip) {
            //a top ip but user has no permission to create ip
            return false
        }
        return true
    }

    async untokenize(user: UserJwtExtractDto, body: UntokenizeDto): Promise<IpLibraryDetailDto> {
        const ip = await this.prismaService.ip_library.findUnique({
            where: { id: body.id, owner: user.usernameShorted },
        })

        if (!ip) {
            throw new BadRequestException("IP not found or you are not the owner of this IP")
        }

        if (!ip.token_info) {
            return await this.detail(body.id.toString(), null)
        }

        //unbind from block chain
        const onChainInfo = ip.on_chain_detail as any as OnChainDetailDto
        if (onChainInfo?.ipAddr) {
            const untokenizeResponse = await this.ipOnChainService.untokenize(onChainInfo.ipAddr)
            if (!untokenizeResponse.isSucc) {
                throw new BadRequestException("Failed to untokenize: " + untokenizeResponse.err.message)
            }
        }

        //toggle from giggle
        if (ip.is_public) {
            await this.giggleService.toggleIpVisibility(ip.id, false)
        }
        //update local db
        await this.prismaService.$transaction(async (tx) => {
            await tx.asset_to_meme_record.deleteMany({
                where: {
                    ip_id: {
                        array_contains: { ip_id: ip.id },
                    },
                },
            })
            await tx.ip_library.update({
                where: { id: body.id },
                data: { token_info: null, current_token_info: null, token_mint: null },
            })
        })
        return await this.detail(body.id.toString(), null)
    }

    async likeIp(ip_id: number, user: UserJwtExtractDto): Promise<IpLibraryDetailDto> {
        const ip = await this.prismaService.ip_library.findUnique({
            where: { id: ip_id },
        })
        if (!ip) {
            throw new BadRequestException("IP not found")
        }

        const existingLike = await this.prismaService.ip_library_likes.findFirst({
            where: { ip_id, user: user.usernameShorted },
        })
        if (existingLike) {
            return await this.detail(ip_id.toString(), null, null, user)
        }

        const likedIpId = await this.prismaService.$transaction(async (tx) => {
            await tx.ip_library_likes.create({
                data: { ip_id, user: user.usernameShorted },
            })
            const updatedIp = await tx.ip_library.update({
                where: { id: ip_id },
                data: { likes: ip.likes + 1 },
            })
            return updatedIp.id
        })
        return await this.detail(likedIpId.toString(), null, null, user)
    }

    async unlikeIp(ip_id: number, user: UserJwtExtractDto): Promise<IpLibraryDetailDto> {
        const ip = await this.prismaService.ip_library.findUnique({
            where: { id: ip_id },
        })
        if (!ip) {
            throw new BadRequestException("IP not found")
        }
        const existingLike = await this.prismaService.ip_library_likes.findFirst({
            where: { ip_id, user: user.usernameShorted },
        })
        if (!existingLike) {
            return await this.detail(ip_id.toString(), null, null, user)
        }

        const unlikedIpId = await this.prismaService.$transaction(async (tx) => {
            await tx.ip_library_likes.delete({
                where: { id: existingLike.id },
            })
            const updatedIp = await tx.ip_library.update({
                where: { id: ip_id },
                data: { likes: ip.likes - 1 },
            })
            return updatedIp.id
        })
        return await this.detail(unlikedIpId.toString(), null, null, user)
    }

    async _processIpSignatureClips(ip_signature_clips: any[]): Promise<IpSignatureClipDto[]> {
        const s3Info = await this.utilitiesService.getIpLibraryS3Info()
        return await Promise.all(
            ip_signature_clips.map(async (item) => {
                const video_url = await this.utilitiesService.createS3SignedUrl(item.object_key, s3Info)
                const thumbnail = await this.utilitiesService.createS3SignedUrl(item.thumbnail, s3Info)
                const video_info = item.video_info as IpSignatureClipMetadataDto
                if (!video_info?.size) {
                    const size = await this.assetsService.getAssetSize(item.asset_id)
                    await this.prismaService.ip_signature_clips.update({
                        where: { id: item.id },
                        data: { video_info: { ...video_info, size: size } },
                    })
                    video_info.size = size
                }
                return {
                    id: item?.id,
                    name: item?.name,
                    description: item?.description,
                    object_key: item?.object_key,
                    thumbnail: thumbnail,
                    asset_id: item?.asset_id,
                    ipfs_hash: item?.ipfs_hash,
                    video_info: video_info,
                    video_url: video_url,
                }
            }),
        )
    }

    async isUserLiked(ip_id: number, user: UserJwtExtractDto): Promise<boolean> {
        if (!user?.usernameShorted) {
            return false
        }
        const like = await this.prismaService.ip_library_likes.findFirst({
            where: { ip_id, user: user.usernameShorted },
        })
        return !!like
    }

    async getIpBindApps(app_bind_ips: app_bind_ips[]): Promise<IpBindAppsDto[]> {
        //filter ids
        const app_ids = app_bind_ips.filter((item) => !item.is_temp).map((item) => item.app_id)
        const appBindWidgets = await this.prismaService.app_bind_widgets.findMany({
            where: {
                app_id: { in: app_ids },
                enabled: true,
                widget_detail: {
                    tag: {
                        not: "login_from_external",
                    },
                    is_private: false,
                    is_developing: false,
                },
            },
            include: {
                widget_detail: true,
            },
        })
        return app_bind_ips.map((item) => {
            const bindWidgets = appBindWidgets.filter((widget) => widget.app_id === item.app_id)
            return {
                app_id: item.app_id,
                bind_widgets: bindWidgets.map((widget) => ({
                    tag: widget.widget_tag,
                    name: widget.widget_detail.name,
                })),
            }
        })
    }
}
