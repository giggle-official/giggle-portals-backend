import { Module } from "@nestjs/common"
import { CookieService } from "./cookie.service"
import { CookieController } from "./cookie.controller"
import { PrismaService } from "src/common/prisma.service"

@Module({
    imports: [],
    controllers: [CookieController],
    providers: [CookieService, PrismaService],
    exports: [CookieService],
})
export class CookieModule { }
