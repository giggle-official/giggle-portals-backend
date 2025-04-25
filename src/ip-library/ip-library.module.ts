import { forwardRef, Module } from "@nestjs/common"
import { IpLibraryController } from "./ip-library.controller"
import { IpLibraryService } from "./ip-library.service"
import { PrismaService } from "src/common/prisma.service"
import { UtilitiesService } from "src/common/utilities.service"
import { AssetsModule } from "src/assets/assets.module"
import { UserModule } from "src/user/user.module"
import { CreditModule } from "src/credit/credit.module"
import { Web3Module } from "src/web3/web3.module"
import { LicenseService } from "./license/license.service"
import { LicenseController } from "./license/license.controller"
import { IpNameValidator } from "./ip-library.validator"
import { AnnouncementController } from "./announcement/announcement.controller"
import { AnnouncementService } from "./announcement/announcement.service"
import { CommentsController } from "./comments/comments.controller"
import { CommentsService } from "./comments/comments.service"
import { JwtCaslAbilityFactory } from "src/casl/casl-ability.factory/jwt-casl-ability.factory"
import { IpOrderController } from "./ip-order/ip-order.controller"
import { IpOrderService } from "./ip-order/ip-order.service"
import { PaymentModule } from "src/payment/payment.module"

@Module({
    imports: [
        forwardRef(() => AssetsModule),
        forwardRef(() => UserModule),
        forwardRef(() => CreditModule),
        forwardRef(() => Web3Module),
        forwardRef(() => PaymentModule),
    ],
    controllers: [
        IpLibraryController,
        LicenseController,
        AnnouncementController,
        CommentsController,
        IpOrderController,
    ],
    providers: [
        IpLibraryService,
        PrismaService,
        UtilitiesService,
        LicenseService,
        IpNameValidator,
        AnnouncementService,
        CommentsService,
        JwtCaslAbilityFactory,
        IpOrderService,
    ],
    exports: [IpLibraryService, LicenseService],
})
export class IpLibraryModule {}
