import { ApiProperty, IntersectionType, OmitType, PickType } from "@nestjs/swagger"
import { ip_license_consume_log, ip_license_orders } from "@prisma/client"
import { JsonValue } from "@prisma/client/runtime/library"
import { IsInt, Min } from "class-validator"
import { IpSummaryDto } from "../ip-library.dto"
import { PaginationDto } from "src/common/common.dto"

export class OrderCreateDto {
    @ApiProperty({ description: "IP id" })
    ip_id: number
    @ApiProperty({ description: "Quantity" })
    quantity: number
}

export class IpLicenseOrder implements ip_license_orders {
    @ApiProperty({ description: "Order id" })
    id: number

    @ApiProperty({ description: "IP id" })
    ip_id: number

    @ApiProperty({ description: "Quantity" })
    @Min(1)
    @IsInt()
    quantity: number

    @ApiProperty({ description: "Remain quantity" })
    remain_quantity: number
    @ApiProperty({ description: "Owner" })
    owner: string
    @ApiProperty({ description: "Created at" })
    created_at: Date
    @ApiProperty({ description: "Updated at" })
    updated_at: Date
    @ApiProperty({ description: "order amount" })
    amount: number

    @ApiProperty({ description: "Web3 order sn" })
    web3_order_sn: string
}

export class IpLicenseConsumeLog implements ip_license_consume_log {
    @ApiProperty({ description: "Consume log id" })
    id: number

    @ApiProperty({ description: "Order id" })
    order_id: number
    @ApiProperty({ description: "IP id" })
    ip_id: number
    @ApiProperty({ description: "Consume amount" })
    consume_amount: number
    @ApiProperty({ description: "Consume type" })
    consume_type: string
    @ApiProperty({ description: "Consume detail" })
    consume_detail: JsonValue
    @ApiProperty({ description: "Created at" })
    created_at: Date
    @ApiProperty({ description: "Updated at" })
    updated_at: Date
    @ApiProperty({ description: "Refunded" })
    refunded: boolean
    @ApiProperty({ description: "Refunded date" })
    refunded_date: Date
}

export class LicenseOrderDetailDto extends OmitType(IpLicenseOrder, ["owner", "web3_order_sn"]) {
    @ApiProperty({ type: IpLicenseConsumeLog })
    ip_license_consume_log: IpLicenseConsumeLog[]
}

//export class LicenseListReqParams extends PaginationDto {}

export class LicenseIpListReqParams extends PaginationDto {
    @ApiProperty({ description: "search", required: false })
    search?: string

    @ApiProperty({ description: "ip id", required: false })
    ip_id?: number
}

export class LicenseListResDto {
    @ApiProperty({ type: [LicenseOrderDetailDto] })
    data: LicenseOrderDetailDto[]
    @ApiProperty({ description: "total count of ip libraries" })
    count: number
}

export class LicenseIpDto extends IntersectionType(
    IpSummaryDto,
    PickType(LicenseOrderDetailDto, ["ip_id", "quantity", "remain_quantity"]),
) {}

export class LicenseIpListDto {
    @ApiProperty({ type: [LicenseIpDto] })
    data: LicenseIpDto[]

    @ApiProperty({ description: "total count of ip libraries" })
    count: number
}
