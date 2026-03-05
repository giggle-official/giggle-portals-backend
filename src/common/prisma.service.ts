import { Injectable, OnModuleInit } from "@nestjs/common"
import { PrismaClient } from "@prisma/client"

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
    constructor() {
        super({
            transactionOptions: {
                maxWait: 10000,
                timeout: 30000,
            },
        })
    }

    async onModuleInit() {
        await this.$connect()
    }
}
