import { Controller } from "@nestjs/common"
import { ApiExcludeController } from "@nestjs/swagger"
@ApiExcludeController()
@Controller({ path: "api/v1/payment" })
export class PaymentController {
    constructor() {}
}
