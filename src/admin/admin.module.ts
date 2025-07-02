import { Module } from "@nestjs/common"
import { IpLibraryController } from "./ip-library/ip-library.controller"
import { IpLibraryService } from "./ip-library/ip-library.service"
import { AdminAuthController } from "./auth/auth.controller"
import { AdminAuthService } from "./auth/auth.service"
import { HttpModule } from "@nestjs/axios"
import { UserModule } from "src/user/user.module"
import { JwtModule } from "@nestjs/jwt"
import { PrismaService } from "src/common/prisma.service"
import { CaslAbilityFactory } from "src/casl/casl-ability.factory/casl-ability.factory"
import { RolesController } from "./roles/roles.controller"
import { RolesService } from "./roles/roles.service"
import { UtilitiesService } from "src/common/utilities.service"
import { AssetsModule } from "src/assets/assets.module"
import { UsersController } from "./users/users.controller"
import { UsersService } from "./users/users.service"
import { PaymentModule } from "src/payment/payment.module"
@Module({
    controllers: [IpLibraryController, AdminAuthController, RolesController, UsersController],
    providers: [
        IpLibraryService,
        AdminAuthService,
        RolesService,
        PrismaService,
        CaslAbilityFactory,
        UtilitiesService,
        UsersService,
    ],
    imports: [
        JwtModule.register({
            secret: process.env.SESSION_SECRET,
            signOptions: { expiresIn: "24h" },
        }),
        HttpModule,
        UserModule,
        AssetsModule,
        PaymentModule,
    ],
})
export class AdminModule {}
