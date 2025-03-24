import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    RawBodyRequest,
    ParseIntPipe,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
    Param,
} from "@nestjs/common"
import { AuthGuard } from "@nestjs/passport"
import { AddCreditsDto, CreateSubscriptionDto } from "./payment.dto"
import { PaymentService } from "./payment.service"
import { Request } from "express"
import { UserInfoDTO } from "src/user/user.controller"
import Stripe from "stripe"
import { CreditService } from "src/credit/credit.service"
import { ApiExcludeController } from "@nestjs/swagger"
import { subscriptionPlans } from "./plans.config"
@ApiExcludeController()
@Controller({ path: "api/v1/payment" })
export class PaymentController {
    constructor(
        private readonly paymentService: PaymentService,
        private readonly creditService: CreditService,
    ) {}
    @Post("/subscription")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async subscription(@Req() req: Request, @Body() subscriptionInfo: CreateSubscriptionDto) {
        return this.paymentService.subscription(req.user as UserInfoDTO, subscriptionInfo)
    }

    @Get("/plans")
    async getPlans() {
        if (process.env.ENV === "product") {
            return subscriptionPlans.find((plan) => plan.env === "product").plans
        } else {
            return subscriptionPlans.find((plan) => plan.env === "test").plans
        }
    }

    @Get("/credit-price/:credits")
    @UseGuards(AuthGuard("jwt"))
    async getCreditPrice(@Param("credits") credits: number) {
        return this.paymentService.getCreditPrice(credits)
    }

    @Get("/manage")
    @UseGuards(AuthGuard("jwt"))
    async getSubscriptionManage(@Req() req: Request) {
        return this.paymentService.getSubscriptionManage(req.user as UserInfoDTO)
    }

    @Get("/subscription")
    @UseGuards(AuthGuard("jwt"))
    async getUserSubscriptionStatus(@Req() req: Request) {
        return this.paymentService.getSubscription(req.user as UserInfoDTO)
    }

    @Post("/stripe/webhook")
    async processStripeWebhook(@Req() req: RawBodyRequest<Request>) {
        const localRecord = await this.paymentService.recordStripeEvent(req)
        const eventType = (localRecord.raw_data as unknown as Stripe.Event).type
        switch (eventType) {
            case "invoice.paid":
                return this.paymentService.stripeInvoicePaid(localRecord.id)
            default:
                return {}
        }
    }

    @Post("/add-credit")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    async addCredits(@Req() req: Request, @Body() body: AddCreditsDto) {
        return this.paymentService.addCredit(req.user as UserInfoDTO, body.amount)
    }

    /*
    @Get("/stripe/webhook/invoice/:logid")
    async reprocessInvoice(@Param("logid") logid: string) {
        return this.paymentService.reprocessInvoice(logid)
    }

    @Get("/credit/refund/:relatedId")
    async refundCredit(@Param("relatedId") relatedId: string) {
        return this.creditService.refundCredit(relatedId)
    }

    @Get("/credit/pending/:amount")
    @UseGuards(AuthGuard("jwt"))
    async pendingCredit(@Req() req: Request, @Param("amount", new ParseIntPipe()) amount: number) {
        return this.creditService.pendingCredit(req.user as UserInfoDTO, amount, "test")
    }

    @Get("/credit/complete/:relatedId")
    @UseGuards(AuthGuard("jwt"))
    async completeCredit(@Req() req: Request, @Param("relatedId") relatedId: string) {
        return this.creditService.completeCredit(relatedId)
    }
    */

    @Get("/credit/history")
    @UseGuards(AuthGuard("jwt"))
    async getCreditConsumeHistory(
        @Req() req: Request,
        @Query("lastDays", new ParseIntPipe()) lastDays: number,
        @Query("take", new ParseIntPipe()) take: number,
        @Query("skip", new ParseIntPipe()) skip: number,
    ) {
        return this.creditService.getCreditConsumeHistory(req.user as UserInfoDTO, take, skip, lastDays)
    }
}
