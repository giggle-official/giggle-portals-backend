import { ApiProperty, PickType } from "@nestjs/swagger"
import { IsEnum, IsNumber, IsString, Min, MinLength } from "class-validator"
import { IpEvents } from "src/ip-library/ip-library.dto"

export class UploadCoverImageResponseDto {
    @ApiProperty({
        description: "name of the cover image",
    })
    name: string

    @ApiProperty({
        description: "url of the cover image",
    })
    url: string

    @ApiProperty({
        description: "tag of the cover image",
    })
    tag: string

    @ApiProperty({
        description: "key of the cover image",
    })
    key: string
}

export class GiggleApiResponseDto<T> {
    code: number
    data: T
    msg: string
}

export class CreateIpTokenDto {
    @ApiProperty({
        description:
            "cover image s3 key of the ip token, if provided, this asset will be uploaded to ipfs and used as cover image",
        type: "string",
        required: false,
    })
    cover_s3_key?: string

    @ApiProperty({
        description: "name of the ip token",
    })
    @IsString()
    @MinLength(1)
    name: string

    @ApiProperty({
        description: "ticker of the ip token",
    })
    @IsString()
    @MinLength(1)
    ticker: string

    @ApiProperty({
        description: "cover image of the ip token, in ipfs format",
    })
    cover_image: string

    @ApiProperty({
        description: "description of the ip token",
    })
    @IsString()
    @MinLength(1)
    description: string

    @ApiProperty({
        description: "twitter of the ip token",
    })
    twitter?: string

    @ApiProperty({
        description: "telegram of the ip token",
    })
    telegram?: string

    @ApiProperty({
        description: "website of the ip token",
    })
    website?: string

    @ApiProperty({
        description: "buy sol of the ip token",
    })
    buySol?: number

    @ApiProperty({
        description: "create amount of the ip token, minimum 0.3, in usdc",
    })
    createAmount: number

    @ApiProperty({
        description: "buy amount of the ip token when create, in usdc",
    })
    buyAmount?: number

    @ApiProperty({
        description: "asset id of the ip token",
        type: "string",
        required: false,
    })
    asset_id?: number | string
}

export class CreateIpTokenResponseDto {
    @ApiProperty({
        description: "url of the ip token for preview",
    })
    url: string
}

export class GetIpTokenListResponseDto {
    @ApiProperty({
        description: "count of ip tokens",
    })
    count: number

    @ApiProperty({
        description: "list of ip tokens",
    })
    data: CreateIpTokenGiggleResponseDto[]
}

export class GetUploadTokenResponseDto {
    key: string
    preSignedUrl: string
}

export class CreateIpTokenGiggleRequestDto {
    email: string
    name: string
    coverUrl: string
    fileUrl: string
    symbol: string
    description?: string
    twitter?: string
    telegram?: string
    website?: string
    buySol?: number
    buyAmount?: number
    createAmount: number
}

export class CreateIpTokenGiggleResponseDto {
    @ApiProperty({
        description: "user address on chain",
    })
    user_address: string

    @ApiProperty({
        description: "token mint address",
    })
    mint: string

    @ApiProperty({
        description: "bonding curve address",
    })
    bonding_curve: string

    @ApiProperty({
        description: "bonding curve progress",
    })
    bonding_curve_progress: number

    @ApiProperty({
        description: "name of the ip token",
    })
    name: string

    @ApiProperty({
        description: "symbol of the ip token",
    })
    symbol: string

    @ApiProperty({
        description: "current price of the ip token",
    })
    price: string

    @ApiProperty({
        description: "market cap of the ip token",
    })
    market_cap: string

    @ApiProperty({
        description: "circulating supply of the ip token",
    })
    circulating_supply: string

    @ApiProperty({
        description: "total supply of the ip token",
    })
    total_supply: string

    @ApiProperty({
        description: "cover url of the ip token",
    })
    cover_url: string

    @ApiProperty({
        description: "file url of the ip token",
    })
    file_url: string

    @ApiProperty({
        description: "twitter of the ip token",
    })
    twitter: string

    @ApiProperty({
        description: "telegram of the ip token",
    })
    telegram: string

    @ApiProperty({
        description: "website of the ip token",
    })
    website: string

    @ApiProperty({
        description: "visit link of the ip token",
    })
    visitLink: string

    @ApiProperty({
        description: "status of the ip token",
    })
    status: string

    @ApiProperty({
        description: "signature of the ip token",
    })
    signature: string

    @ApiProperty({
        description: "description of the ip token",
    })
    description: string

    @ApiProperty({
        description: "metadata uri of the ip token",
    })
    metadata_uri: string

    @ApiProperty({
        description: "sequels amount of the ip token",
    })
    sequels_amount: string

    @ApiProperty({
        description: "credit price of the ip token, this field is only used for license purchase",
    })
    credit_price: number

    @ApiProperty({
        description: "created at of the ip token",
    })
    created_at: string

    @ApiProperty({
        description: "updated at of the ip token",
    })
    updated_at: string

    @ApiProperty({
        description: "5m change of the ip token",
        required: false,
    })
    change5m?: string

    @ApiProperty({
        description: "1h change of the ip token",
        required: false,
    })
    change1h?: string

    @ApiProperty({
        description: "24h change of the ip token",
        required: false,
    })
    change24h?: string

    @ApiProperty({
        description: "trade volume of the ip token",
        required: false,
    })
    volume?: string

    @ApiProperty({
        description: "on exchange of the ip token",
        required: false,
    })
    on_exchange?: boolean

    @ApiProperty({
        description: "pool address of the ip token",
        required: false,
    })
    poolAddress?: string
}

export class GetIpTokenListQueryDto {
    @ApiProperty({
        description: "page number",
    })
    page: string

    @ApiProperty({
        description: "page size",
    })
    page_size: string

    @ApiProperty({
        description: "site of the ip token, '' to get all ip tokens",
        required: false,
    })
    site: string

    @ApiProperty({
        description: "mint address of the ip token, use comma to split",
        required: false,
    })
    mint?: string

    @ApiProperty({
        description: "user wallet address of the ip token",
        required: false,
    })
    addr?: string
}

export class SSEMessage {
    @ApiProperty({
        description: "event of the message",
        enum: IpEvents,
    })
    event: IpEvents

    @ApiProperty({
        description: "data of the message",
        required: false,
    })
    data?: any

    @ApiProperty({
        description: " message of event",
        required: false,
    })
    message?: string
}

export class WalletCoinSummaryDto {
    @ApiProperty({
        description: "holding number",
    })
    holding_num: number
    @ApiProperty({
        description: "formated holding number",
    })
    formated_holding_num: string

    @ApiProperty({
        description: "holding amount",
    })
    holding_amount: number
    @ApiProperty({
        description: "formated holding amount",
    })
    formated_holding_amount: string

    @ApiProperty({
        description: "price",
    })
    price: number
    @ApiProperty({
        description: "formated price",
    })
    formated_price: string

    @ApiProperty({
        description: "symbol",
    })
    symbol: string
    @ApiProperty({
        description: "name",
    })
    name: string
    @ApiProperty({
        description: "mint",
    })
    mint: string

    @ApiProperty({
        description: "cover image url",
    })
    cover_url: string

    @ApiProperty({
        description: "5m change of the ip token",
    })
    change5m: string

    @ApiProperty({
        description: "1h change of the ip token",
    })
    change1h: string

    @ApiProperty({
        description: "24h change of the ip token",
    })
    change24h: string
}

export class WalletDetailDto {
    @ApiProperty({
        description: "user wallet address",
    })
    addr: string

    @ApiProperty({
        description: "total balance",
    })
    total_balance: number
    @ApiProperty({
        description: "formated total balance",
    })
    formated_total_balance: string

    @ApiProperty({
        description: "ip total market cap",
    })
    ip_total_market_cap: number

    @ApiProperty({
        description: "formated market cap",
    })
    formated_market_cap: string

    @ApiProperty({
        description: "list of ip tokens",
        type: () => [WalletCoinSummaryDto],
    })
    list: WalletCoinSummaryDto[]
    @ApiProperty({
        description: "page",
    })
    page: number
    @ApiProperty({
        description: "page size",
    })
    page_size: number
}

export class UserMarketCapDto extends PickType(WalletDetailDto, ["ip_total_market_cap", "formated_market_cap"]) {}

export class TradeDto {
    @ApiProperty({
        description: "type of the trade",
        enum: ["buy", "sell"],
        example: "buy",
    })
    @IsEnum(["buy", "sell"], {
        message: "type must be buy or sell",
    })
    type: "buy" | "sell"
    @ApiProperty({
        description: "token address of the trade",
    })
    token: string
    @ApiProperty({
        description: "amount of the trade",
    })
    @IsNumber()
    amount: number
}

export enum TradeStatus {
    PENDING = 1,
    SUCCESS = 2,
    FAILED = 3,
}

export class TradeResponseFromGiggleDto {
    taskId: string
    @ApiProperty({
        description: "status of the trade, 1: pending, 2: success, 3: failed",
        enum: TradeStatus,
    })
    status: TradeStatus
    @ApiProperty({
        description: "sign of the trade",
    })
    sign: string[]
}

export class TradeResponseDto extends PickType(TradeResponseFromGiggleDto, ["status", "sign"]) {}

export class SendTokenDto {
    @ApiProperty({
        description: "token address of the trade",
    })
    mint: string

    @ApiProperty({
        description: "amount of the send",
    })
    amount: number

    @ApiProperty({
        description: "address of the receiver",
    })
    receipt: string
}

export class SendTokenResponseDto {
    @ApiProperty({
        description: "transaction hash of the send",
    })
    sig: string
}

export class PaymentDto {
    amount: number
    user: string
}

export enum PaymentStatus {
    CANCELLED = 0,
    UNPAID = 1,
    PAID = 2,
    CONFIRMED = 3,
    PENDING_REFUND = 4,
    REFUNDED = 5,
}

export class PaymentResponseDto {
    sn: string
    amount: number
    mint: string
    status: PaymentStatus
    paymentHash: string
    refundHash: string
}

export enum ConfirmStatus {
    CONFIRMED = "confirmed",
    REFUNDED = "refund",
}

export class PaymentCallbackDto {
    @ApiProperty({
        description: "sn of the payment",
    })
    sn: string
    @ApiProperty({
        description: "status of the payment",
    })
    status: ConfirmStatus
}

export type TopUpResponseDto = string
