import { Injectable } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { AppendAccessLogDto } from "./stats.dto"

@Injectable()
export class StatsService {
    constructor(private readonly prisma: PrismaService) {}

    async appendAccessLog(body: AppendAccessLogDto): Promise<void> {
        await this.prisma.widget_access_log.create({
            data: {
                device_id: body?.device_id,
                app_id: body?.app_id,
                widget_tag: body?.widget_tag,
                link_id: body?.link_id,
                user: body?.user,
            },
        })
    }
}
