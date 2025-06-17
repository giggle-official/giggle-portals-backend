import { Injectable } from "@nestjs/common"
import { HttpService } from "@nestjs/axios"
import axios from "axios"
import https from "https"
import { lastValueFrom } from "rxjs"
import { PrismaService } from "src/common/prisma.service"
import { HttpsProxyAgent } from "https-proxy-agent"

@Injectable()
export class EventsNotifyService {
    constructor(
        private notifyRequestService: HttpService,
        private prisma: PrismaService,
    ) {
        if (process.env.HTTP_PROXY) {
            this.notifyRequestService = new HttpService(
                axios.create({
                    httpsAgent: new HttpsProxyAgent(process.env.HTTP_PROXY, { keepAlive: false, timeout: 500 }),
                }),
            )
        } else {
            this.notifyRequestService = new HttpService(
                axios.create({
                    httpsAgent: new https.Agent({ keepAlive: false, timeout: 500 }),
                }),
            )
        }
    }

    async sendEvent(url: string, data: any): Promise<void> {
        const res = await lastValueFrom(this.notifyRequestService.post(url, data))
        await this.prisma.event_notify.create({
            data: {
                url,
                event: data?.event,
                data: data,
                res: res.data,
                res_code: res.status,
            },
        })
    }
}
