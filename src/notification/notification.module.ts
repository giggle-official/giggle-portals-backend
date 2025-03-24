import { Module } from "@nestjs/common"
import { NotificationService } from "./notification.service"
import { MailgunModule } from "nestjs-mailgun"

@Module({
    imports: [
        MailgunModule.forRoot({
            username: "api",
            key: process.env.MAILGUN_API_KEY,
        }),
    ],
    providers: [NotificationService],
    exports: [NotificationService],
})
export class NotificationModule {}
