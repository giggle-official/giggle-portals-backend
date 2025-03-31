import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import {
    AuthorizationSettingsCanPurchase,
    AuthorizationSettingsDto,
    AvailableParentIpDto,
    CreateIpDto,
    EditIpDto,
    GenreDto,
    GetListParams,
    GovernanceType,
    IpLibraryDetailDto,
    IpLibraryListDto,
    IpProcessStepsDto,
    IpSignatureClipDto,
    IpSignatureClipMetadataDto,
    IpSummaryDto,
    IpSummaryWithChildDto,
    PurchasedIpDto,
    RegisterTokenDto,
    RemixClipsDto,
    SetVisibilityDto,
    ShareToGiggleDto,
    TerritoryDto,
    UntokenizeDto,
} from "./ip-library.dto"
import { asset_to_meme_record, assets, Prisma } from "@prisma/client"
import { UtilitiesService } from "src/common/utilities.service"
import { UserInfoDTO } from "src/user/user.controller"
import { AssetsService } from "src/assets/assets.service"
import { VideoToVideoService } from "src/universal-stimulator/video-to-video/video-to-video.service"
import { FaceSwapService } from "src/universal-stimulator/face-swap/face-swap.service"
import { UserService } from "src/user/user.service"
import { CreditService } from "src/credit/credit.service"
import { GiggleService } from "src/web3/giggle/giggle.service"
import { IpOnChainService } from "src/web3/ip-on-chain/ip-on-chain.service"
import { async, Observable } from "rxjs"
import { CreateIpTokenDto, CreateIpTokenGiggleResponseDto, SSEMessage } from "src/web3/giggle/giggle.dto"
import { PinataSDK } from "pinata-web3"
import { LicenseService } from "./license/license.service"
import { AssetDetailDto } from "src/assets/assets.dto"
import { PriceService } from "src/web3/price/price.service"
import { OnChainDetailDto } from "src/web3/ip-on-chain/ip-on-chain.dto"

@Injectable()
export class IpLibraryService {
    private readonly logger = new Logger(IpLibraryService.name)
    public static readonly SHARE_TO_GIGGLE_USDT_AMOUNT = 6
    public static readonly DEFAULT_LICENSOR_RATIO = 45
    public static readonly DEFAULT_PLATFORM_RATIO = 5
    public static readonly DEFAULT_COMMUNITY_RATIO = 5
    public static readonly DEFAULT_TREASURY_RATIO = 45
    public static readonly DEFAULT_LICENSE_PRICE = 10

    constructor(
        private readonly prismaService: PrismaService,
        private readonly utilitiesService: UtilitiesService,

        @Inject(forwardRef(() => LicenseService))
        private readonly licenseService: LicenseService,

        @Inject(forwardRef(() => AssetsService))
        private readonly assetsService: AssetsService,

        @Inject(forwardRef(() => VideoToVideoService))
        private readonly video2videoService: VideoToVideoService,

        @Inject(forwardRef(() => FaceSwapService))
        private readonly faceSwapService: FaceSwapService,

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
    ) {}

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

    getTerritories(): TerritoryDto[] {
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
        user?: UserInfoDTO, // note: this is the user params to filter the ip
        ids?: number[],
        app_id?: string,
        request_user?: UserInfoDTO, // note: this is the user who is requesting the list
    ): Promise<IpLibraryListDto> {
        const where: Prisma.ip_libraryWhereInput = {}

        if (is_public !== null) {
            where.is_public = is_public
        }

        const select: Prisma.ip_librarySelect = {
            id: true,
            name: true,
            ticker: true,
            genre: true,
            description: true,
            cover_images: true,
            on_chain_detail: true,
            token_info: true,
            current_token_info: true,
            authorization_settings: true,
            is_public: true,
            likes: true,
            creation_guide_lines: true,
            user_info: {
                select: {
                    username: true,
                    username_in_be: true,
                    description: true,
                    followers: true,
                    avatar: true,
                },
            },
            ip_signature_clips: {
                select: {
                    id: true,
                    name: true,
                    description: true,
                    object_key: true,
                    thumbnail: true,
                    video_info: true,
                    asset_id: true,
                },
            },
            ip_library_child: true,
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
            select.ip_library_tags = {
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
            where.owner = app.creator
            const childIps = await this.prismaService.ip_library_child.findMany({
                where: {
                    parent_ip: rootIp,
                },
            })
            where.id = {
                in: [...childIps.map((item) => item.ip_id)],
            }
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
            select,
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
                const authSettings = this.processAuthSettings(item.authorization_settings as any)
                const child_ip_info = await this._getChildIps({
                    ip_id: item.id,
                    is_public,
                    take: 100,
                    request_user,
                    children_levels: parseInt(params.children_levels) || 1,
                })
                const res = {
                    id: item.id,
                    name: item.name,
                    ticker: item.ticker,
                    description: item.description,
                    likes: item.likes,
                    comments: item._count.ip_comments,
                    is_user_liked: await this.isUserLiked(item.id, request_user),
                    cover_asset_id,
                    can_purchase: await this.ipCanPurchase(item.id, authSettings, item.token_info as any),
                    on_chain_detail: item.on_chain_detail as any,
                    genre: item.genre as { name: string }[],
                    cover_image: cover_image,
                    cover_hash,
                    creation_guide_lines: item.creation_guide_lines,
                    is_top: item.ip_library_child.length === 0,
                    is_public: item.is_public,
                    token_info: this._processTokenInfo(item.token_info as any, item.current_token_info as any),
                    authorization_settings: authSettings,
                    creator_id: item.user_info?.username_in_be || "",
                    creator: item.user_info?.username || "",
                    creator_description: item.user_info?.description || "",
                    creator_followers: item.user_info?.followers || 0,
                    creator_avatar: item.user_info?.avatar || "",
                    governance_right: this.getGovernanceRight(authSettings),
                    child_ip_info,
                    ip_signature_clips: await this._processIpSignatureClips(item.ip_signature_clips as any[]),
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
        user?: UserInfoDTO, // note: this is the user params to filter the ip
        request_user?: UserInfoDTO, // note: this is the user who is requesting the detail
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
            select: {
                id: true,
                name: true,
                genre: true,
                description: true,
                cover_images: true,
                ticker: true,
                authorization_settings: true,
                on_chain_detail: true,
                on_chain_status: true,
                extra_info: true,
                token_info: true,
                current_token_info: true,
                is_public: true,
                likes: true,
                creation_guide_lines: true,
                user_info: {
                    select: {
                        username: true,
                        username_in_be: true,
                        description: true,
                        followers: true,
                        avatar: true,
                    },
                },
                ip_signature_clips: {
                    select: {
                        id: true,
                        name: true,
                        description: true,
                        object_key: true,
                        thumbnail: true,
                        video_info: true,
                        asset_id: true,
                    },
                },
                ip_library_child: true,
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
                select: {
                    id: true,
                    name: true,
                    ticker: true,
                    description: true,
                    on_chain_detail: true,
                    cover_images: true,
                    token_info: true,
                    current_token_info: true,
                    authorization_settings: true,
                    is_public: true,
                    owner: true,
                    likes: true,
                    creation_guide_lines: true,
                    user_info: {
                        select: {
                            username: true,
                            username_in_be: true,
                            description: true,
                            followers: true,
                            avatar: true,
                        },
                    },
                    ip_signature_clips: true,
                    ip_library_child: true,
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
                const authSettings = this.processAuthSettings(item.authorization_settings as any)
                parentIpInfo.push({
                    id: item.id,
                    name: item.name,
                    ticker: item.ticker,
                    description: item.description,
                    can_purchase: await this.ipCanPurchase(item.id, authSettings, item.token_info as any),
                    cover_asset_id: await this.getCoverAssetId(item.id),
                    cover_image,
                    cover_hash,
                    creation_guide_lines: item.creation_guide_lines,
                    likes: item.likes,
                    comments: item._count.ip_comments,
                    is_top: item.ip_library_child.length === 0,
                    is_user_liked: await this.isUserLiked(item.id, request_user),
                    is_public: item.is_public,
                    on_chain_detail: item.on_chain_detail as any,
                    token_info: this._processTokenInfo(item.token_info as any, item.current_token_info as any),
                    authorization_settings: authSettings,
                    creator_id: item.user_info?.username_in_be || "",
                    creator: item.user_info?.username || "",
                    creator_description: item.user_info?.description || "",
                    creator_followers: item.user_info?.followers || 0,
                    creator_avatar: item.user_info?.avatar || "",
                    governance_right: this.getGovernanceRight(authSettings),
                    ip_signature_clips: await this._processIpSignatureClips(item.ip_signature_clips as any[]),
                })
            }
        }

        //extra info
        const extra_info = data.extra_info as any

        const authSettings = this.processAuthSettings(data.authorization_settings as any)

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
            is_public: data.is_public,
            creator_id: data.user_info?.username_in_be || "",
            creator: data.user_info?.username || "",
            creator_description: data.user_info?.description || "",
            creator_followers: data.user_info?.followers || 0,
            creator_avatar: data.user_info?.avatar || "",
            cover_asset_id: await this.getCoverAssetId(data.id),
            authorization_settings: authSettings,
            ip_signature_clips: await this._processIpSignatureClips(data.ip_signature_clips as any[]),
            parent_ip_info: parentIpInfo,
            on_chain_detail: data.on_chain_detail as any,
            can_purchase: await this.ipCanPurchase(data.id, authSettings, data.token_info as any),
            child_ip_info: await this._getChildIps({
                ip_id: data.id,
                is_public,
                take: 100,
                request_user,
                children_levels: 1,
            }),
            extra_info: {
                twitter: extra_info?.twitter || "",
                website: extra_info?.website || "",
                telegram: extra_info?.telegram || "",
            },
            governance_right: this.getGovernanceRight(authSettings),
        }
        return res
    }

    processAuthSettings(authSettings: any): AuthorizationSettingsDto {
        return {
            can_purchase: authSettings?.can_purchase || "open-access",
            license: authSettings?.license || [{ name: "web3" }],
            territory: authSettings?.territory || "",
            revenue_distribution: authSettings?.revenue_distribution || {
                licensor: IpLibraryService.DEFAULT_LICENSOR_RATIO,
                platform: IpLibraryService.DEFAULT_PLATFORM_RATIO,
                community: IpLibraryService.DEFAULT_COMMUNITY_RATIO,
                treasury: IpLibraryService.DEFAULT_TREASURY_RATIO,
            },
            governance_types: authSettings?.governance_types || [{ name: "governance_right" }],
            long_term_license: authSettings?.long_term_license || true,
            valid_date: authSettings?.valid_date || {
                start_date: "",
                end_date: "",
            },
            license_price: authSettings?.license_price || IpLibraryService.DEFAULT_LICENSE_PRICE,
        }
    }

    editIp(user: UserInfoDTO, body: EditIpDto): Observable<SSEMessage> {
        return new Observable((subscriber) => {
            this.processEditIp(user, body, subscriber).catch((error) => {
                subscriber.error(error)
            })
        })
    }

    async processEditIp(user: UserInfoDTO, body: EditIpDto, subscriber: any): Promise<void> {
        try {
            subscriber.next({
                event: "ip.data_validating",
                data: {
                    message: "Validating data",
                },
            })

            const data = await this.prismaService.ip_library.findUnique({
                where: { id: parseInt(body.id.toString()), owner: user.usernameShorted },
            })
            if (!data) {
                throw new NotFoundException("IP library not found")
            }

            if (data.token_info) {
                throw new BadRequestException("Cannot edit ip on chain or token info")
            }

            const { imageAsset, videoAsset } = await this.processAssets(
                user,
                body.image_id.toString(),
                body.video_id.toString(),
                subscriber,
            )

            const isRelatedToIp = videoAsset.related_ip_libraries.find(
                (item) => item.id !== parseInt(body.id.toString()),
            )
            if (isRelatedToIp && videoAsset.related_ip_libraries.length > 0) {
                throw new BadRequestException("Video asset is already related to an ip")
            }

            const ipDetailBeforeUpdate = await this.detail(body.id.toString(), null)

            const result = await this.prismaService.$transaction(async (tx) => {
                const ipLibrary = await tx.ip_library.update({
                    where: { id: parseInt(body.id.toString()) },
                    data: {
                        ...(body.description && { description: body.description }),
                        ...((body.twitter || body.website || body.telegram) && {
                            extra_info: {
                                twitter: body.twitter || "",
                                website: body.website || "",
                                telegram: body.telegram || "",
                            },
                        }),
                        ...(body.authorization_settings && {
                            authorization_settings: body.authorization_settings as any,
                        }),
                        ...(imageAsset && {
                            cover_images: [
                                {
                                    key: imageAsset.path,
                                    hash: imageAsset.ipfs_key,
                                },
                            ],
                        }),
                        ...(body.genre && { genre: body.genre as any }),
                        ...(body.creation_guide_lines && {
                            creation_guide_lines: body.creation_guide_lines,
                        }),
                    },
                })

                //remove old ip signature clips
                await tx.ip_signature_clips.deleteMany({
                    where: { ip_id: ipLibrary.id },
                })

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

                //remove old related ip
                await this.assetsService.clearRelatedIp(user, ipDetailBeforeUpdate.id)
                //relate to new ip
                await this.assetsService.relateToIp(user, {
                    ip_id: ipDetailBeforeUpdate.id,
                    asset_id: videoAsset.id,
                })

                return ipLibrary
            })

            subscriber.next({
                event: "ip.on_chain_updating",
                data: {
                    message: "Updating on chain",
                },
            })

            let onChainUpdated = false
            const onChainInfo = await this.ipOnChainService.pushIpToChain(user, result.id)
            if (onChainInfo?.isSucc) {
                onChainUpdated = true
            }

            subscriber.next({
                event: "ip.updated",
                data: await this.detail(result.id.toString(), null),
            })

            if (!onChainUpdated) {
                subscriber.next({
                    event: "ip.warning",
                    data: {
                        message: "IP updated, but on chain is not updated, please contact-us to get help.",
                    },
                })
            }
            subscriber.complete()
        } catch (error) {
            this.logger.error("Error editing ip:", error, `user: ${user.email}, body: ${JSON.stringify(body)}`)
            subscriber.error(error)
            subscriber.complete()
        }
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

    async remixVideoToVideo(user: UserInfoDTO, body: RemixClipsDto) {
        try {
            const assetRecord = await this.checkRemixToAsset(user, body.id)
            const result = await this.video2videoService.createFromAsset(user, assetRecord.id)
            return result
        } catch (error) {
            this.logger.error(
                "Error remixing video to video:",
                error,
                `user: ${user.email}, signature clip id: ${body.id}`,
            )
            throw new InternalServerErrorException("Failed to remix video to video")
        }
    }

    async remixFaceSwap(user: UserInfoDTO, body: RemixClipsDto) {
        try {
            const assetRecord = await this.checkRemixToAsset(user, body.id)
            const result = await this.faceSwapService.create(user, {
                from_asset_id: assetRecord.id,
            })
            return result
        } catch (error) {
            this.logger.error("Error remixing face swap:", error, `user: ${user.email}, signature clip id: ${body.id}`)
            throw new InternalServerErrorException("Failed to remix face swap")
        }
    }

    async checkRemixToAsset(user: UserInfoDTO, remixId: number): Promise<assets> {
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

    createIp(user: UserInfoDTO, body: CreateIpDto): Observable<SSEMessage> {
        return new Observable((subscriber) => {
            this.processCreateIp(user, body, subscriber).catch((error) => {
                subscriber.error(error)
            })
        })
    }

    async processAssets(
        user: UserInfoDTO,
        image_id: string,
        video_id: string,
        subscriber: any,
    ): Promise<{ imageAsset: AssetDetailDto; videoAsset: AssetDetailDto }> {
        const imageAsset = await this.assetsService.getAsset(user, parseInt(image_id))
        if (!imageAsset) {
            throw new NotFoundException("Image asset not found")
        }

        const videoAsset = await this.assetsService.getAsset(user, parseInt(video_id))
        if (!videoAsset) {
            throw new NotFoundException("Video asset not found")
        }

        if (imageAsset.type !== "image") {
            throw new BadRequestException("Image asset is not an image")
        }

        if (videoAsset.type !== "video") {
            throw new BadRequestException("Video asset is not a video")
        }

        return await this.uploadAssetToIpfs(imageAsset, videoAsset, subscriber)
    }

    async processCreateIp(user: UserInfoDTO, body: CreateIpDto, subscriber: any): Promise<void> {
        subscriber.next({
            event: "ip.data_validating",
            data: {
                message: "Validating data",
            },
        })

        if (body.buy_amount < 0 || body.buy_amount > 98) {
            throw new BadRequestException("buy_amount must be between 0 and 98")
        }

        if (!(await this._checkCreateIpPermission(user, body))) {
            throw new BadRequestException("you have no permission or license to create this ip")
        }

        let consumeLicenseLogs: number[] = []
        let ipId: number | undefined = undefined
        let ipPushedToChain: boolean = false
        let ipTokenCreated: boolean = false
        let ipTokenRegistered: boolean = false

        try {
            if (body.parent_ip_library_id) {
                const parentIpInfo = await this.prismaService.ip_library.findUnique({
                    where: { id: body.parent_ip_library_id },
                })
                if (!parentIpInfo) {
                    throw new BadRequestException("Parent ip not found")
                }

                /**
                 *
                 * user can create ip with parent ip if user is the owner of the parent ip
                 *
                 */
                if (parentIpInfo.owner !== user.usernameShorted) {
                    try {
                        consumeLicenseLogs = await this.licenseService.consume(
                            user,
                            body.parent_ip_library_id,
                            1,
                            "create_ip",
                            body,
                        )
                    } catch (error) {
                        throw new BadRequestException("you have no license to use this parent ip")
                    }
                }
            }

            //The period of a new ip without long term must be greater than now
            const authSettings = body.authorization_settings as AuthorizationSettingsDto
            if (!authSettings.long_term_license) {
                const startDate = new Date(authSettings.valid_date.start_date).toDateString()
                const now = new Date().toDateString()
                if (new Date(startDate) < new Date(now)) {
                    throw new BadRequestException("Start date must be greater than now")
                }
            }

            const { imageAsset, videoAsset } = await this.processAssets(
                user,
                body.image_id.toString(),
                body.video_id.toString(),
                subscriber,
            )

            if (videoAsset.related_ip_libraries.length > 0) {
                throw new BadRequestException("Video asset is already related to an ip")
            }

            subscriber.next({
                event: "ip.ip_library_creating",
                data: {
                    message: "Creating ip library",
                },
            })

            const result = await this.prismaService.$transaction(async (tx) => {
                const ipLibrary = await tx.ip_library.create({
                    data: {
                        owner: user.usernameShorted,
                        name: body.name,
                        ticker: body.ticker,
                        description: body.description,
                        extra_info: {
                            twitter: body?.twitter || "",
                            website: body?.website || "",
                            telegram: body?.telegram || "",
                        },
                        authorization_settings: body.authorization_settings as any,
                        cover_images: [
                            {
                                key: imageAsset.path,
                                hash: imageAsset.ipfs_key,
                                asset_id: imageAsset.id,
                            },
                        ],
                        is_public: true,
                        on_chain_status: "ready",
                        genre: body.genre as any,
                        creation_guide_lines: body.creation_guide_lines || "",
                    },
                })

                await tx.ip_signature_clips.create({
                    data: {
                        ip_id: ipLibrary.id,
                        name: body.name,
                        description: body.description,
                        object_key: videoAsset.path,
                        ipfs_hash: videoAsset.ipfs_key.split("/").pop(),
                        thumbnail: videoAsset.thumbnail,
                        asset_id: videoAsset.id,
                        video_info: (videoAsset.asset_info as any)?.videoInfo,
                    },
                })

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

            await this.assetsService.relateToIp(user, {
                ip_id: result.id,
                asset_id: videoAsset.id,
            })

            ipId = result.id

            //push ip to chain
            subscriber.next({
                event: "ip.push_ip_to_chain",
                data: {
                    message: "pushing ip to chain",
                },
            })

            const onChainInfo = await this.ipOnChainService.pushIpToChain(user, ipId)
            if (!onChainInfo.isSucc) {
                throw new BadRequestException("Failed to push ip to chain")
            }
            ipPushedToChain = true

            let shareWarning: string | null = null

            if (body.share_to_giggle) {
                const shareResult = await this.processShareToGiggle(
                    user,
                    {
                        id: ipId,
                        buy_amount: body.buy_amount,
                    },
                    subscriber,
                    false, //do not complete subscriber here
                )
                ipTokenCreated = shareResult.ipTokenCreated
                ipTokenRegistered = shareResult.ipTokenRegistered
                if (shareResult?.error) {
                    shareWarning = "IP created successfully, but sharing to giggle error: " + shareResult?.error
                }
            }

            subscriber.next({
                event: "ip.created",
                data: await this.detail(ipId.toString(), null),
            })

            if (shareWarning) {
                subscriber.next({
                    event: "ip.warning",
                    data: { message: shareWarning },
                })
            }
            subscriber.complete()
        } catch (error) {
            this.logger.error("Error creating ip:", error, `user: ${user.email}, body: ${JSON.stringify(body)}`)
            if (ipId && !ipPushedToChain) {
                //all block chain process failed, remove ip and refund parent ip license
                this.logger.error("IP is not pushed to chain, remove it", `ip_id: ${ipId}`)
                await this._removeIp(ipId)
                if (consumeLicenseLogs.length > 0) {
                    await this.licenseService.refund(consumeLicenseLogs)
                    this.logger.error("Refunded license" + consumeLicenseLogs.join(","))
                }
                subscriber.error(error)
                subscriber.complete()
            } else if (ipId && ipPushedToChain && !ipTokenCreated) {
                //ip on chain is created, but giggle token is not created, refund payment
                subscriber.next({
                    event: "ip.created",
                    data: await this.detail(ipId.toString(), null),
                })
                subscriber.next({
                    event: "ip.warning",
                    data: {
                        message:
                            "Ip created, but giggle token is not created, you can create it on your ip page or contact-us to get help.",
                    },
                })
                subscriber.complete()
            } else {
                if (consumeLicenseLogs.length > 0) {
                    await this.licenseService.refund(consumeLicenseLogs)
                    this.logger.error("Refunded license" + consumeLicenseLogs.join(","))
                }
                this.logger.error("Error creating ip", `ip_id: ${ipId}`, error)
                subscriber.error(error?.message || "Failed to create ip")
                subscriber.complete()
            }
        }
    }

    shareToGiggle(user: UserInfoDTO, body: ShareToGiggleDto): Observable<SSEMessage> {
        return new Observable((subscriber) => {
            this.processShareToGiggle(user, body, subscriber).catch((error) => {
                subscriber.error(error)
            })
        })
    }

    async processShareToGiggle(
        user: UserInfoDTO,
        body: ShareToGiggleDto,
        subscriber: any,
        complete: boolean = true,
    ): Promise<IpProcessStepsDto> {
        let ipProcessStepsDto: IpProcessStepsDto = {
            ipId: body.id,
            ipPushedToChain: false,
            ipTokenCreated: false,
            ipTokenRegistered: false,
            error: null,
        }

        const { create_amount, buy_amount } = await this._computeNeedUsdc(body.buy_amount)

        try {
            const ipOwner = await this.prismaService.ip_library.findFirst({
                where: { id: body.id, owner: user.usernameShorted },
            })

            if (!ipOwner) {
                throw new NotFoundException("IP not found")
            }

            const ip = await this.detail(body.id.toString(), null)

            const existingTokenInfo = await this.prismaService.asset_to_meme_record.findFirst({
                where: {
                    ip_id: {
                        array_contains: {
                            ip_id: ip.id,
                        },
                    },
                },
            })

            if (existingTokenInfo || ip.token_info) {
                throw new BadRequestException("IP already shared to giggle")
            }

            if (ip.ip_signature_clips.length === 0) {
                throw new BadRequestException("IP does not have signature clip")
            }

            if (!ip.cover_hash) {
                throw new BadRequestException("IP does not have cover image")
            }

            const ipLibrary = await this.prismaService.ip_library.findUnique({
                where: { id: ip.id },
                select: { cover_images: true },
            })

            if (!ipLibrary?.cover_images?.[0]?.key) {
                throw new BadRequestException("IP does not have cover image")
            }

            const ipDetail = await this.detail(body.id.toString(), null)

            //step1 > push ip to chain if not on chain
            if (ipDetail.on_chain_status === "onChain" && ipDetail.on_chain_detail) {
                ipProcessStepsDto.ipPushedToChain = true
            } else {
                //push ip to chain
                const onChainInfo = await this.ipOnChainService.pushIpToChain(user, ip.id)
                if (!onChainInfo.isSucc) {
                    throw new BadRequestException("Failed to push ip to chain")
                }
                ipProcessStepsDto.ipPushedToChain = true
            }

            //step2 > share to giggle
            subscriber.next({
                event: "ip.share_to_giggle",
                data: {
                    message: "Share to giggle",
                },
            })

            //consume usdt
            const needUsdt = create_amount + buy_amount
            if (needUsdt > 0) {
                //check usdc balance
                const usdcBalance = await this.giggleService.getUsdcBalance(user)
                if (usdcBalance.balance < needUsdt) {
                    throw new BadRequestException("insufficient usdc balance")
                }
            }

            const mintParams: CreateIpTokenDto = {
                asset_id: ip.ip_signature_clips[0].asset_id,
                name: ipDetail.name,
                ticker: ipDetail.ticker,
                description: ipDetail.description,
                cover_image: "", //this empty because we use cover_s3_key to upload cover image
                twitter: ipDetail.extra_info?.twitter,
                telegram: ipDetail.extra_info?.telegram,
                website: ipDetail.extra_info?.website,
                cover_s3_key: ipLibrary?.cover_images?.[0]?.key,
                createAmount: create_amount,
            }

            if (buy_amount > 0) {
                mintParams.buyAmount = buy_amount
            }

            const tokenRes = await this.giggleService.processIpToken(
                user,
                mintParams,
                subscriber,
                false, //do not complete subscriber here
            )

            const tokenInfo = await this.prismaService.asset_to_meme_record.findFirst({
                where: {
                    ip_id: {
                        array_contains: {
                            ip_id: ip.id,
                        },
                    },
                },
            })

            if (!tokenRes || !tokenInfo) {
                throw new BadRequestException("Failed to create ip token")
            }

            await this.prismaService.ip_library.update({
                where: { id: ip.id },
                data: {
                    token_info: tokenInfo?.token_info,
                },
            })

            ipProcessStepsDto.ipTokenCreated = true

            //step3 > register token on chain
            subscriber.next({
                event: "ip.update_token_data_on_chain",
                data: {
                    message: "Registering token on chain",
                },
            })
            const registerTokenResponse = await this.ipOnChainService.registerToken({
                ip_id: ip.id,
                record_id: tokenInfo?.id,
            })

            if (!registerTokenResponse.isSucc) {
                throw new BadRequestException("Failed to register token" + registerTokenResponse.err.message)
            }

            ipProcessStepsDto.ipTokenRegistered = true

            if (complete) {
                subscriber.next({
                    event: "ip.token_created_on_chain",
                    data: await this.detail(ip.id.toString(), null),
                })
                subscriber.complete()
            }

            return ipProcessStepsDto
        } catch (error) {
            let returnError = error?.message || "Failed to share to giggle"
            this.logger.error("Error sharing to giggle", error, `user: ${user.email}, body: ${JSON.stringify(body)}`)
            if (!ipProcessStepsDto.ipPushedToChain) {
                //ip not on chain, throw error
                returnError = error?.message || "Failed to push ip to chain"
                if (complete) {
                    subscriber.error(returnError)
                    subscriber.complete()
                }
            } else if (!ipProcessStepsDto.ipTokenCreated) {
                //ip on chain, but token not registered, throw error
                returnError = error?.message || "Failed to register token"
                if (complete) {
                    subscriber.error(returnError)
                    subscriber.complete()
                }
            } else if (!ipProcessStepsDto.ipTokenRegistered) {
                //ip on chain, token created, but not registered, throw warning and complete payment
                returnError =
                    "IP shared successfully, but ip token is not registered! you can create it on your ip page or contact-us to get help."
                if (complete) {
                    subscriber.next({
                        event: "ip.warning",
                        data: {
                            message: returnError,
                        },
                    })
                    subscriber.complete()
                }
            } else {
                returnError = error?.message || "Failed to share to giggle"
                if (complete) {
                    subscriber.error(returnError)
                    subscriber.complete()
                }
            }

            return { ...ipProcessStepsDto, error: returnError }
        }
    }

    private async _getChildIps(params: {
        ip_id: number
        is_public: boolean | null
        take?: number
        request_user?: UserInfoDTO
        children_levels?: number
    }): Promise<IpSummaryDto[] | IpSummaryWithChildDto[]> {
        let { ip_id, is_public, take, request_user, children_levels } = params
        if (!take) {
            take = 100
        }
        if (!children_levels) {
            children_levels = 1
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
                in: childIps.map((item) => item.ip_id),
            },
        }
        if (is_public !== null) {
            detailWhere.is_public = is_public
        }

        if (request_user) {
            detailWhere.owner = request_user.usernameShorted
        }

        const childIpsDetail = await this.prismaService.ip_library.findMany({
            where: detailWhere,
            include: {
                ip_signature_clips: true,
                user_info: {
                    select: {
                        username: true,
                        username_in_be: true,
                        description: true,
                        followers: true,
                        avatar: true,
                    },
                },
                _count: {
                    select: {
                        ip_comments: true,
                    },
                },
            },
        })
        const s3Info = await this.utilitiesService.getIpLibraryS3Info()
        const childIpsSummary = await Promise.all(
            childIpsDetail.map(async (item) => {
                const onChainDetail = item.on_chain_detail as any
                let coverImage = item.cover_images?.[0]
                if (coverImage) {
                    coverImage = await this.utilitiesService.createS3SignedUrl(coverImage.key, s3Info)
                }
                const authSettings = this.processAuthSettings(item.authorization_settings as any)
                const res: IpSummaryWithChildDto | IpSummaryDto = {
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
                    is_top: false,
                    creation_guide_lines: item.creation_guide_lines,
                    is_user_liked: await this.isUserLiked(item.id, request_user),
                    token_info: this._processTokenInfo(item.token_info as any, item.current_token_info as any),
                    on_chain_detail: onChainDetail,
                    authorization_settings: authSettings,
                    can_purchase: await this.ipCanPurchase(item.id, authSettings, item.token_info as any),
                    creator_id: item.user_info?.username_in_be || "",
                    creator: item.user_info?.username || "",
                    creator_description: item.user_info?.description || "",
                    creator_followers: item.user_info?.followers || 0,
                    creator_avatar: item.user_info?.avatar || "",
                    governance_right: this.getGovernanceRight(authSettings),
                    ip_signature_clips: await this._processIpSignatureClips(item.ip_signature_clips as any[]),
                    child_ip_info: [],
                }
                if (children_levels === 2) {
                    res.child_ip_info = await this._getChildIps({
                        ip_id: item.id,
                        is_public,
                        take: 100,
                        request_user,
                        children_levels: 1,
                    })
                }
                return res
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

    async registerToken(user: UserInfoDTO, body: RegisterTokenDto) {
        const ip = await this.prismaService.ip_library.findUnique({
            where: {
                id: body.id,
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

    async ipCanPurchase(
        ip_id: number,
        authSettings: AuthorizationSettingsDto,
        tokenInfo: CreateIpTokenGiggleResponseDto | null,
    ): Promise<boolean> {
        //return false if ip is top ip or ip has 2 level of parent ip
        const ip = await this.prismaService.ip_library_child.findFirst({
            where: { ip_id: ip_id },
        })
        if (!ip) {
            return false
        }

        //parent has parent ip
        const parentIp = await this.prismaService.ip_library_child.findFirst({
            where: { ip_id: ip.parent_ip },
        })
        if (parentIp) {
            return false
        }

        const now = new Date()
        let validDate = false
        let isOpenAccess = false
        if (authSettings?.can_purchase === AuthorizationSettingsCanPurchase.OPEN_ACCESS) {
            isOpenAccess = true
        }
        if (authSettings?.long_term_license) {
            validDate = true
        } else {
            validDate =
                new Date(authSettings?.valid_date?.end_date) >= now &&
                new Date(authSettings?.valid_date?.start_date) <= now
        }
        //return isOpenAccess && validDate && !!tokenInfo
        return isOpenAccess && validDate
    }

    async uploadAssetToIpfs(
        imageAsset: AssetDetailDto,
        videoAsset: AssetDetailDto,
        subscriber: any,
    ): Promise<{ imageAsset: AssetDetailDto; videoAsset: AssetDetailDto }> {
        subscriber.next({
            event: "ip.asset_processing",
            data: {
                message: "Processing asset",
            },
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

        if (!videoAsset.ipfs_key) {
            //upload video to ipfs
            try {
                const pinata = new PinataSDK({
                    pinataJwt: process.env.PINATA_JWT,
                    pinataGateway: process.env.PINATA_GATEWAY,
                })

                const s3Info = await this.utilitiesService.getIpLibraryS3Info()
                const s3Client = await this.utilitiesService.getS3ClientByS3Info(s3Info)

                const fileStream = s3Client
                    .getObject({ Bucket: s3Info.s3_bucket, Key: videoAsset.path })
                    .createReadStream()
                const headObject = await s3Client
                    .headObject({ Bucket: s3Info.s3_bucket, Key: videoAsset.path })
                    .promise()
                const contentLength = headObject.ContentLength
                const totalSize = contentLength
                let uploadedSize = 0
                fileStream.on("data", (chunk) => {
                    uploadedSize += chunk.length
                    const progress = (uploadedSize / totalSize) * 100
                    subscriber.next({ event: "ip.video_uploading", data: progress })
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
        }
    }

    async getAvailableParentIps(user: UserInfoDTO) {
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

    getGovernanceRight(authSettings: AuthorizationSettingsDto): boolean {
        return Boolean(authSettings.governance_types.find((item) => item.name === GovernanceType.GOVERNANCE_RIGHT))
    }

    private async _computeNeedUsdc(buyPercentage: number): Promise<{ create_amount: number; buy_amount: number }> {
        let create_amount = IpLibraryService.SHARE_TO_GIGGLE_USDT_AMOUNT
        let buy_amount = 0

        if (buyPercentage > 0 && buyPercentage <= 98) {
            const convertResult = await this.priceService.getPercentageToCredits(buyPercentage)
            buy_amount = convertResult.usdc
        }

        return { create_amount: create_amount, buy_amount: buy_amount }
    }

    async setIpVisibility(user: UserInfoDTO, body: SetVisibilityDto): Promise<IpLibraryDetailDto> {
        const ip = await this.prismaService.ip_library.findUnique({
            where: { id: body.id, owner: user.usernameShorted },
        })
        if (!ip) {
            throw new BadRequestException("IP not found or you are not the owner of this IP")
        }

        //if set to private, check if it is bound to an app
        if (!body.is_public) {
            const appBind = await this.prismaService.app_bind_ips.findFirst({
                where: {
                    ip_id: body.id,
                    is_temp: false,
                },
            })

            if (appBind) {
                throw new BadRequestException("This IP is bound to an app, please unbind it first")
            }
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

    async _checkCreateIpPermission(user: UserInfoDTO, ipInfo: CreateIpDto): Promise<boolean> {
        const userInfo = await this.userService.getProfile(user)
        if (userInfo.can_create_ip) {
            return true
        }

        //check user has license of parent ip
        if (!ipInfo.parent_ip_library_id) {
            return false
        }
        const hasLicense = await this.prismaService.ip_license_orders.findFirst({
            where: {
                owner: user.usernameShorted,
                ip_id: ipInfo.parent_ip_library_id,
                remain_quantity: {
                    gt: 0,
                },
            },
        })
        return !!hasLicense
    }

    async untokenize(user: UserInfoDTO, body: UntokenizeDto): Promise<IpLibraryDetailDto> {
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
                data: { token_info: null, current_token_info: null },
            })
        })
        return await this.detail(body.id.toString(), null)
    }

    async likeIp(ip_id: number, user: UserInfoDTO): Promise<IpLibraryDetailDto> {
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

    async unlikeIp(ip_id: number, user: UserInfoDTO): Promise<IpLibraryDetailDto> {
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

    async isUserLiked(ip_id: number, user: UserInfoDTO): Promise<boolean> {
        if (!user?.usernameShorted) {
            return false
        }
        const like = await this.prismaService.ip_library_likes.findFirst({
            where: { ip_id, user: user.usernameShorted },
        })
        return !!like
    }
}
