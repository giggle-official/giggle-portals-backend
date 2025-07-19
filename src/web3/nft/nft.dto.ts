import { ApiProperty } from "@nestjs/swagger"
import { nft_task_status } from "@prisma/client"
import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, MaxLength } from "class-validator"
import { PaginationDto } from "src/common/common.dto"

export class MintNftReqDto {
    @ApiProperty({
        description: "The cover image asset id to mint, must be an image asset",
    })
    @IsString()
    @IsNotEmpty()
    cover_asset_id: string

    @ApiProperty({
        description: "The name of the nft",
        example: "My Nft",
        maxLength: 128,
    })
    @IsNotEmpty()
    @IsString()
    @MaxLength(128, { message: "Name must be less than 128 characters" })
    name: string

    @ApiProperty({
        description: "The description of the nft",
        example: "This is my nft",
        maxLength: 2048,
    })
    @IsNotEmpty()
    @IsString()
    @MaxLength(2048, { message: "Description must be less than 2048 characters" })
    description: string

    @ApiProperty({
        description: "The video asset id to mint, if not provided, the nft will be an image nft",
        required: false,
    })
    @IsOptional()
    @IsString()
    video_asset_id?: string
}

export class MyNftReqDto extends PaginationDto {
    @ApiProperty({
        description: "The nft address",
        required: false,
    })
    @IsOptional()
    mint?: string

    @ApiProperty({
        description: "The task id",
        required: false,
    })
    @IsOptional()
    task_id?: string

    @ApiProperty({
        description: "The email of the user, this is required when requester is developer",
        required: false,
    })
    @IsOptional()
    email?: string

    @ApiProperty({
        description: "The status of the nft",
        required: false,
    })
    @IsEnum(nft_task_status)
    @IsOptional()
    status?: nft_task_status
}

export class NftDetailResDto {
    @ApiProperty({
        description: "User id",
    })
    @IsNotEmpty()
    @IsString()
    user: string

    @ApiProperty({
        description: "Cover asset id",
    })
    @IsNotEmpty()
    @IsString()
    cover_asset_id: string

    @ApiProperty({
        description: "Video asset id",
    })
    @IsNotEmpty()
    @IsString()
    video_asset_id: string

    @ApiProperty({
        description: "Widget tag",
    })
    @IsNotEmpty()
    @IsString()
    widget_tag: string

    @ApiProperty({
        description: "App id",
    })
    @IsNotEmpty()
    @IsString()
    app_id: string

    @ApiProperty({
        description: "Task id of minting nft",
        required: false,
    })
    @IsString()
    mint_task_id: string

    @ApiProperty({
        description: "Collection name of the nft",
    })
    @IsNotEmpty()
    @IsString()
    collection: string

    @ApiProperty({
        description: "Nft address",
    })
    @IsNotEmpty()
    @IsString()
    mint: string

    @ApiProperty({
        description: "Metadata",
        type: () => Object,
        example: {
            name: "Nft Name",
            description: "Nft Description",
            image: "https://example.com/image.png",
        },
    })
    @IsNotEmpty()
    @IsObject()
    metadata: object

    @ApiProperty({
        description: "Nft status",
    })
    @IsNotEmpty()
    @IsEnum(nft_task_status)
    mint_status: nft_task_status

    @ApiProperty({
        description: "Failure reason",
    })
    @IsNotEmpty()
    @IsString()
    failure_reason: string

    @ApiProperty({
        description: "Signature of minting nft",
    })
    @IsNotEmpty()
    @IsString()
    signature: string
}

export class MyNftListResDto {
    @ApiProperty({
        description: "Nft list",
        type: () => NftDetailResDto,
        isArray: true,
    })
    @IsNotEmpty()
    @IsArray()
    nfts: NftDetailResDto[]

    @ApiProperty({
        description: "Total count",
    })
    @IsNotEmpty()
    @IsNumber()
    total: number
}

export class NftMintJobDataDto {
    user: string
    collection: string
    cover_asset_id: string
    video_asset_id: string
    name: string
    description: string
    notify_url: string
}

export class NftMintMiddlewareResDto {
    isSucc: boolean
    res: {
        tx: string
    }
}
