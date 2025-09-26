import { Decimal } from "@prisma/client/runtime/library"

export class AppendAccessLogDto {
    device_id?: string
    app_id?: string
    widget_tag?: string
    link_id?: string
    user?: string
}

export class RevenueStatsDto {
    buyback_day_allocated: Decimal
    platform_day_allocated: Decimal
    ip_holder_day_allocated: Decimal
    customized_day_allocated: Decimal
    developer_day_allocated: Decimal
    other_day_allocated: Decimal
    unsetted_day_allocation: Decimal

    buyback_month_allocated: Decimal
    platform_month_allocated: Decimal
    ip_holder_month_allocated: Decimal
    customized_month_allocated: Decimal
    developer_month_allocated: Decimal
    other_month_allocated: Decimal
    unsetted_month_allocation: Decimal

    buyback_total_allocated: Decimal
    platform_total_allocated: Decimal
    ip_holder_total_allocated: Decimal
    customized_total_allocated: Decimal
    developer_total_allocated: Decimal
    other_total_allocated: Decimal
    unsetted_total_allocation: Decimal

    widget_tag: string
    day_usd_revenue: Decimal
    month_usd_revenue: Decimal
    total_usd_revenue: Decimal
    widget_name: string
}

export class TotalRevenueByIpDto {
    //widget_tag: string
    //app_id: string
    day_usd_revenue: Decimal
    month_usd_revenue: Decimal
    total_usd_revenue: Decimal
    ip_name: string
    widget_name: string
}

export class TotalRegisterdUserDto {
    day_registered: number
    month_registered: number
    total_registered: number
    // register_app_id: string
    ip_name: string
    // widget_name: string
}
