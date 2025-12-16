import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsOptional, IsString } from "class-validator"

export class PayWithPayPalRequestDto {
    @ApiProperty({
        description: "The order id to pay",
        example: "550e8400-e29b-41d4-a716-446655440000",
    })
    @IsString()
    @IsNotEmpty()
    order_id: string
}

export class PayWithPayPalResponseDto {
    @ApiProperty({
        description: "The PayPal order ID",
        example: "5O190127TN364715T",
    })
    paypal_order_id: string

    @ApiProperty({
        description: "The URL to redirect user for PayPal approval",
        example: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T",
    })
    approval_url: string
}

export class CapturePayPalOrderDto {
    @ApiProperty({
        description: "The PayPal order ID to capture",
        example: "5O190127TN364715T",
    })
    @IsString()
    @IsNotEmpty()
    paypal_order_id: string
}

export class PayPalWebhookEventDto {
    @ApiProperty({ description: "PayPal event ID" })
    id: string

    @ApiProperty({ description: "PayPal event type" })
    event_type: string

    @ApiProperty({ description: "Event resource data" })
    resource: any

    @ApiProperty({ description: "Event creation time" })
    create_time: string

    @ApiProperty({ description: "Resource type" })
    resource_type: string

    @ApiProperty({ description: "Summary of the event" })
    summary: string
}

export class GetPayPalOrderStatusDto {
    @ApiProperty({
        description: "The PayPal order ID",
        example: "5O190127TN364715T",
    })
    @IsString()
    @IsNotEmpty()
    paypal_order_id: string
}

export class PayPalOrderStatusResponseDto {
    @ApiProperty({
        description: "PayPal order status",
        example: "COMPLETED",
    })
    status: string

    @ApiProperty({
        description: "Our internal order ID",
        example: "550e8400-e29b-41d4-a716-446655440000",
    })
    order_id: string

    @ApiProperty({
        description: "PayPal order ID",
        example: "5O190127TN364715T",
    })
    paypal_order_id: string
}


