import { Prisma } from "@prisma/client"

export class IssueCreditDto implements Prisma.user_credit_issuesCreateInput {
    user: string
    credit: number
    type: "subscription" | "additional" | "free"
    effective_date: Date
    expire_date: Date
    subscription_id: string
    invoice_id: string
    never_expire?: boolean
}

export type ProductType = "video2video" | "face_swap" | "generate_video" | "generate_image"
