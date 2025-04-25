import { forwardRef, Inject, Injectable, InternalServerErrorException } from "@nestjs/common"
import { lastValueFrom } from "rxjs"
import { HttpService } from "@nestjs/axios"
import { TaskCreateDto, TaskCreateResponseDto, TaskQueryDto, TaskQueryResponseDto } from "./task.dto"
import { Logger } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { CreditService } from "src/credit/credit.service"

@Injectable()
export class TaskService {
    private readonly taskUrl: string
    private readonly logger = new Logger(TaskService.name)

    constructor(
        private readonly httpService: HttpService,
        private readonly prismaService: PrismaService,
        @Inject(forwardRef(() => CreditService))
        private readonly creditService: CreditService,
    ) {
        this.taskUrl = process.env.UNIVERSAL_STIMULATOR_TASK_URL
        if (!this.taskUrl) {
            throw new Error("UNIVERSAL_STIMULATOR_TASK_URL is not defined in the environment variables")
        }
    }

    async taskCreateRequest(request: TaskCreateDto): Promise<TaskCreateResponseDto<any>> {
        try {
            this.logger.log(`Task create request: ${JSON.stringify(request)}`)
            const response = await lastValueFrom(
                this.httpService.post(this.taskUrl, request, {
                    headers: {
                        "Content-Type": "application/json",
                        "Cache-Control": "no-cache",
                    },
                }),
            )
            this.logger.log(`Task create response: ${JSON.stringify(response.data)}`)
            return response.data
        } catch (error) {
            this.logger.error(
                `Error creating task: ${error.message}, requestParams: ${JSON.stringify(request)}, postUrl: ${this.taskUrl}`,
                error.stack,
            )
            throw new InternalServerErrorException("Failed to create task")
        }
    }

    async taskQueryRequest(request: TaskQueryDto): Promise<TaskQueryResponseDto<any>> {
        try {
            this.logger.log(`Task query request: ${JSON.stringify(request)}`)
            const response = await lastValueFrom(
                this.httpService.post(this.taskUrl, request, {
                    headers: {
                        "Content-Type": "application/json",
                        "Cache-Control": "no-cache",
                    },
                }),
            )
            this.logger.log(
                `Task query response: ${JSON.stringify(response.data)}, requestParams: ${JSON.stringify(request)}`,
            )
            return response.data
        } catch (error) {
            this.logger.error(
                `Error querying task: ${error.message}, requestParams: ${JSON.stringify(request)}, postUrl: ${this.taskUrl}`,
                error.stack,
            )
            throw new InternalServerErrorException("Failed to query task")
        }
    }

    //disable cron job
    // @Cron(CronExpression.EVERY_30_SECONDS, {
    //     name: "checkTaskStatus",
    // })
    async checkTaskStatus() {
        const processingId = 1
        // Sleep random time (0-1000ms) to prevent concurrent requests
        await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 1000)))

        // Check if another instance is already processing
        const processing = await this.prismaService.ai_router_requesting.findFirst({
            where: {
                id: processingId,
            },
        })

        if (processing.is_requesting && processing.updated_at > new Date(Date.now() - 1000 * 60 * 5)) {
            this.logger.log("Another instance is already processing videos, skipping...")
            return
        }

        const start = new Date()
        this.logger.log("Starting to check task status")
        //update requesting status
        await this.prismaService.ai_router_requesting.update({
            where: { id: processingId },
            data: { is_requesting: true, updated_at: new Date() },
        })

        //credit
        await this.creditService.processCredits()

        //update requesting status
        await this.prismaService.ai_router_requesting.update({
            where: { id: processingId },
            data: { is_requesting: false, updated_at: new Date() },
        })
        this.logger.log(`Finished checking task status in ${new Date().getTime() - start.getTime()}ms`)
    }
}
