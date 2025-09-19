import { ApiProperty, IntersectionType, OmitType, PickType } from "@nestjs/swagger"
import { ip_library_on_chain_status, ip_token_delegation_status, ip_type } from "@prisma/client"
import {
    IsArray,
    IsBoolean,
    IsInt,
    IsEnum,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    MinLength,
    ValidateNested,
    IsObject,
    MaxLength,
    Validate,
    IsUrl,
    ArrayMinSize,
    ArrayMaxSize,
} from "class-validator"
import { PaginationDto } from "src/common/common.dto"
import { VideoInfoTaskResponseDto } from "src/task/task.dto"
import { CreateIpTokenGiggleResponseDto } from "src/web3/giggle/giggle.dto"
import { OnChainDetailDto } from "src/web3/ip-on-chain/ip-on-chain.dto"
import { Type } from "class-transformer"
import { IpNameValidator, TickerValidator } from "./ip-library.validator"

export enum PurchaseStrategyType {
    DIRECT = "direct",
    AGENT = "agent",
    NONE = "none",
}

export enum IpEvents {
    CREATION_STEPS = "ip.creation_steps",
    DATA_VALIDATING = "ip.data_validating",

    //token creation
    IP_ASSET_TO_IPFS = "ip.asset_to_ipfs",
    IP_TOKEN_CREATING = "ip.token_creating",
    IP_TOKEN_CREATING_REWARD_POOL = "ip.token_creating_reward_pool",

    //strategy
    IP_TOKEN_RUN_STRATEGY = "ip.start_launch_agent.starting",
    IP_STRATEGY_CALCULATE_COST = "ip.start_launch_agent.calculate_cost",
    IP_STRATEGY_CHECK_BALANCE = "ip.start_launch_agent.check_balance",

    IP_STRATEGY_SWAP_SOL = "ip.start_launch_agent.swap_sol",
    IP_STRATEGY_TRANSFER_SOL = "ip.start_launch_agent.transfer_sol",

    IP_STRATEGY_TRANSFER_USDC = "ip.start_launch_agent.transfer_usdc",
    IP_STRATEGY_START_AGENT = "ip.start_launch_agent.start_agent",
    IP_STRATEGY_AGENT_STARTED = "ip.start_launch_agent.agent_started",

    //edit ip
    IP_UPDATED = "ip.updated",

    // created on chain
    IP_TOKEN_CREATED_ON_CHAIN = "ip.token_created_on_chain",

    //warning
    IP_WARNING = "ip.warning",
}

export const IpEventsDetail: EventDto[] = [
    {
        order: 1,
        event: IpEvents.CREATION_STEPS,
        label: "Creation steps",
        summary: "When started a creation process, this event will return the creation steps in `data` structure.",
        is_progress: false,
        is_completed: false,
    },
    {
        order: 2,
        event: IpEvents.DATA_VALIDATING,
        label: "Data verification",
        summary: "Validating IP creation data.",
        is_progress: false,
        is_completed: false,
    },
    {
        order: 3,
        event: IpEvents.IP_ASSET_TO_IPFS,
        label: "Asset to IPFS",
        summary: "Uploading IP asset to IPFS, at current step, the data in `data` is the progress of asset uploading",
        is_progress: true,
        is_completed: false,
    },

    {
        order: 14,
        event: IpEvents.IP_TOKEN_CREATING,
        label: "Creating IP Token",
        summary: "Creating IP token, this may take a while depends on the network condition",
        is_progress: false,
        is_completed: false,
    },
    {
        order: 15,
        event: IpEvents.IP_TOKEN_CREATING_REWARD_POOL,
        label: "Creating Reward Pool",
        summary: "Creating reward pool for IP token.",
        is_progress: false,
        is_completed: false,
    },
    {
        order: 116,
        event: IpEvents.IP_TOKEN_RUN_STRATEGY,
        label: "IP Token Run Strategy",
        summary: "Starting to run strategy for IP token if your purchase strategy is `agent`",
        is_progress: false,
        is_completed: false,
    },

    {
        order: 118,
        event: IpEvents.IP_STRATEGY_CALCULATE_COST,
        label: "Calculate Cost for Purchase Strategy",
        summary: `Calculating cost for purchase strategy, if your strategy is \`${PurchaseStrategyType.AGENT}\``,
        is_progress: false,
        is_completed: false,
    },
    {
        order: 119,
        event: IpEvents.IP_STRATEGY_CHECK_BALANCE,
        label: "Check Balance for Purchase Strategy",
        summary: `Checking balance for IP strategy, if your strategy is \`${PurchaseStrategyType.AGENT}\``,
        is_progress: false,
        is_completed: false,
    },
    {
        order: 120,
        event: IpEvents.IP_STRATEGY_SWAP_SOL,
        label: "Swap SOL for Purchase Strategy",
        summary: `Swapping SOL for IP strategy, if your strategy is \`${PurchaseStrategyType.AGENT}\``,
        is_progress: false,
        is_completed: false,
    },
    {
        order: 121,
        event: IpEvents.IP_STRATEGY_TRANSFER_SOL,
        label: "Transfer SOL for Purchase Strategy",
        summary: `Transferring SOL for IP strategy, if your strategy is \`${PurchaseStrategyType.AGENT}\``,
        is_progress: false,
        is_completed: false,
    },

    {
        order: 122,
        event: IpEvents.IP_STRATEGY_TRANSFER_USDC,
        label: "Transfer USDC for Purchase Strategy",
        summary: `Transferring USDC for IP strategy, if your strategy is \`${PurchaseStrategyType.AGENT}\``,
        is_progress: false,
        is_completed: false,
    },
    {
        order: 123,
        event: IpEvents.IP_STRATEGY_START_AGENT,
        label: "Start Purchase Strategy Agent",
        summary: `Starting purchase strategy, if your strategy is \`${PurchaseStrategyType.AGENT}\``,
        is_progress: false,
        is_completed: false,
    },
    {
        order: 124,
        event: IpEvents.IP_STRATEGY_AGENT_STARTED,
        label: "Purchase Strategy Agent Started",
        summary: `Purchase strategy agent started, if your strategy is \`${PurchaseStrategyType.AGENT}\``,
        is_progress: false,
        is_completed: true,
    },

    {
        order: 1007,
        event: IpEvents.IP_TOKEN_CREATED_ON_CHAIN,
        label: "IP Token Created On Chain",
        summary:
            "IP token is created successfully, this event will be triggered when the IP token is created successfully, and the data in `data` is the IP info.",
        is_progress: false,
        is_completed: true,
    },

    {
        order: 1008,
        event: IpEvents.IP_WARNING,
        label: "IP Warning",
        summary: "IP warning, `data` is the warning info.",
        is_progress: false,
        is_completed: false,
    },
]
export class EventDto {
    @ApiProperty({
        description: "order of the step",
    })
    order: number

    @ApiProperty({
        description: "id of the step",
    })
    event: IpEvents

    @ApiProperty({
        description: "label of the step",
    })
    label: string

    @ApiProperty({
        description: "summary of the step",
    })
    summary: string

    @ApiProperty({
        description: "is progress",
    })
    is_progress: boolean

    @ApiProperty({
        description: "is completed",
    })
    is_completed: boolean
}

export class CreateIpLibraryDto {
    @IsOptional()
    @IsNumber()
    id?: number

    @IsNotEmpty()
    @IsString()
    name: string

    @IsOptional()
    director?: string | DirectorDto[]

    @IsOptional()
    genre?: string | GenreDto[]

    @IsOptional()
    @IsString()
    imdb_code?: string

    @IsOptional()
    @IsString()
    description?: string

    @IsOptional()
    @IsNumber()
    owner?: string

    @IsOptional()
    @IsBoolean()
    is_public?: boolean

    @IsOptional()
    @IsArray()
    cover_images?: CoverImageDto[]

    @IsOptional()
    @IsArray()
    ip_library_tags?: IpLibraryTagDto[]
}

export class DirectorDto {
    name: string
}

export class GenreDto {
    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: "name of the genre",
    })
    name: string

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: "value of the genre",
        required: false,
    })
    value?: string
}

export class CoverImageDto {
    @ApiProperty({
        description: "key of the cover image",
    })
    key: string

    @ApiProperty({
        description: "src of the cover image",
    })
    src?: string

    @ApiProperty({
        description: "ipfs key of the cover image",
        required: false,
    })
    hash?: string
}

export class IpLibraryTagDto {
    tag: string
    priority: number
}

export class UpdateIpLibraryDto extends CreateIpLibraryDto {
    @IsNotEmpty()
    id: number
}

export class UpdateManyArrayDto {
    data: CreateIpLibraryDto[]

    @IsNotEmpty()
    @IsArray()
    ids: number[]
}

export class UploadSignDto {
    @IsNotEmpty()
    @IsString()
    key: string

    @IsNotEmpty()
    @IsString()
    type: string
}

export class UploadSignatureClipDto {
    @IsNotEmpty()
    @IsString()
    key: string

    @IsOptional()
    @IsString()
    name?: string

    @IsOptional()
    @IsString()
    description?: string
}

export class DeleteSignatureClipDto {
    @IsNotEmpty()
    @IsNumber()
    id: number
}

export class UploadSignatureClipsDto {
    @IsNotEmpty()
    @IsNumber()
    id: number

    @IsNotEmpty()
    @IsArray()
    clips: UploadSignatureClipDto[]

    @IsNotEmpty()
    @IsEnum(["replace", "append"])
    method: "replace" | "append"
}

export class GetListParams extends PaginationDto {
    @ApiProperty({
        required: false,
        description: "tag of the ip library",
    })
    @IsOptional()
    @IsString()
    tag?: string

    @ApiProperty({
        required: false,
        description: "search keyword",
    })
    @IsOptional()
    @IsString()
    search?: string

    @ApiProperty({
        required: false,
        description: "category of the ip library",
    })
    @IsOptional()
    @IsString()
    category?: string

    @ApiProperty({
        required: false,
        description: "genre of the ip library, you can pass multiple genres by comma",
    })
    @IsOptional()
    @IsString()
    genre?: string

    @ApiProperty({
        required: false,
        description: "sort order, default sort field is created_at",
    })
    @IsOptional()
    sort_by?: "asc" | "desc"

    @ApiProperty({
        required: false,
        description: "sort field",
    })
    @IsOptional()
    sort_field?: string

    @ApiProperty({
        required: false,
        description: "owner of the ip library",
    })
    @IsOptional()
    @IsString()
    owner?: string

    @ApiProperty({
        required: false,
        description: "email of the ip library",
    })
    @IsOptional()
    @IsString()
    email?: string

    @IsOptional()
    @IsEnum(["true", "false"])
    @ApiProperty({
        required: false,
        description: "is launched to giggle",
        enum: ["true", "false"],
    })
    launched_to_giggle?: "true" | "false"

    @ApiProperty({
        required: false,
        description: "is top",
    })
    @IsOptional()
    @IsEnum(["true", "false"])
    is_top?: "true" | "false"

    @ApiProperty({
        required: false,
        description: "ip level",
    })
    @IsOptional()
    @IsString()
    ip_level?: string

    @ApiProperty({
        required: false,
        description: "children levels",
    })
    @IsOptional()
    @IsEnum(["1", "2", "3"])
    children_levels?: "1" | "2"

    @ApiProperty({
        required: false,
        description: "token mint address of the ip library",
    })
    @IsOptional()
    @IsString()
    token_mint?: string

    @ApiProperty({
        required: false,
        description: "ip type",
    })
    @IsOptional()
    @IsEnum(ip_type)
    ip_type?: "official" | "community"
}

export class GetMyListParams extends GetListParams {
    @ApiProperty({
        required: false,
        description: "is public",
    })
    @IsOptional()
    @IsEnum(["true", "false"])
    is_public?: "true" | "false"
}

export class RemixClipsDto {
    @IsNotEmpty()
    @IsInt()
    @ApiProperty({
        required: true,
        description: "id of the signature clip",
    })
    id: number
}

export class IpSignatureClipMetadataDto extends VideoInfoTaskResponseDto {
    @ApiProperty({
        description: "size of the signature clip",
    })
    size: number
}

//uses for get detail of frontend
export class IpSignatureClipDto {
    @ApiProperty({
        description: "id of the signature clip",
    })
    id: number

    @ApiProperty({
        description: "name of the signature clip",
    })
    name: string

    @ApiProperty({
        description: "description of the signature clip",
    })
    description: string

    @ApiProperty({
        description: "object key of the signature clip",
    })
    object_key: string

    @ApiProperty({
        description: "ipfs hash of the signature clip",
    })
    ipfs_hash: string

    @ApiProperty({
        description: "thumbnail of the signature clip",
    })
    thumbnail: string

    @ApiProperty({
        description: "video url of the signature clip",
    })
    video_url: string

    @ApiProperty({
        description: "video metadata of the signature clip",
    })
    video_info: IpSignatureClipMetadataDto

    @ApiProperty({
        description: "asset id of the signature clip",
    })
    asset_id: string
}

export class AppBindWidgetDto {
    @ApiProperty({
        description: "tag of the widget",
    })
    tag: string

    @ApiProperty({
        description: "name of the widget",
    })
    name: string
}

export class IpBindAppsDto {
    @ApiProperty({
        description: "id of the app",
    })
    app_id: string

    @ApiProperty({
        description: "bind widget of the app",
        type: () => [AppBindWidgetDto],
    })
    bind_widgets: AppBindWidgetDto[]
}

export class IpSummaryDto {
    @ApiProperty({
        description: "id of the ip library",
    })
    id: number

    @ApiProperty({
        description: "name of the ip library",
    })
    name: string

    @ApiProperty({
        description: "ticker of the ip library",
    })
    ticker: string

    @ApiProperty({
        description: "description of the ip library",
    })
    description: string

    @ApiProperty({
        description: "likes of the ip library",
    })
    likes: number

    @ApiProperty({
        description: "comments of the ip library",
    })
    comments: number

    @ApiProperty({
        description: "share count of the ip library",
    })
    share_count: number

    @ApiProperty({
        description: "is liked by the user",
    })
    is_user_liked: boolean

    @ApiProperty({
        description: "cover asset id of the ip library",
    })
    cover_asset_id: string

    @ApiProperty({
        description: "cover images of the ip library",
    })
    cover_image: string

    @ApiProperty({
        description: "cover ipfs hash of the ip library",
    })
    cover_hash: string

    @ApiProperty({
        description: "on chain detail",
        type: OnChainDetailDto,
    })
    on_chain_detail: OnChainDetailDto

    @ApiProperty({
        description: "can purchase",
    })
    can_purchase: boolean

    @ApiProperty({
        description: "creation guide lines",
    })
    creation_guide_lines: string

    @ApiProperty({
        description: "is governance right",
    })
    governance_right: boolean

    @ApiProperty({
        description: "creator id of the ip library",
    })
    creator_id: string

    @ApiProperty({
        description: "creator of the ip library",
    })
    creator: string

    @ApiProperty({
        description: "creator description of the ip library",
    })
    creator_description: string

    @ApiProperty({
        description: "creator avatar of the ip library",
    })
    creator_avatar: string

    @ApiProperty({
        description: "is public",
    })
    is_public: boolean

    @ApiProperty({
        description: "is delegating",
    })
    token_is_delegating: boolean

    @ApiProperty({
        description: "ip type",
        enum: ip_type,
    })
    ip_type: ip_type

    @ApiProperty({
        description: "is top",
    })
    is_top: boolean

    @ApiProperty({
        description: "ip level, currently we support 3 level ip, so the value is 1, 2 or 3",
        enum: [1, 2, 3],
    })
    ip_level: number

    @ApiProperty({
        description: "creator followers of the ip library",
    })
    creator_followers: number

    @ApiProperty({
        description: "token info",
        type: () => CreateIpTokenGiggleResponseDto,
    })
    token_info: CreateIpTokenGiggleResponseDto

    @ApiProperty({
        description: "signature clips of the ip library",
        type: [IpSignatureClipDto],
    })
    ip_signature_clips: IpSignatureClipDto[]

    @ApiProperty({
        description: "meta data of the ip library",
        required: false,
    })
    meta_data?: Record<string, any>

    @ApiProperty({
        description: "apps of the ip library",
        type: () => [IpBindAppsDto],
    })
    apps: IpBindAppsDto[]
}
export type OnchainStatusDto = ip_library_on_chain_status

export class IpLibraryDetailDto extends IpSummaryDto {
    @ApiProperty({
        description: "genre of the ip library",
        type: [GenreDto],
    })
    genre: GenreDto[]

    @ApiProperty({
        description: "parent ip library",
        type: [IpSummaryDto],
    })
    parent_ip_info: IpSummaryDto[]

    @ApiProperty({
        description: "child ip library, only return 100 items",
        type: [IpSummaryDto],
    })
    child_ip_info: IpSummaryDto[]

    @ApiProperty({
        description: "on chain status",
    })
    on_chain_status: OnchainStatusDto

    @ApiProperty({
        description: "extra info",
    })
    extra_info: {
        twitter?: string
        website?: string
        telegram?: string
    }
}

export class IpSummaryWithChildDto extends IntersectionType(
    IpSummaryDto,
    PickType(IpLibraryDetailDto, ["child_ip_info"]),
) {}

export class IpLibraryDetailNoChildDto extends OmitType(IpLibraryDetailDto, ["child_ip_info"]) {}

export class IpLibraryListDto {
    @ApiProperty({
        description: "ip libraries",
        type: () => [IpSummaryWithChildDto],
    })
    data: IpSummaryWithChildDto[]

    @ApiProperty({
        description: "total count of ip libraries",
    })
    count: number
}

export enum SourceWalletType {
    AGENT = "agent",
    GIGGLE = "giggle",
}

export class PurchaseStrategyDto {
    @IsEnum(PurchaseStrategyType)
    @ApiProperty({
        description: "type of the purchase strategy",
        enum: PurchaseStrategyType,
    })
    type: PurchaseStrategyType

    @IsNumber()
    @ApiProperty({
        description: "percentage of the purchase strategy",
    })
    percentage: number

    @IsString()
    @ApiProperty({
        description: "prompt of the purchase strategy",
    })
    prompt: string

    @IsString()
    @ApiProperty({
        description: "agent id of the purchase strategy",
    })
    agent_id: string

    @IsEnum(SourceWalletType)
    @ApiProperty({
        description: "source wallet type of the purchase strategy, default is giggle",
        enum: SourceWalletType,
    })
    wallet_source: SourceWalletType

    @ApiProperty({
        description: "strategy detail of the purchase strategy",
        required: false,
    })
    @IsObject()
    @IsOptional()
    strategy_detail?: any
}

export class CreateIpDto {
    @ApiProperty({
        description: "name of the ip library",
    })
    @Validate(IpNameValidator)
    name: string

    @IsNotEmpty()
    @IsString()
    @MinLength(1)
    @MaxLength(10)
    @ApiProperty({
        description: "ticker of the ip library",
    })
    @Validate(TickerValidator)
    ticker: string

    @IsNotEmpty()
    @IsString()
    @MinLength(1)
    @MaxLength(2000)
    @ApiProperty({
        description: "description of the ip library",
    })
    description: string

    @IsOptional()
    @IsArray()
    @ArrayMinSize(0)
    @ArrayMaxSize(3)
    @ApiProperty({
        type: () => [GenreDto],
        required: false,
    })
    genre?: GenreDto[]

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: "asset id of the ip cover image",
    })
    image_id: string

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: "asset id of the video",
        required: false,
    })
    video_id?: string

    @ApiProperty({
        description: "meta data",
        required: false,
    })
    @IsOptional()
    @IsObject()
    meta_data?: Record<string, any>

    @IsOptional()
    @IsNumber()
    @ApiProperty({
        description: "id of the parent ip library",
        required: false,
    })
    parent_ip_library_id?: number

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: "twitter of the ip holder",
        required: false,
    })
    twitter?: string

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: "website of the ip holder",
        required: false,
    })
    website?: string

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: "telegram of the ip holder",
        required: false,
    })
    telegram?: string

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: "tiktok of the ip holder",
        required: false,
    })
    tiktok?: string

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: "instagram of the ip holder",
        required: false,
    })
    instagram?: string
}

export class EditIpDto extends OmitType(CreateIpDto, ["parent_ip_library_id", "name", "ticker"]) {
    @IsNotEmpty()
    @IsNumber()
    @ApiProperty({
        description: "id of the ip library",
    })
    id: number
}

export class LaunchIpTokenDto {
    @IsNumber()
    @ApiProperty({
        description: "id of the ip library",
    })
    ip_id: number

    @ApiProperty({
        description: "purchase strategy of the ip library",
    })
    @ValidateNested()
    @Type(() => PurchaseStrategyDto)
    purchase_strategy: PurchaseStrategyDto
}

export class IpProcessStepsDto {
    ipId: number
    ipPushedToChain: boolean
    ipTokenCreated: boolean
    ipTokenRegistered: boolean
    error: string | null
}

export class AvailableParentIpDto {
    @ApiProperty({
        description: "id of the ip library",
    })
    id: number

    @ApiProperty({
        description: "name of the ip library",
    })
    name: string

    @ApiProperty({
        description: "ticker of the ip library",
    })
    ticker: string

    @ApiProperty({
        description: "children of the ip library",
        type: () => [AvailableParentIpDto],
    })
    children?: AvailableParentIpDto[]
}

export class PurchasedIpDto extends OmitType(AvailableParentIpDto, ["children"]) {}

export class AvailableParentIpsDto {
    @ApiProperty({
        description: "owned ip libraries",
        type: () => [AvailableParentIpDto],
    })
    owned: AvailableParentIpDto[]

    @ApiProperty({
        description: "purchased ip libraries",
        type: () => [PurchasedIpDto],
    })
    purchased: PurchasedIpDto[]
}

export class SetVisibilityDto {
    @IsNotEmpty()
    @IsNumber()
    @ApiProperty({
        description: "id of the ip library",
    })
    id: number

    @IsNotEmpty()
    @IsBoolean()
    @ApiProperty({
        description: "visibility of the ip library",
    })
    is_public: boolean
}

export class UntokenizeDto {
    @IsNotEmpty()
    @IsNumber()
    @ApiProperty({
        description: "id of the ip library",
    })
    id: number
}

export class LikeIpDto {
    @IsNotEmpty()
    @IsNumber()
    @ApiProperty({
        description: "id of the ip library",
    })
    id: number
}

export class IpNameCheckDto {
    @ApiProperty({
        description: "name of the ip library",
    })
    @IsNotEmpty()
    @Validate(IpNameValidator)
    name: string

    @ApiProperty({
        description: "ticker of the ip library",
    })
    @IsNotEmpty()
    @Validate(TickerValidator)
    ticker: string
}
export class UnlikeIpDto extends LikeIpDto {}

export class CreateIpOrderDto extends CreateIpDto {
    @IsNotEmpty()
    @IsUrl({
        require_tld: false,
    })
    @ApiProperty({
        description: "redirect url if order is successful",
    })
    redirect_url: string
}

export class AddShareCountDto {
    @IsNotEmpty()
    @IsNumber()
    @ApiProperty({
        description: "id of the ip library",
    })
    id: number
}

export class RemoveIpDto {
    @IsNotEmpty()
    @IsNumber()
    @ApiProperty({
        description: "id of the ip library",
    })
    id: number
}

export class RemoveIpResponseDto {
    @IsNotEmpty()
    @IsBoolean()
    @ApiProperty({
        description: "success of the ip removal",
    })
    success: boolean
}

export class DelegateIpTokenDto {
    @IsNotEmpty()
    @IsNumber()
    @ApiProperty({
        description: "ip id",
    })
    ip_id: number
}

export class DelegateIpTokenResponseDto {
    @IsNotEmpty()
    @IsEnum(ip_token_delegation_status)
    status: ip_token_delegation_status
}
