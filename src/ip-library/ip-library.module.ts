import { forwardRef, Module } from "@nestjs/common"
import { IpLibraryController } from "./ip-library.controller"
import { IpLibraryService } from "./ip-library.service"
import { PrismaService } from "src/common/prisma.service"
import { UtilitiesService } from "src/common/utilities.service"
import { AssetsModule } from "src/assets/assets.module"
import { UserModule } from "src/user/user.module"
import { Web3Module } from "src/web3/web3.module"
import { IpNameValidator } from "./ip-library.validator"
import { AnnouncementController } from "./announcement/announcement.controller"
import { AnnouncementService } from "./announcement/announcement.service"
import { CommentsController } from "./comments/comments.controller"
import { CommentsService } from "./comments/comments.service"
import { WidgetCaslAbilityFactory } from "src/casl/casl-ability.factory/widget-casl-ability.factory"
import { IpOrderController } from "./ip-order/ip-order.controller"
import { IpOrderService } from "./ip-order/ip-order.service"
import { PaymentModule } from "src/payment/payment.module"
import { BlueprintService } from "./blueprint/blueprint.service"
import { HttpModule } from "@nestjs/axios"
import { BlueprintController } from "./blueprint/blueprint.controller"
import { NotificationModule } from "src/notification/notification.module"
import { PdfService } from "src/common/pdf.service"
import { MarketMakerController } from "./market-maker/market-maker.controller"
import { MarketMakerService } from "./market-maker/market-maker.service"

@Module({
    imports: [
        forwardRef(() => AssetsModule),
        forwardRef(() => UserModule),
        forwardRef(() => PaymentModule),
        forwardRef(() => Web3Module),
        HttpModule,
        NotificationModule,
    ],
    controllers: [
        IpLibraryController,
        AnnouncementController,
        CommentsController,
        IpOrderController,
        BlueprintController,
        MarketMakerController,
    ],
    providers: [
        IpLibraryService,
        PrismaService,
        UtilitiesService,
        IpNameValidator,
        AnnouncementService,
        CommentsService,
        WidgetCaslAbilityFactory,
        IpOrderService,
        BlueprintService,
        PdfService,
        MarketMakerService,
    ],
    exports: [IpLibraryService],
})
export class IpLibraryModule {}
