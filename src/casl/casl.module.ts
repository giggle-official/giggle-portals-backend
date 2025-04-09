import { Module } from "@nestjs/common"
import { CaslAbilityFactory } from "./casl-ability.factory/casl-ability.factory"
import { PrismaService } from "src/common/prisma.service"
import { JwtCaslAbilityFactory } from "./casl-ability.factory/jwt-casl-ability.factory"

@Module({
    providers: [CaslAbilityFactory, PrismaService, JwtCaslAbilityFactory],
    exports: [CaslAbilityFactory, JwtCaslAbilityFactory],
})
export class CaslModule {}
