import { OrderDetailDto, OrderStatus } from "src/payment/order/order.dto"
import { CreateIpDto } from "../ip-library.dto"
import { ApiProperty } from "@nestjs/swagger"
export enum IpCreateStatus {
    PENDING = "pending",
    CREATING = "creating",
    CREATED = "created",
    FAILED = "failed",
}

export class CheckIpOrderDto {
    @ApiProperty({
        description: "The id of the order",
    })
    order_id: string
    @ApiProperty({
        description: "The creation data of the order",
        type: CreateIpDto,
    })
    creation_data: CreateIpDto
    @ApiProperty({
        description: "The status of the order",
        enum: IpCreateStatus,
    })
    ip_create_status: IpCreateStatus
    @ApiProperty({
        description: "The info of the order",
        type: OrderDetailDto,
    })
    order_info: OrderDetailDto
}

export class CheckIpOrderListDto {
    @ApiProperty({
        description: "The total number of the orders",
    })
    total: number
    @ApiProperty({
        description: "The list of the orders",
        type: [CheckIpOrderDto],
    })
    orders: CheckIpOrderDto[]
}

export class OrderRanksResponseDto {
    @ApiProperty({
        description: "The username of the user",
    })
    username: string

    @ApiProperty({
        description: "The avatar of the user",
    })
    avatar: string

    @ApiProperty({
        description: "The rank of the user",
    })
    rank: number

    @ApiProperty({
        description: "The total duration of the ip creation",
    })
    duration: number
}
