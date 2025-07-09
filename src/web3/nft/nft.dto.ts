import { ApiProperty } from "@nestjs/swagger"
import { nft_task_status } from "@prisma/client"
import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsObject, IsString } from "class-validator"
import { PaginationDto } from "src/common/common.dto"

export class MintNftReqDto {
    @ApiProperty({
        description: "The asset id to mint",
    })
    @IsNotEmpty()
    @IsString()
    asset_id: string

    @ApiProperty({
        description: "The name of the nft",
    })
    @IsNotEmpty()
    @IsString()
    name: string

    @ApiProperty({
        description: "The description of the nft",
    })
    @IsNotEmpty()
    @IsString()
    description: string

    //@ApiProperty({
    //    description:
    //        "The callback url if mint status updated, if not provided, you can use the get task api to get the result",
    //    required: false,
    //})
    //@IsString()
    //callback_url?: string
}

export class MyNftReqDto extends PaginationDto {
    @ApiProperty({
        description: "The nft address",
        required: false,
    })
    @IsString()
    mint?: string

    @ApiProperty({
        description: "The task id",
        required: false,
    })
    @IsString()
    task_id?: string
}

export class NftDetailResDto {
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
        description: "Transaction hash",
    })
    @IsNotEmpty()
    @IsString()
    tx: string
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
