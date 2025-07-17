import { Module } from "@nestjs/common"
import { AppController } from "./app.controller"
import { ConfigModule } from "@nestjs/config"
import { AppService } from "./app.service"
import { ScheduleModule } from "@nestjs/schedule"
import { GoogleRecaptchaModule } from "@nestlab/google-recaptcha"
import { UserModule } from "./user/user.module"
import { AuthModule } from "./auth/auth.module"
import { NotificationModule } from "./notification/notification.module"
import { PaymentModule } from "./payment/payment.module"
import { AssetsModule } from "./assets/assets.module"
import { TaskModule } from "./task/task.module"
import { AdminModule } from "./admin/admin.module"
import { IpLibraryModule } from "./ip-library/ip-library.module"
import { Web3Module } from "./web3/web3.module"
import { OpenAppModule } from "./open-app/open-app.module"
import { DashboardModule } from "./dashboard/dashboard.module"
import { DocsModule } from "./docs/docs.module"
import { StatsModule } from "./stats/stats.module"
import { BullModule } from "@nestjs/bullmq"
import { Cluster } from "ioredis"

@Module({
    imports: [
        ConfigModule.forRoot(),
        ScheduleModule.forRoot(),
        GoogleRecaptchaModule.forRoot({
            secretKey: process.env.GOOGLE_RECAPTCHA_SECRET_KEY,
            response: (req) => req.body.recaptcha,
            skipIf: process.env.ENV !== "product",
        }),
        UserModule,
        AuthModule,
        NotificationModule,
        PaymentModule,
        AssetsModule,
        TaskModule,
        AdminModule,
        IpLibraryModule,
        Web3Module,
        OpenAppModule,
        DashboardModule,
        DocsModule,
        StatsModule,
        //queue
        BullModule.forRoot({
            connection: new Cluster(
                [
                    {
                        //user: process.env.REDIS_USER,
                        host: process.env.REDIS_HOST,
                        port: parseInt(process.env.REDIS_PORT),
                        //password: process.env.REDIS_PASSWORD,
                    },
                ],
                {
                    redisOptions: {
                        username: process.env.REDIS_USER,
                        password: process.env.REDIS_PASSWORD,

                        tls: {},
                    },
                },
            ),
            prefix: process.env.REDIS_PREFIX,
        }),
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {}
