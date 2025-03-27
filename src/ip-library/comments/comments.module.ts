import { Module } from "@nestjs/common"
import { CommentsController } from "./comments.controller"
import { CommentsService } from "./comments.service"
import { PrismaService } from "src/common/prisma.service"
import { IpLibraryService } from "../ip-library.service"
import { IpLibraryModule } from "../ip-library.module"

@Module({
    imports: [IpLibraryModule],
    controllers: [CommentsController],
    providers: [CommentsService, PrismaService],
    exports: [CommentsService],
})
export class CommentsModule {}
