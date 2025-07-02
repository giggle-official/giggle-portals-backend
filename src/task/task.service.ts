import { forwardRef, Inject, Injectable, InternalServerErrorException } from "@nestjs/common"
import { lastValueFrom } from "rxjs"
import { HttpService } from "@nestjs/axios"
import { TaskCreateDto, TaskCreateResponseDto, TaskQueryDto, TaskQueryResponseDto } from "./task.dto"
import { Logger } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"

@Injectable()
export class TaskService {
    private readonly taskUrl: string
    private readonly logger = new Logger(TaskService.name)

    constructor(
        private readonly httpService: HttpService,
        private readonly prismaService: PrismaService,
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
}
