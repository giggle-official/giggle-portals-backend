import { ApiProperty, IntersectionType, OmitType, PickType } from "@nestjs/swagger"
import { ip_library_on_chain_status } from "@prisma/client"
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
    IsDateString,
    ArrayMinSize,
    ArrayMaxSize,
    Matches,
} from "class-validator"
import { PaginationDto } from "src/common/common.dto"
import { VideoInfoTaskResponseDto } from "src/task/task.dto"
import { CreateIpTokenGiggleResponseDto } from "src/web3/giggle/giggle.dto"
import { OnChainDetailDto } from "src/web3/ip-on-chain/ip-on-chain.dto"
import { Type } from "class-transformer"
import { IpNameValidator, IpPeriodValidator, RevenueDistributionValidator } from "./ip-library.validator"

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
        description: "is public",
    })
    @IsOptional()
    @IsEnum(["true", "false"])
    is_public?: "true" | "false"

    @ApiProperty({
        required: false,
        description: "children levels",
    })
    @IsOptional()
    @IsEnum(["1", "2", "3"])
    children_levels?: "1" | "2"
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

export class RevenueDistributionDto {
    @ApiProperty({
        description: "licensor percentage of the revenue distribution",
    })
    licensor: number

    @ApiProperty({
        description: "platform percentage of the revenue distribution",
    })
    platform: number

    @ApiProperty({
        description: "community percentage of the revenue distribution",
    })
    community: number

    @ApiProperty({
        description: "treasury percentage of the revenue distribution",
    })
    treasury: number
}

export class IpPeriodDto {
    @IsDateString()
    @ApiProperty({
        description: "start date of the ip library",
        required: false,
    })
    start_date: Date | null

    @IsDateString()
    @ApiProperty({
        description: "end date of the ip library",
        required: false,
    })
    end_date: Date | null
}

export class LicenseDto {
    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: "name of the license",
    })
    name: string
}

export enum AuthorizationSettingsCanPurchase {
    OPEN_ACCESS = "open-access",
    RESTRICTED = "restricted",
}

export enum GovernanceType {
    GOVERNANCE_RIGHT = "governance_right",
    EXCLUSIVE_NFT_ACCESS = "exclusive_nft_access",
    GAME_FILM_ROYALTIES = "game_film_royalties",
    IP_REVENUE_SHARE = "ip_revenue_share",
    FAN_PARTICIPATION_IP_EXPANSION = "fan_participation_ip_expansion",
}

export class GovernanceTypeDto {
    @IsEnum(GovernanceType)
    @ApiProperty({
        description: "name of the governance type",
        enum: GovernanceType,
    })
    name: GovernanceType
}

export class TerritoryDto {
    @IsString()
    @ApiProperty({
        description: "name of the territory",
    })
    name: string

    @IsString()
    @ApiProperty({
        description: "value of the territory",
    })
    value: string

    @IsArray()
    @ApiProperty({
        description: "children of the territory",
        type: () => [TerritoryDto],
    })
    children?: TerritoryDto[]
}

export class ChildIpExtraAuthSettingsDto {
    @ApiProperty({
        required: false,
    })
    @IsNumber()
    @IsOptional()
    on_chain_revenue_creator?: number

    @ApiProperty({
        required: false,
    })
    @IsNumber()
    @IsOptional()
    on_chain_revenue_ip_holder?: number

    @ApiProperty({
        required: false,
    })
    @IsNumber()
    @IsOptional()
    on_chain_revenue_platform?: number

    @ApiProperty({
        required: false,
    })
    @IsNumber()
    @IsOptional()
    commercial_pass_threshold?: number

    @ApiProperty({
        required: false,
    })
    @IsNumber()
    @IsOptional()
    license_duration?: number

    @ApiProperty({
        required: false,
    })
    @IsNumber()
    @IsOptional()
    external_revenue_creator?: number

    @ApiProperty({
        required: false,
    })
    @IsNumber()
    @IsOptional()
    external_revenue_ip_holder?: number

    @ApiProperty({
        required: false,
    })
    @IsNumber()
    @IsOptional()
    external_revenue_platform?: number
}

export class AuthorizationSettingsDto {
    @IsEnum(AuthorizationSettingsCanPurchase)
    @ApiProperty({
        description: "is license of the ip library can be purchased by users",
        enum: AuthorizationSettingsCanPurchase,
    })
    can_purchase: AuthorizationSettingsCanPurchase

    @Type(() => LicenseDto)
    @IsArray()
    @ArrayMinSize(1)
    @ApiProperty({
        type: () => [LicenseDto],
        description: "licenses of the ip library",
    })
    @ValidateNested({ each: true })
    license: LicenseDto[]

    @IsOptional()
    @ApiProperty({
        description: "territory of the authorization settings",
        required: false,
        isArray: true,
        type: () => TerritoryDto,
    })
    territory?: TerritoryDto[] | string

    @IsObject()
    @ApiProperty({
        type: () => RevenueDistributionDto,
        description:
            "revenue distribution of the authorization settings, all the numbers must be between 0 and 100 and the sum must be 100",
    })
    @Validate(RevenueDistributionValidator)
    revenue_distribution: RevenueDistributionDto

    @IsArray()
    @ApiProperty({
        description: "governance types of the authorization settings",
        type: () => [GovernanceTypeDto],
    })
    governance_types: GovernanceTypeDto[]

    @IsBoolean()
    @IsNotEmpty()
    @ApiProperty({
        description: "is long term license",
    })
    long_term_license: boolean

    @IsObject()
    @Validate(IpPeriodValidator)
    @ApiProperty({
        type: () => IpPeriodDto,
        description: "valid date of the ip library, this field is required if long_term_license is false",
    })
    valid_date: IpPeriodDto

    @IsOptional()
    @IsNumber()
    @ApiProperty({
        description: "price of the license",
        required: true,
    })
    license_price: number

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: "notes of the authorization settings",
        required: false,
    })
    notes?: string

    @IsOptional()
    @IsObject()
    @ApiProperty({
        description: "extra settings of the authorization settings, this field is only used for child ip",
        required: false,
        type: () => ChildIpExtraAuthSettingsDto,
    })
    child_ip_extra_settings?: ChildIpExtraAuthSettingsDto
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
    asset_id: number
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
        description: "is liked by the user",
    })
    is_user_liked: boolean

    @ApiProperty({
        description: "cover asset id of the ip library",
    })
    cover_asset_id: number

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
        description: "is top",
    })
    is_top: boolean

    @ApiProperty({
        description: "creator followers of the ip library",
    })
    creator_followers: number

    @ApiProperty({
        description: "token info",
        type: CreateIpTokenGiggleResponseDto,
    })
    token_info: CreateIpTokenGiggleResponseDto

    @ApiProperty({
        description: "signature clips of the ip library",
        type: [IpSignatureClipDto],
    })
    ip_signature_clips: IpSignatureClipDto[]

    @ApiProperty({
        type: () => AuthorizationSettingsDto,
        description: "authorization settings of the ip library",
    })
    authorization_settings: AuthorizationSettingsDto
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
    @Matches(/^[A-Za-z0-9]+$/)
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
    @IsNumber()
    @ApiProperty({
        description: "asset id of the ip cover image",
    })
    image_id: number

    @IsOptional()
    @IsNumber()
    @ApiProperty({
        description: "id of the video",
        required: false,
    })
    video_id?: number

    @IsNotEmpty()
    @IsBoolean()
    @ApiProperty({
        description: "share this ip to giggle",
    })
    share_to_giggle: boolean

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: "creation guide lines of the ip library",
        required: false,
    })
    creation_guide_lines?: string

    @IsOptional()
    @IsOptional()
    @IsEnum(["solana", "base"])
    @ApiProperty({
        description: "chain name of the ip library, currently only support solana",
        default: "solana",
        required: false,
    })
    chain_name?: "solana" | "base"

    @ApiProperty({
        type: () => AuthorizationSettingsDto,
        description: "authorization settings",
    })
    @ValidateNested()
    @Type(() => AuthorizationSettingsDto)
    authorization_settings: AuthorizationSettingsDto

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
        description: "more options",
        required: false,
    })
    twitter?: string

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: "website of the ip library",
        required: false,
    })
    website?: string

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: "telegram of the ip library",
        required: false,
    })
    telegram?: string

    @IsOptional()
    @IsNumber()
    @IsInt()
    @ApiProperty({
        description: "buy **PERCENTAGE** of ip tokens to self using usdc when share to giggle",
        required: false,
    })
    buy_amount: number
}

export class EditIpDto extends OmitType(CreateIpDto, [
    "share_to_giggle",
    "parent_ip_library_id",
    "chain_name",
    "name",
    "ticker",
    "buy_amount",
]) {
    @IsNotEmpty()
    @IsNumber()
    @ApiProperty({
        description: "id of the ip library",
    })
    id: number
}

export class ShareToGiggleDto extends PickType(CreateIpDto, ["buy_amount"]) {
    @IsNotEmpty()
    @IsNumber()
    @ApiProperty({
        description: "id of the ip library",
    })
    id: number
}

export class RegisterTokenDto {
    @IsNotEmpty()
    @IsNumber()
    @ApiProperty({
        description: "id of the ip library",
    })
    id: number
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

export class UnlikeIpDto extends LikeIpDto {}
