import { ApiProperty } from "@nestjs/swagger"

export class MySummaryDto {
    @ApiProperty({ description: "total ip count" })
    total_ip_count: number

    @ApiProperty({ description: "total ip count" })
    top_level_ip_count: number

    @ApiProperty({ description: "current market value" })
    current_market_value: number

    @ApiProperty({ description: "bound widget" })
    bound_widget: number
}

export class StatisticByDayDto {
    @ApiProperty({ description: "date" })
    date: string

    @ApiProperty({ description: "income" })
    income: number

    @ApiProperty({ description: "market cap" })
    market_cap: number
}

export class MarketCapRankDto {
    @ApiProperty({ description: "ip id" })
    ip_id: number

    @ApiProperty({ description: "ip name" })
    ip_name: string

    @ApiProperty({ description: "cover image" })
    cover_image: string

    @ApiProperty({ description: "market cap" })
    market_cap: number

    @ApiProperty({ description: "change 24h" })
    change_24h: number

    @ApiProperty({ description: "rank" })
    rank: number
}

export class IncomeRankDto {
    @ApiProperty({ description: "ip id" })
    ip_id: number

    @ApiProperty({ description: "ip name" })
    ip_name: string

    @ApiProperty({ description: "cover image" })
    cover_image: string

    @ApiProperty({ description: "income" })
    income: number

    @ApiProperty({ description: "increased income 24h" })
    increased_income_24h: number

    @ApiProperty({ description: "rank" })
    rank: number
}
