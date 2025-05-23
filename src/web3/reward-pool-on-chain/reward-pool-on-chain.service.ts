import { Injectable } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { CreatePoolDto } from "./reward-pool-on-chain.dto"

@Injectable()
export class RewardPoolOnChainService {
    constructor(private readonly prisma: PrismaService) {}

    async create(dto: CreatePoolDto) {}
}
