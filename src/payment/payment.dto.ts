import { IsEnum, IsInt, IsNumber, Min } from "class-validator"
import { SubscriptionPlanDto, SubscriptionPlanName, SubscriptionPlanPeriod } from "./plans.config"
import { PickType } from "@nestjs/swagger"

export class CreateSubscriptionDto extends PickType(SubscriptionPlanDto, ["name", "period"]) {
    @IsEnum(SubscriptionPlanName)
    name: SubscriptionPlanName
    @IsEnum(SubscriptionPlanPeriod)
    period: SubscriptionPlanPeriod
}

export class UpdateSubscriptionDto extends CreateSubscriptionDto {}

export class GetUserSubscriptionStatusDto extends PickType(SubscriptionPlanDto, [
    "name",
    "period",
    "price_per_credit",
    "price_id",
]) {
    next_billing_date: Date | null
    ended_date: Date | null
    invoices?: {
        id: string
        status: string
        downloadUrl: string
        previewUrl: string
        amount: number
        created_at: Date
    }[]
}

export class GetCreditConsumeHistoryDto {
    @IsInt()
    @Min(1, { message: "Take must be greater or equal to 1" })
    take: number

    @IsInt()
    @Min(0, { message: "Skip must be greater or equal to 0" })
    skip: number

    @IsInt()
    @Min(1, { message: "Last days must be greater or equal to 1" })
    lastDays: number
}

export class SubscriptionResultDto {
    url: string
    redirect: boolean
    message?: string
}

export class AddCreditsDto {
    @IsNumber()
    @Min(1, { message: "credits must be greater or equal to 1" })
    amount: number
}
