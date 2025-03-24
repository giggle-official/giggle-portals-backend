import { ApiProperty } from "@nestjs/swagger"

export enum SubscriptionPlanName {
    None = "none",
    Free = "Free",
    Starter = "Starter",
    Basic = "Basic",
    Premium = "Premium",
    Custom = "Custom",
}

export enum SubscriptionPlanPeriod {
    Monthly = "monthly",
    Yearly = "yearly",
}

export class SubscriptionPlanDto {
    @ApiProperty({
        description: "The name of the plan",
        enum: SubscriptionPlanName,
    })
    name: SubscriptionPlanName

    @ApiProperty({
        description: "The period of the plan",
        enum: SubscriptionPlanPeriod,
    })
    period: SubscriptionPlanPeriod

    @ApiProperty({
        description: "The price of the plan",
        type: Number,
    })
    price: number

    @ApiProperty({
        description: "The price per credit of the plan, using to purchase external credits",
        type: Number,
    })
    price_per_credit: number

    @ApiProperty({
        description: "Stripe price id of the plan",
        type: String,
    })
    price_id: string

    @ApiProperty({
        description: "The credits per month of the plan",
        type: Number,
    })
    credit_per_month: number

    @ApiProperty({
        description: "The maximum seconds of animation convert of the plan",
        type: Number,
    })
    video_convert_max_seconds: number

    @ApiProperty({
        description: "The credits consume every second of the plan",
        type: Number,
    })
    credit_consume_every_second: number

    @ApiProperty({
        description: "The credits consume every second of the plan",
        type: Number,
    })
    face_swap_consume_every_second: number

    @ApiProperty({
        description: "The credits consume every second of the plan",
        type: Number,
    })
    generate_video_consume_every_second: number

    @ApiProperty({
        description: "The credits consume per image of the plan",
        type: Number,
    })
    generate_image_consume_per_image: number

    @ApiProperty({
        type: "object",
        description: "The rights of the plan",
        required: [],
        properties: {
            max_animate_seconds: {
                description: "The maximum seconds of animation convert of the plan",
                type: "number",
            },
            max_generate_videos: { description: "The maximum seconds of generate videos of the plan", type: "number" },
            max_generate_images: { description: "The maximum seconds of generate images of the plan", type: "number" },
        },
    })
    extra_info?: {
        max_animate_seconds: number
        max_generate_videos: number
        max_generate_images: number
    }
}

export const freePlan: SubscriptionPlanDto = {
    name: SubscriptionPlanName.Free,
    period: SubscriptionPlanPeriod.Monthly,
    price_per_credit: 9999,
    price: 0,
    credit_per_month: 0,
    video_convert_max_seconds: 360,
    price_id: "",
    credit_consume_every_second: 5,
    face_swap_consume_every_second: 1,
    generate_video_consume_every_second: 1,
    generate_image_consume_per_image: 1,
}

const subscriptionDefaultSettings = {
    credit_consume_every_second: 5,
    face_swap_consume_every_second: 1,
    generate_video_consume_every_second: 1,
    generate_image_consume_per_image: 1,
    video_convert_max_seconds: 360,
}

const subscriptionStarterRights = {
    max_animate_seconds: 58,
    max_generate_videos: 100,
    max_generate_images: 15,
}

const subscriptionBasicRights = {
    max_animate_seconds: 323,
    max_generate_videos: 550,
    max_generate_images: 84,
}

const subscriptionPremiumRights = {
    max_animate_seconds: 941,
    max_generate_videos: 1600,
    max_generate_images: 246,
}

export const subscriptionPlans: { env: string; plans: SubscriptionPlanDto[] }[] = [
    {
        env: "test",
        plans: [
            {
                name: SubscriptionPlanName.Starter,
                period: SubscriptionPlanPeriod.Monthly,
                price_per_credit: 0.035,
                price: 9.99,
                credit_per_month: 1000,
                price_id: "price_1QvxdKK8QxdE3RUIdmvGyJwM",
                extra_info: subscriptionStarterRights,
                ...subscriptionDefaultSettings,
            },
            {
                name: SubscriptionPlanName.Starter,
                period: SubscriptionPlanPeriod.Yearly,
                price_per_credit: 0.035,
                price: 99.99,
                credit_per_month: 1000,
                price_id: "price_1QvxdwK8QxdE3RUIItNtL7fk",
                extra_info: subscriptionStarterRights,
                ...subscriptionDefaultSettings,
            },
            {
                name: SubscriptionPlanName.Basic,
                period: SubscriptionPlanPeriod.Monthly,
                price_per_credit: 0.035,
                price: 49.99,
                credit_per_month: 5500,
                price_id: "price_1QJrG5K8QxdE3RUIQBERziwG",
                extra_info: subscriptionBasicRights,
                ...subscriptionDefaultSettings,
            },
            {
                name: SubscriptionPlanName.Basic,
                period: SubscriptionPlanPeriod.Yearly,
                price_per_credit: 0.035,
                price: 499.99,
                credit_per_month: 5500,
                price_id: "price_1QJrLwK8QxdE3RUIdhIaB358",
                extra_info: subscriptionBasicRights,
                ...subscriptionDefaultSettings,
            },
            {
                name: SubscriptionPlanName.Premium,
                period: SubscriptionPlanPeriod.Monthly,
                price_per_credit: 0.03,
                price: 129.99,
                credit_per_month: 16000,
                price_id: "price_1QJrHoK8QxdE3RUIvURuhRLI",
                extra_info: subscriptionPremiumRights,
                ...subscriptionDefaultSettings,
            },
            {
                name: SubscriptionPlanName.Premium,
                period: SubscriptionPlanPeriod.Yearly,
                price_per_credit: 0.03,
                price: 1299.99,
                credit_per_month: 16000,
                price_id: "price_1QJrMKK8QxdE3RUIxIs4hCbQ",
                extra_info: subscriptionPremiumRights,
                ...subscriptionDefaultSettings,
            },
        ],
    },
    {
        env: "product",
        plans: [
            {
                name: SubscriptionPlanName.Starter,
                period: SubscriptionPlanPeriod.Monthly,
                price_per_credit: 0.035,
                price: 9.99,
                credit_per_month: 1000,
                price_id: "price_1QvxebK8QxdE3RUIeDDiktWl",
                extra_info: subscriptionStarterRights,
                ...subscriptionDefaultSettings,
            },
            {
                name: SubscriptionPlanName.Starter,
                period: SubscriptionPlanPeriod.Yearly,
                price_per_credit: 0.035,
                price: 99.99,
                credit_per_month: 1000,
                price_id: "price_1QvxebK8QxdE3RUIzEXN6TIG",
                extra_info: subscriptionStarterRights,
                ...subscriptionDefaultSettings,
            },
            {
                name: SubscriptionPlanName.Basic,
                period: SubscriptionPlanPeriod.Monthly,
                price_per_credit: 0.035,
                price: 49.99,
                credit_per_month: 5000,
                price_id: "price_1QMSARK8QxdE3RUIHUUyOiah",
                extra_info: subscriptionBasicRights,
                ...subscriptionDefaultSettings,
            },
            {
                name: SubscriptionPlanName.Basic,
                period: SubscriptionPlanPeriod.Yearly,
                price_per_credit: 0.035,
                price: 499.99,
                credit_per_month: 5000,
                price_id: "price_1QMSARK8QxdE3RUI3ptRy4Mz",
                extra_info: subscriptionBasicRights,
                ...subscriptionDefaultSettings,
            },
            {
                name: SubscriptionPlanName.Premium,
                period: SubscriptionPlanPeriod.Monthly,
                price_per_credit: 0.03,
                price: 129.99,
                credit_per_month: 16000,
                price_id: "price_1QMSAMK8QxdE3RUIAH8qOEVS",
                extra_info: subscriptionPremiumRights,
                ...subscriptionDefaultSettings,
            },
            {
                name: SubscriptionPlanName.Premium,
                period: SubscriptionPlanPeriod.Yearly,
                price_per_credit: 0.03,
                price: 1299.99,
                credit_per_month: 16000,
                price_id: "price_1QMSAMK8QxdE3RUIL4yNMJ3C",
                extra_info: subscriptionPremiumRights,
                ...subscriptionDefaultSettings,
            },
        ],
    },
]
