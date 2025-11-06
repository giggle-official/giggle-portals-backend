import { Module } from "@nestjs/common"
import { CaslAbilityFactory } from "./casl-ability.factory/casl-ability.factory"
import { PrismaService } from "src/common/prisma.service"
import { WidgetCaslAbilityFactory } from "./casl-ability.factory/widget-casl-ability.factory"

@Module({
    providers: [CaslAbilityFactory, PrismaService, WidgetCaslAbilityFactory],
    exports: [CaslAbilityFactory, WidgetCaslAbilityFactory],
})
export class CaslModule {}
