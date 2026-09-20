import { HttpStatus, Injectable, Logger } from "@nestjs/common"
import { Cron, CronExpression } from "@nestjs/schedule"
import { PrismaService } from "src/common/prisma.service"
import { UserInfoDTO } from "../user.controller"
import { Decimal } from "@prisma/client/runtime/library"

export class CreateLogDto {
    product: "web" | "openapi"
    action: string
    detail: any
    status: HttpStatus | "success" | "failed"
}
/** How many of the newest user_logs rows to keep. Temporary migration measure —
 *  see cleanupOldLogs below. */
const KEEP_LATEST_LOGS = 5000

type SanitizeOptions = {
    sensitiveFields?: string[]
    maskChar?: string
    maxDepth?: number
}

@Injectable()
export class LogsService {
    constructor(private readonly prismaService: PrismaService) { }
    private readonly logger = new Logger(LogsService.name)

    async create(userInfo: UserInfoDTO, body: CreateLogDto) {
        try {
            const data = {
                user: userInfo?.usernameShorted || "",
                product: body.product,
                action: body.action,
                detail: this.sanitizeLogData(body.detail),
                status: body.status.toString(),
            }
            await this.prismaService.user_logs.create({
                data,
            })
        } catch (error) {
            this.logger.error(`fail to record user log: ${error}`)
        }
    }

    sanitizeLogData(data: any, options: SanitizeOptions = {}, depth = 0): any {
        const {
            sensitiveFields = ["password", "token", "secret", "key", "ssn", "access_key", "secret_key"],
            maskChar = "******",
            maxDepth = 20,
        } = options

        // Prevent infinite recursion
        if (depth > maxDepth) return "[Max Depth Reached]"

        // Handle null/undefined
        if (data == null) return data

        // Handle arrays
        if (Array.isArray(data)) {
            return data.map((item) => this.sanitizeLogData(item, options, depth + 1))
        }

        // Handle objects
        if (typeof data === "object") {
            const sanitized = {}
            for (const [key, value] of Object.entries(data)) {
                // Check if key contains sensitive information
                if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
                    sanitized[key] = maskChar
                } else {
                    sanitized[key] = this.sanitizeLogData(value, options, depth + 1)
                }
                //convert decimal to number
                if (value instanceof Decimal) {
                    sanitized[key] = value.toNumber()
                }
            }
            return sanitized
        }

        // Return primitive values as-is
        return data
    }

    /** Retention is capped by row count instead of age while the AWS -> Alibaba
     *  Cloud migration is in flight: user_logs is by far the largest table and the
     *  dump has to stay small. Put the time window back (7 days) once the
     *  migration is done. */
    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async cleanupOldLogs() {
        try {
            // id is autoincrement, so id order is insert order: find the id of the
            // oldest row worth keeping and drop everything below it.
            const [oldestKept] = await this.prismaService.user_logs.findMany({
                select: { id: true },
                orderBy: { id: "desc" },
                skip: KEEP_LATEST_LOGS - 1,
                take: 1,
            })

            if (!oldestKept) {
                // fewer rows than the cap, nothing to clean up
                return
            }

            const result = await this.prismaService.user_logs.deleteMany({
                where: {
                    id: {
                        lt: oldestKept.id,
                    },
                },
            })
            this.logger.log(`Cleaned up ${result.count} old log entries, kept the latest ${KEEP_LATEST_LOGS}`)
        } catch (error) {
            this.logger.error(`Failed to clean up old logs: ${error}`)
        }
    }
}
