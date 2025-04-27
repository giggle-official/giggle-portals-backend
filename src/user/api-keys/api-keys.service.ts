import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { UserJwtExtractDto } from "../user.controller"
import { UtilitiesService } from "src/common/utilities.service"

@Injectable()
export class ApiKeysService {
    constructor(private readonly prismaService: PrismaService) {}
    async list(user: UserJwtExtractDto) {
        const records = await this.prismaService.user_api_keys.findMany({
            where: { user: user.usernameShorted, discarded: false },
        })
        return records.map((record) => {
            return {
                ...record,
                //api_key: record.api_key.replace(/^(.{4}).*(.{4})$/, "$1********$2"),
            }
        })
    }

    async generate(user: UserJwtExtractDto) {
        const userInfo = await this.prismaService.users.findUnique({
            where: { username_in_be: user.usernameShorted },
            include: {
                user_api_keys: {
                    where: { discarded: false },
                },
            },
        })
        if (!userInfo) {
            throw new NotFoundException("User not found")
        }
        if (userInfo.user_api_keys.length >= 10) {
            throw new BadRequestException("User has reached the maximum number of API keys")
        }
        await this.prismaService.user_api_keys.create({
            data: { user: userInfo.username_in_be, api_key: UtilitiesService.generateRandomApiKey() },
        })
        return this.list(user)
    }

    async disable(user: UserJwtExtractDto, id: number) {
        const apiKeyInfo = await this.prismaService.user_api_keys.findFirst({
            where: { user: user.usernameShorted, id },
        })

        if (!apiKeyInfo) {
            throw new NotFoundException("API key not found")
        }

        await this.prismaService.user_api_keys.update({
            where: { id: apiKeyInfo.id },
            data: { discarded: true },
        })
        return this.list(user)
    }
}
