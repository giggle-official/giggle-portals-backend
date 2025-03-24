import { forwardRef, Module } from "@nestjs/common"
import { HttpModule } from "@nestjs/axios"
import { GiggleController } from "./giggle/giggle.controller"
import { GiggleService } from "./giggle/giggle.service"
import { AssetsModule } from "src/assets/assets.module"
import { PrismaService } from "src/common/prisma.service"
import { UtilitiesService } from "src/common/utilities.service"
import { UserModule } from "src/user/user.module"
import { IpOnChainService } from "./ip-on-chain/ip-on-chain.service"
import { IpLibraryModule } from "src/ip-library/ip-library.module"
import { PriceController } from "./price/price.controller"
import { PriceService } from "./price/price.service"

@Module({
    imports: [
        HttpModule,
        forwardRef(() => AssetsModule),
        forwardRef(() => UserModule),
        forwardRef(() => IpLibraryModule),
    ],
    providers: [GiggleService, PrismaService, UtilitiesService, IpOnChainService, PriceService],
    controllers: [GiggleController, PriceController],
    exports: [GiggleService, IpOnChainService, PriceService],
})
export class Web3Module {}
