import { Module } from "@nestjs/common"
import { NotificationService } from "./notification.service"
import { MailgunModule } from "nestjs-mailgun"
import { EventsNotifyService } from "./events-notify/events-notify.service"
import { HttpModule } from "@nestjs/axios"
import { PrismaService } from "src/common/prisma.service"

@Module({
    imports: [
        MailgunModule.forRoot({
            username: "api",
            key: process.env.MAILGUN_API_KEY,
        }),
        HttpModule,
    ],
    providers: [NotificationService, PrismaService, EventsNotifyService],
    exports: [NotificationService, EventsNotifyService],
})
export class NotificationModule {}
